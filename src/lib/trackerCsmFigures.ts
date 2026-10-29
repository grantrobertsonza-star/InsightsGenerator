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
// Likely to switch: on a 0 to 10 scale the share answering 8, 9 or 10 (top three codes, the pack's "risk"); on a
// shorter scale the top two. Don't-know and not-applicable answers are outside the base, as in a Cross tab.
// Bases: the box tiles carry the distribution's effective base (the number answering when unweighted, Kish's
// effective base when weighted), the NPS tile the number answering.
import { runDistributionAction } from "./chartActions";
import { runNpsAction } from "./npsActions";
import { runDriverAnalysisFor } from "./drivers";
import { summarizeSeries } from "./csmMetrics";
import { isZeroToTenScale } from "./descriptiveFindings";
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

async function boxTile(id: "satisfaction" | "stay" | "switch", runId: string, documentId: string, variable: string, weightVar: string | null): Promise<CsmTile> {
  const r = await runDistributionAction(runId, documentId, variable, weightVar, null, "compute");
  if (!r.ok) return { id, status: "failed", variable, error: r.error };
  const series = r.result.series[0];
  if (!series) return { id, status: "failed", variable, error: "This question has no answers to read." };
  const codes = series.bars.map((b) => Number(b.rawCode ?? NaN));
  const elevenPoint = id === "switch" && isZeroToTenScale(codes.filter(Number.isFinite));
  const box = summarizeSeries(series, elevenPoint ? "top3" : "top2");
  const mean = id === "switch" ? null : summarizeSeries(series, "mean");
  return { id, status: "ok", variable, label: r.result.label, mean: mean?.exact ?? null, box: box.exact, boxCodes: elevenPoint ? "8 to 10" : "top two", effectiveBase: series.n };
}

export async function csmOverviewFigures(tenantId: string, runId: string, documentId: string, dashboard: ResolvedDashboard): Promise<CsmTile[]> {
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
    return boxTile(id, runId, documentId, variable, weightVar);
  };
  return Promise.all(CSM_TILES.map(tile));
}
