// D3 customer satisfaction (CSM) tiles for one wave file, from the owners that already compute each figure:
//   - satisfaction mean and top-two box, likely to stay (top-two box) and likely to switch: the distribution
//     (runDistributionAction) summarised by csmMetrics.summarizeSeries, the same reading CSM Analytics uses;
//   - recommendation: the NPS tool's own calculation (runNpsAction), so the score and its interval match the tool;
//   - driver priority: driver analysis (runDriverAnalysisFor) of satisfaction on the chosen drivers.
// Each is computed without saving a table ("compute"), with the dashboard's weight (D2: weighted by default when the
// file has a weight, unweighted only when the researcher chose so) and the file's own survey design.
//
// Every tile is always returned (Grant, 29 October 2026: "what is missing generates a blank tile ... and then the
// user can correct that"): "missing" when no variable has that role (the screen offers a choice), "failed" with the
// owner's reason when the figure could not be calculated, never a zero or a silently dropped tile.
//
// Likely to switch: on a 0 to 10 scale the share answering 8, 9 or 10 (the pack's "risk"); on a shorter scale the
// top two codes. Which codes count comes from the question's scale, never from the answers present (boxCodesFor,
// Codex D3A-F01): with an answer list the engine's declared substantive answers (boxScaleTop, D3AR-F01), else the
// range the wording or name states; an absent code counts 0; an unstated scale is "failed" with the reason. Don't-know and
// not-applicable answers are outside the base, as in a Cross tab.
// Bases: the box tiles carry the distribution's effective base (the number answering when unweighted, Kish's
// effective base when weighted), the NPS tile the number answering.
import { runDistributionAction } from "./chartActions";
import { runNpsAction } from "./npsActions";
import { runDriverAnalysisFor } from "./drivers";
import { shareOfCodes, summarizeSeries } from "./csmMetrics";
import { scaleTop, type RoleVariable } from "./trackerRoles";
import type { ResolvedDashboard } from "./trackerDashboard";

export const CSM_TILES = ["satisfaction", "recommend", "stay", "switch", "drivers"] as const;
export type CsmTileId = (typeof CSM_TILES)[number];

type Missing = { id: CsmTileId; status: "missing"; reason: string };
type Failed = { id: CsmTileId; status: "failed"; variable: string; error: string };
export type CsmBoxFigure = { id: "satisfaction" | "stay" | "switch"; status: "ok"; variable: string; label: string; mean: number | null; box: number | null; boxCodes: string; effectiveBase: number };
export type CsmNpsFigure = { id: "recommend"; status: "ok"; variable: string; label: string; nps: number; lo: number; hi: number; promoters: number; detractors: number; base: number };
export type CsmDriverFigure = { id: "drivers"; status: "ok"; variable: string; label: string; method: string; rSquared: number; n: number; rows: { variable: string; label: string; share: number; rank: number }[] };
export type CsmTile = Missing | Failed | CsmBoxFigure | CsmNpsFigure | CsmDriverFigure;

const ROLE: Record<Exclude<CsmTileId, "drivers">, keyof Omit<ResolvedDashboard["csm"], "drivers">> = {
  satisfaction: "overallSatisfaction",
  recommend: "recommend0to10",
  stay: "likelyToStay",
  switch: "likelyToSwitch",
};
const NO_ROLE: Record<CsmTileId, string> = {
  satisfaction: "No overall satisfaction question was found in this file.",
  recommend: "No 0 to 10 likelihood-to-recommend question was found in this file.",
  stay: "No likelihood-to-stay question was found in this file.",
  switch: "No likelihood-to-switch question was found in this file.",
  drivers: "Driver priority needs an overall satisfaction question and at least two driver questions.",
};

/**
 * The codes a box counts (Codex D3A-F01), from the top of the question's scale (boxScaleTop: the engine's declared
 * substantive answers, else the range its wording or name states), never from the answers the data happens to hold: likely to switch on a 0 to 10
 * scale is 8, 9 and 10; any other box is the top two codes. Null when the scale is not stated.
 */
export function boxCodesFor(id: "satisfaction" | "stay" | "switch", top: number | null): { codes: number[]; text: string } | null {
  if (top === null) return null;
  if (id === "switch" && top === 10) return { codes: [8, 9, 10], text: "8 to 10" };
  return { codes: [top - 1, top], text: "top two" };
}

