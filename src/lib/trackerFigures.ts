// D3 (Grant, 28 and 29 October 2026): the figures of an automatic tracker dashboard, from the owners that already
// compute them, never from the dashboard layer itself:
//   - per-brand shares (awareness, consideration, ...): one Cross tab per section through computeCrosstab (the
//     computation buildCrosstab saves, here not saved), with the
//     dashboard's weight (D2: weighted by default when the file has one) and the file's survey design, every
//     per-brand variable a row item;
//   - a share is the unrounded percentage (pctExact) of the answer code that means "selected", read by code, never
//     by label: the code whose answer label says selected, yes or mentioned; with no labels, code 1 of a variable
//     whose only answers are 0 and 1; with only code 0 labelled as its opposite ("No", "Not selected"), code 1. A variable whose selected code cannot be told is "not available" with the
//     reason, never 0. A brand nobody selected, where the selected code is known, is 0 of a stated base;
//   - change against the compared wave (the previous included wave by default, or the researcher's choice; the
//     project's wave files, src/lib/waves.ts) is this wave's unrounded share minus the compared wave's for the same
//     stage, variable name and brand code, the code naming the same brand and the variable the same question in both
//     waves, in percentage points; anything else has no change, said so. Its significance is trackerWaveChange.ts's.
// The base is the unweighted number of valid answers (the table's base row); the effective base is reported when
// the figures are weighted. Nothing is saved here: no table, no finding.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { isNonAnswerLabel } from "./nonAnswerLabel";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import type { CrosstabResult, CrosstabRow } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { FunnelStage, RoleVariable, TrackerRecognition } from "./trackerRoles";
import type { ChangeTest } from "./trackerWaveChange";

/** The funnel and behaviour stages the brand overview shows, in funnel order, when the file has them. */
export const OVERVIEW_STAGES: readonly FunnelStage[] = ["awareness", "consideration", "shortlist", "first_choice", "trial", "usage", "frequent_usage"];

export type BrandShare = {
  code: string;
  variable: string;
  /** Percentage selecting, unrounded; null when not available (see `reason`). */
  share: number | null;
  /** Unweighted number of valid answers. */
  base: number | null;
  reason?: string;
  /** What a test of this share against another wave needs (shareStatOf); absent from an engine before 2026.10.30. */
  stat?: ShareStat;
};

/**
 * The sampling facts of one share as the engine computed it, for a test against another wave (trackerWaveChange.ts):
 * the Kish effective base of the share's own base, unrounded, and, when a survey design was applied to the file, the
 * share's design-based standard error (percentage points) and the design's degrees of freedom (PSUs minus strata).
 * `designApplied` is the table's own flag (notes.designApplied), never inferred from an `se` being present.
 */
export type ShareStat = { nEff: number; designApplied: boolean; se: number | null; designDf: number | null };

/**
 * The ShareStat of one answer row of a built Cross tab, read from column `k` (the overall column of a table without a
 * banner). Undefined when the engine gave no unrounded effective base (a table from before engine 2026.10.30).
 */
export function shareStatOf(result: CrosstabResult, row: CrosstabRow | undefined, k = 0): ShareStat | undefined {
  const nEff = row?.base?.[k]?.nEffExact;
  if (typeof nEff !== "number" || !Number.isFinite(nEff)) return undefined;
  const designApplied = result.notes?.designApplied === true && !!result.notes.designUsed;
  const used = result.notes?.designUsed;
  return {
    nEff,
    designApplied,
    se: designApplied ? (row?.seExact?.[k] ?? null) : null,
    designDf: designApplied && used ? used.nPsu - used.nStrata : null,
  };
}

export type StageFigures = { stage: FunnelStage; group: string; label: string; byBrand: BrandShare[] };

