// D3 overview for one wave file: the dashboard's resolved choices (trackerDashboards.ts), every brand's stage figures
// (trackerFigures.ts), the customer satisfaction tiles with figures by company (trackerCsmFigures.ts, D3b), and the
// change of both against the previous wave file of the same project (waveFiles.ts).
//
// The previous wave is the wave file immediately before this one in the project's wave order. Its figures use the
// same saved programme choices, resolved against its own file. When there is no previous wave, or its figures
// cannot be read, the overview still shows this wave and says why the change is missing: a failed read of the
// previous wave is reported as failed, never shown as "no change" or as an earlier wave that does not exist.
import { loadTrackerDashboard, type TrackerDashboardView } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { brandOverviewFigures, changesAgainst, type BrandOverviewFigures, type StageChange } from "./trackerFigures";
import { loadProjectWaves } from "./waveFiles";
import type { ResolvedDashboard } from "./trackerDashboard";
import { csmAttributeMeans, csmChangesAgainst, csmOverviewFigures, satisfactionMean, type AttributeMean, type CsmChange, type CsmCompanies, type CsmTile } from "./trackerCsmFigures";
import type { FunnelStage, RoleVariable, TrackerRecognition } from "./trackerRoles";
import type { TimeWindow } from "./trackerWindows";
import { prefilledFocalBrand } from "./trackerDashboard";

export type PreviousWave =
  | { status: "ok"; documentId: string; wave: string; filename: string }
  | { status: "none"; reason: string }
  | { status: "failed"; documentId: string; wave: string; filename: string; error: string };

export type BrandOverview = {
  /** The dashboard these figures are for; the other dashboard's figures are empty (not calculated). */
  kind: TrackerDashboardKind;
  view: Omit<TrackerDashboardView, "recognition">;
  /** This file's wave label, or null when the file is not labelled as a wave. */
  wave: string | null;
  figures: BrandOverviewFigures;
  previous: PreviousWave;
  changes: StageChange[];
  /** The brands compared by default: five, the client's brand first when chosen, then the file's list order. */
  suggestedComparators: string[];
  /** Every overview stage, shown or not, in the tracker type's order (dashboard.overviewStages): "shown" has figures;
   * "choose" means two questions claim it; "missing" means no question in this file has it. The screen keeps a blank
   * tile for the last two (Grant, 29 October 2026). `window` is the shown question's period (null otherwise). */
  stageTiles: { stage: FunnelStage; status: "shown" | "choose" | "missing"; groups: string[]; window: TimeWindow | null }[];
  /** Per-brand yes/no questions a stage can be set to: the researcher's choices for a blank or contested tile. */
  stageCandidates: { group: string; label: string; stage: FunnelStage | null; window: TimeWindow }[];
  /** The customer satisfaction tiles, every one returned (trackerCsmFigures.ts). */
  csm: CsmTile[];
  /** Variables that could fill a blank CSM tile: this file's variables with an answer list or numeric scale. */
  csmCandidates: { name: string; label: string }[];
  /** The company each customer rates and its companies (D3b), or null without one; `note` says why figures by
   * company are not shown when the question has no answer list. */
  csmCompany: (CsmCompanies & { label: string; focal: { code: string; label: string; source: "chosen" | "prefilled" } | null }) | { variable: string; note: string } | null;
  /** CSM headlines against the previous wave, for all customers and each company (D3b). */
  csmChanges: CsmChange[];
  /**
   * Every wave of the project up to this one, in wave order (Grant's previews: "<brand> across three waves",
   * "Overall satisfaction trend"). Brand: each wave's stage figures. CSM: each wave's overall satisfaction mean.
   * A wave whose figures cannot be read is "failed" with the reason and draws no point.
   */
  timeline: TimelinePoint[];
  /** CSM "Service attributes": each driver's mean on its own scale (csmAttributeMeans); empty on the brand dashboard. */
  attributes: AttributeMean[];
};

export type TimelinePoint = {
  documentId: string;
  wave: string;
  waveDate: string | null;
  status: "ok" | "failed";
  error?: string;
  stages?: BrandOverviewFigures["stages"];
  satisfaction?: { mean: number | null; effectiveBase: number | null };
};

