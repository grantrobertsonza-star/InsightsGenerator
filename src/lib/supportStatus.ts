// FND-001 / REP-OUT-001 and ANA-NPS-003 downstream freshness: server-side loaders for the support
// status of synthesized insights and (golden-thread GT-006) pre-insights. The rule itself lives in supportStatusShared.ts (classifyInsightSupport);
// this file only gathers the inputs. Read-only: it never writes, deletes or rewrites anything.
//
// Inputs, per insight and source link: the support_snapshot recorded when the insight was drafted
// (migration 0096), finding_support_parts() now (same migration, so drafted and current
// fingerprints come from one SQL definition), the finding's status, and, for findings from a
// calculated table, that table's recorded design/corrections snapshots compared with the data
// file's CURRENT settings - resolved with the same unchanged helpers the Findings table and the
// cross-tab list already use (resolveCurrentDesignSnapshotStatus, loadVariableOverrides), so the
// three cannot disagree about what "current settings" means.
//
// Missing migration: detected with a catalog pre-check (no failing statement, so the read
// transaction is never left aborted). Without 0096 every link is "not recorded" (unknown);
// rejection and deletion are still detected because they need no snapshot.
//
// Failure: a settings lookup for one data file that fails is contained to that file's links
// (unknown, with the reason). Anything else that fails makes loadInsightSupport throw. Callers that must still render (the run page, exports) use
// loadInsightSupportOrUnchecked, which turns a failed check into "unknown" WITH the error
// attached - visible and qualified, never silently "current" and never an empty success.
import type { PoolClient } from "pg";
import { withTenantRead } from "./db";
import { designFreshnessStatus, resolveCurrentDesignSnapshotStatus } from "./crosstabs";
import { loadVariableOverrides } from "./variableOverrides";
import {
  classifyInsightSupport,
  correctionsFor,
  tableVariablesFromSavedRequest,
  uncheckedSupport,
  type DocumentSettingsCheck,
  type InsightSupport,
  type SupportLinkRow,
  type SupportParts,
} from "./supportStatusShared";

type RawRow = {
  insight_id: string;
  triangulation_count: number | string;
  link_id: string | null;
  finding_id: string | null;
  finding_status: string | null;
  finding_text: string | null;
  support_snapshot: SupportParts | null;
  current_parts: SupportParts | null;
  calculated_table_document_id: string | null;
  design_snapshot: SupportLinkRow["designSnapshot"];
  overrides_snapshot: unknown;
  saved_request: unknown;
};

/** Key-order-independent JSON, for comparing two corrections maps read from jsonb. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

async function settingsCheckFor(tenantId: string, runId: string, documentId: string): Promise<DocumentSettingsCheck> {
  // Golden-thread repair: a failed lookup for ONE data file (an unreachable stored file while its
  // dictionary is rebuilt, say) used to throw out of the whole support check, so every insight in
  // the run - including one whose source was plainly rejected - read "not checked". It is now
  // contained here: only links to this file's calculated tables become unknown, with the reason,
  // and rejection, deletion and in-place changes are still detected everywhere.
  let design: Awaited<ReturnType<typeof resolveCurrentDesignSnapshotStatus>>;
  try {
    design = await resolveCurrentDesignSnapshotStatus(tenantId, runId, documentId);
  } catch (error) {
    design = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  let corrections: { ok: true; json: string } | { ok: false; error: string };
  try {
    corrections = { ok: true, json: stableJson(await loadVariableOverrides(tenantId, runId, documentId)) };
  } catch (error) {
    corrections = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const errors = [design.ok ? null : design.error, corrections.ok ? null : corrections.error].filter(Boolean);
  return {
    design: (snapshot) => designFreshnessStatus(snapshot, design),
    corrections: (snapshot, tableVariables) => {
      // A table calculated before corrections were snapshotted (0078) has nothing to compare
      // against: unknown, not "no corrections" (the cross-tab list treats it as not stale, which
      // is a display choice there; here it would let an unverifiable insight read as current).
      if (snapshot === null || snapshot === undefined) return "unknown";
      if (!corrections.ok) return "unknown";
      // Compared on the variables the table used when that is recorded; file-wide otherwise.
      const current = correctionsFor(JSON.parse(corrections.json), tableVariables);
      return stableJson(correctionsFor(snapshot, tableVariables)) === stableJson(current) ? "current" : "stale";
    },
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  };
}

export type InsightSupportResult = {
  /** Status of one insight. An id the check did not cover reports "unknown", never "current". */
  statusOf: (insightId: string) => InsightSupport;
  /** False when migration 0096 is not applied: nothing can be "current", by construction. */
  snapshotsAvailable: boolean;
  /** Set when the whole check failed (loadInsightSupportOrUnchecked only). */
  error: string | null;
};