export type BrandOverviewFigures = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  effectiveBase: number | null;
  stages: StageFigures[];
  /** Stages the overview would show but cannot: two questions claim it, and the researcher has not chosen. */
  unresolvedStages: FunnelStage[];
  /** Why stages with a question have no figures, when none can be counted (Grant, 29 October 2026: a question chosen
   * for awareness "saves but doesn't update the tile"): no brand list, or no chosen question asked about a listed
   * brand. Null when figures were calculated or no stage has a question. */
  noFigures: string | null;
};

/** The code of a yes/no variable that means "selected" (see the file comment); null when it cannot be told. */
export function selectedCode(v: Pick<RoleVariable, "valueLabels">, observedCodes: string[]): string | null {
  const labels = v.valueLabels;
  if (labels && Object.keys(labels).length > 0) {
    const yes = Object.entries(labels).filter(([, l]) => SELECTED_LABEL.test(l.trim()));
    if (yes.length === 1) return yes[0][0];
    // No positive label (Codex D3A-F02): code 1 counts as selected only when the labels say what 0 is, as the
    // opposite of selected ("No", "Not selected", "Not mentioned"), leave 1 unlabelled, and the data holds no code
    // but 0 and 1 (Codex D3AR-F02: {0: No} with codes 0 and 2 gave code 1, absent, and a 0% share). A label on 1, a
    // 0 labelled anything else ("Not applicable") or another code in the data is never overruled: the variable is
    // not available, with the reason. Data holding only 0 reads as nobody selected, as for an unlabelled 0/1 variable.
    if (
      yes.length === 0 &&
      Object.keys(labels).length === 1 &&
      labels["0"] !== undefined &&
      labels["1"] === undefined &&
      NOT_SELECTED_LABEL.test(labels["0"].trim()) &&
      observedCodes.every((c) => c === "0" || c === "1")
    )
      return "1";
    return null;
  }
  return observedCodes.length > 0 && observedCodes.every((c) => c === "0" || c === "1") ? "1" : null;
}

/**
 * An answer label that says "selected" ("Yes", "Selected", "Mentioned", ...). Awareness questions are often labelled
 * "Aware" / "Not aware" or "Heard of" / "Never heard of" instead (Grant, 30 October 2026: aware and not aware make up
 * everyone with a known answer), so those count too. Anchored at the start, so "Not aware" or "Don't know" never match.
 */
const SELECTED_LABEL = /^(selected|yes|mentioned|chosen|ticked|checked|aware|heard of)\b/i;

/**
 * An answer label that says "not selected": the opposite of selected ("No", "Not selected", "Not mentioned", and for
 * awareness "Not aware", "Unaware", "Not heard of (it)", "Never heard of (it)"). Whole label only, so "Not applicable"
 * or "No answer" stay unknown, never counted as not selected.
 */
const NOT_SELECTED_LABEL = /^(no|unaware|not (selected|mentioned|chosen|ticked|checked|aware)|(not|never) heard of( (it|this brand|the brand))?)$/i;

/** Why an answer of a yes/no variable is neither its selected code nor an explicit not selected one. */
export type UnknownAnswerKind = "non_answer" | "unlabelled" | "other_label";

/**
 * Every observed code of a yes/no variable sorted into selected (selectedCode), explicitly not selected, and unknown.
 * Codex D3E-F01: "not the selected code" is not the same as "not selected". A code is not selected only when the
 * answer list says so: its label is the opposite of selected (NOT_SELECTED_LABEL, the rule selectedCode already
 * uses), or the variable has no labels and holds only 0 and 1 (0 is then not selected, as selectedCode reads 1 as
 * selected). Every other code is unknown, never counted on either side: a non-answer label by the engine's rule
 * (nonAnswerLabel.ts, don't know, refused, ...), a code the answer list does not label, or a label that is neither
 * (for example "Maybe"). Null when the selected code itself cannot be told.
 */
