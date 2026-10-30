// D3 overview for one wave file: the dashboard's resolved choices (trackerDashboards.ts), every brand's stage figures
// (trackerFigures.ts), the customer satisfaction tiles with figures by company (trackerCsmFigures.ts, D3b), and the
// change of both against the compared wave of the same project (waveFiles.ts).
//
// The compared wave (R5 waves) is the included wave immediately before this one in the project's wave order by
// default, or an earlier included wave the researcher chose, or none (trackerWaveChange.comparisonTarget). Its figures
// use the same saved programme choices, resolved against its own file. When there is no compared wave, or its figures
// cannot be read, the overview still shows this wave and says why the change is missing: a failed read is reported as
// failed, never shown as "no change" or as an earlier wave that does not exist. Stage changes carry the engine's
// significance test (trackerWaveChange.attachTests).
import { loadTrackerDashboard, type TrackerDashboardView } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { brandOverviewFigures, changesAgainst, type BrandOverviewFigures, type StageChange, type StageFigures } from "./trackerFigures";
import { loadDocumentFile } from "./crosstabs";
import { attachTests, comparisonTarget, DESIGN_NOTE, SRS_NOTE, TEST_LINE, waveListOf, type CompareChoice, type TestJob, type WaveList } from "./trackerWaveChange";
import { loadProjectWaves } from "./waveFiles";
import type { ResolvedDashboard } from "./trackerDashboard";
import { OVERVIEW_STAGES } from "./trackerFigures";
import { csmAttributeMeans, csmChangesAgainst, csmOverviewFigures, satisfactionMean, type AttributeMean, type CsmChange, type CsmCompanies, type CsmTile } from "./trackerCsmFigures";
import type { FunnelStage, RoleVariable, TrackerRecognition } from "./trackerRoles";
import { prefilledFocalBrand } from "./trackerDashboard";

/** The wave this one is compared with (R5 waves: the previous included wave by default, an earlier included wave the
 * researcher chose, or none). "off": the researcher chose None. */
export type PreviousWave =
  | { status: "ok"; documentId: string; wave: string; filename: string }
  | { status: "none"; reason: string }
  | { status: "off"; reason: string }
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
  /** Every overview stage, shown or not: "shown" has figures; "choose" means two questions claim it; "missing" means
   * no question in this file has it. The screen keeps a blank tile for the last two (Grant, 29 October 2026). */
  stageTiles: { stage: FunnelStage; status: "shown" | "choose" | "missing"; groups: string[] }[];
  /** Per-brand yes/no questions a stage can be set to: the researcher's choices for a blank or contested tile. */
  stageCandidates: { group: string; label: string; stage: FunnelStage | null }[];
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
  /** The project's waves for the wave selector (included, in their owner's order; excluded named as left out). */
  waves: WaveList;
  /** The compare choice these figures were computed with: "previous", "none", or a wave file's id. */
  compareWith: string;
  /** The significance test's line for the stage changes; null when nothing is compared (or on the CSM dashboard). */
  compareTest: { line: string; note: string; failed: string | null } | null;
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

