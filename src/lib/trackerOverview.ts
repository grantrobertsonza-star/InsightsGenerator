// D3 brand overview for one wave file: the dashboard's resolved choices (trackerDashboards.ts), every brand's stage
// figures (trackerFigures.ts) and the change against the previous wave file of the same project (waveFiles.ts).
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
import { OVERVIEW_STAGES } from "./trackerFigures";
import { csmOverviewFigures, type CsmTile } from "./trackerCsmFigures";
import type { FunnelStage, TrackerRecognition } from "./trackerRoles";

export type PreviousWave =
  | { status: "ok"; documentId: string; wave: string; filename: string }
  | { status: "none"; reason: string }
  | { status: "failed"; documentId: string; wave: string; filename: string; error: string };

export type BrandOverview = {
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
};

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

async function figuresFor(tenantId: string, runId: string, documentId: string) {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  return { view, input, figures: await brandOverviewFigures(tenantId, runId, documentId, view.recognition, view.dashboard, input.variables) };
}

export async function loadBrandOverview(tenantId: string, runId: string, documentId: string): Promise<BrandOverview> {
  const [{ view, input, figures }, waves] = await Promise.all([figuresFor(tenantId, runId, documentId), loadProjectWaves(tenantId, runId)]);
  const csm = await csmOverviewFigures(tenantId, runId, documentId, view.dashboard, input.variables);
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  let previous: PreviousWave;
  let previousStages = null;
  let previousBrands: { code: string; label: string }[] = [];
  if (at < 0) previous = { status: "none", reason: "This file is not labelled as a wave of this project, so there is no earlier wave to compare with." };
  else if (at === 0) previous = { status: "none", reason: "This is the earliest wave of this project." };
  else {
    const p = waves.included[at - 1];
    try {
      const prev = await figuresFor(tenantId, runId, p.documentId);
      previousStages = prev.figures.stages;
      previousBrands = prev.view.dashboard.brands;
      previous = { status: "ok", documentId: p.documentId, wave: p.wave, filename: p.filename };
    } catch (e) {
      previous = { status: "failed", documentId: p.documentId, wave: p.wave, filename: p.filename, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const changes =
    previous.status === "ok"
      ? changesAgainst(figures.stages, previousStages, { current: view.dashboard.brands, previous: previousBrands })
      : changesAgainst(figures.stages, null).map((c) => ({ ...c, reason: previous.status === "failed" ? "The previous wave's figures could not be read." : c.reason }));
  // The recognition is the server's working detail; the screen needs only the resolved dashboard.
  const { recognition: _recognition, ...rest } = view;
  void _recognition;
  const measureLabel = new Map(view.recognition.measures.map((m) => [m.group, m.label]));
  return {
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
  };
}