export function answerSides(
  v: Pick<RoleVariable, "valueLabels">,
  observedCodes: string[],
): { selected: string; notSelected: string[]; unknown: { code: string; kind: UnknownAnswerKind; label: string | null }[] } | null {
  const selected = selectedCode(v, observedCodes);
  if (selected === null) return null;
  const labels = v.valueLabels && Object.keys(v.valueLabels).length > 0 ? v.valueLabels : null;
  const notSelected: string[] = [];
  const unknown: { code: string; kind: UnknownAnswerKind; label: string | null }[] = [];
  for (const code of observedCodes) {
    if (code === selected) continue;
    if (!labels) {
      // selectedCode reads an unlabelled variable only when it holds nothing but 0 and 1.
      notSelected.push(code);
      continue;
    }
    const label = labels[code]?.trim();
    if (label === undefined || label === "") unknown.push({ code, kind: "unlabelled", label: null });
    else if (NOT_SELECTED_LABEL.test(label)) notSelected.push(code);
    else unknown.push({ code, kind: isNonAnswerLabel(label) ? "non_answer" : "other_label", label });
  }
  return { selected, notSelected, unknown };
}

/** The per-brand questions of one shape the dashboard maps to a stage (the recogniser's stage, or the researcher's
 * saved choice): one is the stage's question, several are the researcher's choice, none means the file has none. */
export function stageClaims(rec: TrackerRecognition, dashboard: ResolvedDashboard, stage: FunnelStage, shape: "binary" | "single" = "binary"): TrackerRecognition["measures"] {
  const stageOf = new Map(dashboard.stages.map((s) => [s.group, s.stage]));
  return rec.measures.filter((m) => stageOf.get(m.group) === stage && m.shape === shape);
}

/** The stage measures the overview shows: one per stage, the researcher's choice where two questions claimed it. */
export function overviewMeasures(rec: TrackerRecognition, dashboard: ResolvedDashboard) {
  const shown: { stage: FunnelStage; measure: TrackerRecognition["measures"][number] }[] = [];
  const unresolved: FunnelStage[] = [];
  for (const stage of OVERVIEW_STAGES) {
    const claims = stageClaims(rec, dashboard, stage);
    if (claims.length === 1) shown.push({ stage, measure: claims[0] });
    else if (claims.length > 1) unresolved.push(stage);
  }
  return { shown, unresolved };
}

/** One answer of a single-choice question as a Cross tab reports it (the total column), by its raw code. */
export type AnswerShare = {
  code: string;
  label: string;
  /** Unrounded percentage of the question's valid answers; null when suppressed. */
  share: number | null;
  /** Unrounded weighted count (the unweighted count when the table is unweighted). */
  weighted: number | null;
  /** Unweighted number of respondents giving this answer. */
  n: number | null;
  /** For a test against another wave: read from the overall column of a table without a banner; absent otherwise. */
  stat?: ShareStat;
};

/**
 * Every answer of a single-choice question, read from the total column of a built Cross tab (so a table with a
 * banner reads the same as one without), by raw code in the engine's order: each answer's unrounded share of the
 * valid answers, weighted count and unweighted count, and the unweighted base of valid answers. Answers are
 * identified by `rawCode`, never by label; a row without a raw code (a net, a mean) is not an answer. Null base and
 * no answers, with the reason, when the question is not in the result.
 */
export function answersOf(result: CrosstabResult, variable: string): { base: number | null; answers: AnswerShare[]; reason?: string } {
  const q = result.questions.find((x) => x.key === variable);
  if (!q) return { base: null, answers: [], reason: "This question was not in the table the engine returned." };
  const base = q.rows.find((r) => r.isBase && !r.isEffBase)?.total.count ?? null;
  const answers = q.rows
    .filter((r) => !r.isBase && !r.isNet && !r.isMean && !r.isScore && r.rawCode !== undefined)
    // The unrounded figure when the engine gives one (null there means suppressed, never read from the rounded one).
    .map((r) => {
      // The total column of a table without a banner is its one overall column, which carries the share's
      // sampling facts; with a banner the total has no standard error, so no stat is given (no test is made).
      const stat = result.overall ? shareStatOf(result, r, 0) : undefined;
      return {
        code: r.rawCode as string,
        label: r.label,
        share: r.total.pctExact !== undefined ? r.total.pctExact : r.total.pct,
        weighted: r.total.countExact !== undefined ? r.total.countExact : r.total.count,
        n: r.total.nCell ?? null,
        ...(stat ? { stat } : {}),
      };
    });
  return { base, answers };
}

