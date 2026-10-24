import { withTenantRead } from "./db";
import { processingState, type AcceptanceState, type StoredProcessingStatus } from "./importSources";
import { crosstabDatasetState } from "./crosstabEntry";
import { getTranscriptSetups } from "./transcriptSetup";
import { getInstrumentSummaries } from "./instruments";
import { loadFailedBriefFill, loadLastBriefFill } from "./briefFillRecord";
import { loadObjectiveQualityStatus, objectiveQualityLookup, unscoredReasonFor, unscoredReasonText, type ObjectiveQualityStatus } from "./objectiveQualityStatus";
import { parseObjectiveLines, setupLineCandidateIds } from "./objectiveLines";
import { decisionRefreshPending } from "./decisionRefresh";
import type { ObjectiveStageInput } from "./stageStatus";
import { nextStep, sectionStatuses, type ProjectStageFacts, type SectionStatus } from "./sectionStatus";

// The facts behind the section dashboards and the main dashboard's project rows (Grant, 2026-10-23,
// 3001), from the stored records only: one set of queries per project, the same for the project's
// own dashboards and the main dashboard, so both say the same thing. The project page adds its
// fuller checks (preview identity, data quality flags, design freshness, support) on top; those are
// absent here and the main dashboard says so.
//
// A query that fails is not passed off as an empty project: the whole load throws, and the caller
// shows that the status could not be read.

/** An objective's score state, the one rule the Objectives page and the status share. */
export function objectiveUnscoredReason(text: string, accepted: boolean, scored: boolean, status: ObjectiveQualityStatus | { error: string }): string | null {
  if (scored && accepted) return null;
  return "error" in status ? unscoredReasonText(null, accepted) : unscoredReasonText(unscoredReasonFor(status, text), accepted);
}

/**
 * Objectives' status input: every objective, with a stated line that has no candidate record yet
 * counted as accepted and not yet scored rather than left out or passed as scored.
 */
export function objectiveStageInputOf(input: {
  statedText: string | null;
  candidates: { id: string; candidate_text: string; source: string; status: "pending" | "accepted" | "rejected" }[];
  quality: { rows: { item_text: string; quality_tier: "strong" | "workable" | "weak" | null }[]; missing: boolean };
  qualityStatus: ObjectiveQualityStatus | { error: string };
  failedFill: { documents: string; reason: string } | null | { error: string };
  lastFill: unknown;
  coverage: { item_kind: string; item_text: string; status: "resolved" | "partial" | "gap"; inferred: boolean; evidence_digest_degraded?: boolean }[];
  coverageError: string | null;
}): ObjectiveStageInput {
  const lines = parseObjectiveLines(input.statedText);
  const ids = setupLineCandidateIds(lines, input.candidates);
  const qualityFor = objectiveQualityLookup(input.quality.rows);
  const fillFailed = (x: unknown) => typeof x === "object" && x !== null && "error" in x;
  return {
    objectives: [
      ...lines.flatMap((text, i) => (ids[i] ? [] : [{ id: null, text, status: "accepted" as const, unscoredReason: unscoredReasonText({ kind: "never" }, true), scoreTier: null }])),
      ...input.candidates.map((c) => {
        const q = qualityFor(c.candidate_text);
        const scored = Boolean(q && c.status === "accepted");
        return {
          id: c.id,
          text: c.candidate_text,
          status: c.status,
          unscoredReason: objectiveUnscoredReason(c.candidate_text, c.status === "accepted", scored, input.qualityStatus),
          scoreTier: scored ? (q!.quality_tier ?? null) : null,
        };
      }),
    ],
    qualityStatusFailed: "error" in input.qualityStatus,
    scoresUnavailable: input.quality.missing,
    failedFill: input.failedFill && !fillFailed(input.failedFill) ? (input.failedFill as { documents: string; reason: string }) : null,
    fillRecordFailed: fillFailed(input.failedFill) || fillFailed(input.lastFill),
    coverage: input.coverage
      .filter((v) => v.item_kind === "objective" && !v.inferred)
      .map((v) => ({ text: v.item_text, status: v.status, degraded: v.evidence_digest_degraded === true })),
    coverageError: input.coverageError,
  };
}