/**
 * Support status for every synthesized insight in a run (or just `insightIds`). One read
 * transaction for the insight/link/finding rows; the per-data-file settings lookups use their
 * existing helpers. Throws on failure.
 */
export async function loadInsightSupport(
  tenantId: string,
  runId: string,
  insightIds?: string[],
): Promise<InsightSupportResult> {
  const { rows, snapshotsAvailable } = await withTenantRead(tenantId, async (client) => {
    const probe = await client.query<{ available: boolean }>(
      `select (
         exists (
           select 1 from information_schema.columns
           where table_name = 'synthesized_insight_sources' and column_name = 'support_snapshot'
         )
         and to_regprocedure('finding_support_parts(uuid)') is not null
       ) as available`,
    );
    const available = probe.rows[0]?.available === true;
    const snapshotColumns = available
      ? "s.support_snapshot, case when f.id is null then null else finding_support_parts(f.id) end as current_parts"
      : "null::jsonb as support_snapshot, null::jsonb as current_parts";
    const filter = insightIds ? "and si.id = any($2::uuid[])" : "";
    const result = await client.query<RawRow>(
      `select si.id as insight_id, si.triangulation_count,
              s.pre_insight_id as link_id,
              f.id as finding_id, f.status as finding_status, f.finding_text,
              ${snapshotColumns},
              case when dt.crosstab is not null then dt.document_id else null end as calculated_table_document_id,
              dt.design_snapshot, dt.overrides_snapshot, dt.crosstab->'savedRequest' as saved_request
       from synthesized_insights si
       left join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       left join insights i on i.id = s.pre_insight_id
       left join findings f on f.id = i.finding_id
       left join document_tables dt on dt.id = f.source_table_id
       where si.run_id = $1 ${filter}
       order by si.id, s.pre_insight_id`,
      insightIds ? [runId, insightIds] : [runId],
    );
    return { rows: result.rows, snapshotsAvailable: available };
  });

  return classifyRows(tenantId, runId, rows, snapshotsAvailable);
}

/** Builds the per-insight link rows and classifies each with the one shared rule. */
async function classifyRows(tenantId: string, runId: string, rows: RawRow[], snapshotsAvailable: boolean): Promise<InsightSupportResult> {
  const byInsight = new Map<string, SupportLinkRow[]>();
  for (const r of rows) {
    const row: SupportLinkRow = {
      insightId: r.insight_id,
      triangulationCount: Number(r.triangulation_count),
      linkId: r.link_id,
      findingId: r.finding_id,
      findingStatus: r.finding_status,
      findingText: r.finding_text,
      recorded: r.support_snapshot,
      current: r.current_parts,
      calculatedTableDocumentId: r.calculated_table_document_id,
      designSnapshot: r.design_snapshot ?? null,
      overridesSnapshot: r.overrides_snapshot ?? null,
      tableVariables: tableVariablesFromSavedRequest(r.saved_request),
    };
    const list = byInsight.get(row.insightId);
    if (list) list.push(row);
    else byInsight.set(row.insightId, [row]);
  }

  const documentIds = Array.from(
    new Set(rows.map((r) => r.calculated_table_document_id).filter((id): id is string => id !== null)),
  );
  const settings = new Map<string, DocumentSettingsCheck>();
  await Promise.all(
    documentIds.map(async (documentId) => {
      settings.set(documentId, await settingsCheckFor(tenantId, runId, documentId));
    }),
  );

  const statuses = new Map<string, InsightSupport>();
  for (const [insightId, insightRows] of byInsight) {
    statuses.set(insightId, classifyInsightSupport(insightRows, settings, snapshotsAvailable));
  }
  return {
    statusOf: (insightId) => statuses.get(insightId) ?? uncheckedSupport("this insight was not included in the support check"),
    snapshotsAvailable,
    error: null,
  };
}

