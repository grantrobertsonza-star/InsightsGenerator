// One wave file's dashboard context: the programme's choices resolved against this file (trackerDashboards.ts) and
// the recogniser's input read from it (trackerInput.ts). Every tracker page loader starts from it. The wave-on-wave
// layer (trackerWaveChange.ts) reads it once per wave and passes it to the page loader, and uses the same context to
// match brands and questions across waves, so the figures and the identity checks always come from one reading.
import { loadTrackerDashboard, type TrackerDashboardView } from "./trackerDashboards";
import { loadRoleInput, type RoleInput } from "./trackerInput";

export type WaveContext = { view: TrackerDashboardView; input: RoleInput };

export type WaveLoadOptions = {
  /** The wave's context, when the caller already read it. */
  ctx?: WaveContext;
  /** Brand codes to compute brand-by-brand tables for (the associations trend reads the client's brand only); every
   * listed brand when absent. A brand left out has no figures, with the reason. */
  onlyBrands?: string[];
  /** Moments & needs: a recall row for every moment with a recall question, not only the six most relevant (the
   * compared wave, whose ranking may differ). */
  allRecallRows?: boolean;
};

export async function loadWaveContext(tenantId: string, runId: string, documentId: string): Promise<WaveContext> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  return { view, input };
}