/**
 * The top of a question's answer scale (Codex D3AR-F01). With an answer list, it is the highest code of the engine's
 * own distribution: the engine keeps every declared answer, chosen or not (a declared 5 nobody chose is a 0% row), and
 * drops the codes it reads as non-answers (_non_answer_codes: "6 = Don't know" on a 1 to 5 scale), so the top is the
 * scale's, never a non-answer's and never only what this wave happened to hold. scaleTop's own answer-list reading
 * kept 6 and boxed 5 and 6, halving the figure. Without an answer list, the range the wording or name states.
 */
export function boxScaleTop(series: { bars: { rawCode?: string | null }[] }, roleVariable: RoleVariable | undefined): number | null {
  const labelled = roleVariable?.valueLabels && Object.keys(roleVariable.valueLabels).length > 0;
  if (labelled) {
    const codes = series.bars.map((b) => Number(b.rawCode)).filter((n) => Number.isInteger(n));
    return codes.length ? Math.max(...codes) : null;
  }
  return roleVariable ? scaleTop(roleVariable) : null;
}

async function boxTile(id: "satisfaction" | "stay" | "switch", runId: string, documentId: string, variable: string, weightVar: string | null, roleVariable: RoleVariable | undefined): Promise<CsmTile> {
  const r = await runDistributionAction(runId, documentId, variable, weightVar, null, "compute");
  if (!r.ok) return { id, status: "failed", variable, error: r.error };
  const series = r.result.series[0];
  if (!series) return { id, status: "failed", variable, error: "This question has no answers to read." };
  const box = boxCodesFor(id, boxScaleTop(series, roleVariable));
  if (!box) return { id, status: "failed", variable, error: `The scale of ${variable} is not stated (no answer list, and its wording or name gives no range such as "0 to 10"), so its top box cannot be fixed. Add its labels (a codebook or labels file), or choose another question.` };
  const share = shareOfCodes(series, box.codes);
  const mean = id === "switch" ? null : summarizeSeries(series, "mean");
  return { id, status: "ok", variable, label: r.result.label, mean: mean?.exact ?? null, box: share.exact, boxCodes: box.text, effectiveBase: series.n };
}

export async function csmOverviewFigures(tenantId: string, runId: string, documentId: string, dashboard: ResolvedDashboard, variables: RoleVariable[]): Promise<CsmTile[]> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const varOf = (id: Exclude<CsmTileId, "drivers">) => dashboard.csm[ROLE[id]].variable;
  const tile = async (id: CsmTileId): Promise<CsmTile> => {
    if (id === "drivers") {
      const outcome = varOf("satisfaction");
      const predictors = dashboard.csm.drivers.variables;
      if (!outcome || predictors.length < 2) return { id, status: "missing", reason: NO_ROLE.drivers };
      try {
        const report = await runDriverAnalysisFor(tenantId, runId, documentId, { outcome, outcomeType: "continuous", predictors, weightVar, groupVar: null });
        return {
          id,
          status: "ok",
          variable: outcome,
          label: report.outcomeLabel,
          method: report.result.method,
          rSquared: report.result.fit.rSquared,
          n: report.result.n,
          rows: [...report.result.rows].sort((a, b) => a.rank - b.rank).map((row) => ({ variable: row.variable ?? row.name, label: row.name, share: row.share, rank: row.rank })),
        };
      } catch (e) {
        return { id, status: "failed", variable: outcome, error: e instanceof Error ? e.message : String(e) };
      }
    }
    const variable = varOf(id);
    if (!variable) return { id, status: "missing", reason: NO_ROLE[id] };
    if (id === "recommend") {
      const r = await runNpsAction(runId, documentId, variable, weightVar, null, undefined, "compute");
      if (!r.ok) return { id, status: "failed", variable, error: r.error };
      const x = r.result;
      return { id, status: "ok", variable, label: x.label, nps: x.nps, lo: x.lo, hi: x.hi, promoters: x.promoters, detractors: x.detractors, base: x.rawN };
    }
    return boxTile(id, runId, documentId, variable, weightVar, byName.get(variable));
  };
  return Promise.all(CSM_TILES.map(tile));
}
