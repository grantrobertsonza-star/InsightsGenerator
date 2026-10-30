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
//
// By company (D3b, Grant: "splitting by company, for example per bank"): when the file has a company question (the
// company each customer rates), each tile also carries its figure per company, by the company's answer code, from
// the same owner split by that question. The all-customers figure is still the owner's own unsplit reading, so it
// equals the tile without a company. A company whose figure the owner withholds (a small base) is listed with no
// figure, never dropped or shown as 0. Driver priority is for all customers only.
//
// R5 CSM segment (Grant, 30 October 2026: "CSM needs a segment tool as well"): every figure here takes the dashboard's
// segment, already checked against the file by the loader (trackerOverview.ts), and hands it by codes (segmentOf) to
// the owner that computes it: the distribution and NPS tools and the driver model each restrict to the segment through
// the segment owner's engine filters, so means, boxes, scores, bases, suppression and the model are the segment's; a
// company's figures are within the segment too. Driver priority on a segment with fewer cases than the driver owner's
// minimum is "failed" with that reason. Each tile also carries the bases the engine counted (raw, weighted, effective).
import { runDistributionAction } from "./chartActions";
import { runNpsAction } from "./npsActions";
import { runDriverAnalysisFor } from "./drivers";
import { shareOfCodes, summarizeSeries } from "./csmMetrics";
import { codeNamesDiffer } from "./trackerFigures";
import { scaleTop, type RoleVariable } from "./trackerRoles";
import type { ResolvedDashboard } from "./trackerDashboard";
import { segmentFailure, segmentOf, type AppliedSegment } from "./trackerSegment";

export const CSM_TILES = ["satisfaction", "recommend", "stay", "switch", "drivers"] as const;
export type CsmTileId = (typeof CSM_TILES)[number];

type Missing = { id: CsmTileId; status: "missing"; reason: string };
type Failed = { id: CsmTileId; status: "failed"; variable: string; error: string };
export type CompanyBox = { code: string; label: string; mean: number | null; box: number | null; effectiveBase: number | null };
export type CompanyNps = { code: string; label: string; nps: number | null; lo: number | null; hi: number | null; base: number | null };
/** byCompany: null without a company question; "failed" with the reason when the split could not be calculated. */
/** The answered base the engine counted (R5 CSM segment): unweighted n and weighted total (the effective base is the
 * tile's own `effectiveBase`). Null or absent when the owner did not report it. */
export type CsmBases = { rawBase?: number | null; weightedBase?: number | null };
export type CsmBoxFigure = { id: "satisfaction" | "stay" | "switch"; status: "ok"; variable: string; label: string; mean: number | null; /** The highest answer code of the scale (5 on a 1 to 5 scale), for "mean / scale". */ scaleTop: number | null; box: number | null; boxCodes: string; effectiveBase: number; byCompany: CompanyBox[] | { failed: string } | null; /** Each answer code's share (unrounded, in percent; null where suppressed), in the distribution's order. */ shares?: { code: string; share: number | null }[] } & CsmBases;
export type CsmNpsFigure = { id: "recommend"; status: "ok"; variable: string; label: string; nps: number; lo: number; hi: number; promoters: number; passives: number; detractors: number; base: number; /** Kish effective base as the NPS tool reports it (rounded). */ effectiveBase?: number; byCompany: CompanyNps[] | { failed: string } | null } & Pick<CsmBases, "weightedBase">;
/** The company question and its companies (answer code and label), in code order. */
export type CsmCompanies = { variable: string; companies: { code: string; label: string }[] };
/** `n`: complete cases in the model; `cases`: cases read (every case, or every case in the segment). */
export type CsmDriverFigure = { id: "drivers"; status: "ok"; variable: string; label: string; method: string; rSquared: number; n: number; cases?: number; rows: { variable: string; label: string; share: number; rank: number; coefficient?: number }[] };
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
 * substantive answers, else the range its wording or name states), never from the answers the data happens to hold:
 * likely to switch on a 0 to 10 scale is 8, 9 and 10; any other box is the top two codes. Null when the scale is not
 * stated. The same codes count for every company.
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

/** The segment by codes for a tool, or null (R5 CSM segment). */
const toolSeg = (segment: AppliedSegment | null) => (segment ? segmentOf(segment) : null);

