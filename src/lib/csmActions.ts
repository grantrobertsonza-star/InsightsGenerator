"use server";

import { revalidatePath } from "next/cache";

import { withTenant } from "./db";
import { findingProvenanceAvailable, recordHumanReview } from "./findingProvenance";
import { loadVariableDictionary } from "./crosstabs";
import { defaultWeight } from "./starterTables";
import { runDistributionAction, type ChartResult } from "./chartActions";
import { runNpsAction, type NpsResult } from "./npsActions";
import { runDriverAnalysisFor, type DriverReport } from "./drivers";
import type { VariableInfo } from "./parseStatsFile";
import { defaultMetricForScale, metricLabel, summarizeSeries, csmFindingKey, type CsmMetric } from "./csmMetrics";
import { requireTenantId } from "./requestContext";

export type { CsmMetric };



type Fail = { ok: false; error: string };

/** One attribute (or the overall-satisfaction question) summarised overall, and by segment when a group variable was mapped. */
export type CsmScore = {
  variable: string;
  label: string;
  metric: CsmMetric;
  n: number;
  overall: number | null;
  bySegment: { name: string; value: number | null; n: number }[];
};

export type CsmAttributeMapping = { variable: string; metric?: CsmMetric };

export type CsmMapping = {
  overallVar: string | null;
  overallMetric?: CsmMetric;
  attributes: CsmAttributeMapping[];
  loyaltyVar: string | null;
  segmentVar: string | null;
};

export type CsmDashboard = {
  documentId: string;
  waveLabel: string | null;
  weighted: boolean;
  segmentVar: string | null;
  segmentLabel: string | null;
  segments: string[];
  overall: CsmScore | null;
  attributes: CsmScore[];
  /** ANA-CSM-001: a mapped attribute that could not be tabulated used to be dropped with no trace -
   * the dashboard came back ok:true with a shorter attributes list and nothing to say why, so a
   * driver analysis or finding built from "all mapped attributes" silently ran on fewer attributes
   * than the researcher actually mapped. Each entry here is one that was mapped but is missing from
   * `attributes` above, with the reason, so anything built from this dashboard can disclose it. */
  failedAttributes: { variable: string; label: string; error: string }[];
  loyalty: NpsResult | null;
  driver: DriverReport | null;
};