/**
 * The ShareStat of answer `code` among a question's answers (answersOf). Every answer of one question has the same
 * base, so an answer nobody gave (0 of a known base) takes its effective base from another answer, with no design
 * variance (a share of 0). Undefined when no answer carries a stat.
 */
export function answerStat(answers: AnswerShare[], code: string): ShareStat | undefined {
  const own = answers.find((a) => a.code === code);
  if (own) return own.stat;
  const other = answers.find((a) => a.stat)?.stat;
  return other ? { ...other, se: other.designApplied ? 0 : null } : undefined;
}

/**
 * The share selecting a yes/no variable, read from one row item of a built Cross tab result (single column, the
 * total): the unrounded percentage of the selected code (selectedCode) among the variable's valid answers, and the
 * unweighted count of those answers as the base. Null with the reason when the item is missing from the result, the
 * selected code cannot be told, there are no valid answers, or the engine suppressed the figure. The one reading of
 * a yes/no share for the tracker dashboards (brand stages, category moments, moment by brand recall).
 */
export function selectedShareOf(result: CrosstabResult, variable: string, v: Pick<RoleVariable, "valueLabels"> | undefined): { share: number | null; base: number | null; reason?: string; stat?: ShareStat } {
  const { share, base, reason, stat } = selectedAnswerOf(result, variable, v);
  return { share, base, ...(reason !== undefined ? { reason } : {}), ...(stat ? { stat } : {}) };
}

/**
 * selectedShareOf with what the share was read from: the selected answer's code (`selectedCode`, by code) and the
 * unweighted number of respondents giving it (`selectedN`, the row's unweighted cell count). The brand associations
 * page uses the code and count of each brand's awareness answer to define that brand's aware base. `code` is null
 * when the selected answer cannot be told; `selectedN` is null when the code is unknown or the engine gave no
 * unweighted cell count, and 0 when the selected code is known but nobody gave it.
 */
export function selectedAnswerOf(
  result: CrosstabResult,
  variable: string,
  v: Pick<RoleVariable, "valueLabels"> | undefined,
): { code: string | null; selectedN: number | null; share: number | null; base: number | null; reason?: string; stat?: ShareStat } {
  const q = result.questions.find((x) => x.key === variable);
  if (!q) return { code: null, selectedN: null, share: null, base: null, reason: "This question was not in the table the engine returned." };
  const rows: CrosstabRow[] = q.rows;
  const base = rows.find((r) => r.isBase && !r.isEffBase)?.count[0] ?? null;
  const cats = rows.filter((r) => !r.isBase && !r.isNet && !r.isMean && !r.isScore && r.rawCode !== undefined);
  const sel = selectedCode(v ?? {}, cats.map((r) => r.rawCode as string));
  if (sel === null) return { code: null, selectedN: null, share: null, base, reason: "Which answer means selected could not be told from its codes and labels." };
  const row = cats.find((r) => r.rawCode === sel);
  const selectedN = row ? (row.nCell?.[0] ?? null) : 0;
  if (base === null || base === 0) return { code: sel, selectedN, share: null, base, reason: "No valid answers." };
  const exact = row ? (row.pctExact?.[0] ?? row.pct[0]) : 0;
  // Every answer row of the variable has the same base, so a selected code nobody gave reads its base's effective
  // size from another row (its share is 0, with no design variance).
  const stat = shareStatOf(result, row ?? cats[0], 0);
  const statOut = stat && !row ? { ...stat, se: stat.designApplied ? 0 : null } : stat;
  return { code: sel, selectedN, share: exact ?? null, base, ...(exact === null ? { reason: "Suppressed for a small base." } : {}), ...(statOut ? { stat: statOut } : {}) };
}