/** Answers of a company question that are not companies. */
const NOT_A_COMPANY = /^(other|others|none|no (main )?(bank|provider|company)|don'?t know|do not know|not sure|refused|prefer not|not applicable|n\/a)\b/i;

/**
 * The company question's companies, from its answer list (by code, in code order; "Other", "None" and no-answer
 * codes left out), and the client's company: the chosen code when this file lists it, else the company the
 * programme's or project's name names, shown as suggested. A company question without an answer list cannot name
 * its companies, so figures by company are not shown for it, and the overview says so.
 */
export function csmCompanyOf(variables: RoleVariable[], dashboard: ResolvedDashboard, focalCode: string | undefined, scopeNames: string[]): BrandOverview["csmCompany"] {
  const variable = dashboard.csm.company.variable;
  if (!variable) return null;
  const v = variables.find((x) => x.name === variable);
  const labels = v?.valueLabels;
  if (!labels || Object.keys(labels).length === 0) return { variable, note: `The company question (${variable}) has no answer list, so figures by company cannot be named. Add its labels (a codebook or labels file).` };
  const companies = Object.entries(labels)
    .filter(([, l]) => !NOT_A_COMPANY.test(l.trim()))
    .sort(([a], [b]) => Number(a) - Number(b) || a.localeCompare(b))
    .map(([code, label]) => ({ code, label }));
  const chosen = focalCode !== undefined ? companies.find((c) => c.code === focalCode) : undefined;
  const prefill = chosen ? null : prefilledFocalBrand(companies, scopeNames);
  return {
    variable,
    label: v?.label || variable,
    companies,
    focal: chosen ? { ...chosen, source: "chosen" } : prefill ? { ...prefill, source: "prefilled" } : null,
  };
}

/** Each overview stage's tile, in the dashboard's order: which per-brand yes/no questions claim it now (the
 * dashboard's stage per group), and the window of the one that does. */
export function stageTilesOf(rec: TrackerRecognition, dashboard: Pick<ResolvedDashboard, "stages" | "overviewStages">): BrandOverview["stageTiles"] {
  const stageOf = new Map(dashboard.stages.map((s) => [s.group, s.stage]));
  return dashboard.overviewStages.map((stage) => {
    const claims = rec.measures.filter((m) => m.shape === "binary" && stageOf.get(m.group) === stage);
    return { stage, status: claims.length === 1 ? "shown" : claims.length > 1 ? "choose" : "missing", groups: claims.map((m) => m.group), window: claims.length === 1 ? claims[0].window : null };
  });
}

/** Brands compared by default (Grant, D3 previews): five brands, the client's first when chosen, the rest in the
 * file's list order. */
export function suggestedComparators(dashboard: Pick<ResolvedDashboard, "brands" | "focalBrand">, count = 5): string[] {
  const focal = dashboard.focalBrand?.code ?? null;
  const others = dashboard.brands.filter((b) => b.code !== focal).map((b) => b.code);
  return (focal ? [focal, ...others] : others).slice(0, count);
}

/** Which dashboard is open (Grant, 29 October 2026: brand and CSM dashboards are separate tools, "hardly ever
 * analysed together"): only that dashboard's figures are calculated, for this wave and the previous one. */
export type TrackerDashboardKind = "brand" | "csm";

async function figuresFor(tenantId: string, runId: string, documentId: string, kind: TrackerDashboardKind) {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const company = csmCompanyOf(input.variables, view.dashboard, view.choices.focalCompanyCode, view.scopeNames);
  const noBrand: BrandOverviewFigures = { documentId, weighted: view.dashboard.weighted, weightVar: view.dashboard.weighted ? view.dashboard.weightVar : null, effectiveBase: null, stages: [], unresolvedStages: [], noFigures: null };
  const [figures, csm] = await Promise.all([
    kind === "brand" ? brandOverviewFigures(tenantId, runId, documentId, view.recognition, view.dashboard, input.variables) : Promise.resolve(noBrand),
    kind === "csm" ? csmOverviewFigures(tenantId, runId, documentId, view.dashboard, input.variables, company && "companies" in company ? company : null) : Promise.resolve([] as CsmTile[]),
  ]);
  return { view, input, figures, csm, company };
}

export async function loadBrandOverview(tenantId: string, runId: string, documentId: string, kind: TrackerDashboardKind = "brand"): Promise<BrandOverview> {
  const [{ view, input, figures, csm, company }, waves] = await Promise.all([figuresFor(tenantId, runId, documentId, kind), loadProjectWaves(tenantId, runId)]);
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  let previous: PreviousWave;
  let previousStages = null;
  let previousCsm: CsmTile[] | null = null;
  let previousCompanies: CsmCompanies | null = null;
  let previousBrands: { code: string; label: string }[] = [];
  const timeline: TimelinePoint[] = [];
  const satOf = (tiles: CsmTile[]) => {
    const t = tiles.find((x) => x.id === "satisfaction");
    return t && t.status === "ok" && t.id === "satisfaction" ? { mean: t.mean, effectiveBase: t.effectiveBase } : { mean: null, effectiveBase: null };
  };
  if (at < 0) previous = { status: "none", reason: "This file is not labelled as a wave of this project, so there is no earlier wave to compare with." };
  else if (at === 0) previous = { status: "none", reason: "This is the earliest wave of this project." };
  else {
    const p = waves.included[at - 1];
    try {
      const prev = await figuresFor(tenantId, runId, p.documentId, kind);
      previousStages = prev.figures.stages;
      previousBrands = prev.view.dashboard.brands;
      previousCsm = prev.csm;
      previousCompanies = prev.company && "companies" in prev.company ? prev.company : null;
      previous = { status: "ok", documentId: p.documentId, wave: p.wave, filename: p.filename };
    } catch (e) {
      previous = { status: "failed", documentId: p.documentId, wave: p.wave, filename: p.filename, error: e instanceof Error ? e.message : String(e) };
    }
  }
  if (at >= 0) {
    // The waves before the previous one, read for the trend only: brand stage figures, or satisfaction's mean
    // (the same reading as the tile), each with that wave's own resolved choices.
    const earlier = await Promise.all(
      waves.included.slice(0, Math.max(0, at - 1)).map(async (w): Promise<TimelinePoint> => {
        const base = { documentId: w.documentId, wave: w.wave, waveDate: w.waveDate };
        try {
          if (kind === "brand") return { ...base, status: "ok", stages: (await figuresFor(tenantId, runId, w.documentId, "brand")).figures.stages };
          const v = await loadTrackerDashboard(tenantId, runId, w.documentId);
          const variable = v.dashboard.csm.overallSatisfaction.variable;
          if (!variable) return { ...base, status: "failed", error: "No overall satisfaction question in this wave." };
          const m = await satisfactionMean(runId, w.documentId, variable, v.dashboard.weighted ? v.dashboard.weightVar : null);
          return m.error ? { ...base, status: "failed", error: m.error } : { ...base, status: "ok", satisfaction: { mean: m.mean, effectiveBase: m.effectiveBase } };
        } catch (e) {
          return { ...base, status: "failed", error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );
    timeline.push(...earlier);
    if (at >= 1) {
      const p = waves.included[at - 1];
      const base = { documentId: p.documentId, wave: p.wave, waveDate: p.waveDate };
      if (previous.status === "failed") timeline.push({ ...base, status: "failed", error: previous.error });
      else timeline.push(kind === "brand" ? { ...base, status: "ok", stages: previousStages ?? [] } : { ...base, status: "ok", satisfaction: satOf(previousCsm ?? []) });
    }
    const c = waves.included[at];
    timeline.push(kind === "brand" ? { documentId, wave: c.wave, waveDate: c.waveDate, status: "ok", stages: figures.stages } : { documentId, wave: c.wave, waveDate: c.waveDate, status: "ok", satisfaction: satOf(csm) });
  }
  const attributes =
    kind === "csm" && view.dashboard.csm.drivers.variables.length > 0
      ? await csmAttributeMeans(runId, documentId, view.dashboard.csm.drivers.variables, view.dashboard.weighted ? view.dashboard.weightVar : null)
      : [];
  const changes =
    previous.status === "ok"
      ? changesAgainst(figures.stages, previousStages, { current: view.dashboard.brands, previous: previousBrands })
      : changesAgainst(figures.stages, null).map((c) => ({ ...c, reason: previous.status === "failed" ? "The previous wave's figures could not be read." : c.reason }));
  const csmChanges = csmChangesAgainst(
    csm,
    previous.status === "ok" ? previousCsm : null,
    previous.status === "failed" ? "The previous wave's figures could not be read." : previous.status === "none" ? previous.reason : "",
    { current: company && "companies" in company ? company : null, previous: previousCompanies },
  );
  // The recognition is the server's working detail; the screen needs only the resolved dashboard.
  const { recognition: _recognition, ...rest } = view;
  void _recognition;
  const measureLabel = new Map(view.recognition.measures.map((m) => [m.group, m.label]));
  return {
    kind,
    view: rest,
    wave: at >= 0 ? waves.included[at].wave : null,
    figures,
    previous,
    changes,
    suggestedComparators: suggestedComparators(view.dashboard),
    stageTiles: stageTilesOf(view.recognition, view.dashboard),
    stageCandidates: view.recognition.measures
      .filter((m) => m.shape === "binary")
      .map((m) => ({ group: m.group, label: measureLabel.get(m.group) ?? m.group, stage: view.dashboard.stages.find((s) => s.group === m.group)?.stage ?? null, window: m.window })),
    csm,
    csmCandidates: input.variables.filter((v) => !v.text && v.name !== view.dashboard.weightVar).map((v) => ({ name: v.name, label: v.label || v.name })),
    csmCompany: company,
    csmChanges,
    timeline,
    attributes,
  };
}
