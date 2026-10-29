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
};

/** The code of a yes/no variable that means "selected" (see the file comment); null when it cannot be told. */
export function selectedCode(v: Pick<RoleVariable, "valueLabels">, observedCodes: string[]): string | null {
  const labels = v.valueLabels;
  if (labels && Object.keys(labels).length > 0) {
    const yes = Object.entries(labels).filter(([, l]) => /^(selected|yes|mentioned|chosen|ticked|checked)\b/i.test(l.trim()));
    if (yes.length === 1) return yes[0][0];
    // No positive label (Codex D3A-F02): code 1 counts as selected only when the labels say what 0 is, as the
    // opposite of selected ("No", "Not selected", "Not mentioned"), and leave 1 unlabelled. A label on 1, or a 0
    // labelled anything else ("Not applicable"), is never overruled: the variable is not available, with the reason.
    if (yes.length === 0 && Object.keys(labels).length === 1 && labels["0"] !== undefined && labels["1"] === undefined && /^(no|not (selected|mentioned|chosen|ticked|checked))$/i.test(labels["0"].trim())) return "1";
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

/** Shares of every brand of each stage measure, read from a built Cross tab result (by variable and code). */
export function sharesFromResult(result: CrosstabResult, measures: { stage: FunnelStage; measure: TrackerRecognition["measures"][number] }[], variables: Map<string, RoleVariable>, brandCodes: Set<string>): StageFigures[] {
  const byVariable = new Map(result.questions.map((q) => [q.key, q]));
  return measures.map(({ stage, measure }) => ({
    stage,
    group: measure.group,
    label: measure.label,
    byBrand: measure.byBrand
      .filter((b) => brandCodes.has(b.code))
      .map((b) => {
        const q = byVariable.get(b.variable);
        if (!q) return { code: b.code, variable: b.variable, share: null, base: null, reason: "This question was not in the table the engine returned." };
        const rows: CrosstabRow[] = q.rows;
        const base = rows.find((r) => r.isBase && !r.isEffBase)?.count[0] ?? null;
        const cats = rows.filter((r) => !r.isBase && !r.isNet && !r.isMean && !r.isScore && r.rawCode !== undefined);
        const sel = selectedCode(variables.get(b.variable) ?? {}, cats.map((r) => r.rawCode as string));
        if (sel === null) return { code: b.code, variable: b.variable, share: null, base, reason: "Which answer means selected could not be told from its codes and labels." };
        if (base === null || base === 0) return { code: b.code, variable: b.variable, share: null, base, reason: "No valid answers." };
        const row = cats.find((r) => r.rawCode === sel);
        const exact = row ? (row.pctExact?.[0] ?? row.pct[0]) : 0;
        return { code: b.code, variable: b.variable, share: exact ?? null, base, ...(exact === null ? { reason: "Suppressed for a small base." } : {}) };
      }),
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
  const base: Omit<BrandOverviewFigures, "stages" | "effectiveBase"> = { documentId, weighted: weightVar !== null, weightVar, unresolvedStages: unresolved };
  const rowVars = shown.flatMap(({ measure }) => measure.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable));
  if (rowVars.length === 0) return { ...base, stages: [], effectiveBase: null };
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
    stages: sharesFromResult(result, shown, new Map(variables.map((v) => [v.name, v])), brandCodes),
    effectiveBase: weightVar ? result.total?.nEff ?? null : null,
  };
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
  const name = (list: { code: string; label: string }[] | undefined, code: string) => list?.find((b) => b.code === code)?.label.trim().toLowerCase();
  return current.flatMap((s) =>
    s.byBrand.map((b): StageChange => {
      if (!previous) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "No earlier wave." };
      const p = prev.get(key(s.stage, b.variable, b.code));
      if (!p) return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: "Not asked about this brand in the previous wave." };
      if (brands) {
        const now = name(brands.current, b.code);
        const then = name(brands.previous, b.code);
        if (!now || !then || now !== then) {
          const was = brands.previous.find((x) => x.code === b.code)?.label;
          return { stage: s.stage, code: b.code, current: b.share, previous: null, changePp: null, reason: was ? `Brand code ${b.code} was ${was} in the previous wave, so it is not compared.` : `Brand code ${b.code} is not in the previous wave's brand list.` };
        }
      }
      const changePp = b.share !== null && p.share !== null ? b.share - p.share : null;
      return { stage: s.stage, code: b.code, current: b.share, previous: p.share, changePp, ...(changePp === null ? { reason: "Not available in one of the two waves." } : {}) };
    }),
  );
}