/** The variables a CSM mapping can draw from, grouped the way the setup screen offers them. */
export async function loadCsmCandidatesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; variables: VariableInfo[]; weightVar: string | null } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const dict = await loadVariableDictionary(TENANT_ID, runId, documentId);
    const usable = dict.variables.filter((v) => !v.weightLike && !v.text && v.nDistinct >= 2);
    return { ok: true, variables: usable, weightVar: defaultWeight(dict) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function scoreVariable(
  runId: string,
  documentId: string,
  variable: string,
  label: string,
  metric: CsmMetric,
  weightVar: string | null,
  segmentVar: string | null,
): Promise<CsmScore | { error: string }> {
  // A segmented distribution (columnVars set) never carries an "All
  // respondents" total column - the engine only adds one when there is no
  // banner variable at all - so the true overall has to come from its own,
  // unsegmented run rather than being guessed from one of the segments.
  const [overallRes, segmentedRes] = await Promise.all([
    runDistributionAction(runId, documentId, variable, weightVar, null),
    segmentVar ? runDistributionAction(runId, documentId, variable, weightVar, segmentVar) : Promise.resolve(null),
  ]);
  if (!overallRes.ok) return { error: overallRes.error };
  if (segmentedRes && !segmentedRes.ok) return { error: segmentedRes.error };

  const overallSeries = overallRes.result.series[0];
  const overall = overallSeries ? summarizeSeries(overallSeries, metric) : { value: null, base: 0 };
  const bySegment =
    segmentedRes && segmentedRes.ok && segmentedRes.result.grouped
      ? segmentedRes.result.series.map((s) => {
          const sum = summarizeSeries(s, metric);
          return { name: s.name, value: sum.value, n: s.n };
        })
      : [];
  return {
    variable,
    label,
    metric,
    n: overall.base,
    overall: overall.value,
    bySegment,
  };
}

/**
 * Runs one CSM dashboard for one file: overall satisfaction, each mapped attribute (each at its
 * own metric, split by the segment variable when one was mapped), the loyalty/NPS question if
 * mapped, and a driver analysis ranking the attributes against overall satisfaction when both
 * are present. Every step reuses the single-file engines (runDistributionAction, runNpsAction,
 * runDriverAnalysisFor) the other Analytics tools already run on, so a CSM dashboard reads
 * exactly as a crosstab, an NPS card or a driver ranking built by hand would.
 */
export async function buildCsmDashboardAction(
  runId: string,
  documentId: string,
  mapping: CsmMapping,
  waveLabel?: string | null,
): Promise<{ ok: true; dashboard: CsmDashboard } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const dict = await loadVariableDictionary(TENANT_ID, runId, documentId);
    const weightVar = defaultWeight(dict);
    const byName = new Map(dict.variables.map((v) => [v.name, v]));
    const segmentVar = mapping.segmentVar ?? null;

    let overall: CsmScore | null = null;
    if (mapping.overallVar) {
      const v = byName.get(mapping.overallVar);
      const metric = mapping.overallMetric ?? defaultMetricForScale(v?.nDistinct ?? 10);
      const scored = await scoreVariable(runId, documentId, mapping.overallVar, v?.label || mapping.overallVar, metric, weightVar, segmentVar);
      if ("error" in scored) return { ok: false, error: scored.error };
      overall = scored;
    }

    const attributes: CsmScore[] = [];
    const failedAttributes: CsmDashboard["failedAttributes"] = [];
    for (const attr of mapping.attributes) {
      const v = byName.get(attr.variable);
      const metric = attr.metric ?? mapping.overallMetric ?? defaultMetricForScale(v?.nDistinct ?? 5);
      const scored = await scoreVariable(runId, documentId, attr.variable, v?.label || attr.variable, metric, weightVar, segmentVar);
      // ANA-CSM-001: an attribute that can't be tabulated still doesn't fail the whole dashboard,
      // but it is no longer dropped with nothing to show for it - it is recorded in
      // failedAttributes, explicit and pending, rather than just missing from attributes with no
      // way to tell "not mapped" from "mapped but failed".
      if ("error" in scored) {
        failedAttributes.push({ variable: attr.variable, label: v?.label || attr.variable, error: scored.error });
        continue;
      }
      attributes.push(scored);
    }

    let loyalty: NpsResult | null = null;
    if (mapping.loyaltyVar) {
      const nps = await runNpsAction(runId, documentId, mapping.loyaltyVar, weightVar, segmentVar);
      if (nps.ok) loyalty = nps.result;
    }

    let driver: DriverReport | null = null;
    if (mapping.overallVar && mapping.attributes.length >= 2) {
      try {
        driver = await runDriverAnalysisFor(TENANT_ID, runId, documentId, {
          outcome: mapping.overallVar,
          outcomeType: "continuous",
          predictors: mapping.attributes.map((a) => a.variable),
          weightVar,
          groupVar: segmentVar,
        });
      } catch {
        driver = null; // driver analysis is a bonus view here; a failure (eg too few cases) shouldn't sink the dashboard
      }
    }

    const segmentLabel = segmentVar ? (byName.get(segmentVar)?.label || segmentVar) : null;
    const segments = overall?.bySegment.map((s) => s.name) ?? attributes[0]?.bySegment.map((s) => s.name) ?? [];

    return {
      ok: true,
      dashboard: {
        documentId,
        waveLabel: waveLabel ?? null,
        weighted: !!weightVar,
        segmentVar,
        segmentLabel,
        segments,
        overall,
        attributes,
        failedAttributes,
        loyalty,
        driver,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Runs the same mapping across several wave files, one dashboard per file, so a multi-wave CSM module reads off the same mapping without re-setup. */
export async function buildCsmWaveDashboardsAction(
  runId: string,
  files: { documentId: string; label: string }[],
  mapping: CsmMapping,
): Promise<{ ok: true; dashboards: CsmDashboard[] } | Fail> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  const dashboards: CsmDashboard[] = [];
  for (const f of files) {
    const res = await buildCsmDashboardAction(runId, f.documentId, mapping, f.label);
    if (!res.ok) return res;
    dashboards.push(res.dashboard);
  }
  return { ok: true, dashboards };
}

export async function loadCsmModuleAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; mapping: CsmMapping | null } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const mapping = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ mapping: CsmMapping }>(
        `select mapping from csm_modules where run_id = $1 and document_id = $2 limit 1`,
        [runId, documentId],
      );
      return r.rows[0]?.mapping ?? null;
    });
    return { ok: true, mapping };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveCsmModuleAction(
  runId: string,
  documentId: string,
  mapping: CsmMapping,
): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into csm_modules (tenant_id, run_id, document_id, mapping, updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (document_id) do update set mapping = $4, updated_at = now()`,
        [TENANT_ID, runId, documentId, JSON.stringify(mapping)],
      );
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}


/** The four things a CSM dashboard can post as findings, each committed independently so a researcher can keep the attribute scorecard without the driver ranking, say. */
export type CsmFindingSection = "overall" | "attributes" | "loyalty" | "driver";

function pct(score: CsmScore, v: number | null): string {
  return v === null ? "-" : score.metric === "mean" ? `${v}` : `${v}%`;
}

function describeCsmSection(dashboard: CsmDashboard, section: CsmFindingSection): { text: string; theme: string } {
  const segNote = dashboard.segmentLabel ? `, split by ${dashboard.segmentLabel}` : "";
  const base = dashboard.weighted ? "weighted" : "unweighted";
  if (section === "overall" && dashboard.overall) {
    const o = dashboard.overall;
    return {
      text: `Overall satisfaction ("${o.label}") is ${pct(o, o.overall)} (${metricLabel(o.metric)}, n=${o.n.toLocaleString()}, ${base})${segNote}.`,
      theme: o.label,
    };
  }
  if (section === "attributes" && dashboard.attributes.length) {
    const ranked = [...dashboard.attributes].sort((a, b) => (b.overall ?? -Infinity) - (a.overall ?? -Infinity));
    const parts = ranked.map((a) => `${a.label} ${pct(a, a.overall)}`).join("; ");
    return {
      text: `CSM attribute scores (${metricLabel(ranked[0].metric)}-style cuts, ${base})${segNote}: ${parts}.`,
      theme: "CSM attributes",
    };
  }
  if (section === "loyalty" && dashboard.loyalty) {
    const l = dashboard.loyalty;
    return {
      text: `Loyalty ("${l.label}") NPS is ${Math.round(l.nps)} (${Math.round(l.promoters)}% promoters, ${Math.round(l.detractors)}% detractors, n=${l.n.toLocaleString()})${segNote}.`,
      theme: l.label,
    };
  }
  if (section === "driver" && dashboard.driver) {
    const ranked = [...dashboard.driver.result.rows].sort((a, b) => b.share - a.share).slice(0, 3);
    const parts = ranked.map((r) => `${r.name} (${Math.round(r.share * 100)}%)`).join(", ");
    return {
      text: `Driver ranking for "${dashboard.driver.outcomeLabel}": led by ${parts}.`,
      theme: dashboard.driver.outcomeLabel,
    };
  }
  return { text: "", theme: "" };
}

/** Posts (or re-posts) one section of a CSM dashboard as a finding. Keyed on the section's own variable(s) plus the segment variable, so building the same dashboard again updates the finding in place, while re-mapping to a different question or a different segment posts a fresh one. */
export async function addCsmFindingAction(
  runId: string,
  documentId: string,
  dashboard: CsmDashboard,
  section: CsmFindingSection,
): Promise<{ ok: true; added: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const key = csmFindingKey(dashboard, section);
    if (!key) return { ok: false, error: "There is nothing in this section to post yet." };
    const { text, theme } = describeCsmSection(dashboard, section);
    if (!text) return { ok: false, error: "There is nothing in this section to post yet." };
    const groupVar = dashboard.segmentVar;
    await withTenant(TENANT_ID, async (client) => {
      const existing = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'csm_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and coalesce(stated_stats->>'groupVar', '') = coalesce($5, '') and status <> 'rejected'`,
        [runId, section, key, documentId, groupVar],
      );
      const statsJson = JSON.stringify({
        source: "csm_tool",
        section,
        key,
        documentId,
        waveLabel: dashboard.waveLabel,
        groupVar,
        groupLabel: dashboard.segmentLabel,
        dashboard,
        caveats: ["descriptive_reading"],
      });
      if ((existing.rows[0]?.n ?? 0) > 0) {
        // REP-IN-002: a theme a researcher changed by hand is kept; the tool still refreshes its
        // own text and statistics. Before migration 0094 there is no edit record to consult.
        const provenance = await findingProvenanceAvailable(client);
        const touched = await client.query<{ id: string }>(
          `update findings set finding_text = $6,
             theme = ${provenance ? "case when human_edited_fields @> array['theme'] then theme else $7 end" : "$7"},
             stated_stats = $8
           where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'csm_tool'
             and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
             and coalesce(stated_stats->>'groupVar', '') = coalesce($5, '') and status <> 'rejected'
         returning id`,
          [runId, section, key, documentId, groupVar, text, theme, statsJson],
        );
        await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
        return;
      }
      const revived = await client.query<{ id: string }>(
        `update findings set status = 'accepted'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'csm_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and coalesce(stated_stats->>'groupVar', '') = coalesce($5, '') and status = 'rejected'
         returning id`,
        [runId, section, key, documentId, groupVar],
      );
      await recordHumanReview(client, revived.rows.map((row) => row.id), "tool_add");
      if ((revived.rowCount ?? 0) > 0) return;
      const touched = await client.query<{ id: string }>(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, data_type, status, source_document_id)
         values ($1, $2, 'generated', $3, $4, 'level', $5, 'quantitative', 'accepted', $6)
         returning id`,
        [TENANT_ID, runId, text, theme, statsJson, documentId],
      );
      await recordHumanReview(client, touched.rows.map((row) => row.id), "tool_add");
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, added: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function removeCsmFindingAction(
  runId: string,
  documentId: string,
  section: CsmFindingSection,
  key: string,
  groupVar: string | null,
): Promise<{ ok: true; removed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const removed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string }>(
        `update findings set status = 'rejected'
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'csm_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and coalesce(stated_stats->>'groupVar', '') = coalesce($5, '') and status <> 'rejected'
         returning id`,
        [runId, section, key, documentId, groupVar],
      );
      await recordHumanReview(client, r.rows.map((row) => row.id), "tool_remove");
      return r.rowCount ?? 0;
    });
    revalidatePath(`/runs/${runId}`);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function csmFindingStatusAction(
  runId: string,
  documentId: string,
  section: CsmFindingSection,
  key: string,
  groupVar: string | null,
): Promise<{ ok: true; committed: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  try {
    const committed = await withTenant(TENANT_ID, async (client) => {
      const r = await client.query<{ n: number }>(
        `select count(*)::int as n from findings
         where run_id = $1 and pattern_type = 'level' and stated_stats->>'source' = 'csm_tool'
           and stated_stats->>'section' = $2 and stated_stats->>'key' = $3 and stated_stats->>'documentId' = $4
           and coalesce(stated_stats->>'groupVar', '') = coalesce($5, '') and status <> 'rejected'`,
        [runId, section, key, documentId, groupVar],
      );
      return (r.rows[0]?.n ?? 0) > 0;
    });
    return { ok: true, committed };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}