/**
 * Same as loadInsightSupport, but a failed check reports every insight as "unknown" with the
 * error attached instead of throwing. For callers that must still render something truthful (the
 * run page, exports): a reader sees "Support not checked (reason)", never a silently current or
 * silently missing insight.
 */
export async function loadInsightSupportOrUnchecked(
  tenantId: string,
  runId: string,
  insightIds?: string[],
): Promise<InsightSupportResult> {
  try {
    return await loadInsightSupport(tenantId, runId, insightIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unchecked = uncheckedSupport(message);
    return { statusOf: () => unchecked, snapshotsAvailable: false, error: message };
  }
}

let preInsightSnapshotConfirmed = false;
/**
 * Whether pre-insights can record their finding's fingerprint: insights.support_snapshot
 * (migration 0103) and finding_support_parts() (0096) both exist. Positive result cached.
 */
export async function preInsightSupportSnapshotAvailable(client: PoolClient): Promise<boolean> {
  if (preInsightSnapshotConfirmed) return true;
  const r = await client.query<{ available: boolean }>(
    `select (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'insights' and column_name = 'support_snapshot')
             and to_regprocedure('finding_support_parts(uuid)') is not null) as available`,
  );
  preInsightSnapshotConfirmed = r.rows[0]?.available === true;
  return preInsightSnapshotConfirmed;
}

/**
 * Support status for pre-insights (one per finding; golden-thread GT-006). Each pre-insight is
 * treated as an insight with one source link, its own finding, and classified by the same rule
 * as synthesized insights: rejected finding -> invalid; finding changed in place since the
 * pre-insight was drafted (0103 snapshot) -> stale; calculation settings behind it changed ->
 * stale; nothing recorded (written before 0103) or a lookup failed -> unknown, never current.
 * A deleted finding takes its pre-insight with it (cascade), so there is nothing left to qualify.
 * Throws on failure; exports use loadPreInsightSupportOrUnchecked.
 */
export async function loadPreInsightSupport(tenantId: string, runId: string, insightIds?: string[]): Promise<InsightSupportResult> {
  const { rows, snapshotsAvailable } = await withTenantRead(tenantId, async (client) => {
    const available = await preInsightSupportSnapshotAvailable(client);
    const snapshotColumns = available
      ? "i.support_snapshot, finding_support_parts(f.id) as current_parts"
      : "null::jsonb as support_snapshot, null::jsonb as current_parts";
    const filter = insightIds ? "and i.id = any($2::uuid[])" : "";
    const result = await client.query<RawRow>(
      `select i.id as insight_id, 1 as triangulation_count, i.id as link_id,
              f.id as finding_id, f.status as finding_status, f.finding_text,
              ${snapshotColumns},
              case when dt.crosstab is not null then dt.document_id else null end as calculated_table_document_id,
              dt.design_snapshot, dt.overrides_snapshot, dt.crosstab->'savedRequest' as saved_request
       from insights i
       join findings f on f.id = i.finding_id
       left join document_tables dt on dt.id = f.source_table_id
       where i.run_id = $1 ${filter}
       order by i.id`,
      insightIds ? [runId, insightIds] : [runId],
    );
    return { rows: result.rows, snapshotsAvailable: available };
  });
  return classifyRows(tenantId, runId, rows, snapshotsAvailable);
}

/** loadPreInsightSupport, but a failed check reads "unknown" with the error on every pre-insight. */
export async function loadPreInsightSupportOrUnchecked(tenantId: string, runId: string, insightIds?: string[]): Promise<InsightSupportResult> {
  try {
    return await loadPreInsightSupport(tenantId, runId, insightIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const unchecked = uncheckedSupport(message);
    return { statusOf: () => unchecked, snapshotsAvailable: false, error: message };
  }
}
