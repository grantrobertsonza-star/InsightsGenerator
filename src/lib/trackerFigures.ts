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
//   - change against the previous wave (the project's wave files, src/lib/waves.ts) is this wave's unrounded share
//     minus the previous wave's for the same stage, variable name and brand code, the code naming the same brand in
//     both waves, in percentage points, with no significance claim; anything else has no change, said so.
// The base is the unweighted number of valid answers (the table's base row); the effective base is reported when
// the figures are weighted. Nothing is saved here: no table, no finding.
import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import type { CrosstabResult, CrosstabRow } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { FunnelStage, RoleVariable, TrackerRecognition } from "./trackerRoles";

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
};

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
    const yes = Object.entries(labels).filter(([, l]) => /^(selected|yes|mentioned|chosen|ticked|checked)\b/i.test(l.trim()));
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
      /^(no|not (selected|mentioned|chosen|ticked|checked))$/i.test(labels["0"].trim()) &&
      observedCodes.every((c) => c === "0" || c === "1")
    )
      return "1";
    return null;
  }
  return observedCodes.length > 0 && observedCodes.every((c) => c === "0" || c === "1") ? "1" : null;
}

/** The stage measures the overview shows: one per stage, the researcher's choice where two questions claimed it. */
export function overviewMeasures(rec: TrackerRecognition, dashboard: ResolvedDashboard) {
  const stageOf = new Map(dashboard.stages.map((s) => [s.group, s.stage]));
  const shown: { stage: FunnelStage; measure: TrackerRecognition["measures"][number] }[] = [];
  const unresolved: FunnelStage[] = [];
  for (const stage of OVERVIEW_STAGES) {
    const claims = rec.measures.filter((m) => stageOf.get(m.group) === stage && m.shape === "binary");
    if (claims.length === 1) shown.push({ stage, measure: claims[0] });
    else if (claims.length > 1) unresolved.push(stage);
  }
  return { shown, unresolved };
}

/**
 * The share selecting a yes/no variable, read from one row item of a built Cross tab result (single column, the
 * total): the unrounded percentage of the selected code (selectedCode) among the variable's valid answers, and the
 * unweighted count of those answers as the base. Null with the reason when the item is missing from the result, the
 * selected code cannot be told, there are no valid answers, or the engine suppressed the figure. The one reading of
 * a yes/no share for the tracker dashboards (brand stages, category moments, moment by brand recall).
 */
export function selectedShareOf(result: CrosstabResult, variable: string, v: Pick<RoleVariable, "valueLabels"> | undefined): { share: number | null; base: number | null; reason?: string } {
  const { share, base, reason } = selectedAnswerOf(result, variable, v);
  return { share, base, ...(reason !== undefined ? { reason } : {}) };
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
): { code: string | null; selectedN: number | null; share: number | null; base: number | null; reason?: string } {
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
  return { code: sel, selectedN, share: exact ?? null, base, ...(exact === null ? { reason: "Suppressed for a small base." } : {}) };
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
  return was ? `${noun} code ${code} was ${was} in the previous wave, so it is not compared.` : `${noun} code ${code} is not in the previous wave's ${listName}.`;
}

export type StageChange = { stage: FunnelStage; code: string; current: number | null; previous: number | null; changePp: number | null; reason?: string };

/**
 * This wave's shares against the previous wave's, unrounded, in percentage points. A share is compared only with the
 * previous wave's share for the same stage, the same variable and the same brand code (Codex D3A-F03), and, when both
 * waves' brand lists are given, only when that code names the same brand in both (a code reused for another brand is
 * not comparable). Otherwise there is no change, with the reason.
 */
export function changesAgainst(
  current: StageFigures[],
  previous: StageFigures[] | null,
  brands?: { current: { code: string; label: string }[]; previous: { code: string; label: string }[] },
): StageChange[] {
  const key = (stage: string, variable: string, code: string) => `${stage}|${variable}|${code}`;
  const prev = new Map((previous ?? []).flatMap((s) => s.byBrand.map((b) => [key(s.stage, b.variable, b.code), b] as const)));
  return current.flatMap((s) =>
    s.byBrand.map((b): StageChange => {
      if (!previous) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "No earlier wave." };
      const p = prev.get(key(s.stage, b.variable, b.code));
      if (!p) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "Not asked about this brand in the previous wave." };
      if (brands) {
        const differs = codeNamesDiffer(b.code, brands.current, brands.previous, "Brand", "brand list");
        if (differs) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: differs };
      }
      const changePp = b.share !== null && p.share !== null ? b.share - p.share : null;
      return { stage: s.stage, code: b.code, current: b.share, previous: p.share, changePp, ...(changePp === null ? { reason: "Not available in one of the two waves." } : {}) };
    }),
  );
}