/** Shares of every brand of each stage measure, read from a built Cross tab result (by variable and code). */
export function sharesFromResult(result: CrosstabResult, measures: { stage: FunnelStage; measure: TrackerRecognition["measures"][number] }[], variables: Map<string, RoleVariable>, brandCodes: Set<string>): StageFigures[] {
  return measures.map(({ stage, measure }) => ({
    stage,
    group: measure.group,
    label: measure.label,
    byBrand: measure.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => ({ code: b.code, variable: b.variable, ...selectedShareOf(result, b.variable, variables.get(b.variable)) })),
  }));
}

/**
 * The brand overview's figures for one data file: every brand's share at each overview stage, from one Cross tab.
 * Throws with the reason when the file's set-up, dictionary or table cannot be read (never an empty overview).
 */
export async function brandOverviewFigures(
  tenantId: string,
  runId: string,
  documentId: string,
  rec: TrackerRecognition,
  dashboard: ResolvedDashboard,
  variables: RoleVariable[],
): Promise<BrandOverviewFigures> {
  const { shown, unresolved } = overviewMeasures(rec, dashboard);
  const brandCodes = new Set(dashboard.brands.map((b) => b.code));
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const base: Omit<BrandOverviewFigures, "stages" | "effectiveBase" | "noFigures"> = { documentId, weighted: weightVar !== null, weightVar, unresolvedStages: unresolved };
  const rowVars = shown.flatMap(({ measure }) => measure.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable));
  if (rowVars.length === 0) {
    const noFigures =
      shown.length === 0
        ? null
        : dashboard.brands.length === 0
          ? "A question is chosen, but no brand list was found in this file, so there is nothing to count. Link the codebook on Import so the brand names are read, or check the file has its answer labels."
          : "A question is chosen, but it is not asked about any brand in this file's brand list. Check the brand list under Customise, or choose another question.";
    return { ...base, stages: [], effectiveBase: null, noFigures };
  }
  const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
  if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
  const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
  const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
  // Computed, not saved: opening the dashboard must not add a table to the file each time (computeCrosstab).
  const { result } = await computeCrosstab(tenantId, runId, documentId, {
    columnVars: [],
    rowItems: rowVars.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] })),
    weightVar,
    design,
  });
  return {
    ...base,
    noFigures: null,
    stages: sharesFromResult(result, shown, new Map(variables.map((v) => [v.name, v])), brandCodes),
    effectiveBase: weightVar ? result.total?.nEff ?? null : null,
  };
}

/**
 * The identity rule for a code compared across two waves (a brand, or a CSM company): the code is the same thing in both
 * only when both waves' answer lists name it and the names agree (trimmed, ignoring case). A code reused for another
 * name, or missing from either list, is not the same thing, so no change is computed for it. Returns null when the code
 * names the same thing in both waves, else the reason, worded with `noun` ("Brand", "Company") and the list's name.
 */
export function codeNamesDiffer(
  code: string,
  current: { code: string; label: string }[],
  previous: { code: string; label: string }[],
  noun: string,
  listName: string,
): string | null {
  const name = (list: { code: string; label: string }[], c: string) => list.find((x) => x.code === c)?.label.trim().toLowerCase();
  const now = name(current, code);
  const then = name(previous, code);
  if (now && then && now === then) return null;
  const was = previous.find((x) => x.code === code)?.label;
  return was ? `${noun} code ${code} was ${was} in the compared wave, so it is not compared.` : `${noun} code ${code} is not in the compared wave's ${listName}.`;
}

/** A question's wording compared across waves: case, spacing and surrounding white space ignored. */
const wordingKey = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The identity rule for a question compared across two waves (R5 waves, Grant 30 October 2026): a variable is the same
 * question in both waves only when the comparison wave has a variable of the same name, with the same wording (its
 * label, case and spacing ignored) and the same answer codes (the codes of its answer list; neither wave having a list
 * counts as the same). Matching is by variable identity and code only, never by label or position: a wording or an
 * answer list that changed means a different question, so no change is computed for it. Returns null when it is the
 * same question, else the reason.
 */