/** Each overview stage's tile: which per-brand yes/no questions claim it now (the dashboard's stage per group). */
export function stageTilesOf(rec: TrackerRecognition, dashboard: ResolvedDashboard): BrandOverview["stageTiles"] {
  const stageOf = new Map(dashboard.stages.map((s) => [s.group, s.stage]));
  return OVERVIEW_STAGES.map((stage) => {
    const groups = rec.measures.filter((m) => m.shape === "binary" && stageOf.get(m.group) === stage).map((m) => m.group);
    return { stage, status: groups.length === 1 ? "shown" : groups.length > 1 ? "choose" : "missing", groups };
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

export async function loadBrandOverview(tenantId: string, runId: string, documentId: string, kind: TrackerDashboardKind = "brand", choice: CompareChoice = "previous"): Promise<BrandOverview> {
  const [{ view, input, figures, csm, company }, waves] = await Promise.all([figuresFor(tenantId, runId, documentId, kind), loadProjectWaves(tenantId, runId)]);
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  const target = comparisonTarget(waves, documentId, choice);
  let previous: PreviousWave;
  let compared: Awaited<ReturnType<typeof figuresFor>> | null = null;
  if (target.status !== "target") previous = target;
  else {
    const p = target.wave;
    try {
      compared = await figuresFor(tenantId, runId, p.documentId, kind);
      previous = { status: "ok", documentId: p.documentId, wave: p.wave, filename: p.filename };
    } catch (e) {
      previous = { status: "failed", documentId: p.documentId, wave: p.wave, filename: p.filename, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const previousStages = compared?.figures.stages ?? null;
  const previousCsm = compared?.csm ?? null;
  const previousCompanies = compared?.company && "companies" in compared.company ? compared.company : null;
  const satOf = (tiles: CsmTile[]) => {
    const t = tiles.find((x) => x.id === "satisfaction");
    return t && t.status === "ok" && t.id === "satisfaction" ? { mean: t.mean, effectiveBase: t.effectiveBase } : { mean: null, effectiveBase: null };
  };
  // The trend: every included wave up to this one, each with its own resolved choices (brand stage figures, or
  // satisfaction's mean, the same reading as the tile). This wave and the compared wave are not read twice.
  const timeline: TimelinePoint[] = at < 0 ? [] : await Promise.all(
    waves.included.slice(0, at + 1).map(async (w): Promise<TimelinePoint> => {
      const base = { documentId: w.documentId, wave: w.wave, waveDate: w.waveDate };
      if (w.documentId === documentId) return kind === "brand" ? { ...base, status: "ok", stages: figures.stages } : { ...base, status: "ok", satisfaction: satOf(csm) };
      if (previous.status === "failed" && previous.documentId === w.documentId) return { ...base, status: "failed", error: previous.error };
      if (compared && previous.status === "ok" && previous.documentId === w.documentId)
        return kind === "brand" ? { ...base, status: "ok", stages: compared.figures.stages } : { ...base, status: "ok", satisfaction: satOf(compared.csm) };
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
  const attributes =
    kind === "csm" && view.dashboard.csm.drivers.variables.length > 0
      ? await csmAttributeMeans(runId, documentId, view.dashboard.csm.drivers.variables, view.dashboard.weighted ? view.dashboard.weightVar : null)
      : [];
  const notCompared = previous.status === "failed" ? "The compared wave's figures could not be read." : previous.status === "ok" ? "" : previous.reason;
  const changes =
    previous.status === "ok" && compared
      ? changesAgainst(figures.stages, previousStages, { current: view.dashboard.brands, previous: compared.view.dashboard.brands }, { current: new Map(input.variables.map((v) => [v.name, v])), previous: new Map(compared.input.variables.map((v) => [v.name, v])) })
      : changesAgainst(figures.stages, null).map((c) => ({ ...c, reason: notCompared || c.reason }));
  // The significance of each stage change (trackerWaveChange.attachTests, the engine's test), from the two shares it
  // was computed from. The CSM side's changes are box shares, NPS and means: shown without a test.
  let compareTest: BrandOverview["compareTest"] = null;
  if (kind === "brand" && previous.status === "ok" && previousStages) {
    const share = (stages: StageFigures[], stage: string, code: string) => stages.find((x) => x.stage === stage)?.byBrand.find((b) => b.code === code);
    const jobs: TestJob[] = changes.flatMap((c) => {
      const cur = share(figures.stages, c.stage, c.code);
      const prev = share(previousStages, c.stage, c.code);
      // StageChange carries the test on itself: the job writes it there.
      return c.changePp !== null && cur && prev ? [{ change: c as unknown as TestJob["change"], current: cur, previous: prev }] : [];
    });
    const doc = await loadDocumentFile(tenantId, runId, documentId);
    const { failed, designBased } = await attachTests(jobs, { storagePath: doc.storage_path, sourceFilename: doc.source_filename });
    compareTest = { line: TEST_LINE, note: designBased ? `${DESIGN_NOTE} ${SRS_NOTE}` : SRS_NOTE, failed };
  }
  const csmChanges = csmChangesAgainst(csm, previous.status === "ok" ? previousCsm : null, notCompared, { current: company && "companies" in company ? company : null, previous: previousCompanies });
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
      .map((m) => ({ group: m.group, label: measureLabel.get(m.group) ?? m.group, stage: view.dashboard.stages.find((s) => s.group === m.group)?.stage ?? null })),
    csm,
    csmCandidates: input.variables.filter((v) => !v.text && v.name !== view.dashboard.weightVar).map((v) => ({ name: v.name, label: v.label || v.name })),
    csmCompany: company,
    csmChanges,
    timeline,
    attributes,
    waves: waveListOf(waves, documentId),
    compareWith: choice === "previous" || choice === "none" ? choice : choice.documentId,
    compareTest,
  };
}