async function boxTile(id: "satisfaction" | "stay" | "switch", runId: string, documentId: string, variable: string, weightVar: string | null, roleVariable: RoleVariable | undefined, company: CsmCompanies | null, segment: AppliedSegment | null = null): Promise<CsmTile> {
  // The unsplit distribution comes first: its answers fix the scale top (boxScaleTop), and so the box codes and the
  // "mean / scale" divisor. Under a segment the scale top still comes from the declared answer list (boxScaleTop), so
  // a top answer nobody in the segment chose still counts as the top.
  const [r, split] = await Promise.all([
    runDistributionAction(runId, documentId, variable, weightVar, null, "compute", toolSeg(segment)),
    company ? runDistributionAction(runId, documentId, variable, weightVar, company.variable, "compute", toolSeg(segment)) : Promise.resolve(null),
  ]);
  if (!r.ok) return { id, status: "failed", variable, error: segmentFailure(new Error(r.error), segment) };
  const series = r.result.series[0];
  if (!series) return { id, status: "failed", variable, error: "This question has no answers to read." };
  const top = boxScaleTop(series, roleVariable);
  const box = boxCodesFor(id, top);
  if (!box) return { id, status: "failed", variable, error: `The scale of ${variable} is not stated (no answer list, and its wording or name gives no range such as "0 to 10"), so its top box cannot be fixed. Add its labels (a codebook or labels file), or choose another question.` };
  const mean = id === "switch" ? null : summarizeSeries(series, "mean");
  let byCompany: CsmBoxFigure["byCompany"] = null;
  if (company && split) {
    if (!split.ok) byCompany = { failed: split.error };
    else {
      const byCode = new Map(split.result.series.filter((x) => x.code !== undefined).map((x) => [x.code as string, x]));
      byCompany = company.companies.map(({ code, label }) => {
        const x = byCode.get(code);
        if (!x) return { code, label, mean: null, box: null, effectiveBase: null };
        return { code, label, mean: id === "switch" ? null : summarizeSeries(x, "mean").exact, box: shareOfCodes(x, box.codes).exact, effectiveBase: x.n };
      });
    }
  }
  return {
    id,
    status: "ok",
    variable,
    label: r.result.label,
    mean: mean?.exact ?? null,
    scaleTop: top,
    box: shareOfCodes(series, box.codes).exact,
    boxCodes: box.text,
    effectiveBase: series.n,
    rawBase: series.base?.n ?? null,
    weightedBase: series.base?.w ?? null,
    shares: series.bars.map((b) => ({ code: b.rawCode ?? b.label, share: b.share === undefined ? b.pct : b.share })),
    byCompany,
  };
}

async function npsTile(runId: string, documentId: string, variable: string, weightVar: string | null, company: CsmCompanies | null, segment: AppliedSegment | null = null): Promise<CsmTile> {
  const [r, split] = await Promise.all([
    runNpsAction(runId, documentId, variable, weightVar, null, undefined, "compute", toolSeg(segment)),
    company ? runNpsAction(runId, documentId, variable, weightVar, company.variable, undefined, "compute", toolSeg(segment)) : Promise.resolve(null),
  ]);
  if (!r.ok) return { id: "recommend", status: "failed", variable, error: segmentFailure(new Error(r.error), segment) };
  const x = r.result;
  let byCompany: CsmNpsFigure["byCompany"] = null;
  if (company && split) {
    if (!split.ok) byCompany = { failed: split.error };
    else {
      // The NPS tool leaves out a segment whose score it withholds (a suppressed scale point); that company is
      // listed with no score.
      const byCode = new Map((split.result.segments ?? []).filter((g) => g.code !== undefined).map((g) => [g.code as string, g]));
      byCompany = company.companies.map(({ code, label }) => {
        const g = byCode.get(code);
        return g ? { code, label, nps: g.nps, lo: g.lo, hi: g.hi, base: g.rawN } : { code, label, nps: null, lo: null, hi: null, base: null };
      });
    }
  }
  return { id: "recommend", status: "ok", variable, label: x.label, nps: x.nps, lo: x.lo, hi: x.hi, promoters: x.promoters, passives: x.passives, detractors: x.detractors, base: x.rawN, effectiveBase: x.effectiveN, weightedBase: x.weightedBase, byCompany };
}