const ANALYSIS_SOURCES = ["nps_tool", "chart_tool", "scatter_tool", "brand_health_tool", "csm_tool", "wave_chart_tool", "wave_driver_tool", "wave_nps_tool"];

/** The stored-record facts for one project. Throws when they cannot be read. */
export async function loadProjectStageFacts(tenantId: string, runId: string): Promise<ProjectStageFacts> {
  const [db, transcriptSetups, instruments, failedFill, lastFill, qualityStatus, refreshPending] = await Promise.all([
    withTenantRead(tenantId, async (client) => {
      const q = async <T>(sql: string, args: unknown[] = [runId]) => (await client.query(sql, args)).rows as T[];
      const has = async (table: string) => (await q<{ ok: boolean }>("select to_regclass($1) is not null as ok", [`public.${table}`]))[0].ok;
      const run = (await q<{ stated_objectives_text: string | null }>("select stated_objectives_text from runs where id = $1"))[0];
      if (!run) throw new Error("That project was not found.");
      const docs = await q<{ id: string; source_filename: string; kind: string; processing_status: StoredProcessingStatus; ingestion_type: string | null; accepted: boolean | null; has_setup: boolean; text_len: number }>(
        `select id, source_filename, kind, processing_status, ingestion_type,
                (data_setup->>'accepted')::boolean as accepted, data_setup is not null as has_setup,
                coalesce(length(extracted_text), 0) as text_len
           from documents where run_id = $1 and kind <> 'output' order by uploaded_at`,
      );
      const tables = await q<{ document_id: string; imported: number; drafts: number; committed: number }>(
        `select document_id,
                count(*) filter (where table_index < 100 and jsonb_array_length(headers) > 0 and jsonb_array_length(rows) > 0)::int as imported,
                count(*) filter (where table_index >= 100 and crosstab_status = 'draft')::int as drafts,
                count(*) filter (where table_index >= 100 and coalesce(crosstab_status, 'committed') = 'committed')::int as committed
           from document_tables where run_id = $1 and coalesce(crosstab_status, 'committed') <> 'evidence' group by document_id`,
      );
      const outputSets = (await has("output_sets")) ? await q<{ id: string; name: string }>("select id, name from output_sets where run_id = $1 order by created_at") : [];
      const candidates = await q<{ id: string; candidate_text: string; source: string; status: "pending" | "accepted" | "rejected" }>(
        "select id, candidate_text, source, status from objective_candidates where run_id = $1 order by created_at",
      );
      const qualityMissing = !(await has("objective_quality"));
      const quality = qualityMissing ? [] : await q<{ item_text: string; quality_tier: "strong" | "workable" | "weak" | null }>("select item_text, quality_tier from objective_quality where run_id = $1 order by item_order");
      const degradedColumn = (await q<{ ok: boolean }>("select exists (select 1 from information_schema.columns where table_name = 'objective_validations' and column_name = 'evidence_digest_degraded') as ok", []))[0].ok;
      const coverage = await q<{ item_kind: string; item_text: string; status: "resolved" | "partial" | "gap"; inferred: boolean; evidence_digest_degraded?: boolean }>(
        `select item_kind, item_text, status, inferred${degradedColumn ? ", evidence_digest_degraded" : ""} from objective_validations where run_id = $1 order by item_kind, item_order`,
      );
      const coverageError =
        coverage.length === 0
          ? ((await q<{ message: string | null }>("select detail->>'message' as message from trace where run_id = $1 and event = 'objective_validation_error' order by occurred_at desc limit 1"))[0]?.message ?? null)
          : null;
      const decisions = (await q<{ pending: number; accepted: number }>("select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'accepted')::int as accepted from decision_candidates where run_id = $1"))[0];
      const rq = (await has("research_quality_reviews"))
        ? { latest: (await q<{ state: string }>("select state from research_quality_reviews where run_id = $1 order by created_at desc limit 1"))[0]?.state ?? null }
        : null;
      const codebooks = new Set((await q<{ document_id: string }>("select distinct document_id from coding_codebooks where run_id = $1")).map((r) => r.document_id));
      const claims = new Map(
        (await q<{ document_id: string; n: number }>("select source_document_id as document_id, count(*)::int as n from findings where run_id = $1 and origin = 'stated' and source_document_id is not null group by source_document_id")).map((r) => [r.document_id, r.n]),
      );
      const findings = (await q<{ total: number; pending: number; accepted: number; rejected: number; analysis: number }>(
        `select count(*)::int as total, count(*) filter (where status = 'pending')::int as pending,
                count(*) filter (where status = 'accepted')::int as accepted, count(*) filter (where status = 'rejected')::int as rejected,
                count(*) filter (where status <> 'rejected' and (stated_stats->>'source' = any($2::text[]) or pattern_type = 'driver'))::int as analysis
           from findings where run_id = $1`,
        [runId, ANALYSIS_SOURCES],
      ))[0];
      const insights = (await q<{ total: number; in_use: number }>("select count(*)::int as total, count(*) filter (where review_status <> 'rejected')::int as in_use from synthesized_insights where run_id = $1"))[0];
      const recs = (await q<{ total: number; pending: number; accepted: number }>(
        "select count(*)::int as total, count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'accepted')::int as accepted from recommendations where run_id = $1 and synthesized_insight_id is not null",
      ))[0];
      const narrative = (await q<{ generated_at: string }>("select generated_at::text from deck_narratives where run_id = $1 limit 1"))[0] ?? null;
      const narrativeError = narrative ? null : ((await q<{ message: string | null }>("select detail->>'message' as message from trace where run_id = $1 and event = 'story_narrative_error' order by occurred_at desc limit 1"))[0]?.message ?? null);
      // The same rule as the project page's processing banner: errors at or after the latest batch.
      const processErrors = await q<{ errors: unknown }>(
        `with latest_batch as (select occurred_at from trace where run_id = $1 and event = 'process_run_batch' order by occurred_at desc limit 1)
         select detail->'errors' as errors from trace
          where run_id = $1 and event = 'process_run_errors' and occurred_at >= coalesce((select occurred_at from latest_batch), '-infinity'::timestamptz)
          order by occurred_at desc limit 1`,
      );
      return { run, docs, tables, outputSets, candidates, quality, qualityMissing, coverage, coverageError, decisions, rq, codebooks, claims, findings, insights, recs, narrative, narrativeError, processErrors };
    }),
    getTranscriptSetups(tenantId, runId),
    getInstrumentSummaries(tenantId, runId),
    loadFailedBriefFill(tenantId, runId),
    loadLastBriefFill(tenantId, runId),
    loadObjectiveQualityStatus(tenantId, runId),
    decisionRefreshPending(tenantId, runId),
  ]);

  const tablesOf = new Map(db.tables.map((t) => [t.document_id, t]));
  const files = [
    ...db.docs.map((d) => {
      const instrument = d.kind === "instrument" ? instruments.get(d.id) : undefined;
      const imported = tablesOf.get(d.id)?.imported ?? 0;
      const processing = processingState({
        kind: d.kind,
        processingStatus: instrument?.readStatus && !instrument.readStatus.complete ? "incomplete" : d.processing_status,
        preview: d.kind === "instrument" ? null : d.kind === "table" ? { kind: "tables", count: imported } : d.text_len > 0 ? { kind: "text", length: d.text_len } : null,
        instrumentRead: instrument ? instrument.items > 0 || instrument.readStatus !== undefined : undefined,
      });
      const isRaw = d.kind === "table" && d.ingestion_type === "raw";
      const t = d.kind === "transcript" ? transcriptSetups.get(d.id) : undefined;
      // No saved setup yet: Import accepts the defaults when it is opened, so until then it is
      // waiting for the researcher to open it, not being saved.
      const acceptance: AcceptanceState = isRaw ? (d.has_setup ? (d.accepted === false ? "needs_review" : "accepted") : "needs_review") : d.kind === "transcript" ? (t?.confirmed ? "accepted" : "needs_review") : "none";
      return { documentId: d.id, filename: d.source_filename, kind: d.kind, processing, acceptance, readError: null, linksToCheck: instrument?.itemsToCheck ?? 0 };
    }),
    ...db.outputSets.map((s) => ({ documentId: `output-set:${s.id}`, filename: s.name, kind: "output", processing: "read" as const, acceptance: "none" as const, readError: null, linksToCheck: 0 })),
  ];

  const tableDocs = db.docs.filter((d) => d.kind === "table");
  return {
    import: { files, tablesReadFailed: false },
    objectives: objectiveStageInputOf({
      statedText: db.run.stated_objectives_text,
      candidates: db.candidates,
      quality: { rows: db.quality, missing: db.qualityMissing },
      qualityStatus,
      failedFill,
      lastFill,
      coverage: db.coverage,
      coverageError: db.coverageError,
    }),
    // A queued review ('pending') is counted as running: it starts by itself. No reviews table yet
    // (before 0105) means the module is not in use.
    researchQuality: {
      latest: db.rq?.latest === "pending" ? "running" : ((db.rq?.latest ?? null) as "running" | "complete" | "partial" | "failed" | null),
      hasContextFile: db.docs.some((d) => d.kind === "evidence"),
    },
    decisions: { pending: db.decisions.pending, accepted: db.decisions.accepted, refreshPending },
    crosstabs: {
      tablesReadFailed: false,
      files: tableDocs.map((d) => ({
        id: d.id,
        filename: d.source_filename,
        state: crosstabDatasetState({ filename: d.source_filename, ingestion: d.ingestion_type, processingStatus: d.processing_status, setupAccepted: d.has_setup ? d.accepted === true : undefined }),
        draftTables: tablesOf.get(d.id)?.drafts ?? 0,
        committedTables: tablesOf.get(d.id)?.committed ?? 0,
      })),
    },
    analytics: { analysisFindings: db.findings.analysis },
    coding: {
      transcripts: db.docs.filter((d) => d.kind === "transcript").map((d) => ({ id: d.id, filename: d.source_filename, setupAccepted: transcriptSetups.get(d.id)?.confirmed === true, coded: db.codebooks.has(d.id) })),
    },
    reports: {
      reports: db.docs.filter((d) => d.kind === "report").map((d) => ({ id: d.id, filename: d.source_filename, failed: d.processing_status === "failed", claims: db.claims.get(d.id) ?? 0 })),
      processErrors: (() => {
        const e = db.processErrors[0]?.errors;
        return Array.isArray(e) ? e.filter((x): x is string => typeof x === "string") : [];
      })(),
    },
    findings: {
      total: db.findings.total,
      pending: db.findings.pending,
      accepted: db.findings.accepted,
      rejected: db.findings.rejected,
      hasSources: db.docs.some((d) => d.kind === "table" || d.kind === "transcript" || d.kind === "report") || db.outputSets.length > 0,
    },
    insights: { total: db.insights.total, inUse: db.insights.in_use },
    recommendations: { total: db.recs.total, pending: db.recs.pending, accepted: db.recs.accepted },
    report: { generatedAt: db.narrative?.generated_at ?? null, error: db.narrativeError },
  };
}

export type ProjectOverview =
  | { ok: true; sections: SectionStatus[]; next: ReturnType<typeof nextStep> }
  | { ok: false; error: string };

/**
 * The main dashboard's row for each project: its four sections and its next step, from the stored
 * records. At most four projects are read at once, so a long list does not take every connection.
 * A project whose facts cannot be read gets its own error, not an empty status.
 */
export async function loadProjectOverviews(tenantId: string, runIds: string[]): Promise<Map<string, ProjectOverview>> {
  const out = new Map<string, ProjectOverview>();
  let i = 0;
  const worker = async () => {
    while (i < runIds.length) {
      const id = runIds[i++];
      try {
        const sections = sectionStatuses(await loadProjectStageFacts(tenantId, id));
        out.set(id, { ok: true, sections, next: nextStep(sections) });
      } catch (e) {
        out.set(id, { ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, runIds.length) }, worker));
  return out;
}