export function questionDiffers(variable: string, current: Pick<RoleVariable, "label" | "valueLabels"> | undefined, previous: Pick<RoleVariable, "label" | "valueLabels"> | undefined): string | null {
  if (!previous) return `${variable} is not in the compared wave's file.`;
  if (!current) return `${variable} is not in this wave's file.`;
  if (wordingKey(current.label) !== wordingKey(previous.label))
    return `The wording of ${variable} changed between the waves ("${previous.label ?? ""}" then, "${current.label ?? ""}" now), so it is not compared.`;
  const codes = (v: Pick<RoleVariable, "valueLabels">) => Object.keys(v.valueLabels ?? {}).sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  const now = codes(current);
  const then = codes(previous);
  if (now.join("|") !== then.join("|"))
    return `The answer codes of ${variable} changed between the waves (${then.join(", ") || "none"} then, ${now.join(", ") || "none"} now), so it is not compared.`;
  return null;
}

/**
 * The identity rule for one answer code of a question compared across waves: the code names the same answer in both
 * waves' answer lists (codeNamesDiffer, the brand rule, with "Answer"). A question with no answer list in either wave
 * is read by code alone. Null when the answer is the same, else the reason.
 */
export function answerDiffers(code: string, current: Pick<RoleVariable, "valueLabels"> | undefined, previous: Pick<RoleVariable, "valueLabels"> | undefined): string | null {
  const list = (v: Pick<RoleVariable, "valueLabels"> | undefined) => Object.entries(v?.valueLabels ?? {}).map(([c, label]) => ({ code: c, label }));
  const now = list(current);
  const then = list(previous);
  if (now.length === 0 && then.length === 0) return null;
  return codeNamesDiffer(code, now, then, "Answer", "answer list");
}

export type StageChange = {
  stage: FunnelStage;
  code: string;
  current: number | null;
  previous: number | null;
  changePp: number | null;
  reason?: string;
  /** The significance of the change (trackerWaveChange.ts), when one was asked for. */
  test?: ChangeTest;
};

/**
 * This wave's shares against the compared wave's (the previous included wave by default, or the researcher's choice),
 * unrounded, in percentage points. A share is compared only with the compared wave's share for the same stage, the
 * same variable and the same brand code (Codex D3A-F03); when both waves' brand lists are given, only when that code
 * names the same brand in both (codeNamesDiffer); and when both waves' variables are given, only when the variable is
 * the same question in both (questionDiffers: same wording, same answer codes). Otherwise there is no change, with
 * the reason.
 */
export function changesAgainst(
  current: StageFigures[],
  previous: StageFigures[] | null,
  brands?: { current: { code: string; label: string }[]; previous: { code: string; label: string }[] },
  questions?: { current: Map<string, RoleVariable>; previous: Map<string, RoleVariable> },
): StageChange[] {
  const key = (stage: string, variable: string, code: string) => `${stage}|${variable}|${code}`;
  const prev = new Map((previous ?? []).flatMap((s) => s.byBrand.map((b) => [key(s.stage, b.variable, b.code), b] as const)));
  return current.flatMap((s) =>
    s.byBrand.map((b): StageChange => {
      if (!previous) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "No earlier wave." };
      const p = prev.get(key(s.stage, b.variable, b.code));
      if (!p) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "Not asked about this brand in the compared wave." };
      if (brands) {
        const differs = codeNamesDiffer(b.code, brands.current, brands.previous, "Brand", "brand list");
        if (differs) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: differs };
      }
      if (questions) {
        const differs = questionDiffers(b.variable, questions.current.get(b.variable), questions.previous.get(b.variable));
        if (differs) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: differs };
      }
      const changePp = b.share !== null && p.share !== null ? b.share - p.share : null;
      return { stage: s.stage, code: b.code, current: b.share, previous: p.share, changePp, ...(changePp === null ? { reason: "Not available in one of the two waves." } : {}) };
    }),
  );
}