export async function csmOverviewFigures(tenantId: string, runId: string, documentId: string, dashboard: ResolvedDashboard, variables: RoleVariable[], company: CsmCompanies | null = null, segment: AppliedSegment | null = null): Promise<CsmTile[]> {
  const byName = new Map(variables.map((v) => [v.name, v]));
  const weightVar = dashboard.weighted ? dashboard.weightVar : null;
  const varOf = (id: Exclude<CsmTileId, "drivers">) => dashboard.csm[ROLE[id]].variable;
  const tile = async (id: CsmTileId): Promise<CsmTile> => {
    if (id === "drivers") {
      const outcome = varOf("satisfaction");
      const predictors = dashboard.csm.drivers.variables;
      if (!outcome || predictors.length < 2) return { id, status: "missing", reason: NO_ROLE.drivers };
      try {
        const report = await runDriverAnalysisFor(tenantId, runId, documentId, { outcome, outcomeType: "continuous", predictors, weightVar, groupVar: null }, toolSeg(segment));
        return {
          id,
          status: "ok",
          variable: outcome,
          label: report.outcomeLabel,
          method: report.result.method,
          rSquared: report.result.fit.rSquared,
          n: report.result.n,
          cases: report.casesInFile,
          rows: [...report.result.rows].sort((a, b) => a.rank - b.rank).map((row) => ({ variable: row.variable ?? row.name, label: row.name, share: row.share, rank: row.rank, coefficient: row.coefficient })),
        };
      } catch (e) {
        return { id, status: "failed", variable: outcome, error: segmentFailure(e, segment) };
      }
    }
    const variable = varOf(id);
    if (!variable) return { id, status: "missing", reason: NO_ROLE[id] };
    if (id === "recommend") return npsTile(runId, documentId, variable, weightVar, company, segment);
    return boxTile(id, runId, documentId, variable, weightVar, byName.get(variable), company, segment);
  };
  return Promise.all(CSM_TILES.map(tile));
}

export type CsmChange = { id: CsmTileId; /** null: all customers. */ code: string | null; current: number | null; previous: number | null; changePp: number | null; /** Box tiles: the change in the mean (scale points), when both waves have one. */ meanChange?: number | null; reason?: string };

/** The headline reading a change compares: the box share for a box tile, the score for NPS (both in points). */
function headline(t: CsmTile): number | null {
  if (t.status !== "ok") return null;
  if (t.id === "recommend") return t.nps;
  if (t.id === "drivers") return null;
  return t.box;
}
function meanOf(t: CsmTile, code: string | null): number | null {
  if (t.status !== "ok" || t.id === "drivers" || t.id === "recommend") return null;
  if (code === null) return t.mean;
  return Array.isArray(t.byCompany) ? ((t.byCompany as CompanyBox[]).find((c) => c.code === code)?.mean ?? null) : null;
}
const meanDiff = (a: number | null, b: number | null) => (a !== null && b !== null ? a - b : null);
function companyHeadlines(t: CsmTile): Map<string, number | null> {
  if (t.status !== "ok" || t.id === "drivers" || !Array.isArray(t.byCompany)) return new Map();
  return new Map((t.byCompany as (CompanyBox | CompanyNps)[]).map((c) => [c.code, "nps" in c ? c.nps : c.box]));
}

/**
 * This wave's CSM headlines against the previous wave's, for all customers and each company (by answer code), in
 * points, unrounded, with no significance claim. Compared only when both waves read the same question (by variable
 * name): a tile whose question differs, is missing or failed in either wave has no change, with the reason.
 *
 * A company's figures are compared only when the code is the same company in both waves (Codex E1-F01): both waves'
 * company questions are given (`companies`), they are the same question (by variable name), and the code names the
 * same company in both answer lists (`codeNamesDiffer`, the rule the brand funnel uses). A code reused for another
 * company, a changed company question, or a wave whose companies are not known gives no change (box or mean) for that
 * company, with the reason. The all-customer row does not depend on the company question and is compared as before.
 */
