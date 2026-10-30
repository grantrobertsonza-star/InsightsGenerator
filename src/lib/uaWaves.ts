import { loadProjectWaves } from "./waveFiles";
import { loadUaPage, uaWaveDifference } from "./uaComputation";
import type { UaPage, UaPageId, UaMetricSpec } from "./uaTypes";

const key = (m: UaMetricSpec) => JSON.stringify([m.variable, m.kind, m.selectedCodes, m.unit, m.eligible, m.assigned, m.answered, m.logicalZero, m.valueCondition, m.valueVariables]);
export type UaComparison = { status: "ok"; wave: string; documentId: string; changes: Record<string, number | null> } | { status: "none" | "failed"; reason: string };
export async function loadUaComparison(tenantId: string, runId: string, current: UaPage, weighted: boolean, brands: string[]): Promise<UaComparison> {
  const waves = await loadProjectWaves(tenantId, runId);
  const index = waves.included.findIndex(w => w.documentId === current.documentId);
  if (index < 1) return { status: "none", reason: index < 0 ? "This file has no wave label or is excluded from wave comparison." : "This is the earliest included wave." };
  const previous = waves.included[index - 1];
  try {
    const page = await loadUaPage(tenantId, runId, previous.documentId, current.page as UaPageId, weighted, brands);
    const before = new Map(page.metrics.map(m => [key(m.spec), m]));
    const changes: Record<string, number | null> = {};
    for (const m of current.metrics) {
      const earlier = before.get(key(m.spec));
      changes[m.spec.id] = earlier && earlier.spec.label === m.spec.label && m.spec.kind === "percent" && m.spec.unit === "percent" ? uaWaveDifference(m.result.value, earlier.result.value) : null;
    }
    return { status: "ok", wave: previous.wave, documentId: previous.documentId, changes };
  } catch (e) { return { status: "failed", reason: e instanceof Error ? e.message : String(e) }; }
}
