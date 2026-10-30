import { computeCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadUaWorkspace } from "./uaDashboards";
import { all } from "./uaRouting";
import type { UaCondition, UaPage, UaPageId, UaMetricSpec } from "./uaTypes";

/** Claude's segment integration point. A supplied segment must be explicit raw-code conditions. */
export function withUaSegment(metrics: UaMetricSpec[], segment: UaCondition | null): UaMetricSpec[] {
  return segment ? metrics.map(m => ({ ...m, eligible: all(m.eligible, segment), assigned: all(m.assigned, segment) })) : metrics;
}
export async function loadUaPage(tenantId: string, runId: string, documentId: string, page: UaPageId, weighted?: boolean, compareBrands?: string[]): Promise<UaPage> {
  const view = await loadUaWorkspace(tenantId, runId, documentId);
  if (!view.recognition.recognised) throw new Error("Usage and attitudes is not recognised. Confirm the codebook's category consumption, personal purchase, routes and state fields first.");
  const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  if (!dict.ok) throw new Error(dict.error);
  if (!setup.ok) throw new Error(setup.error);
  const useWeight = weighted ?? view.choices.weighted;
  if (useWeight && !view.recognition.analysisWeight) throw new Error("No unambiguous analysis weight was declared. Choose unweighted or confirm the analysis weight in the codebook.");
  const weightVar = useWeight ? view.recognition.analysisWeight : null;
  const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined));
  if (design.ambiguous.psu.length || design.ambiguous.strata.length) throw new Error("The survey design is ambiguous. Resolve it in Import before using this dashboard.");
  if (compareBrands?.some(code => !view.recognition.brands.some(b => b.code === code))) throw new Error("A compared brand is not in this wave. Reload and choose listed brands.");
  const selected = compareBrands?.length ? new Set(compareBrands) : null;
  const metrics = withUaSegment(view.metrics.filter(m => m.page === page && (!selected || !m.brandCode || selected.has(m.brandCode))), null);
  if (!metrics.length) return { page, metrics: [], unavailable: view.unavailable.filter(m => m.page === page), documentId, weightVar };
  const { result } = await computeCrosstab(tenantId, runId, documentId, { columnVars: [], rowItems: [{ key: metrics[0].variable, label: metrics[0].label, vars: [metrics[0].variable] }], weightVar, correction: "none", excludeDk: false, ...(design.design ? { design: design.design } : {}), uaMetrics: metrics });
  if (!result.uaMetrics || result.uaMetrics.length !== metrics.length) throw new Error("The engine did not return the complete U&A page. No partial page is shown.");
  const values = new Map(result.uaMetrics.map(m => [m.id, m]));
  return { page, metrics: metrics.map(spec => {
    const value = values.get(spec.id);
    if (!value) throw new Error("A U&A measure is missing from the engine reply.");
    // Population incidences report the expansion-weighted numerator as people, not a percent.
    return { spec, result: spec.unit === "hypothetical people" ? { ...value, value: value.value === null ? null : value.numerator } : value };
  }), unavailable: view.unavailable.filter(m => m.page === page), documentId, weightVar };
}

/** Claude's significance integration point. Until wired, wave differences are descriptive only. */
export function uaWaveDifference(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