export function csmChangesAgainst(
  current: CsmTile[],
  previous: CsmTile[] | null,
  noPrevious: string,
  companies: { current: CsmCompanies | null; previous: CsmCompanies | null } | null = null,
): CsmChange[] {
  const out: CsmChange[] = [];
  // Why no company of this wave can be compared at all, or null when each code is to be checked by name.
  const noCompanyComparison = (() => {
    if (!companies?.current || !companies.previous) return "Which company each code named in one of the two waves is not known, so companies are not compared.";
    if (companies.current.variable !== companies.previous.variable) return `The previous wave used a different company question (${companies.previous.variable}), so companies are not compared.`;
    return null;
  })();
  const companyDiffers = (code: string) =>
    noCompanyComparison ?? codeNamesDiffer(code, companies!.current!.companies, companies!.previous!.companies, "Company", "company list");
  for (const t of current) {
    if (t.id === "drivers") continue;
    const p = previous?.find((x) => x.id === t.id) ?? null;
    const cur = headline(t);
    const codes = [...companyHeadlines(t).keys()];
    const unavailable = (reason: string) => {
      out.push({ id: t.id, code: null, current: cur, previous: null, changePp: null, reason });
      for (const code of codes) out.push({ id: t.id, code, current: companyHeadlines(t).get(code) ?? null, previous: null, changePp: null, reason });
    };
    if (!previous) { unavailable(noPrevious); continue; }
    if (!p || p.status !== "ok" || t.status !== "ok") { unavailable("Not available in one of the two waves."); continue; }
    if (p.variable !== t.variable) { unavailable(`The previous wave used a different question (${p.variable}).`); continue; }
    const prev = headline(p);
    out.push({ id: t.id, code: null, current: cur, previous: prev, changePp: cur !== null && prev !== null ? cur - prev : null, meanChange: meanDiff(meanOf(t, null), meanOf(p, null)) });
    const prevBy = companyHeadlines(p);
    for (const [code, value] of companyHeadlines(t)) {
      const differs = companyDiffers(code);
      if (differs) {
        out.push({ id: t.id, code, current: value, previous: null, changePp: null, meanChange: null, reason: differs });
        continue;
      }
      const pv = prevBy.get(code) ?? null;
      out.push({ id: t.id, code, current: value, previous: pv, changePp: value !== null && pv !== null ? value - pv : null, meanChange: meanDiff(meanOf(t, code), meanOf(p, code)), ...(value === null || pv === null ? { reason: prevBy.has(code) ? "Not available in one of the two waves." : "This company was not in the previous wave." } : {}) });
    }
  }
  return out;
}

/** One driver's performance for "Service attributes": its mean on its own scale (`summarizeSeries`), or why not. */
export type AttributeMean = { variable: string; label: string; mean: number | null; scaleTop: number | null; effectiveBase: number | null; /** R5 CSM segment: the engine's raw and weighted answered base (absent on an error). */ rawBase?: number | null; weightedBase?: number | null; error?: string };

/**
 * The drivers' means (CSM "Service attributes", Grant's preview), each from the distribution owner and
 * `summarizeSeries`, as CSM Analytics reads an attribute, with the dashboard's weight. A driver that cannot be read
 * is listed with the reason, never dropped or shown as 0.
 */
export async function csmAttributeMeans(runId: string, documentId: string, drivers: string[], weightVar: string | null, segment: AppliedSegment | null = null): Promise<AttributeMean[]> {
  return Promise.all(
    drivers.map(async (variable) => {
      const r = await runDistributionAction(runId, documentId, variable, weightVar, null, "compute", toolSeg(segment));
      if (!r.ok) return { variable, label: variable, mean: null, scaleTop: null, effectiveBase: null, error: segmentFailure(new Error(r.error), segment) };
      const series = r.result.series[0];
      if (!series) return { variable, label: r.result.label, mean: null, scaleTop: null, effectiveBase: null, error: "No answers to read." };
      const codes = series.bars.map((b) => Number(b.rawCode ?? NaN)).filter(Number.isFinite);
      return { variable, label: r.result.label, mean: summarizeSeries(series, "mean").exact, scaleTop: codes.length ? Math.max(...codes) : null, effectiveBase: series.n, rawBase: series.base?.n ?? null, weightedBase: series.base?.w ?? null };
    }),
  );
}

/** Overall satisfaction's mean in one wave file, for the trend (the same reading as the satisfaction tile), in the
 * segment as applied to that wave when there is one. */
export async function satisfactionMean(runId: string, documentId: string, variable: string, weightVar: string | null, segment: AppliedSegment | null = null): Promise<{ mean: number | null; effectiveBase: number | null; error?: string }> {
  const r = await runDistributionAction(runId, documentId, variable, weightVar, null, "compute", toolSeg(segment));
  if (!r.ok) return { mean: null, effectiveBase: null, error: segmentFailure(new Error(r.error), segment) };
  const series = r.result.series[0];
  if (!series) return { mean: null, effectiveBase: null, error: "No answers to read." };
  return { mean: summarizeSeries(series, "mean").exact, effectiveBase: series.n };
}
