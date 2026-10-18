import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTenant, withTenantRead } from "@/lib/db";
import { loadImportQuestionDefinitions } from "@/lib/importQuestionDefinitions";
import { extractFindingsFromDocument, readContextDocument } from "@/lib/extractFindings";
import { findingProvenanceAvailable } from "@/lib/findingProvenance";
import { processTableDocument } from "@/lib/documentTables";
import { generateFindingsFromBannerPlan } from "@/lib/generateFindingsFromBannerPlan";
import {
  extractThemesFromTranscript,
  importCodedTranscript,
  reapplyCodebook,
  type CodebookEdit,
} from "@/lib/extractThemes";
import { detectDuplicateFindings } from "@/lib/dedupe";
import { readCodingFile } from "@/lib/codedImportFile";
import { mapWithConcurrency } from "@/lib/concurrency";
import { deleteDocument } from "@/lib/documentActions";
import { markDocumentProcessingStatus } from "@/lib/documentUpload";
import { generateDecisionCandidates } from "@/lib/decisionFramer";
import { refreshVerdicts, reverifyFindings } from "@/lib/verifyFindings";
import { refreshStatedInsightValidations } from "@/lib/validateStatedInsights";
import {
  startProcessProgress,
  incrementProcessProgress,
  setProcessPhase,
  setStageStatus,
  finishProcessProgress,
  isPipelineActive,
} from "@/lib/processProgress";
import { refreshInsights } from "@/lib/insightGenerator";
import { refreshRecommendations } from "@/lib/recommendationAgent";
import { generateStoryNarrative, type DeckPillar } from "@/lib/storyNarrative";
import { loadInsightSupportOrUnchecked, loadPreInsightSupportOrUnchecked, type InsightSupportResult } from "@/lib/supportStatus";
import { summariseSupport } from "@/lib/supportStatusShared";
import { NarrativeSupportBanner } from "./NarrativeSupportBanner";
import { loadWordingEdits } from "@/lib/findingWording";
import { loadRunFigureChecks, type RunFigureChecks } from "@/lib/figureChecks";
import { FigureChecksProvider, FigureCheckNotice } from "./FigureCheckNotice";
import type { WordingEdits } from "./FindingsTable";
import {
  generateObjectiveValidation,
  type ObjectiveValidation,
} from "@/lib/objectiveValidator";
import { generateMethodologySummary } from "@/lib/methodologyExtractor";
import { refreshSynthesizedInsights } from "@/lib/insightSynthesizer";
import { refreshSynthesizedInsightQuality } from "@/lib/synthesizedInsightQualityScorer";
import { estimateCostUsd } from "@/lib/apiUsage";
import {
  summarizeSynthesizedProvenance,
  type DiscoveryType,
} from "@/lib/discoveryClassification";
import { getRunInputCompleteness } from "@/lib/inputCompleteness";
import DecisionBriefReview from "./DecisionBriefReview";
import { decisionContextMismatch, decisionRefreshPending } from "@/lib/decisionRefresh";
import { recommendationDecisionContextAvailable, recommendationDecisionStateSql, writtenForEarlierDecisionsSql } from "@/lib/decisionContext";
import ObjectiveReviewTable, { type ObjectiveRow } from "./ObjectiveReviewTable";
import RunContextForm from "./RunContextForm";
import UploadForm from "./UploadForm";
import StorageCleanupNotice from "./StorageCleanupNotice";
import StatedObjectivesList from "./StatedObjectivesList";
import { generateObjectiveCandidates } from "@/lib/objectiveFramer";
import { refreshObjectiveQuality } from "@/lib/objectiveQualityScorer";
import ObjectiveCoverage from "./ObjectiveCoverage";
import ObjectiveEvidence from "./ObjectiveEvidence";
import { ObjectiveSelectionProvider } from "./ObjectiveSelection";
import { ObjectiveList, ObjectiveMiddle } from "./ObjectivesWorkspace";
import ClaimTableChecks from "./ClaimTableChecks";
import RecommendationsReview from "./RecommendationsReview";
import SynthesizedRecommendationsReview from "./SynthesizedRecommendationsReview";
import InsightsReview from "./InsightsReview";
import StatedInsightValidationsReview, {
  type StatedInsightValidation,
} from "./StatedInsightValidationsReview";
import SynthesizedInsightsReview, {
  type SynthesizedInsightRow,
} from "./SynthesizedInsightsReview";
import CollapsibleSection from "./CollapsibleSection";
import {
  RunSectionProvider,
  RunNav,
  SectionPanel,
  type RunNavSection,
  GoToSection,
} from "./RunShell";
import type { FindingKind } from "@/lib/findingActions";
import DeleteDocumentButton from "@/app/DeleteDocumentButton";
import { impactFor, loadDocumentDeletionImpact } from "@/lib/documentDeletionImpact";
import { deleteDocumentConfirmation } from "@/lib/documentDeletionMessage";
import SubmitButton from "@/components/SubmitButton";
import { Pane, ThreePane } from "./ThreePane";
import RerunExtractButton from "./RerunExtractButton";
import ProcessProgress from "./ProcessProgress";
import CodingFormProgress from "./CodingFormProgress";
import ReportReadSummary, { type ReportReadStats } from "./ReportReadSummary";
import PipelineStatus from "./PipelineStatus";
import WorkingDataTabs from "./WorkingDataTabs";
import ImportQualityPanel, { ImportPreviewRecovery } from "./ImportQualityPanel";
import { loadImportPreviewIdentities } from "@/lib/importPreviewIdentity";
import ImportVariablesPanel from "./ImportVariablesPanel";
import DocumentPicker from "./DocumentPicker";
import DataAuditPanel from "./DataAuditPanel";
import { TranscriptImportQualityPanel, AggregatedQualityPanel } from "./ImportQualityChecks";
import { getTranscriptImportQuality } from "@/lib/transcriptImportQuality";
import { computeAggregatedQuality } from "@/lib/aggregatedQuality";
import { getInstrumentSummaries, getConfirmedItemsForData } from "@/lib/instruments";
import { buildStatedRouting, type StatedRouting } from "@/lib/statedRouting";
import { computeTableQuality, computeFullTableQuality, type TableQuality } from "@/lib/dataQuality";
import { loadVariableDictionary, resolveCurrentDesignSnapshotStatus, designFreshnessStatus, type DesignFreshness, type CurrentDesignSnapshotStatus } from "@/lib/crosstabs";
import { loadVariableOverrides, type QuestionType } from "@/lib/variableOverrides";
import type { VariableDictionary } from "@/lib/parseStatsFile";
import InstrumentCard from "./InstrumentCard";
import AttachedInstruments from "./AttachedInstruments";
import AcceptDataButton from "./AcceptDataButton";
import OutputSetCard from "./OutputSetCard";
import RelatedOutputSets from "./RelatedOutputSets";
import { getOutputSets } from "@/lib/outputSets";
import TranscriptQualityPanel from "./TranscriptQualityPanel";
import CodebookPanel, { type CodebookView } from "./CodebookPanel";
import CodingExtras from "./CodingExtras";
import CodingAnalysisPanel from "./CodingAnalysisPanel";
import TranscriptSetupTable, {
  CodeGate,
  ImportDetailProvider,
  SelectedFileDetail,
  MODE_LABEL,
  SESSION_LABEL,
} from "./TranscriptSetup";
import {
  findUnconfirmedTranscripts,
  getSetupSuggestions,
  getTranscriptSetups,
  SETUP_NEEDED_MESSAGE,
} from "@/lib/transcriptSetup";
import { loadDataSetups } from "@/lib/dataSetup";
import {
  crossTranscriptThemes,
  getCodingAnalysis,
  getFindingCodingCounts,
} from "@/lib/codingAnalysis";
import AcrossTranscripts from "./AcrossTranscripts";
import AnalyticsBuilder from "./AnalyticsBuilder";
import { listWaveFilesAction, type WaveFile } from "@/lib/waveTrackingActions";
import { isStatsFileName, isCaseTableFileName } from "@/lib/statsFileName";
import FindingsTable from "./FindingsTable";
import TableDigest from "./TableDigest";
import { parseObjectiveLines } from "@/lib/objectiveLines";
import ResearchAssistantCard, {
  type AssistantChatMessage,
} from "./ResearchAssistantCard";
import {
  UploadIcon,
  BoltIcon,
  DocumentIcon,
  ChartIcon,
  DownloadIcon,
  PresentationIcon,
  ListIcon,
  SparkleIcon,
  TargetIcon,
  CheckIcon,
  ChatIcon,
} from "@/components/icons";
import {
  type CrossTabPreviewTable,
} from "@/lib/crossTabPreview";
import { latestVerdictLateral } from "@/lib/latestVerdict";
import { getSampleFailedVerdicts, getVerdictSummary } from "@/lib/verdictSummary";
import { requireTenantId } from "@/lib/requestContext";

// Opening an already-processed run used to take as long as processing it,
// because these three self-heal checks (retry a framer or the
// recommendation agent if it looks like it did not finish) ran with
// `await` right in the page's render path, so the request did not
// resolve until a fresh AI call chain completed, every single visit.
// The page has nothing to gain by waiting on that: it can render
// whatever is already in the database immediately and let a catch-up
// call run in the background, same pattern as every other automatic
// trigger in this file. The per-run Sets below stop two overlapping
// page loads (a refresh while one is already healing) from kicking off
// duplicate work; they live for the process's lifetime, which is fine
// for a single long-running Node server but would need a shared store
// (Redis, a DB row) behind a multi-instance deployment.
//
// The cooldown map guards against a different failure mode the in-flight
// set alone doesn't catch: if even one insight can never produce a usable
// recommendation (its chunk comes back empty and generateRecommendations
// just logs that and moves on, rather than throwing), the "fewer
// recommendations than insights" check below stays true forever for that
// run, and every single page load, manual refresh, or dev-server Fast
// Refresh would otherwise re-run the entire agent again from scratch,
// including every insight already covered. A short cooldown per run turns
// "retried on every page view" into "retried at most once every few
// minutes", which is enough to self-heal a transient failure without
// quietly burning a full pass's worth of Claude calls on every reload a
// genuinely stuck insight can no longer benefit from anyway.
const decisionRefreshesInFlight = new Set<string>();
const recommendationRefreshesInFlight = new Set<string>();
const refreshCooldownUntil = new Map<string, number>();
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

function refreshInBackground(
  runId: string,
  inFlight: Set<string>,
  run: () => Promise<void>,
  cooldownKey?: string,
) {
  if (inFlight.has(runId)) return;
  if (cooldownKey) {
    const until = refreshCooldownUntil.get(cooldownKey);
    if (until && until > Date.now()) return;
    refreshCooldownUntil.set(cooldownKey, Date.now() + REFRESH_COOLDOWN_MS);
  }
  inFlight.add(runId);
  void run()
    .catch(() => {})
    .finally(() => inFlight.delete(runId));
}

type Run = {
  id: string;
  project_name: string | null;
  business_problem: string | null;
  research_objective: string | null;
  decision_statement: string | null;
  evidence_synthesis: string | null;
  audience: string | null;
  status: string;
  entry_point: "generate" | "validate" | null;
  initial_research_objective: string | null;
  // OBJ-SET-M01: the current, editable list of stated objectives. Null on a
  // pre-migration-0080 database (getRun falls back to a column-less query,
  // same guard pattern used elsewhere for a not-yet-applied migration).
  stated_objectives_text: string | null;
  program_id: string | null;
  wave_label: string | null;
};

type Document = {
  id: string;
  kind: "report" | "table" | "evidence" | "transcript" | "instrument" | "output";
  source_filename: string;
  uploaded_at: string;
  ingestion_type: "raw" | "aggregated" | null;
  // IMP-006: null until a processing attempt has actually run; see
  // 0079_document_processing_status.sql for why this can't be inferred from
  // document_tables/findings alone. Selected with a fallback below so a
  // pre-migration database doesn't 42703 on this query. 'incomplete' (0088,
  // ANA-QUAL-001): a transcript whose coding came back without full per-unit
  // coverage - not a failure, but not a clean run either.
  processing_status: "ready" | "incomplete" | "failed" | null;
};

type Finding = {
  id: string;
  origin: "stated" | "generated" | "coded";
  data_type: "qualitative" | "quantitative" | null;
  finding_text: string;
  finding_kind: FindingKind | null;
  theme: string | null;
  status: "pending" | "accepted" | "rejected";
  source_filename: string | null;
  source_page: number | null;
  quote_verified: boolean | null;
  source_document_id: string | null;
  source_table_id: string | null;
  source_cells: { rowIndices?: number[] } | null;
  duplicate_group_id: string | null;
  researcher_note: string | null;
  pattern_type: string | null;
  stated_stats: Record<string, unknown> | null;
  created_at: string;
  // The validated / net-new split (see discoveryClassification.ts): a
  // computed finding some report claim is grounded in exists to check the
  // report; one nothing points at is new. is_contradicted marks a report
  // claim the Elevator's own evidence conflicts with; contradicts_report
  // marks the net-new finding doing the conflicting.
  corroborates_report_claim: boolean;
  is_contradicted: boolean;
  contradicts_report: boolean;
  // Coded (transcript) findings only: how many of the open coding passes
  // found the theme, how many turns and speakers it rests on, and how the
  // stored quote matched the transcript.
  reproduced_runs: number | null;
  total_runs: number | null;
  supporting_segments: number | null;
  supporting_speakers: number | null;
  quote_match: "exact" | "near" | "none" | null;
  // Codex re-review, package 4 (cross-tab handover repair); Brief 37 repair: "demonstrate
  // downstream staleness after design changes through saved tables, findings, insights,
  // recommendations and narratives." This is the findings-level piece of that: "current" or
  // "stale" when this finding's source table's design snapshot could be compared against what a
  // fresh build of its document would resolve now (same rule as a crosstab's own
  // designFreshness in crosstabs.ts); "unknown" when it has a source table but the comparison
  // itself could not be made - a legacy snapshot never recorded, or the document's current
  // set-up failing to load just now - which Brief 37's re-review found this previously
  // collapsed into the same `false` a genuine match would show. Never alters finding_text or
  // any human wording - purely an additional, read-only signal. Null for a finding with no
  // source table at all (nothing to compare, a different thing from "couldn't compare").
  designFreshness: DesignFreshness | null;
};

async function getRun(runId: string): Promise<Run | null> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    try {
      const result = await client.query<Run>(
        `select id, project_name, business_problem, research_objective, decision_statement,
                evidence_synthesis, audience, status, entry_point, initial_research_objective,
                stated_objectives_text, program_id, wave_label
         from runs where id = $1`,
        [runId],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/stated_objectives_text/.test(message)) throw error;
      // Pre-migration-0080 database: same query without the new column.
      const result = await client.query<Omit<Run, "stated_objectives_text">>(
        `select id, project_name, business_problem, research_objective, decision_statement,
                evidence_synthesis, audience, status, entry_point, initial_research_objective,
                program_id, wave_label
         from runs where id = $1`,
        [runId],
      );
      const row = result.rows[0];
      // Pre-migration-0080, a run's current objective list lived in initial_research_objective
      // (migration 0080's own backfill is `stated_objectives_text = initial_research_objective`
      // for exactly this reason - see its comment). Hardcoding null here instead ignored that
      // and made every existing project's objectives vanish from Setup's display with nothing
      // to say why (OBJ-SET-005): falling back to the same column the migration itself treats
      // as the legacy source of truth keeps them visible until the migration actually runs.
      return row ? { ...row, stated_objectives_text: row.initial_research_objective } : null;
    }
  });
}

type Program = {
  id: string;
  name: string;
};

async function getPrograms(): Promise<Program[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Program>(
      "select id, name from programs order by name asc",
    );
    return result.rows;
  });
}

type ProgramWave = {
  id: string;
  project_name: string | null;
  wave_label: string | null;
};

// Other waves already attached to this run's program, shown so linking a
// run doesn't feel like shouting into the void: the researcher immediately
// sees which other projects this one is now grouped with.
async function getProgramWaves(
  programId: string,
  excludeRunId: string,
): Promise<ProgramWave[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<ProgramWave>(
      `select id, project_name, wave_label from runs
       where program_id = $1 and id <> $2
       order by created_at asc`,
      [programId, excludeRunId],
    );
    return result.rows;
  });
}

async function getReportReadStats(runId: string): Promise<Map<string, NonNullable<ReportReadStats>>> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ detail: Record<string, unknown>; ran_at: string | null }>(
      `select distinct on (detail->>'documentId') detail, occurred_at::text as ran_at
         from trace
        where run_id = $1 and event = 'extract_findings_summary'
        order by detail->>'documentId', occurred_at desc`,
      [runId],
    );
    const out = new Map<string, NonNullable<ReportReadStats>>();
    for (const r of result.rows) {
      const d = r.detail;
      if (typeof d.documentId !== "string") continue;
      out.set(d.documentId, {
        pages: Number(d.pages) || 0,
        characters: Number(d.characters) || 0,
        parts: Number(d.parts) || 0,
        failedParts: Number(d.failedParts) || 0,
        ranAt: r.ran_at,
      });
    }
    return out;
  });
}

async function getDocuments(runId: string): Promise<Document[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    try {
      const result = await client.query<Document>(
        "select id, kind, source_filename, uploaded_at, ingestion_type, processing_status from documents where run_id = $1 order by uploaded_at desc",
        [runId],
      );
      return result.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/processing_status/.test(message)) throw error;
      // Pre-migration-0079 database: same query without the new column.
      const result = await client.query<Omit<Document, "processing_status">>(
        "select id, kind, source_filename, uploaded_at, ingestion_type from documents where run_id = $1 order by uploaded_at desc",
        [runId],
      );
      return result.rows.map((row) => ({ ...row, processing_status: null as "ready" | "incomplete" | "failed" | null }));
    }
  });
}

/**
 * Best-effort, like stampSingleDocumentBatch: records the one durable fact
 * IMP-006 needed a column for (did this document's last processing attempt
 * succeed or fail), independent of the run-level error banner, which is
 * scoped to "the most recent click on this run" and so loses an earlier
 * failure the moment any other document on the run is processed afterward.
 * Silently a no-op pre-0079, same migration-guard shape used elsewhere in
 * this file for document_tables/variable_overrides etc.
 */
async function setDocumentProcessingStatus(
  documentId: string,
  status: "ready" | "incomplete" | "failed",
): Promise<boolean> {
  const TENANT_ID = await requireTenantId();
  // Shared with storeAndRead's upload-time read (documentUploadActions.ts), so a document's
  // status reflects every attempt that could tell whether it has usable data, not just the
  // ones triggered from this page.
  //
  // IMP-006 / REP-IN-001: returns markDocumentProcessingStatus's own boolean (false on a
  // pre-migration database where the write could not land) instead of discarding it. Every
  // call site below now checks this, so a status-persistence failure surfaces as an
  // actionable error rather than leaving the document looking like whatever status it had
  // before this attempt - which, for a document that just finished reading successfully,
  // would otherwise read as an unqualified "ready" that was never actually saved.
  return await markDocumentProcessingStatus(TENANT_ID, documentId, status);
}

type DocumentTablePreview = {
  id: string;
  document_id: string;
  table_index: number;
  label: string | null;
  source_page: number | null;
  headers: string[];
  rows: Record<string, string | number | null>[];
  ingestion_type: "raw" | "aggregated";
  banner_columns: string[] | null;
  stub_columns: string[] | null;
  /** Raw files come back with no rows (they can be huge); this is the true count. */
  row_count: number;
  /** Changes whenever the stored table is rewritten. Keys the quality cache. */
  row_version: string;
};

/**
 * Lets a researcher see exactly what landed in document_tables for a
 * "Table" document before trusting the statistical pass built on it. This
 * matters most for Word/PDF tables, since those go through a Claude
 * detection pass rather than a deterministic spreadsheet parser: if the
 * model misread a column or dropped a row, this is where that shows up,
 * rather than only surfacing later as a finding that looks wrong. Wrapped
 * in try/catch and defaulting to [] for the same reason getFindingHistory
 * is: document_tables only exists once migration 0023 has been applied.
 */
async function getDocumentTablePreviews(
  runId: string,
): Promise<DocumentTablePreview[]> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<DocumentTablePreview>(
        // A raw table's full `rows` column can be huge, so this never ships it whole - but
        // shipping literally nothing (the previous '[]'::jsonb, regardless of actual size) left
        // the "Raw data" preview with a true row_count and zero rows to ever show for it (IMP-010).
        // jsonb_array_length already has to read and parse that same column to get the true
        // count, so pulling the first 10 elements alongside it with jsonb_array_elements + a
        // LIMIT adds no new full-table read, just a small in-memory slice of what was parsed
        // anyway; an aggregated table's rows column is already small enough to send whole.
        `select id, document_id, table_index, label, source_page, headers,
                case when ingestion_type = 'raw'
                  then coalesce((select jsonb_agg(elem) from (
                         select elem from jsonb_array_elements(rows) as elem limit 10
                       ) sample), '[]'::jsonb)
                  else rows
                end as rows,
                jsonb_array_length(rows)::int as row_count,
                xmin::text as row_version,
                ingestion_type, banner_columns, stub_columns
         from document_tables
         where run_id = $1 and coalesce(crosstab_status, 'committed') <> 'evidence'
         order by document_id, table_index`,
        [runId],
      );
      return result.rows;
    });
  } catch {
    return [];
  }
}

// Quality figures for a raw data file are worked out from every stored row,
// which is slow to fetch and to count. They only change when the stored table
// is rewritten or the skip logic changes, so the result is kept in memory per
// table and reused on later page loads.
const rawQualityCache = new Map<string, { version: string; q: TableQuality }>();

async function getRawQuality(
  t: { id: string; headers: string[]; row_version: string },
  stated: StatedRouting[],
): Promise<TableQuality | null> {
  const TENANT_ID = await requireTenantId();
  const version = `${t.row_version}|${t.headers.length}|${JSON.stringify(stated)}`;
  const hit = rawQualityCache.get(t.id);
  if (hit && hit.version === version) return hit.q;
  try {
    const rows = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ rows: Record<string, string | number | null>[] }>(
        "select rows from document_tables where id = $1",
        [t.id],
      );
      return r.rows[0]?.rows ?? [];
    });
    const q = computeTableQuality(t.headers, rows, "raw", stated);
    if (rawQualityCache.size >= 40) rawQualityCache.delete(rawQualityCache.keys().next().value as string);
    rawQualityCache.set(t.id, { version, q });
    return q;
  } catch {
    return null;
  }
}

/**
 * The opening of each report or transcript's extracted text, so a researcher
 * can check on the Import page that the file was read properly. Only the
 * first characters are fetched, never the whole text.
 */
async function getDocumentExcerpts(
  runId: string,
): Promise<Map<string, { excerpt: string; length: number }>> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ id: string; excerpt: string | null; length: number }>(
        `select id, substring(extracted_text from 1 for 2500) as excerpt,
                coalesce(length(extracted_text), 0)::int as length
         from documents where run_id = $1 and kind <> 'table'`,
        [runId],
      );
      return new Map(
        r.rows.map((row) => [row.id, { excerpt: row.excerpt ?? "", length: row.length }] as const),
      );
    });
  } catch {
    return new Map();
  }
}

/**
 * The codebook now in force for each coded transcript, with how many turns
 * and speakers each code rests on and what the open coding passes recorded.
 * Wrapped in try/catch for the same reason getDocumentTablePreviews is: the
 * coding tables only exist once migration 0043 has been applied.
 */
async function getCodebooks(runId: string): Promise<Map<string, CodebookView>> {
  const TENANT_ID = await requireTenantId();
  const out = new Map<string, CodebookView>();
  try {
    await withTenantRead(TENANT_ID, async (client) => {
      const books = await client.query<{
        id: string;
        document_id: string;
        version: number;
        source: "induced" | "edited" | "imported";
        created_at: string;
      }>(
        `select distinct on (document_id) id, document_id, version, source, created_at::text as created_at
         from coding_codebooks where run_id = $1
         order by document_id, version desc`,
        [runId],
      );
      if (books.rows.length === 0) return;
      const bookIds = books.rows.map((b) => b.id);
      const docIds = books.rows.map((b) => b.document_id);

      // Every version of each codebook, so an earlier one can be viewed and
      // restored.
      const allBooks = await client.query<{
        id: string;
        document_id: string;
        version: number;
        source: "induced" | "edited" | "imported";
        created_at: string;
      }>(
        `select id, document_id, version, source, created_at::text as created_at
         from coding_codebooks where document_id = any($1::uuid[])
         order by document_id, version desc`,
        [docIds],
      );
      const allCodes = await client.query<{
        codebook_id: string;
        name: string;
        definition: string;
      }>(
        `select codebook_id, name, definition from coding_codes
         where codebook_id = any($1::uuid[]) order by codebook_id, position`,
        [allBooks.rows.map((b) => b.id)],
      );

      const codes = await client.query<{
        id: string;
        codebook_id: string;
        name: string;
        definition: string;
        inclusion_criteria: string;
        exclusion_criteria: string;
        reproduced_runs: number | null;
        total_runs: number | null;
        turns: number;
        speakers: number;
      }>(
        `select c.id, c.codebook_id, c.name, c.definition, c.inclusion_criteria, c.exclusion_criteria,
                c.reproduced_runs, c.total_runs,
                count(distinct a.segment_id)::int as turns,
                count(distinct s.speaker) filter (where s.speaker is not null)::int as speakers
         from coding_codes c
         left join coding_assignments a on a.code_id = c.id
         left join coding_segments s on s.id = a.segment_id
         where c.codebook_id = any($1::uuid[])
         group by c.id
         order by c.position`,
        [bookIds],
      );

      const turns = await client.query<{
        document_id: string;
        participant_turns: number;
        coded_turns: number;
      }>(
        `select s.document_id,
                count(*) filter (where s.role <> 'moderator')::int as participant_turns,
                count(*) filter (where exists (
                  select 1 from coding_assignments a
                  join coding_codes c on c.id = a.code_id
                  where a.segment_id = s.id and c.codebook_id = any($2::uuid[])
                ))::int as coded_turns
         from coding_segments s
         where s.document_id = any($1::uuid[])
         group by s.document_id`,
        [docIds, bookIds],
      );

      const manifest = await client.query<{
        document_id: string;
        detail: Record<string, unknown>;
      }>(
        `select m.document_id, m.detail
         from coding_run_manifest m
         where m.stage = 'open_coding'
           and m.codebook_id = (
             select b.id from coding_codebooks b
             where b.document_id = m.document_id and b.source = 'induced'
             order by b.version desc limit 1
           )
           and m.document_id = any($1::uuid[])`,
        [docIds],
      );

      // Themes, notes and keywords (migration 0055), by transcript and code name.
      const metaRows = new Map<
        string,
        { theme: string; note: string; keywords: string }
      >();
      try {
        const exists = await client.query(
          "select to_regclass('public.coding_code_meta') is not null as ok",
        );
        if (exists.rows[0]?.ok === true) {
          const m = await client.query<{
            document_id: string;
            code_key: string;
            theme: string;
            note: string;
            keywords: string;
          }>(
            `select document_id, code_key, theme, note, keywords
             from coding_code_meta where document_id = any($1::uuid[])`,
            [docIds],
          );
          for (const row of m.rows)
            metaRows.set(`${row.document_id}|${row.code_key}`, row);
        }
      } catch {
        // 0055 not applied
      }

      for (const book of books.rows) {
        const t = turns.rows.find((r) => r.document_id === book.document_id);
        const rows = manifest.rows.filter(
          (m) => m.document_id === book.document_id,
        );
        const num = (v: unknown) => (typeof v === "number" ? v : 0);
        const passes =
          rows.length === 0
            ? null
            : {
                count: rows.length,
                themesReturned: rows.reduce(
                  (n, r) => n + num(r.detail.themes_returned),
                  0,
                ),
                themesKept: rows.reduce(
                  (n, r) => n + num(r.detail.themes_kept),
                  0,
                ),
                quotesExact: rows.reduce(
                  (n, r) =>
                    n +
                    num(
                      (r.detail.quotes as Record<string, unknown> | undefined)
                        ?.exact,
                    ),
                  0,
                ),
                quotesNear: rows.reduce(
                  (n, r) =>
                    n +
                    num(
                      (r.detail.quotes as Record<string, unknown> | undefined)
                        ?.near,
                    ),
                  0,
                ),
                quotesNone: rows.reduce(
                  (n, r) =>
                    n +
                    num(
                      (r.detail.quotes as Record<string, unknown> | undefined)
                        ?.none,
                    ),
                  0,
                ),
                quotesModerator: rows.reduce(
                  (n, r) =>
                    n +
                    num(
                      (r.detail.quotes as Record<string, unknown> | undefined)
                        ?.moderator,
                    ),
                  0,
                ),
                inputTruncated: rows.some(
                  (r) => r.detail.input_truncated === true,
                ),
                droppedThemes: rows.flatMap((r, i) =>
                  Array.isArray(r.detail.dropped_themes)
                    ? (
                        r.detail.dropped_themes as {
                          theme?: unknown;
                          quote?: unknown;
                          reason?: unknown;
                        }[]
                      ).map((d) => ({
                        pass: i + 1,
                        theme: String(d.theme ?? ""),
                        quote: String(d.quote ?? ""),
                        reason: String(d.reason ?? ""),
                      }))
                    : [],
                ),
              };
        out.set(book.document_id, {
          runId,
          documentId: book.document_id,
          version: book.version,
          source: book.source,
          createdAt: book.created_at,
          codes: codes.rows
            .filter((c) => c.codebook_id === book.id)
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            .map(({ codebook_id: _codebookId, ...c }) => {
              const meta = metaRows.get(
                `${book.document_id}|${c.name.trim().toLowerCase().replace(/\s+/g, " ")}`,
              );
              return {
                ...c,
                theme: meta?.theme ?? "",
                note: meta?.note ?? "",
                keywords: meta?.keywords ?? "",
              };
            }),
          participantTurns: t?.participant_turns ?? 0,
          codedTurns: t?.coded_turns ?? 0,
          passes,
          versions: allBooks.rows
            .filter((b) => b.document_id === book.document_id)
            .map((b) => ({
              id: b.id,
              version: b.version,
              source: b.source,
              createdAt: b.created_at,
              codes: allCodes.rows
                .filter((c) => c.codebook_id === b.id)
                .map((c) => ({ name: c.name, definition: c.definition })),
            })),
        });
      }
    });
  } catch {
    // Migration 0043 not applied yet, or nothing coded.
  }
  return out;
}

type FindingRow = Omit<Finding, "designFreshness"> & {
  source_table_document_id: string | null;
  design_snapshot: { design: { psu: string | null; strata: string | null } | null } | null;
};

/**
 * FND-001 probe B: which findings carry researcher-edited wording (and whether each still waits for
 * a re-check). A failed read is reported to the findings screen, never shown as "nothing edited".
 */
/**
 * Numerical traceability (0101): every stored figure check in the run that is not "traced". A
 * failed read is reported on the page, never shown as "nothing to review".
 */
async function getFigureChecks(runId: string): Promise<RunFigureChecks> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, (client) => loadRunFigureChecks(client, runId));
  } catch (error) {
    return {
      available: false,
      preInsights: {},
      synthesizedInsights: {},
      recommendations: {},
      narrative: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getWordingEdits(runId: string): Promise<WordingEdits> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, (client) => loadWordingEdits(client, runId));
  } catch (error) {
    return { available: false, edits: {}, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getFindings(runId: string): Promise<Finding[]> {
  const TENANT_ID = await requireTenantId();
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    try {
      const result = await client.query<FindingRow>(
        `select c.id, c.origin, c.finding_text, c.finding_kind, c.theme, c.status,
                coalesce(d1.source_filename, d2.source_filename) as source_filename,
                c.source_page, c.quote_verified, c.source_document_id, c.source_table_id,
                c.source_cells, c.duplicate_group_id, c.researcher_note, c.data_type,
                c.pattern_type, c.stated_stats, c.created_at::text as created_at,
                c.reproduced_runs, c.total_runs, c.supporting_segments, c.supporting_speakers, c.quote_match,
                exists (select 1 from findings g where g.grounded_by_finding_id = c.id) as corroborates_report_claim,
                exists (select 1 from finding_contradictions fc where fc.original_finding_id = c.id) as is_contradicted,
                exists (select 1 from finding_contradictions fc where fc.contradicting_finding_id = c.id) as contradicts_report,
                dt2.document_id as source_table_document_id, dt2.design_snapshot
         from findings c
         left join documents d1 on d1.id = c.source_document_id
         left join document_tables dt2 on dt2.id = c.source_table_id
         left join documents d2 on d2.id = dt2.document_id
         where c.run_id = $1
         order by c.created_at`,
        [runId],
      );
      return result.rows;
    } catch (error) {
      // Migration 0091 (design_snapshot) not applied yet: same query without that column, same
      // way listCrosstabs itself degrades (crosstabs.ts). Brief 38 repair (Codex re-review of
      // Brief 37, item 3): `dt2.document_id as source_table_document_id` is a column on the
      // long-existing `document_tables` table - it predates migration 0091 and needs no
      // fallback of its own, so it stays in this query even though `design_snapshot` is dropped.
      // Previously this fallback hardcoded `source_table_document_id: null` below regardless of
      // what the join actually found, which collapsed two different situations into the same
      // result: a finding with NO source table at all (genuinely nothing to compare) and a
      // finding that DOES have a source table but whose design freshness can't be verified
      // because this database predates the migration. Both produced `designFreshness: null`
      // ("not applicable"), when only the first one should.
      const message = error instanceof Error ? error.message : String(error);
      if (!/design_snapshot/.test(message)) throw error;
      const result = await client.query<Omit<FindingRow, "design_snapshot">>(
        `select c.id, c.origin, c.finding_text, c.finding_kind, c.theme, c.status,
                coalesce(d1.source_filename, d2.source_filename) as source_filename,
                c.source_page, c.quote_verified, c.source_document_id, c.source_table_id,
                c.source_cells, c.duplicate_group_id, c.researcher_note, c.data_type,
                c.pattern_type, c.stated_stats, c.created_at::text as created_at,
                c.reproduced_runs, c.total_runs, c.supporting_segments, c.supporting_speakers, c.quote_match,
                exists (select 1 from findings g where g.grounded_by_finding_id = c.id) as corroborates_report_claim,
                exists (select 1 from finding_contradictions fc where fc.original_finding_id = c.id) as is_contradicted,
                exists (select 1 from finding_contradictions fc where fc.contradicting_finding_id = c.id) as contradicts_report,
                dt2.document_id as source_table_document_id
         from findings c
         left join documents d1 on d1.id = c.source_document_id
         left join document_tables dt2 on dt2.id = c.source_table_id
         left join documents d2 on d2.id = dt2.document_id
         where c.run_id = $1
         order by c.created_at`,
        [runId],
      );
      // `source_table_document_id` is now a real selected column (present whenever the finding
      // has a source table, migration or no migration) - only `design_snapshot` is forced to
      // null here, because that column genuinely cannot be read without the migration. The
      // mapper below already turns (real document id + null design_snapshot) into
      // designFreshness: "unknown" via designFreshnessStatus's own first branch, so no change
      // is needed there.
      return result.rows.map((r) => ({ ...r, design_snapshot: null }));
    }
  });

  // Codex re-review, package 4: resolve "what design would a fresh build use right now" once per
  // DISTINCT document among these findings' source tables, not once per finding - the same
  // resolution listCrosstabs performs per document already, now shared via
  // resolveCurrentDesignSnapshotStatus (crosstabs.ts) so this cannot drift from that rule.
  const distinctDocIds = Array.from(
    new Set(rows.map((r) => r.source_table_document_id).filter((id): id is string => id !== null)),
  );
  // Brief 37 repair: a failed per-document lookup is now recorded as its own explicit status
  // ({ ok: false, error }), not simply left absent from the map. Previously an absent entry and
  // a "nothing to compare" finding (no source table at all) were indistinguishable - both ended
  // up with `currentSnapshot === undefined`, and both produced `designStale: null` - so a real
  // lookup failure silently looked exactly like "not applicable" instead of "couldn't verify."
  const currentSnapshotStatuses = new Map<string, CurrentDesignSnapshotStatus>();
  await Promise.all(
    distinctDocIds.map(async (docId) => {
      currentSnapshotStatuses.set(docId, await resolveCurrentDesignSnapshotStatus(TENANT_ID, runId, docId));
    }),
  );

  return rows.map((r) => {
    const { source_table_document_id, design_snapshot, ...finding } = r;
    if (!source_table_document_id) {
      // No source table at all - there is nothing to compare, a different thing from having
      // tried to compare and failed. Unchanged from before this repair.
      return { ...finding, designFreshness: null };
    }
    const status = currentSnapshotStatuses.get(source_table_document_id);
    // Brief 37 repair: `status` is only ever absent here if the Promise.all above somehow never
    // resolved for this docId, which `distinctDocIds` guarantees it was scheduled for - but
    // treat a missing entry as a failed lookup rather than assuming anyway, consistent with
    // "failed configuration lookups must be unknown, not verified agreement."
    const resolvedStatus = status ?? { ok: false as const, error: "design freshness was not resolved for this document" };
    return { ...finding, designFreshness: designFreshnessStatus(design_snapshot, resolvedStatus) };
  });
}

type ObjectiveCandidate = {
  id: string;
  candidate_text: string;
  rationale: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
};

async function getObjectiveCandidates(
  runId: string,
): Promise<ObjectiveCandidate[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<ObjectiveCandidate>(
      `select id, candidate_text, rationale, source, status, edited
       from objective_candidates
       where run_id = $1
       order by created_at`,
      [runId],
    );
    return result.rows;
  });
}

type DecisionCandidate = {
  id: string;
  candidate_text: string;
  rationale: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
};

async function getDecisionCandidates(
  runId: string,
): Promise<DecisionCandidate[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<DecisionCandidate>(
      `select id, candidate_text, rationale, source, status, edited
       from decision_candidates
       where run_id = $1
       order by created_at`,
      [runId],
    );
    return result.rows;
  });
}

type InsightRow = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  decision_context: string | null;
  finding_text: string;
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution";
  // True when the finding behind this insight traces to something the
  // original report said (a stated or coded finding, or a computed finding
  // a report claim is grounded in). False means it is new, found by the
  // Elevator's own analysis.
  from_report: boolean;
  verification_basis: "data_backed" | "report_only";
  caveats: string[];
  // Written for accepted decisions that have since changed (rule in decisionContext.ts).
  written_for_earlier_decisions: boolean;
  // GT-006: the pre-insight's support (shared rule), so the card says what the exports say.
  support_status: "current" | "stale" | "invalid" | "unknown";
  support_summary: string | null;
};

// Sorted by quality_score first (highest first, unscored insights last via
// nulls last) so the insights most worth a researcher's attention surface
// at the top of each theme, then by theme and creation order as before.
// This is purely a sort, nothing here filters an insight out: an insight
// that hasn't been scored yet, or that scored low, still appears, it just
// sorts lower.
async function getInsights(runId: string): Promise<InsightRow[]> {
  const TENANT_ID = await requireTenantId();
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Omit<InsightRow, "support_status" | "support_summary">>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, i.decision_context,
              f.finding_text, f.theme, v.verdict_tier, v.verification_basis,
              (f.origin in ('stated', 'coded')
                or exists (select 1 from findings g where g.grounded_by_finding_id = f.id)) as from_report,
              coalesce(v.statistical_checks->'caveats', '[]'::jsonb) as caveats,
              ${writtenForEarlierDecisionsSql("i.decision_context", "r.decision_statement")} as written_for_earlier_decisions
       from insights i
       join runs r on r.id = i.run_id
       join findings f on f.id = i.finding_id
       join ${latestVerdictLateral("f.id", ["verdict_tier", "verification_basis", "statistical_checks"])} v on true
       where i.run_id = $1
       order by f.theme nulls last, i.created_at`,
      [runId],
    );
    return result.rows;
  });
  const support = await loadPreInsightSupportOrUnchecked(TENANT_ID, runId, rows.map((row) => row.id));
  return rows.map((row) => {
    const s = support.statusOf(row.id);
    return { ...row, support_status: s.status, support_summary: s.status === "current" ? null : summariseSupport(s) };
  });
}

// Each synthesized insight is built from more than one pre-insight (see
// insightSynthesizer.ts), so this pulls the chain of evidence back in as
// source_headlines via array_agg rather than a join that would duplicate
// the parent row per member. Ordered by confidence tier first (strong
// before moderate before exploratory) so the best-corroborated insights
// surface at the top, same reasoning as getInsights' quality_score sort.
type SynthesizedInsightQueryRow = Omit<
  SynthesizedInsightRow,
  "provenance_caption" | "contradicts"
> & { member_discovery_types: DiscoveryType[] };

async function getSynthesizedInsights(
  runId: string,
  supportPromise: Promise<InsightSupportResult>,
): Promise<SynthesizedInsightRow[]> {
  const TENANT_ID = await requireTenantId();
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<SynthesizedInsightQueryRow>(
      `select si.id, si.headline, si.observation, si.tension, si.implication, si.action_plan_status,
              si.triangulation_count, si.source_theme_count, si.materiality_rationale, si.confidence_tier,
              -- INS-001: read through to_jsonb so this works before migration 0097 (null = not checked).
              (to_jsonb(si)->>'independent_source_count')::int as independent_source_count,
              si.review_status, si.why_score, si.actionability_score, si.novelty_score, si.synthesis_score,
              si.evidentiary_score, si.quality_score, si.quality_tier, si.quality_rationale,
              si.stability_testable_count, si.stability_reappeared_count, si.stability_checked_at::text,
              coalesce(array_agg(pi.headline order by pi.created_at) filter (where pi.id is not null), '{}') as source_headlines,
              coalesce(array_agg(pf.id::text order by pi.created_at) filter (where pf.id is not null), '{}') as source_finding_ids,
              coalesce(array_agg(
                case when pf.origin in ('stated', 'coded')
                       or exists (select 1 from findings g where g.grounded_by_finding_id = pf.id)
                     then 'validated' else 'net_new' end
                order by pi.created_at
              ) filter (where pf.id is not null), '{}') as member_discovery_types
       from synthesized_insights si
       -- FND-001: left joins, so an insight whose supporting findings were all deleted still
       -- appears (with "Support no longer valid") instead of silently disappearing from review.
       left join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       left join insights pi on pi.id = s.pre_insight_id
       left join findings pf on pf.id = pi.finding_id
       where si.run_id = $1
       group by si.id
       order by case si.review_status when 'rejected' then 1 else 0 end,
                si.quality_score desc nulls last,
                case si.confidence_tier when 'strong' then 0 when 'moderate' then 1 else 2 end,
                si.triangulation_count desc, si.created_at`,
      [runId],
    );
    return result.rows;
  });

  // Report claims each synthesized insight contradicts, read separately so
  // the core query above stays as it was.
  const contradictionRows = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{
      synthesized_insight_id: string;
      original_text: string;
      rationale: string;
    }>(
      `select fc.contradicting_synthesized_insight_id as synthesized_insight_id,
              orig.finding_text as original_text, fc.rationale
       from finding_contradictions fc
       join findings orig on orig.id = fc.original_finding_id
       where fc.run_id = $1 and fc.contradicting_synthesized_insight_id is not null
       order by fc.created_at`,
      [runId],
    );
    return result.rows;
  });

  const support = await supportPromise;
  return rows.map(({ member_discovery_types, ...row }) => ({
    ...row,
    support: support.statusOf(row.id),
    provenance_caption: summarizeSynthesizedProvenance(member_discovery_types)
      .caption,
    contradicts: contradictionRows
      .filter((c) => c.synthesized_insight_id === row.id)
      .map((c) => ({ original_text: c.original_text, rationale: c.rationale })),
  }));
}

// Insights and recommendations can both legitimately stay empty for a
// while (nothing has passed verification yet, say), and the generic empty
// states in each section used to leave a researcher unable to tell that
// apart from something actually broken. This gives the Insights section
// enough to say which one it is: how many findings have a verdict at all
// yet, how many of those passed, and the most recent failure (if any) from
// the automatic pipeline (verification or insight generation) for this run.

// One row per stated_insight finding (the report's own higher-order
// claims), left-joined to its chain-trace verdict (null until the
// validator gets to it, see validateStatedInsights.ts) and to the insight
// it produced if the claim held up and got elevated like any other
// verified finding. due_care on a chain_trace verdict carries
// cited_finding_ids (what the report itself pointed to) and
// relied_finding_ids (what the check actually used); both are resolved
// back to their finding_text here so the UI never has to chase ids.
async function getStatedInsightValidations(
  runId: string,
): Promise<StatedInsightValidation[]> {
  const TENANT_ID = await requireTenantId();
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<
      Omit<StatedInsightValidation, "contradicted_by">
    >(
      `select f.id, f.finding_text, f.theme,
              v.verdict_tier, v.rationale, v.verification_basis,
              i.id as elevated_insight_id,
              coalesce((
                select array_agg(ef.finding_text order by ef.created_at)
                from findings ef
                where ef.id = any(
                  array(select jsonb_array_elements_text(coalesce(v.due_care->'cited_finding_ids', '[]'::jsonb)))::uuid[]
                )
              ), array[]::text[]) as cited_texts,
              coalesce((
                select array_agg(ef.finding_text order by ef.created_at)
                from findings ef
                where ef.id = any(
                  array(select jsonb_array_elements_text(coalesce(v.due_care->'relied_finding_ids', '[]'::jsonb)))::uuid[]
                )
              ), array[]::text[]) as relied_texts
       from findings f
       left join ${latestVerdictLateral("f.id", ["verdict_tier", "rationale", "verification_basis", "due_care"])} v on true
       left join insights i on i.finding_id = f.id
       where f.run_id = $1 and f.finding_kind = 'stated_insight' and f.status != 'rejected'
       order by f.created_at`,
      [runId],
    );
    return result.rows;
  });

  // What contradicted each claim, if anything: a net-new finding from the
  // data, a net-new synthesized insight, or another claim in the same
  // report. Read separately so the core query above stays as it was.
  const contradictions = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{
      original_finding_id: string;
      rationale: string;
      contradicting_text: string | null;
      contradicting_origin: string | null;
      synth_headline: string | null;
    }>(
      `select fc.original_finding_id, fc.rationale,
              cf.finding_text as contradicting_text, cf.origin as contradicting_origin,
              si.headline as synth_headline
       from finding_contradictions fc
       left join findings cf on cf.id = fc.contradicting_finding_id
       left join synthesized_insights si on si.id = fc.contradicting_synthesized_insight_id
       where fc.run_id = $1
       order by fc.created_at`,
      [runId],
    );
    return result.rows;
  });

  return rows.map((row) => ({
    ...row,
    contradicted_by: contradictions
      .filter((c) => c.original_finding_id === row.id)
      .map((c) =>
        c.contradicting_text !== null
          ? {
              text: c.contradicting_text,
              kind:
                c.contradicting_origin === "generated"
                  ? ("net_new_finding" as const)
                  : ("report_claim" as const),
              rationale: c.rationale,
            }
          : {
              text: c.synth_headline ?? "a synthesized insight",
              kind: "net_new_insight" as const,
              rationale: c.rationale,
            },
      ),
  }));
}

/**
 * Files too wide to store whole are cut down to their usable variables on
 * import (a 'wide_file_trimmed' trace row records by how much). Read here so
 * the Import screen can say "185 of 3,776 variables kept" instead of
 * quietly reporting the smaller number as if it were the whole file.
 */
async function getTrimmedFiles(
  runId: string,
): Promise<Map<string, { total: number; kept: number }>> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ detail: unknown }>(
      `select detail from trace where run_id = $1 and event = 'wide_file_trimmed' order by occurred_at asc`,
      [runId],
    );
    const out = new Map<string, { total: number; kept: number }>();
    for (const row of result.rows) {
      let d: unknown = row.detail;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          continue;
        }
      }
      const o = d as { documentId?: unknown; totalVariables?: unknown; keptVariables?: unknown } | null;
      if (o && typeof o.documentId === "string" && typeof o.totalVariables === "number" && typeof o.keptVariables === "number") {
        out.set(o.documentId, { total: o.totalVariables, kept: o.keptVariables });
      }
    }
    return out;
  });
}

/**
 * Codex round 3, "preserve the qualification through extraction": a document whose
 * extraction found an id-like column with an Excel format the calculation side can't
 * faithfully reproduce records an 'unsupported_identifier_format' trace row (see
 * documentTables.ts). Read here the same way getTrimmedFiles reads its own event, so the
 * Import screen can show a recovery message instead of silently importing the column.
 */
/**
 * IMP-015: label diagnostics from each table document's cached variable dictionary - variables whose
 * label sheets disagree (shown with every competing label, never one silently chosen) and label-sheet
 * names matching no data column. Read-only. A document whose dictionary has not been computed yet has
 * no entry, which shows no notice; the conflict text itself is still in every computed table.
 */
async function getLabelDiagnostics(
  runId: string,
): Promise<Map<string, { conflicts: { variable: string; kind: "variable_label" | "value_label"; value?: string | number }[]; unmatched: string[] }>> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ id: string; conflicts: unknown; unmatched: unknown }>(
      `select id, variable_dictionary->'labelConflicts' as conflicts, variable_dictionary->'unmatchedLabelVariables' as unmatched
       from documents
       where run_id = $1 and variable_dictionary is not null
         and (variable_dictionary ? 'labelConflicts' or variable_dictionary ? 'unmatchedLabelVariables')`,
      [runId],
    );
    const out = new Map<string, { conflicts: { variable: string; kind: "variable_label" | "value_label"; value?: string | number }[]; unmatched: string[] }>();
    for (const row of result.rows) {
      const conflicts = (Array.isArray(row.conflicts) ? row.conflicts : []).filter(
        (c): c is { variable: string; kind: "variable_label" | "value_label"; value?: string | number } =>
          !!c && typeof c === "object" && typeof (c as { variable?: unknown }).variable === "string" &&
          ((c as { kind?: unknown }).kind === "value_label" || (c as { kind?: unknown }).kind === "variable_label"),
      );
      const unmatched = (Array.isArray(row.unmatched) ? row.unmatched : []).filter((u): u is string => typeof u === "string");
      out.set(row.id, { conflicts, unmatched });
    }
    return out;
  });
}

async function getUnsupportedIdentifierColumns(
  runId: string,
): Promise<Map<string, string[]>> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ detail: unknown }>(
      `select detail from trace where run_id = $1 and event = 'unsupported_identifier_format' order by occurred_at asc`,
      [runId],
    );
    const out = new Map<string, string[]>();
    for (const row of result.rows) {
      let d: unknown = row.detail;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          continue;
        }
      }
      const o = d as { documentId?: unknown; columns?: unknown } | null;
      if (o && typeof o.documentId === "string" && Array.isArray(o.columns)) {
        const existing = out.get(o.documentId) ?? [];
        const merged = Array.from(new Set([...existing, ...o.columns.filter((c): c is string => typeof c === "string")]));
        out.set(o.documentId, merged);
      }
    }
    return out;
  });
}

async function getLatestTraceMessage(
  runId: string,
  events: string[],
): Promise<string | null> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ detail: unknown }>(
      `select detail from trace where run_id = $1 and event = any($2::text[]) order by occurred_at desc limit 1`,
      [runId, events],
    );
    const detail = result.rows[0]?.detail;
    if (!detail) return null;
    if (typeof detail === "string") {
      try {
        const parsed = JSON.parse(detail);
        return typeof parsed?.message === "string" ? parsed.message : detail;
      } catch {
        return detail;
      }
    }
    if (typeof detail === "object" && detail !== null && "message" in detail) {
      const message = (detail as { message?: unknown }).message;
      return typeof message === "string" ? message : null;
    }
    return null;
  });
}

type ProcessRunErrors = { errors: string[]; occurredAt: string };

/**
 * processRunAction has always logged a per-document failure list to trace
 * (event = 'process_run_errors') whenever extraction, archiving, or
 * anything else in the pipeline threw for one or more documents, but
 * nothing ever read that back: a run that failed partway looked, from the
 * page, identical to one that quietly had nothing left to do. This surfaces
 * the most recent one as a banner instead, so "I clicked the button and
 * nothing happened" has an actual answer on the page rather than a trace
 * row only visible from a database client.
 */
async function getLatestProcessErrors(
  runId: string,
): Promise<ProcessRunErrors | null> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    // Only an error from the most recent processing click should ever show:
    // processRunAction writes a 'process_run_batch' marker the instant you
    // click, and only writes 'process_run_errors' afterward if that specific
    // click had a failure. Without the occurred_at >= latest-batch filter
    // below, a failure from an old click kept showing here forever, since a
    // later, fully successful click writes no row at all to replace it with
    // -- there was nothing to tell "this is old" from "this just happened
    // again". Filtering to errors at or after the latest batch means a
    // clean run makes the banner disappear, because nothing qualifies.
    const result = await client.query<{
      detail: { errors?: unknown };
      occurred_at: string;
    }>(
      `with latest_batch as (
         select occurred_at from trace
         where run_id = $1 and event = 'process_run_batch'
         order by occurred_at desc
         limit 1
       )
       select detail, occurred_at from trace
       where run_id = $1 and event = 'process_run_errors'
         and occurred_at >= coalesce((select occurred_at from latest_batch), '-infinity'::timestamptz)
       order by occurred_at desc
       limit 1`,
      [runId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const errors = Array.isArray(row.detail?.errors)
      ? row.detail.errors.filter((e): e is string => typeof e === "string")
      : [];
    if (errors.length === 0) return null;
    return { errors, occurredAt: row.occurred_at };
  });
}

type PendingLegacyConfirmation = {
  documentId: string;
  filename: string;
  findings: { id: string; text: string }[];
};

/**
 * REP-IN-002: documents whose most recent replacement attempt was withheld because findings with
 * unknown provenance would have been retired, and which have not been replaced since. Only the
 * listed findings that still exist on that document (and, once migration 0094 is applied, still
 * carry no recorded review or edit) are offered. This is a prompt, not a decision: publication
 * re-checks every id under its lock.
 */
async function getPendingLegacyConfirmations(runId: string): Promise<PendingLegacyConfirmation[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const latest = await client.query<{
      event: string;
      detail: { documentId?: unknown; reason?: unknown; legacyFindingIds?: unknown };
    }>(
      `select distinct on (detail->>'documentId') event, detail from trace
        where run_id = $1
          and event in ('extract_findings_replacement_withheld', 'extract_findings_replacement_published')
        order by detail->>'documentId', occurred_at desc, id desc`,
      [runId],
    );
    const provenance = await findingProvenanceAvailable(client);
    const pending: PendingLegacyConfirmation[] = [];
    for (const row of latest.rows) {
      if (row.event !== "extract_findings_replacement_withheld" || row.detail?.reason !== "legacy_unconfirmed") continue;
      const documentId = typeof row.detail.documentId === "string" ? row.detail.documentId : null;
      const ids = Array.isArray(row.detail.legacyFindingIds)
        ? row.detail.legacyFindingIds.filter((x): x is string => typeof x === "string")
        : [];
      if (!documentId || ids.length === 0) continue;
      const live = await client.query<{ id: string; finding_text: string; source_filename: string }>(
        `select f.id, f.finding_text, d.source_filename
           from findings f join documents d on d.id = f.source_document_id
          where f.run_id = $1 and f.source_document_id = $2 and f.id = any($3::uuid[])
            and f.status = 'accepted'
            ${provenance ? "and f.provenance_tracked = false and f.human_reviewed_at is null and cardinality(f.human_edited_fields) = 0" : ""}
          order by f.created_at, f.id`,
        [runId, documentId, ids],
      );
      if (live.rows.length === 0) continue;
      pending.push({
        documentId,
        filename: live.rows[0].source_filename,
        findings: live.rows.map((r) => ({ id: r.id, text: r.finding_text })),
      });
    }
    return pending;
  });
}

type Priority = "high" | "medium" | "low";

type Recommendation = {
  id: string;
  insight_id: string;
  insight_headline: string;
  theme: string | null;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: Priority;
  assumptions_and_risks: string;
  alternatives_considered: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  insight_quality_score: number | null;
  insight_quality_tier: "finding" | "partial" | "qualified" | null;
};

// Sorted by the parent insight's quality score first (nulls last), so a
// recommendation built on a sharp, well-evidenced insight surfaces above
// one built on a thin or unscored one. Priority still matters for what a
// researcher does with an accepted recommendation, but this ordering
// answers a different question first, which one is worth looking at at
// all, nothing here drops or filters a recommendation.
async function getRecommendations(runId: string): Promise<Recommendation[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Recommendation>(
      `select r.id, r.insight_id, i.headline as insight_headline, f.theme, r.action_text, r.owner_role,
              r.owner_feasibility_note, r.timeline, r.metric, r.priority, r.assumptions_and_risks,
              r.alternatives_considered, r.source, r.status, r.edited,
              i.quality_score as insight_quality_score, i.quality_tier as insight_quality_tier
       from recommendations r
       join insights i on i.id = r.insight_id
       join findings f on f.id = i.finding_id
       where r.run_id = $1
         and r.insight_id is not null
       order by i.quality_score desc nulls last, f.theme nulls last, r.created_at`,
      [runId],
    );
    return result.rows;
  });
}

type SynthesizedRecommendation = {
  id: string;
  synthesized_insight_id: string;
  synthesized_insight_headline: string;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: Priority;
  assumptions_and_risks: string;
  alternatives_considered: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  confidence_tier: "strong" | "moderate" | "exploratory" | null;
  quality_score: number | null;
  quality_tier: "finding" | "partial" | "qualified" | null;
  /** FND-001: inherited from the anchor insight (supportStatus.ts). */
  support?: import("@/lib/supportStatusShared").InsightSupport;
  /** GT-007: the decisions it was written for, and whether they are earlier or unrecorded. */
  decision_context: string | null;
  decision_state: "earlier" | "unknown" | null;
};

type RecommendationQuality = {
  id: string;
  rec_actionability_score: number | null;
  rec_feasibility_score: number | null;
  rec_evidence_score: number | null;
  rec_impact_score: number | null;
  rec_quality_score: number | null;
  rec_quality_tier: "weak" | "workable" | "strong" | null;
  rec_quality_rationale: string | null;
};

/**
 * The recommendation quality scores (migration 0045), read apart from the
 * main recommendations query so the page still loads before that migration
 * has been applied.
 */
async function getRecommendationQuality(
  runId: string,
): Promise<Map<string, RecommendationQuality>> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<RecommendationQuality>(
        `select id, rec_actionability_score, rec_feasibility_score, rec_evidence_score, rec_impact_score,
                rec_quality_score, rec_quality_tier, rec_quality_rationale
         from recommendations where run_id = $1 and synthesized_insight_id is not null`,
        [runId],
      );
      return new Map(result.rows.map((r) => [r.id, r]));
    });
  } catch {
    return new Map();
  }
}

type StoredObjectiveQuality = {
  item_order: number;
  item_text: string;
  specific_score: number;
  measurable_score: number;
  answerable_score: number;
  relevant_score: number;
  quality_score: number;
  quality_tier: "weak" | "workable" | "strong";
  rationale: string;
  suggestion: string;
};

async function getObjectiveQuality(
  runId: string,
): Promise<{ rows: StoredObjectiveQuality[]; missing: boolean }> {
  const TENANT_ID = await requireTenantId();
  try {
    const rows = await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<StoredObjectiveQuality>(
        `select item_order, item_text, specific_score, measurable_score, answerable_score, relevant_score,
                quality_score, quality_tier, rationale, suggestion
         from objective_quality where run_id = $1 order by item_order`,
        [runId],
      );
      return result.rows;
    });
    return { rows, missing: false };
  } catch {
    return { rows: [], missing: true };
  }
}

/**
 * The actual funnel output: recommendations anchored to a synthesized
 * insight rather than a pre-insight (see generateSynthesizedRecommendations
 * in recommendationAgent.ts for why this exists -- a run with 60
 * pre-insights behind 16 real insights used to produce 60 recommendations,
 * not something close to 16). Sorted by the parent synthesized insight's
 * quality score first, same reasoning getRecommendations already used for
 * pre-insights.
 */
async function getSynthesizedRecommendations(
  runId: string,
  supportPromise: Promise<InsightSupportResult>,
): Promise<SynthesizedRecommendation[]> {
  const TENANT_ID = await requireTenantId();
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    // GT-007: each card states the decisions it was written for by the same rule the main-list
    // exports use (decisionContext.ts), so screen and files agree. Same order as the exports.
    const recorded = await recommendationDecisionContextAvailable(client);
    const result = await client.query<SynthesizedRecommendation>(
      `select r.id, r.synthesized_insight_id, si.headline as synthesized_insight_headline, r.action_text,
              r.owner_role, r.owner_feasibility_note, r.timeline, r.metric, r.priority,
              r.assumptions_and_risks, r.alternatives_considered, r.source, r.status, r.edited,
              si.confidence_tier, si.quality_score, si.quality_tier,
              ${recorded ? "r.decision_context" : "null::text as decision_context"},
              ${recommendationDecisionStateSql("r", "run.decision_statement", recorded)} as decision_state
       from recommendations r
       join runs run on run.id = r.run_id
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1
         and r.synthesized_insight_id is not null
       order by si.quality_score desc nulls last, r.created_at, r.id`,
      [runId],
    );
    return result.rows;
  });
  const support = await supportPromise;
  return rows.map((row) => ({ ...row, support: support.statusOf(row.synthesized_insight_id) }));
}

type ParkedInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  action_plan_status: "has_action" | "retained_no_action";
  /** REC-002: false when no recommendation of any status exists for it (a partial run left it out). */
  has_any_recommendation: boolean;
};

/**
 * The insight reserve: accepted synthesized insights with no accepted
 * recommendation pointing at them. No schema change needed -- this is
 * purely a query against what generateSynthesizedRecommendations and the
 * recommendations table already track. Covers both the insights the
 * synthesizer itself flagged action_plan_status = 'retained_no_action'
 * (which generateSynthesizedRecommendations now deliberately skips, see
 * its doc comment in recommendationAgent.ts) and any insight whose
 * recommendation simply hasn't been generated or accepted yet. Per
 * Simoudis (2015): an insight without a feasible action plan is retained,
 * not discarded, in case a plan becomes hypothesizable later as more data
 * or domain knowledge arrives.
 */
async function getParkedInsights(runId: string): Promise<ParkedInsight[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<ParkedInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication, si.action_plan_status,
              exists (select 1 from recommendations r2 where r2.synthesized_insight_id = si.id) as has_any_recommendation
       from synthesized_insights si
       where si.run_id = $1
         and si.review_status = 'accepted'
         and not exists (
           select 1 from recommendations r
           where r.synthesized_insight_id = si.id and r.status = 'accepted'
         )
       order by si.created_at`,
      [runId],
    );
    return result.rows;
  });
}

type StoryNarrative = {
  executive_summary: string;
  situation: string;
  complication: string;
  question: string;
  governing_thought: string;
  pillars: DeckPillar[];
  recommendations_intro: string;
  caveats: string[];
  generated_at: string;
};

/**
 * The persisted narrative behind the "Insights Report" deck (see
 * src/lib/storyNarrative.ts): one row per run, upserted each time the
 * researcher generates or regenerates it. null until it's been generated
 * at least once.
 */
async function getStoryNarrative(
  runId: string,
): Promise<StoryNarrative | null> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<StoryNarrative>(
      `select executive_summary, situation, complication, question, governing_thought, pillars,
              recommendations_intro, caveats, generated_at
       from deck_narratives where run_id = $1`,
      [runId],
    );
    return result.rows[0] ?? null;
  });
}

/**
 * The Research assistant card's chat history for this run (see
 * src/lib/researchAssistant.ts). Oldest first, matching reading order in
 * the chat panel; the card itself caps how many of these it keeps visible,
 * this just hands back everything that's been said so far on this run.
 */
async function getAssistantMessages(
  runId: string,
): Promise<AssistantChatMessage[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<AssistantChatMessage>(
      `select id, role, content, created_at::text
       from assistant_messages
       where run_id = $1
       order by created_at asc`,
      [runId],
    );
    return result.rows;
  });
}

/**
 * The persisted per-objective/per-decision dispositions (see
 * src/lib/objectiveValidator.ts): one row per research objective or
 * confirmed decision item, re-generated alongside the Insights Report.
 * Ordered objectives first then decisions, each in the order they were
 * originally stated, so the review screen reads in the same order the
 * researcher (or the brief) stated them.
 */
async function getObjectiveValidations(
  runId: string,
): Promise<ObjectiveValidation[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    // OBJ-REV-012: evidence_digest_degraded (migration 0087) is migration-guarded with a
    // catalog probe rather than try/catch - a failed SELECT (the column doesn't exist
    // pre-migration) would abort the rest of this transaction, taking a plain fallback query
    // down with it, the same failure mode this fix's own package (OBJ-REV-007) had to correct
    // elsewhere. The catalog check below cannot itself fail the transaction.
    const colCheck = await client.query<{ exists: boolean }>(
      `select exists (
         select 1 from information_schema.columns
         where table_name = 'objective_validations' and column_name = 'evidence_digest_degraded'
       ) as "exists"`,
    );
    if (colCheck.rows[0]?.exists === true) {
      const result = await client.query<ObjectiveValidation>(
        `select item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, inferred, evidence_digest_degraded
         from objective_validations
         where run_id = $1
         order by item_kind, item_order`,
        [runId],
      );
      return result.rows;
    }
    const result = await client.query<Omit<ObjectiveValidation, "evidence_digest_degraded">>(
      `select item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids, inferred
       from objective_validations
       where run_id = $1
       order by item_kind, item_order`,
      [runId],
    );
    return result.rows.map((row) => ({ ...row, evidence_digest_degraded: false }));
  });
}

type ApiUsageRow = {
  agent: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
};

/**
 * Every Claude call this pipeline makes logs its token usage to `trace`
 * (event = 'api_usage', see src/lib/apiUsage.ts) as a side effect of the
 * call it's observing, never gating it. This just reads that back,
 * aggregated per agent, so a researcher curious what a run actually cost
 * doesn't have to go looking in the Claude Console. Token counts come back
 * from Postgres as strings (bigint sums), hence the Number() conversions
 * below rather than trusting the declared row type.
 */
async function getApiUsage(runId: string): Promise<ApiUsageRow[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{
      agent: string;
      calls: string;
      input_tokens: string;
      output_tokens: string;
    }>(
      `select
         detail->>'agent' as agent,
         count(*) as calls,
         coalesce(sum((detail->>'input_tokens')::bigint), 0) as input_tokens,
         coalesce(sum((detail->>'output_tokens')::bigint), 0) as output_tokens
       from trace
       where run_id = $1 and event = 'api_usage'
       group by detail->>'agent'
       order by sum((detail->>'input_tokens')::bigint + (detail->>'output_tokens')::bigint) desc`,
      [runId],
    );
    return result.rows.map((row) => ({
      agent: row.agent,
      calls: Number(row.calls),
      input_tokens: Number(row.input_tokens),
      output_tokens: Number(row.output_tokens),
    }));
  });
}

export type FindingHistoryRow = {
  id: string;
  finding_text: string;
  finding_kind: string | null;
  theme: string | null;
  status: string;
  archived_reason: string;
  archived_at: string;
  insight_headline: string | null;
  insight_quality_tier: string | null;
};

/**
 * One row per archived finding (see 0021_finding_history.sql), newest
 * first, left-joined to whatever insight it had grown at the point it was
 * archived. A finding that was still at the claim stage when "Regenerate
 * unreviewed" or "Reprocess all documents" swept it up simply has nulls for
 * the insight columns. Capped at 200 rows: this is a researcher's audit
 * trail, not a full export, and a run that has been reprocessed often
 * enough to blow past that is better served by a database query than this
 * page.
 *
 * Wrapped in try/catch and defaulting to [] because the finding_history
 * table only exists once migration 0021 has been applied; until then this
 * quietly renders no History section rather than breaking the whole page.
 */
async function getFindingHistory(runId: string): Promise<FindingHistoryRow[]> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<FindingHistoryRow>(
        `select
           fh.id,
           fh.finding_text,
           fh.finding_kind,
           fh.theme,
           fh.status,
           fh.archived_reason,
           fh.archived_at,
           ih.headline as insight_headline,
           ih.quality_tier as insight_quality_tier
         from finding_history fh
         left join insight_history ih on ih.original_finding_id = fh.original_finding_id
         where fh.run_id = $1
         order by fh.archived_at desc
         limit 200`,
        [runId],
      );
      return result.rows;
    });
  } catch {
    return [];
  }
}

export type ApiUsageBatchRow = {
  batch_id: string;
  mode: string;
  started_at: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
};

/**
 * Cost per click, rather than the all-time total getApiUsage gives. Every
 * processRunAction call stamps a 'process_run_batch' trace row the moment
 * it starts (see processRunAction below), tagged with a fresh batch_id and
 * which of the three tiers was used. This buckets every 'api_usage' row
 * between one batch marker and the next (or "now" for the most recent) and
 * sums it, so each row here is "what that one click actually cost". Usage
 * logged before the first batch marker existed (brief intake on run
 * creation, or any call made before this feature shipped) falls outside
 * every window and so is correctly left out of this view, while still
 * counting toward getApiUsage's all-time total.
 */
async function getApiUsageBatches(runId: string): Promise<ApiUsageBatchRow[]> {
  const TENANT_ID = await requireTenantId();
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<{
        batch_id: string;
        mode: string;
        started_at: string;
        calls: string;
        input_tokens: string;
        output_tokens: string;
      }>(
        `with batches as (
           select
             detail->>'batch_id' as batch_id,
             detail->>'mode' as mode,
             occurred_at as started_at,
             lead(occurred_at) over (order by occurred_at) as ended_at
           from trace
           where run_id = $1 and event = 'process_run_batch'
         )
         select
           b.batch_id,
           b.mode,
           b.started_at,
           count(t.id) as calls,
           coalesce(sum((t.detail->>'input_tokens')::bigint), 0) as input_tokens,
           coalesce(sum((t.detail->>'output_tokens')::bigint), 0) as output_tokens
         from batches b
         left join trace t
           on t.run_id = $1
           and t.event = 'api_usage'
           and t.occurred_at >= b.started_at
           and (b.ended_at is null or t.occurred_at < b.ended_at)
         group by b.batch_id, b.mode, b.started_at
         order by b.started_at desc`,
        [runId],
      );
      return result.rows.map((row) => ({
        batch_id: row.batch_id,
        mode: row.mode,
        started_at: row.started_at,
        calls: Number(row.calls),
        input_tokens: Number(row.input_tokens),
        output_tokens: Number(row.output_tokens),
      }));
    });
  } catch {
    return [];
  }
}

// Re-running the framer after a document is processed is wrapped so a
// framer failure (an API hiccup, say) never blocks the extraction the
// researcher actually clicked for; it's logged to trace and swallowed
// instead. The framer itself is a no-op error if there are no findings yet,
// which is also caught here rather than treated as something to surface.
// Runs before refreshDecisionCandidates on every trigger below, so an
// objective candidate is at least proposed before the decision framer
// reads runs.research_objective. Accepting one is still a manual step the
// researcher takes on the Objective brief screen, this only makes sure
// there's something to accept.
// Ties the synthesized insights back to the stated objectives and decisions
// after each analysis run. Skipped when none exist (objectives are optional).
// Failures are logged, never thrown, so they cannot stop the pipeline.
async function refreshObjectiveValidation(runId: string) {
  const TENANT_ID = await requireTenantId();
  try {
    const has = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<{ n: boolean }>(
        `select (coalesce(trim(research_objective), '') <> '' or coalesce(trim(decision_statement), '') <> '') as n
         from runs where id = $1`,
        [runId],
      );
      return r.rows[0]?.n === true;
    });
    if (!has) return;
    await generateObjectiveValidation(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_validation_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })],
      );
    }).catch(() => {});
  }
}

// Early trigger points (after extraction, verification and so on) no longer
// touch objectives. Setup records the researcher's own objectives; inferred
// ones are generated later, after the insights exist (refreshInferredObjectives).
async function refreshObjectiveCandidates(runId: string) {
  void runId;
}

async function refreshInferredObjectives(runId: string) {
  const TENANT_ID = await requireTenantId();
  // Objectives are optional. When the researcher stated none (typed or
  // imported from a brief), objectives are inferred from the findings and
  // accepted automatically, marked as inferred so reports can flag that
  // their coverage is circular. Once a stated objective exists this does
  // nothing; suggestions are then only made on request.
  try {
    const hasStated = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query(
        "select 1 from objective_candidates where run_id = $1 and source = 'researcher_authored' and status = 'accepted' limit 1",
        [runId],
      );
      return r.rows.length > 0;
    });
    if (hasStated) return;
    await generateObjectiveCandidates(TENANT_ID, runId);
    await refreshObjectiveQuality(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_framer_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })],
      );
    }).catch(() => {});
  }
}

async function refreshDecisionCandidates(runId: string) {
  const TENANT_ID = await requireTenantId();
  try {
    await generateDecisionCandidates(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'decision_framer_error', $3)`,
        [
          TENANT_ID,
          runId,
          JSON.stringify({
            message: error instanceof Error ? error.message : String(error),
          }),
        ],
      );
    });
  }
}

/**
 * Stamps the same 'process_run_batch' marker processRunAction stamps on a
 * click, so a single-document retry is treated as "the latest action on
 * this run" by getLatestProcessErrors' staleness filter below -- without
 * this, a single-document retry that succeeds wouldn't be able to clear an
 * older batch error off the banner, since nothing would prove a newer
 * action had happened. Best-effort, same as the batch version: a failure
 * here shouldn't block the actual processing.
 */
async function stampSingleDocumentBatch(runId: string, mode: string) {
  const TENANT_ID = await requireTenantId();
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_run_batch', $3)`,
        [TENANT_ID, runId, JSON.stringify({ batch_id: randomUUID(), mode })],
      );
    });
  } catch {
    // Best-effort bookkeeping only, see comment above.
  }
}

/**
 * The single-document equivalent of processRunAction's error trace: a lone
 * "Extract findings" / "Generate findings" / "Code themes" click used to
 * have no error handling at all, so a failure threw straight out of the
 * server action with nothing recorded and nothing for the researcher to
 * see beyond a generic failed-request state. This writes the same
 * 'process_run_errors' event processRunAction uses, so the existing error
 * banner surfaces a single-document failure exactly like a batch one.
 */
async function recordSingleDocumentError(
  runId: string,
  documentId: string,
  error: unknown,
) {
  const TENANT_ID = await requireTenantId();
  const message = error instanceof Error ? error.message : String(error);
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_run_errors', $3)`,
      [
        TENANT_ID,
        runId,
        JSON.stringify({ errors: [`${documentId}: ${message}`] }),
      ],
    );
  });
}

async function extractFindingsAction(runId: string, documentId: string) {
  "use server";
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  await runReportExtraction(runId, documentId, {});
}

/**
 * REP-IN-002: the researcher's explicit confirmation, from the legacy-replacement prompt, that
 * exactly the listed findings on exactly this document may be replaced. The ids come from that
 * prompt's hidden inputs; publication re-validates every one under its document lock and never
 * retires a finding that has since been reviewed, edited, annotated or used.
 */
async function confirmLegacyReplacementAction(runId: string, documentId: string, formData: FormData) {
  "use server";
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  const findingIds = formData
    .getAll("findingId")
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (findingIds.length === 0) return;
  await runReportExtraction(runId, documentId, { confirmLegacyReplacement: { findingIds } });
}

// The single-document report extraction (formerly extractFindingsAction's body, unchanged apart
// from passing `options` through), shared by the normal action and the legacy confirmation.
async function runReportExtraction(
  runId: string,
  documentId: string,
  options: { confirmLegacyReplacement?: { findingIds: string[] } },
) {
  const TENANT_ID = await requireTenantId();
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    const result = await extractFindingsFromDocument(TENANT_ID, runId, documentId, options);
    // IMP-006 / REP-IN-001: some but not all chunks failing is not "ready" - it is a
    // document a researcher must be told to treat as partially read, the same way a
    // transcript's own coverage gap already surfaces as "incomplete" rather than "ready".
    // REP-IN-002: a replacement that was withheld or could not be published left the
    // previous findings in place; that is also "incomplete", with the retry instruction.
    const status = result.failedParts > 0 || !result.published ? "incomplete" : "ready";
    if (!result.published) {
      await recordSingleDocumentError(runId, documentId, new Error(result.notPublishedReason ?? "the new reading was not applied; retry extraction for this document"));
    }
    const persisted = await setDocumentProcessingStatus(documentId, status);
    if (!persisted) {
      await recordSingleDocumentError(
        runId,
        documentId,
        new Error(
          `extraction finished (${status}), but its completion status could not be saved (a database migration is pending) - do not trust this document's status badge`,
        ),
      );
    }
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
    const persisted = await setDocumentProcessingStatus(documentId, "failed");
    if (!persisted) {
      await recordSingleDocumentError(
        runId,
        documentId,
        new Error(
          "extraction failed, and its failed status could not be saved either (a database migration is pending) - do not trust this document's status badge",
        ),
      );
    }
  }
  await detectDuplicateFindings(TENANT_ID, runId);
  // Objective-candidate generation only reads findings, not verdicts or
  // insights, so it has nothing to wait for here; running it alongside the
  // verify -> insight chain instead of after it cuts a real chunk of wall
  // clock off every one of these triggers. Decision-candidate generation
  // does read the objective (and, in generate mode, insights), so it still
  // waits for this group to finish before it runs.
  await Promise.all([
    refreshVerdicts(TENANT_ID, runId)
      .then(() => refreshStatedInsightValidations(TENANT_ID, runId))
      .then(() => refreshInsights(TENANT_ID, runId)),
    refreshObjectiveCandidates(runId),
  ]);
  await refreshDecisionCandidates(runId);
  // In "validate" mode, decision_statement is still null during the
  // Promise.all above (decisions aren't generated until this point), so
  // the earlier refreshInsights call there was a guaranteed no-op for
  // validate-mode runs: generateInsights bails out immediately whenever
  // entry_point is "validate" and no decision has been confirmed yet.
  // Before decisions auto-accepted, that gap used to get closed by the
  // researcher's own click on "Accept" (acceptDecisionCandidate calls
  // refreshInsights itself), but generateDecisionCandidates auto-accepting
  // its suggestions here means decision_statement can go from null to set
  // without that click ever happening. This second call is what actually
  // covers that: for "generate" mode it's a cheap no-op (every eligible
  // finding already has an insight from the pass above), and for
  // "validate" mode it's the first real chance generateInsights has had to
  // run now that a decision exists.
  await refreshInsights(TENANT_ID, runId);
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

async function generateFindingsAction(runId: string, documentId: string) {
  "use server";
  const TENANT_ID = await requireTenantId();
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    await processTableDocument(TENANT_ID, runId, documentId);
    await setDocumentProcessingStatus(documentId, "ready");
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
    await setDocumentProcessingStatus(documentId, "failed");
  }
  await detectDuplicateFindings(TENANT_ID, runId);
  // Objective-candidate generation only reads findings, not verdicts or
  // insights, so it has nothing to wait for here; running it alongside the
  // verify -> insight chain instead of after it cuts a real chunk of wall
  // clock off every one of these triggers. Decision-candidate generation
  // does read the objective (and, in generate mode, insights), so it still
  // waits for this group to finish before it runs.
  await Promise.all([
    refreshVerdicts(TENANT_ID, runId)
      .then(() => refreshStatedInsightValidations(TENANT_ID, runId))
      .then(() => refreshInsights(TENANT_ID, runId)),
    refreshObjectiveCandidates(runId),
  ]);
  await refreshDecisionCandidates(runId);
  // In "validate" mode, decision_statement is still null during the
  // Promise.all above (decisions aren't generated until this point), so
  // the earlier refreshInsights call there was a guaranteed no-op for
  // validate-mode runs: generateInsights bails out immediately whenever
  // entry_point is "validate" and no decision has been confirmed yet.
  // Before decisions auto-accepted, that gap used to get closed by the
  // researcher's own click on "Accept" (acceptDecisionCandidate calls
  // refreshInsights itself), but generateDecisionCandidates auto-accepting
  // its suggestions here means decision_statement can go from null to set
  // without that click ever happening. This second call is what actually
  // covers that: for "generate" mode it's a cheap no-op (every eligible
  // finding already has an insight from the pass above), and for
  // "validate" mode it's the first real chance generateInsights has had to
  // run now that a decision exists.
  await refreshInsights(TENANT_ID, runId);
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Re-applies an edited codebook to a coded transcript, then refreshes what
 * is built on its findings, the same chain "Code themes" runs. Failures are
 * returned to the panel rather than thrown, so the researcher sees them next
 * to the codebook they were editing.
 */
async function reapplyCodebookAction(
  runId: string,
  documentId: string,
  codes: CodebookEdit[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  "use server";
  const TENANT_ID = await requireTenantId();
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    // ANA-QUAL-001: reapplyCodebook stamps "ready"/"incomplete" itself now - see
    // extractThemesFromTranscript's own comment on the same change.
    const result = await reapplyCodebook(TENANT_ID, runId, documentId, codes);
    if (!result.statusPersisted) {
      await recordSingleDocumentError(
        runId,
        documentId,
        new Error(
          "Coding finished, but its completion status could not be saved (a database migration is pending). Do not trust this document's status badge until that migration is applied and coding is re-run.",
        ),
      );
    }
  } catch (error) {
    await setDocumentProcessingStatus(documentId, "failed");
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await detectDuplicateFindings(TENANT_ID, runId);
  await Promise.all([
    refreshVerdicts(TENANT_ID, runId)
      .then(() => refreshStatedInsightValidations(TENANT_ID, runId))
      .then(() => refreshInsights(TENANT_ID, runId)),
    refreshObjectiveCandidates(runId),
  ]);
  await refreshDecisionCandidates(runId);
  await refreshInsights(TENANT_ID, runId);
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

async function codeThemesAction(runId: string, documentId: string) {
  "use server";
  const TENANT_ID = await requireTenantId();
  await stampSingleDocumentBatch(runId, "single_document");
  const waiting = await findUnconfirmedTranscripts(TENANT_ID, runId);
  if (waiting.some((w) => w.id === documentId)) {
    await recordSingleDocumentError(
      runId,
      documentId,
      new Error(SETUP_NEEDED_MESSAGE),
    );
    revalidatePath(`/runs/${runId}`);
    return;
  }
  try {
    // ANA-QUAL-001: extractThemesFromTranscript now stamps "ready" or "incomplete" itself
    // (see its own comment) based on whether coding actually reached full per-unit coverage,
    // so this no longer overwrites that with an unconditional "ready".
    const result = await extractThemesFromTranscript(TENANT_ID, runId, documentId);
    if (!result.statusPersisted) {
      // Counter-review: the write was swallowed by a migration guard (pre-0088), so
      // whatever status this document is showing now is NOT a confirmation that today's
      // coverage was actually recorded - surfaced the same way a real processing error
      // would be, since a researcher trusting a stale badge is exactly the failure mode
      // this is meant to prevent.
      await recordSingleDocumentError(
        runId,
        documentId,
        new Error(
          "Coding finished, but its completion status could not be saved (a database migration is pending). Do not trust this document's status badge until that migration is applied and coding is re-run.",
        ),
      );
    }
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
    await setDocumentProcessingStatus(documentId, "failed");
  }
  await refreshAfterCoding(runId);
}

/**
 * Everything that follows once a transcript's coded findings exist, whether
 * the model coded it or the researcher imported their own coding: duplicate
 * detection, verification, insights, objectives, decisions, recommendations.
 */
async function refreshAfterCoding(runId: string) {
  const TENANT_ID = await requireTenantId();
  await detectDuplicateFindings(TENANT_ID, runId);
  // Objective-candidate generation only reads findings, not verdicts or
  // insights, so it has nothing to wait for here; running it alongside the
  // verify -> insight chain instead of after it cuts a real chunk of wall
  // clock off every one of these triggers. Decision-candidate generation
  // does read the objective (and, in generate mode, insights), so it still
  // waits for this group to finish before it runs.
  await Promise.all([
    refreshVerdicts(TENANT_ID, runId)
      .then(() => refreshStatedInsightValidations(TENANT_ID, runId))
      .then(() => refreshInsights(TENANT_ID, runId)),
    refreshObjectiveCandidates(runId),
  ]);
  await refreshDecisionCandidates(runId);
  // In "validate" mode, decision_statement is still null during the
  // Promise.all above (decisions aren't generated until this point), so
  // the earlier refreshInsights call there was a guaranteed no-op for
  // validate-mode runs: generateInsights bails out immediately whenever
  // entry_point is "validate" and no decision has been confirmed yet.
  // Before decisions auto-accepted, that gap used to get closed by the
  // researcher's own click on "Accept" (acceptDecisionCandidate calls
  // refreshInsights itself), but generateDecisionCandidates auto-accepting
  // its suggestions here means decision_statement can go from null to set
  // without that click ever happening. This second call is what actually
  // covers that: for "generate" mode it's a cheap no-op (every eligible
  // finding already has an insight from the pass above), and for
  // "validate" mode it's the first real chance generateInsights has had to
  // run now that a decision exists.
  await refreshInsights(TENANT_ID, runId);
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Brings in a transcript the researcher already coded elsewhere. The coding
 * file (spreadsheet or Word table) is read, every quote is matched to a turn
 * of the transcript, and the normal counts, quotes and findings follow. No
 * model coding pass runs.
 */
async function importCodingAction(
  runId: string,
  documentId: string,
  formData: FormData,
) {
  "use server";
  const TENANT_ID = await requireTenantId();
  await stampSingleDocumentBatch(runId, "single_document");
  const waiting = await findUnconfirmedTranscripts(TENANT_ID, runId);
  if (waiting.some((w) => w.id === documentId)) {
    await recordSingleDocumentError(
      runId,
      documentId,
      new Error(SETUP_NEEDED_MESSAGE),
    );
    revalidatePath(`/runs/${runId}`);
    return;
  }
  try {
    const file = formData.get("codingFile");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a coding file first.");
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new Error("That coding file is over 10 MB.");
    }
    const parsed = await readCodingFile(
      Buffer.from(await file.arrayBuffer()),
      file.name,
    );
    if (parsed.entries.length === 0) {
      throw new Error(
        `No codes could be read from "${file.name}". It needs a column of codes or themes, usually next to a column of quotes (a table in a Word file works too).`,
      );
    }
    const result = await importCodedTranscript(
      TENANT_ID,
      runId,
      documentId,
      parsed,
    );
    const notes: string[] = [];
    // ANA-QUAL-001: this codebook-only import handler is a third caller of the same
    // statusPersisted contract reapplyCodebookAction and codeThemesAction already check (see
    // their own comments above) - importCodedTranscript stamps the document's "ready"/"incomplete"
    // status itself and reports whether that status write actually persisted, but this call site
    // never inspected it, so a failed status write here (a pending migration, say) was reported to
    // the researcher as a plain successful import with no sign the status badge can't be trusted.
    // Folded into this function's own existing `notes` accumulator (not a second, separate
    // recordSingleDocumentError call) so it reaches the researcher the same way every other
    // advisory note from this import already does - one combined message, not two competing ones.
    if (!result.statusPersisted) {
      notes.push(
        "coding finished, but its completion status could not be saved (a database migration is pending) - do not trust this document's status badge until that migration is applied and coding is re-run",
      );
    }
    if (result.quotesMatched < result.quotesTotal) {
      const missed = result.quotesTotal - result.quotesMatched;
      notes.push(
        `${missed} of ${result.quotesTotal} quotes could not be found in the transcript` +
          (result.inModeratorTurns > 0
            ? ` (${result.inModeratorTurns} sit in interviewer turns)`
            : "") +
          (result.unmatchedSamples.length > 0
            ? `, for example: "${result.unmatchedSamples[0]}"`
            : ""),
      );
    }
    if (result.codesWithoutQuotes.length > 0) {
      notes.push(
        `${result.codesWithoutQuotes.length} code${result.codesWithoutQuotes.length === 1 ? "" : "s"} had no quote that could be matched and ${result.codesWithoutQuotes.length === 1 ? "is" : "are"} not counted: ${result.codesWithoutQuotes.slice(0, 4).join("; ")}`,
      );
    }
    if (result.codebookOnly) {
      notes.push(
        "your file had codes but no quotes, so the codes were applied to the transcript by the model and are not your own coding of it: check the quotes under each theme",
      );
    }
    if (
      !result.metaSaved &&
      parsed.codes.some((c) => c.theme || c.keywords)
    ) {
      notes.push(
        "themes and keywords from your file were not saved because migration 0055 has not been applied",
      );
    }
    if (parsed.warnings.length > 0) notes.push(...parsed.warnings);
    if (notes.length > 0) {
      await recordSingleDocumentError(
        runId,
        documentId,
        new Error(
          `Coding imported (${result.codes} codes, ${result.findings} findings). Worth a look: ${notes.join(". ")}.`,
        ),
      );
    }
    // Import itself succeeded even when there are advisory notes above -
    // those aren't a processing failure. When codebookOnly, importCodedTranscript already
    // stamped "ready" or "incomplete" itself based on the model's own apply-codebook
    // coverage (ANA-QUAL-001); only a plain researcher-coded import (no model involved,
    // so no coverage question to report) is set unconditionally here.
    if (!result.codebookOnly) await setDocumentProcessingStatus(documentId, "ready");
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
    await setDocumentProcessingStatus(documentId, "failed");
    revalidatePath(`/runs/${runId}`);
    return;
  }
  await refreshAfterCoding(runId);
}

/**
 * Wipes and redoes verification for every finding on this run, then lets
 * that ripple forward into insights and recommendations. A direct
 * researcher action for a run stuck with bad verdicts (see
 * reverifyFindings's own comment), not something triggered automatically,
 * so it stays a deliberate, visible reset rather than something that could
 * silently fire on every page load.
 */
async function reverifyFindingsAction(runId: string) {
  "use server";
  const TENANT_ID = await requireTenantId();
  await reverifyFindings(TENANT_ID, runId);
  // reverifyFindings just wiped every verdict on this run, including the
  // chain-trace verdicts stated_insight claims had; without this they would
  // stay unverified forever instead of getting redone like everything else.
  await refreshStatedInsightValidations(TENANT_ID, runId);
  await refreshInsights(TENANT_ID, runId);
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * A direct, visible way to run the findings->insights funnel on demand,
 * rather than only as a side effect of the heavier actions above
 * (extraction, re-verification). This matters in particular for a run
 * whose pre-insights already existed before insightSynthesizer.ts did:
 * nothing about those pre-insights changes to re-trigger any of the
 * existing automatic call sites, so without this button the researcher's
 * only way to populate Synthesized insights would be to force a full
 * re-verify, which also wipes and redoes verdicts for no reason. This only
 * touches synthesis; nothing upstream of it is recomputed.
 */
async function synthesizeInsightsAction(runId: string) {
  "use server";
  const TENANT_ID = await requireTenantId();
  await refreshSynthesizedInsights(TENANT_ID, runId);
  await refreshSynthesizedInsightQuality(TENANT_ID, runId);
  // Every other workflow trigger in this file already chains
  // refreshRecommendations onto whatever it just did (new findings
  // accepted, a decision accepted, and so on) -- this was the one gap,
  // synthesis itself never did. Without it a researcher had to notice and
  // separately click "regenerate" on the Recommendations panel before the
  // Insights Report had anything to draw on, which is exactly the "no
  // recommendations accepted" surprise this closes.
  await refreshRecommendations(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}

/**
 * Generates (or regenerates) the SCQA/Pyramid Principle narrative behind
 * the Insights Report deck, and, alongside it, checks every research
 * objective and confirmed decision against the accepted evidence (see
 * src/lib/objectiveValidator.ts) -- standard market-research reporting
 * practice: what the project set out to answer should get an explicit
 * conclusion, not just whatever insights happened to surface. Both
 * generateStoryNarrative and generateObjectiveValidation already upsert
 * (the latter by delete-then-reinsert), so a researcher can click this
 * again after accepting more findings or recommendations and both stay
 * current.
 *
 * The two are wrapped in separate try/catches, same reasoning as
 * refreshRecommendations wrapping its two generators separately: an
 * objective-validation failure (most commonly, no research objective or
 * decision recorded yet) shouldn't hide a narrative that generated fine,
 * and vice versa.
 */
async function generateStoryReportAction(runId: string) {
  "use server";
  const TENANT_ID = await requireTenantId();
  try {
    await generateStoryNarrative(TENANT_ID, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'story_narrative_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message })],
      );
    });
  }
  try {
    await generateObjectiveValidation(TENANT_ID, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_validation_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message })],
      );
    });
  }
  try {
    // Looks for a stated research methodology in the project's uploaded
    // brief/proposal/report documents -- never invented, left null when
    // none of them states one. See src/lib/methodologyExtractor.ts.
    await generateMethodologySummary(TENANT_ID, runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'methodology_extraction_error', $3)`,
        [TENANT_ID, runId, JSON.stringify({ message })],
      );
    });
  }
  revalidatePath(`/runs/${runId}`);
}

// Links (or re-links) this run to a program as one of its waves, or
// creates a brand new program inline rather than making the researcher
// detour to /programs first. Unlinking just clears both columns; nothing
// about the run's own data changes either way, since tracking is an
// attribute a project can pick up or drop at any time, never a separate
// pipeline (see supabase/migrations/0026_programs.sql).
async function updateProgramLinkAction(runId: string, formData: FormData) {
  "use server";
  const TENANT_ID = await requireTenantId();
  const action = String(formData.get("action") ?? "link");

  if (action === "unlink") {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `update runs set program_id = null, wave_label = null where id = $1`,
        [runId],
      );
    });
    revalidatePath(`/runs/${runId}`);
    return;
  }

  const waveLabelRaw = String(formData.get("waveLabel") ?? "").trim();
  const waveLabel = waveLabelRaw.length > 0 ? waveLabelRaw : null;
  const existingProgramId = String(formData.get("programId") ?? "").trim();
  const newProgramName = String(formData.get("newProgramName") ?? "").trim();

  let programId = existingProgramId.length > 0 ? existingProgramId : null;

  if (!programId && newProgramName.length > 0) {
    programId = await withTenant(TENANT_ID, async (client) => {
      const result = await client.query<{ id: string }>(
        `insert into programs (tenant_id, name) values ($1, $2) returning id`,
        [TENANT_ID, newProgramName],
      );
      return result.rows[0].id;
    });
  }

  if (!programId) {
    return;
  }

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `update runs set program_id = $1, wave_label = $2 where id = $3`,
      [programId, waveLabel, runId],
    );
  });
  revalidatePath(`/runs/${runId}`);
}

// One accent per imported file, shared by its setup row and its card, so the
// two can be matched by eye.
const DOC_ACCENTS = [
  { border: "border-l-violet-500", dot: "bg-violet-500" },
  { border: "border-l-sky-500", dot: "bg-sky-500" },
  { border: "border-l-emerald-500", dot: "bg-emerald-500" },
  { border: "border-l-amber-500", dot: "bg-amber-500" },
  { border: "border-l-rose-500", dot: "bg-rose-500" },
  { border: "border-l-teal-500", dot: "bg-teal-500" },
];

// Colour per document kind, so a mixed upload can be read at a glance.
const DOC_KIND_STYLE: Record<
  string,
  { border: string; badge: string; label: string }
> = {
  transcript: {
    border: "border-l-purple-500",
    badge: "bg-purple-50 text-purple-700",
    label: "Transcript",
  },
  report: {
    border: "border-l-blue-500",
    badge: "bg-blue-50 text-blue-700",
    label: "Report",
  },
  table: {
    border: "border-l-emerald-500",
    badge: "bg-emerald-50 text-emerald-700",
    label: "Table",
  },
  evidence: {
    border: "border-l-amber-500",
    badge: "bg-amber-50 text-amber-700",
    label: "Evidence",
  },
  instrument: {
    border: "border-l-cyan-500",
    badge: "bg-cyan-50 text-cyan-700",
    label: "Questionnaire or guide",
  },
};

/**
 * Three tiers, from gentlest to most destructive:
 *
 * - "new": only documents with no findings yet (new uploads, or ones whose
 *   previous attempt errored out before writing anything). The default
 *   action, cheap, never re-spends an API call on a document already done.
 * - "unreviewed": every document is reprocessed, but extraction only
 *   replaces findings still sitting at status 'rejected'. Findings insert
 *   as 'accepted' by default, so this is the normal "I rejected a few,
 *   now redo just those" loop -- an accepted finding, and everything
 *   built on it (verdict, insight, recommendation, via cascade), is left
 *   alone. This is the one to reach for after editing a prompt or adding
 *   a document, without losing review work already done on this run.
 * - "all": every document, every finding, full stop, regardless of review
 *   status. For the rare case the extraction logic itself changed, or a
 *   document's findings look wrong enough that even accepted ones need to
 *   go. Explicit and separately labeled because it is the one tier that
 *   can discard a researcher's own accept/reject decisions.
 */
async function processRunAction(
  runId: string,
  mode: "new" | "unreviewed" | "all",
) {
  "use server";
  const TENANT_ID = await requireTenantId();
  // A previous click's later stages may still be running in the background.
  // Starting another pass on top of them would reset the progress card and
  // race the same writes, so do nothing; the status card shows it is running.
  if (isPipelineActive(runId)) return;
  const allDocuments = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{
      id: string;
      kind: "report" | "table" | "evidence" | "transcript";
      has_findings: boolean;
    }>(
      `select d.id, d.kind,
              exists (
                select 1 from findings f
                where (d.kind = 'table' and f.source_table_id in (select t.id from document_tables t where t.document_id = d.id))
                   or (d.kind != 'table' and f.source_document_id = d.id)
              ) as has_findings
       from documents d
       where d.run_id = $1`,
      [runId],
    );
    return result.rows;
  });

  // A transcript nobody has set up is held back: the group counts and echo
  // flags depend on who was in each session.
  const waiting = new Map(
    (await findUnconfirmedTranscripts(TENANT_ID, runId)).map((w) => [
      w.id,
      w.filename,
    ]),
  );
  const heldBack = allDocuments.filter((doc) => waiting.has(doc.id));
  const ready = allDocuments.filter((doc) => !waiting.has(doc.id));
  const documents =
    mode === "new" ? ready.filter((doc) => !doc.has_findings) : ready;
  const onlyReplacePending = mode === "unreviewed";
  const archiveReason: "regenerate_unreviewed" | "full_reprocess" =
    mode === "unreviewed" ? "regenerate_unreviewed" : "full_reprocess";

  // Stamped before any Claude call this click will make, so getApiUsageBatches
  // can attribute every 'api_usage' row that follows (until the next click's
  // marker) back to this one run. Best-effort: if this insert fails, the
  // click still goes ahead, it just won't show up broken out in the "cost per
  // run" view (its usage still counts toward the all-time total).
  try {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_run_batch', $3)`,
        [TENANT_ID, runId, JSON.stringify({ batch_id: randomUUID(), mode })],
      );
    });
  } catch {
    // Best-effort bookkeeping only, see comment above.
  }

  const errors: string[] = heldBack.map(
    (doc) =>
      `${waiting.get(doc.id) ?? doc.id}: ${SETUP_NEEDED_MESSAGE}`,
  );

  // Each document's extraction is independent of every other document's
  // (they each read their own file and write their own findings), so
  // there's no reason to make a project with a dozen-plus uploads wait on
  // them one at a time. A fixed worker count, rather than Promise.all over
  // every document at once, keeps this from firing 15+ Claude calls in the
  // same instant and risking a rate-limit error on a large project; 4 is a
  // conservative middle ground between "actually faster" and "safe on a
  // standard API rate limit".
  const DOCUMENT_PROCESSING_CONCURRENCY = 4;

  // Read by the process-progress API route, which the ProcessProgress
  // client component polls while this action is mid-submission: the bare
  // minimum fix for a click that otherwise gives no feedback for however
  // long this whole function takes. "extracting" ticks once per document
  // (not per chunk, so a long document doesn't look stalled while its own
  // several chunks are each read in turn); "finishing" covers everything
  // from here to the end of the function as one remaining block.
  startProcessProgress(runId, documents.length);

  await mapWithConcurrency(
    documents,
    DOCUMENT_PROCESSING_CONCURRENCY,
    async (doc) => {
      try {
        if (doc.kind === "report") {
          const result = await extractFindingsFromDocument(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
          // IMP-006 / REP-IN-001: mirrors the transcript carve-out just below - a report
          // with failed chunks has its own accurate status to stamp ("incomplete"), so it is
          // pulled out of the shared unconditional "ready" line the same way transcripts
          // already are, rather than overwriting a partial result back to an unqualified
          // "ready". REP-IN-002: a withheld or unpublished replacement keeps the previous
          // findings and is reported as "incomplete" with its retry instruction.
          const status = result.failedParts > 0 || !result.published ? "incomplete" : "ready";
          if (!result.published) {
            errors.push(`${doc.id}: ${result.notPublishedReason ?? "the new reading was not applied; retry extraction for this document"}`);
          }
          const persisted = await setDocumentProcessingStatus(doc.id, status);
          if (!persisted) {
            errors.push(
              `${doc.id}: extraction finished (${status}), but its completion status could not be saved (a database migration is pending) - do not trust this document's status badge`,
            );
          }
        } else if (doc.kind === "table") {
          await processTableDocument(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
        } else if (doc.kind === "transcript") {
          const result = await extractThemesFromTranscript(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
          if (!result.statusPersisted) {
            // Same migration-guard case as the single-document coding action - see its own
            // comment. Pushed into the same batch `errors` array as a real processing
            // failure would be, so it reaches the same process_run_errors banner below.
            errors.push(
              `${doc.id}: coding finished, but its completion status could not be saved (a database migration is pending) - do not trust this document's status badge`,
            );
          }
        } else if (doc.kind === "evidence") {
          // Context documents are not mined for findings, but their text is read and kept
          // so they preview and the brief and methodology steps can use them.
          const has = await withTenant(TENANT_ID, async (client) => {
            const r = await client.query<{ n: number }>(
              "select coalesce(length(extracted_text), 0)::int as n from documents where id = $1",
              [doc.id],
            );
            return (r.rows[0]?.n ?? 0) > 0;
          });
          if (!has) await readContextDocument(TENANT_ID, runId, doc.id);
        }
        // ANA-QUAL-001 / IMP-006: a transcript or report already stamped its own accurate
        // status above ("ready" or "incomplete", depending on whether coding or extraction
        // reached full coverage) - this unconditional "ready" used to run right after it
        // regardless and overwrite "incomplete" back to "ready" before a researcher ever saw
        // it. Every other kind has no coverage concept of its own, so "ready" is still
        // unconditionally correct for them.
        if (doc.kind !== "transcript" && doc.kind !== "report") {
          await setDocumentProcessingStatus(doc.id, "ready");
        }
      } catch (error) {
        errors.push(
          `${doc.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // IMP-006 / REP-IN-001: the "failed" write itself can silently not land (same
        // pre-migration-database case setDocumentProcessingStatus already guards elsewhere),
        // which would otherwise leave this document showing whatever status it had before -
        // for a document that had never been processed, that is no badge at all, which reads
        // as "nothing wrong yet" rather than "failed". Surface that as its own error line in
        // the same batch, rather than only here in the catch's own error push above.
        const persisted = await setDocumentProcessingStatus(doc.id, "failed");
        if (!persisted) {
          errors.push(
            `${doc.id}: failed, and its failed status could not be saved either (a database migration is pending) - do not trust this document's status badge`,
          );
        }
      } finally {
        incrementProcessProgress(runId);
      }
    },
  );

  setStageStatus(runId, "documents", "done");
  setProcessPhase(runId, "finishing");

  if (errors.length > 0) {
    // Still show whatever succeeded, but record that something failed rather
    // than silently dropping it.
    try {
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_run_errors', $3)`,
          [TENANT_ID, runId, JSON.stringify({ errors })],
        );
      });
    } catch {
      // Best-effort bookkeeping only.
    }
  }

  // Documents are read and coded, so return now: the click is finished and the
  // findings are on the page. Everything after this (verification, insights,
  // synthesis, recommendations) carries on in the background, and the
  // PipelineStatus card marks each stage complete as it finishes and
  // refreshes the page so its results appear.
  after(async () => {
    // Runs a stage, marks it done or errored, and never lets one failure stop
    // the stages after it from being attempted.
    const stage = async (id: string, work: () => Promise<unknown>) => {
      setStageStatus(runId, id, "active");
      try {
        await work();
        setStageStatus(runId, id, "done");
      } catch (error) {
        setStageStatus(runId, id, "error");
        try {
          await withTenant(TENANT_ID, async (client) => {
            await client.query(
              `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'process_stage_error', $3)`,
              [
                TENANT_ID,
                runId,
                JSON.stringify({
                  stage: id,
                  message:
                    error instanceof Error ? error.message : String(error),
                }),
              ],
            );
          });
        } catch {
          // Best-effort bookkeeping only.
        }
      }
    };

    try {
      await detectDuplicateFindings(TENANT_ID, runId).catch(() => undefined);
      // Objective-candidate generation only reads findings, so it runs
      // alongside the verify, then insights chain. Decision candidates read the
      // objective (and, in generate mode, insights), so they wait for both.
      await Promise.all([
        (async () => {
          await stage("verify", async () => {
            await refreshVerdicts(TENANT_ID, runId);
            await refreshStatedInsightValidations(TENANT_ID, runId);
          });
          await stage("insights", () => refreshInsights(TENANT_ID, runId));
        })(),
        refreshObjectiveCandidates(runId).catch(() => undefined),
      ]);
      await stage("framing", async () => {
        await refreshDecisionCandidates(runId);
        // In "validate" mode no decision exists until the step above, so the
        // earlier insight pass was a no-op for those runs. For "generate" mode
        // this is a cheap no-op (every eligible finding already has an
        // insight); for "validate" mode it is the first real chance to run.
        await refreshInsights(TENANT_ID, runId);
      });
      await stage("synthesis", async () => {
        await refreshSynthesizedInsights(TENANT_ID, runId);
        await refreshSynthesizedInsightQuality(TENANT_ID, runId);
        await refreshInferredObjectives(runId);
        await refreshObjectiveQuality(TENANT_ID, runId);
        await refreshObjectiveValidation(runId);
      });
      await stage("recommendations", () =>
        refreshRecommendations(TENANT_ID, runId),
      );
    } finally {
      // Guaranteed, so a failed run does not leave the card stuck on
      // "continues in the background" forever.
      finishProcessProgress(runId);
    }
  });

  revalidatePath(`/runs/${runId}`);
}

/**
 * Times each loader on the run page. Logs one line per page load in
 * development (or when PROFILE_RUN_PAGE=1) listing the slowest loaders, so
 * it is easy to see where the time goes.
 */
function startPageTiming() {
  const started = Date.now();
  const marks: { name: string; ms: number }[] = [];
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env.PROFILE_RUN_PAGE === "1";
  const timing = <T,>(name: string, promise: Promise<T>): Promise<T> => {
    const t0 = Date.now();
    return promise.finally(() => {
      marks.push({ name, ms: Date.now() - t0 });
    });
  };
  // Logged just before the page is returned: the gap between "data ready" and
  // this is page-body computation; the rest of the request time is the render
  // and sending the result to the browser.
  timing.bodyBuilt = () => {
    if (!enabled) return;
    console.log(`[run page] body computed at ${Date.now() - started}ms`);
  };
  timing.done = () => {
    if (!enabled) return;
    const slow = [...marks]
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 6)
      .map((m) => `${m.name} ${m.ms}ms`)
      .join(", ");
    console.log(
      `[run page] data ready in ${Date.now() - started}ms. Slowest: ${slow}`,
    );
  };
  return timing;
}

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const TENANT_ID = await requireTenantId();
  const { id } = await params;
  // Every loader below only needs the run id, so they all run at once. They
  // used to run one after another, which meant the page waited on the sum of
  // some thirty database round trips instead of the slowest one.
  const timing = startPageTiming();
  // FND-001: one support check per page load, shared by the synthesized-insight and
  // recommendation loaders below (and the narrative note), so they cannot disagree. A failed
  // check reads "Support not checked" with its reason; it never fails the page or shows current.
  const insightSupport = loadInsightSupportOrUnchecked(TENANT_ID, id);
  const [
    run,
    documents,
    rawFindings,
    codingAnalysis,
    transcriptSetups,
    dataSetups,
    documentExcerpts,
    setupSuggestions,
    latestProcessErrors,
    pendingLegacyConfirmations,
    documentTablePreviews,
    codebooksByDocument,
    objectiveCandidates,
    decisionCandidates,
    insights,
    synthesizedInsights,
    statedInsightValidations,
    inputCompleteness,
    recommendations,
    recommendationQuality,
    rawSynthesizedRecommendations,
    parkedInsights,
    apiUsage,
    findingHistory,
    storyNarrative,
    objectiveValidations,
    assistantMessages,
    programs,
    apiUsageBatches,
    trimmedFiles,
    unsupportedIdentifierColumnsByDoc,
    labelDiagnosticsByDoc,
    transcriptQuality,
    instrumentSummaries,
    outputSets,
    reportReadStats,
    waveFilesResult,
    decisionRefreshIsPending,
    earlierDecisionCounts,
    deletionImpact,
  ] = await Promise.all([
    timing("run", getRun(id)),
    timing("documents", getDocuments(id)),
    timing("findings", getFindings(id)),
    timing("codingAnalysis", getCodingAnalysis(TENANT_ID, id)),
    timing("transcriptSetups", getTranscriptSetups(TENANT_ID, id)),
    timing("dataSetups", loadDataSetups(TENANT_ID, id)),
    timing("documentExcerpts", getDocumentExcerpts(id)),
    timing("setupSuggestions", getSetupSuggestions(TENANT_ID, id)),
    timing("latestProcessErrors", getLatestProcessErrors(id)),
    timing("pendingLegacyConfirmations", getPendingLegacyConfirmations(id)),
    timing("documentTablePreviews", getDocumentTablePreviews(id)),
    timing("codebooks", getCodebooks(id)),
    timing("objectiveCandidates", getObjectiveCandidates(id)),
    timing("decisionCandidates", getDecisionCandidates(id)),
    timing("insights", getInsights(id)),
    timing("synthesizedInsights", getSynthesizedInsights(id, insightSupport)),
    timing("statedInsightValidations", getStatedInsightValidations(id)),
    timing("inputCompleteness", getRunInputCompleteness(TENANT_ID, id)),
    timing("recommendations", getRecommendations(id)),
    timing("recommendationQuality", getRecommendationQuality(id)),
    timing("synthesizedRecommendations", getSynthesizedRecommendations(id, insightSupport)),
    timing("parkedInsights", getParkedInsights(id)),
    timing("apiUsage", getApiUsage(id)),
    timing("findingHistory", getFindingHistory(id)),
    timing("storyNarrative", getStoryNarrative(id)),
    timing("objectiveValidations", getObjectiveValidations(id)),
    timing("assistantMessages", getAssistantMessages(id)),
    timing("programs", getPrograms()),
    timing("apiUsageBatches", getApiUsageBatches(id)),
    timing("trimmedFiles", getTrimmedFiles(id)),
    timing("unsupportedIdentifierColumnsByDoc", getUnsupportedIdentifierColumns(id)),
    timing("labelDiagnosticsByDoc", getLabelDiagnostics(id)),
    timing("transcriptQuality", getTranscriptImportQuality(TENANT_ID, id)),
    timing("instrumentSummaries", getInstrumentSummaries(TENANT_ID, id)),
    timing("outputSets", getOutputSets(TENANT_ID, id)),
    timing("reportReadStats", getReportReadStats(id)),
    timing("waveFiles", listWaveFilesAction(id)),
    timing("decisionRefreshPending", decisionRefreshPending(TENANT_ID, id)),
    timing("decisionContextMismatch", decisionContextMismatch(TENANT_ID, id)),
    // GT-010: what deleting each document takes with it, for its confirmation.
    timing("deletionImpact", loadDocumentDeletionImpact(TENANT_ID, id)),
  ]);
  if (!run) {
    notFound();
  }

  const waveFiles: WaveFile[] = waveFilesResult.ok ? waveFilesResult.files : [];

  // Only what depends on the first batch, again all at once.
  const needsVerdictSummary = insights.length === 0 && rawFindings.length > 0;
  const [
    findingCodingCounts,
    verdictSummary,
    insightError,
    storyReportError,
    objectiveValidationError,
    programWaves,
  ] = await Promise.all([
    timing(
      "findingCodingCounts",
      getFindingCodingCounts(TENANT_ID, id, codingAnalysis),
    ),
    needsVerdictSummary ? getVerdictSummary(TENANT_ID, id) : Promise.resolve(null),
    needsVerdictSummary
      ? getLatestTraceMessage(id, [
          "insight_generator_error",
          "verify_findings_error",
        ])
      : Promise.resolve(null),
    !storyNarrative
      ? getLatestTraceMessage(id, ["story_narrative_error"])
      : Promise.resolve(null),
    objectiveValidations.length === 0
      ? getLatestTraceMessage(id, ["objective_validation_error"])
      : Promise.resolve(null),
    run.program_id
      ? getProgramWaves(run.program_id, id)
      : Promise.resolve([]),
  ]);
  const failedVerdictSamples =
    verdictSummary &&
    verdictSummary.verdictedCount > 0 &&
    verdictSummary.passedCount === 0
      ? await getSampleFailedVerdicts(TENANT_ID, id)
      : [];
  timing.done();
  const wordingEdits = await getWordingEdits(id);
  const figureChecks = await getFigureChecks(id);
  const findings = rawFindings.map((f) => ({
    ...f,
    coding_counts: findingCodingCounts.get(f.id) ?? null,
  }));
  // Which raw tables already have at least one finding from a previous
  // "Compute banner comparisons" click -- the button itself is a full
  // recompute (generateFindingsFromBannerPlan replaces this table's own
  // findings each run, see archiveAndReplaceFindings), but its label read
  // as a one-shot "do this once" action even once results already existed,
  // which is what prompted the mislabeling question.
  const reapplyForRun = reapplyCodebookAction.bind(null, id);
  const documentTablesByDocument = new Map<string, DocumentTablePreview[]>();
  for (const preview of documentTablePreviews) {
    const existing = documentTablesByDocument.get(preview.document_id);
    if (existing) {
      existing.push(preview);
    } else {
      documentTablesByDocument.set(preview.document_id, [preview]);
    }
  }

  const documentNameById = new Map(
    documents.map((d) => [d.id, d.source_filename]),
  );
  const importPreviewIdentities = await loadImportPreviewIdentities(TENANT_ID, id, documentTablePreviews);

  // Skip logic from a confirmed questionnaire, per raw data file. Best
  // effort: without a questionnaire the detected routing is used.
  const statedRoutingByDoc = new Map<string, StatedRouting[]>();
  await Promise.all(
    documents
      .filter((d) => d.kind === "table" && d.ingestion_type === "raw")
      .filter((d) => [...instrumentSummaries.values()].some((s) => s.forDocumentId === d.id && s.links.confirmed > 0))
      .map(async (d) => {
        try {
          const items = await getConfirmedItemsForData(TENANT_ID, id, d.id);
          if (!items.some((i) => i.routing)) return;
          const dict = await loadVariableDictionary(TENANT_ID, id, d.id);
          statedRoutingByDoc.set(d.id, buildStatedRouting(items, dict.variables));
        } catch {
          // fall back to detected routing
        }
      }),
  );
  const importQualityBase = documentTablePreviews.filter((t) => t.headers.length > 0 && t.table_index < 100);
  const rawQualities = await Promise.all(
    importQualityBase.map((t) =>
      t.ingestion_type === "raw" ? getRawQuality(t, statedRoutingByDoc.get(t.document_id) ?? []) : Promise.resolve(null),
    ),
  );

  // A file too wide to store whole only has the capped quality above, which
  // covers the kept subset named in trimmedFiles. Where that happened, pull
  // in the uncapped variable dictionary (the same one the cross tab tool
  // reads, read from the full file with no column cap) and fold it into a
  // quality report that covers every variable, not just the kept ones.
  type FullCoverageExtra = { quality: TableQuality; questionTypeByVariable: Record<string, QuestionType> };
  const trimmedRawRows = importQualityBase
    .map((t, i) => ({ t, capped: rawQualities[i] }))
    .filter(
      (r): r is { t: (typeof importQualityBase)[number]; capped: TableQuality } =>
        r.t.ingestion_type === "raw" && !!r.capped && trimmedFiles.has(r.t.document_id),
    );
  const trimmedDocs = [...new Map(trimmedRawRows.map((r) => [r.t.document_id, r.capped])).entries()];
  const fullCoverageByDoc = new Map<string, FullCoverageExtra>();
  await Promise.all(
    trimmedDocs.map(async ([documentId, capped]) => {
      try {
        const dict = await loadVariableDictionary(TENANT_ID, id, documentId);
        const quality = computeFullTableQuality(dict as VariableDictionary, capped);
        const questionTypeByVariable: Record<string, QuestionType> = {};
        for (const set of dict.sets ?? []) {
          for (const name of set.vars) questionTypeByVariable[name] = (set.kind ?? "multi") as QuestionType;
        }
        fullCoverageByDoc.set(documentId, { quality, questionTypeByVariable });
      } catch {
        // Dictionary unavailable (e.g. a non-SPSS/Stata/SAS file was trimmed some
        // other way): fall back to the capped view for this file rather than failing.
      }
    }),
  );

  // The researcher's saved type/question-type corrections apply to any raw
  // file, not only ones too wide to store whole, so these are loaded for
  // every raw document shown here (a single small jsonb read each).
  const rawDocIds = [...new Set(importQualityBase.filter((t) => t.ingestion_type === "raw").map((t) => t.document_id))];
  const questionDefinitionsByDoc = new Map(await Promise.all(rawDocIds.map(async documentId =>
    [documentId, await loadImportQuestionDefinitions(TENANT_ID, id, documentId)] as const,
  )));
  const overridesByDoc = new Map(
    await Promise.all(
      rawDocIds.map(
        async (documentId) => [documentId, await loadVariableOverrides(TENANT_ID, id, documentId)] as const,
      ),
    ),
  );

  // An SPSS/Stata/SAS file not caught by the uncapped-coverage path above (it
  // was never too wide to need it) still has its stored table, and so its
  // quality.variableDetails, keyed by each variable's display LABEL rather
  // than its canonical name - a correction saved against that label would
  // otherwise reach nowhere the dictionary, crosstabs or any calculation
  // actually looks. Built only for this case: CSV/Excel headers already are
  // the canonical name, and a trimmed file's coverage is already canonically
  // keyed via fullCoverageByDoc above.
  const statsRawDocIds = rawDocIds.filter(
    (documentId) => !fullCoverageByDoc.has(documentId) && isStatsFileName(documentNameById.get(documentId) ?? ""),
  );
  const canonicalMapByDoc = new Map(
    await Promise.all(
      statsRawDocIds.map(async (documentId) => {
        try {
          const dict = await loadVariableDictionary(TENANT_ID, id, documentId);
          // Keyed only by the exact display header a correction was actually saved
          // against (the disambiguated label _build_headers produced, falling back
          // to the raw name only when no label exists). A raw name is never added
          // as a second key: a variable's own name can coincide with another
          // variable's disambiguated label (e.g. a label literally "q (2)" next to
          // a raw-named column "q (2)"), and folding both into one object let
          // whichever was written second silently redirect the other's corrections.
          // If a key is ever claimed by two different variables, that key is left
          // out entirely rather than guessing.
          const map: Record<string, string> = {};
          const ambiguous = new Set<string>();
          for (const v of dict.variables) {
            const key = v.label || v.name;
            if (key in map && map[key] !== v.name) ambiguous.add(key);
            else map[key] = v.name;
          }
          for (const key of ambiguous) delete map[key];
          // IMP-003: the client used to fall back to the raw header text itself as the
          // canonical name whenever a lookup here came up empty - correct for an
          // unlabelled header, which already equals its own canonical name, but not
          // generally safe: a display label with no entry in `map` (ambiguous, or any
          // other reason) can still coincide, purely by chance, with some OTHER
          // variable's actual canonical name (a label "Shared" sitting next to a
          // genuinely different variable literally named "Shared"), and silently
          // falling back to it then writes a correction into that other variable's
          // override slot instead. Every real canonical name in this dictionary is
          // sent down too, so the client can refuse that fallback whenever it would
          // collide, rather than trust that no name ever repeats as a label elsewhere.
          const allNames = dict.variables.map((v) => v.name);
          return [documentId, { map, allNames }] as const;
        } catch {
          // Dictionary unavailable: headers are used as-is, same as before this fix.
          return [documentId, { map: {} as Record<string, string>, allNames: [] as string[] }] as const;
        }
      }),
    ),
  );

  const importQualityTables = importQualityBase
    .map((t, i) => ({
      quality: rawQualities[i] ?? undefined,
      t,
    }))
    // A raw file whose quality could not be worked out is left out rather than shown as empty.
    .filter(({ t, quality }) => t.ingestion_type !== "raw" || quality !== undefined)
    .map(({ t, quality }) => {
      const full = fullCoverageByDoc.get(t.document_id);
      return {
        quality: full?.quality ?? quality,
        id: t.id,
        documentId: t.document_id,
        documentName: documentNameById.get(t.document_id) ?? "Table",
        label: t.label,
        tableIndex: t.table_index,
        headers: t.headers,
        rows: t.rows,
        ingestionType: t.ingestion_type,
        trimmed: trimmedFiles.get(t.document_id) ?? null,
        previewError: importPreviewIdentities.get(t.document_id)?.error,
        unsupportedIdentifierColumns: unsupportedIdentifierColumnsByDoc.get(t.document_id) ?? [],
        labelConflicts: labelDiagnosticsByDoc.get(t.document_id)?.conflicts ?? [],
        unmatchedLabelVariables: labelDiagnosticsByDoc.get(t.document_id)?.unmatched ?? [],
        fullyCovered: !!full,
        stated: statedRoutingByDoc.get(t.document_id) ?? [],
        questionTypeByVariable: questionDefinitionsByDoc.get(t.document_id)?.types ?? full?.questionTypeByVariable,
        questionTypeError: questionDefinitionsByDoc.get(t.document_id)?.error,
        overrides: overridesByDoc.get(t.document_id),
        canonicalNameByHeader: canonicalMapByDoc.get(t.document_id)?.map,
        claimedCanonicalNames: canonicalMapByDoc.get(t.document_id)?.allNames,
      };
    });

  // The framer is meant to run automatically once there's evidence to read,
  // not wait for the researcher to notice nothing showed up and click a
  // button. If processing already produced findings but no candidate exists
  // yet (the automatic call after extraction never ran, or it ran and
  // failed, e.g. a transient API error), kick off a retry here on page
  // load rather than waiting on one: this used to be `await`ed right in
  // the render path, which meant every visit to an already-processed
  // project blocked on a fresh framer call before the page could even
  // start rendering. It runs in the background instead; if it fails again,
  // refreshDecisionCandidates swallows the error and logs it to trace, and
  // the "Get suggestions" button in the decision brief section gives the
  // researcher an explicit way to retry rather than needing a fresh
  // document upload (or another page load) to re-trigger it.
  if (findings.length > 0 && decisionCandidates.length === 0) {
    refreshInBackground(
      id,
      decisionRefreshesInFlight,
      () => refreshDecisionCandidates(id),
      `decision:${id}`,
    );
  }


  // Same reasoning as the objective/decision self-heal above: this used to
  // `await` a full recommendation-generation pass right here whenever the
  // counts did not line up, which on a run with a lot of insights (or one
  // where a handful of insights never got a usable recommendation out of a
  // chunk) meant the gap never closed and every single page load re-ran
  // the agent before rendering. It now tops up in the background instead;
  // "Generate for new insights" in the Recommendations section covers the
  // case where a researcher wants to force it immediately rather than
  // waiting for the next visit.
  const synthesizedRecommendations = rawSynthesizedRecommendations.map(
    (r) => ({ ...r, ...(recommendationQuality.get(r.id) ?? {}) }),
  );
  const acceptedSynthesizedInsightCount = synthesizedInsights.filter(
    (i) => i.review_status === "accepted",
  ).length;
  if (
    Boolean(run.decision_statement) &&
    ((insights.length > 0 && recommendations.length < insights.length) ||
      (acceptedSynthesizedInsightCount > 0 &&
        synthesizedRecommendations.length < acceptedSynthesizedInsightCount))
  ) {
    refreshInBackground(
      id,
      recommendationRefreshesInFlight,
      // Background refresh: failures are already logged by refreshRecommendations.
      async () => {
        await refreshRecommendations(TENANT_ID, id);
      },
      `recommendation:${id}`,
    );
  }

  const currentProgram = run.program_id
    ? (programs.find((program) => program.id === run.program_id) ?? null)
    : null;

  const processRunWithId = processRunAction.bind(null, id, "new");
  const regenerateUnreviewedWithId = processRunAction.bind(
    null,
    id,
    "unreviewed",
  );
  const reprocessAllWithId = processRunAction.bind(null, id, "all");
  const reverifyFindingsWithId = reverifyFindingsAction.bind(null, id);
  const generateStoryReportWithId = generateStoryReportAction.bind(null, id);
  const synthesizeInsightsWithId = synthesizeInsightsAction.bind(null, id);
  const updateProgramLinkWithId = updateProgramLinkAction.bind(null, id);

  // Each section below opens itself automatically the one time it first
  // becomes relevant, then is left exactly as the researcher leaves it from
  // then on, no matter what else changes elsewhere on the page. That's done
  // with a `reached`/`done` pair per section rather than one shared
  // "current stage": `reached` flips true once evidence exists for this
  // section to act on, `done` flips true once its own step is finished, and
  // the section's key is built from its own two flags, not from a single
  // global stage. Accepting a decision, say, only changes the flags for
  // Decision and whatever becomes newly reached by it (Recommendations,
  // and Insights in validate mode); it can no longer force every other
  // section on the page to remount and re-collapse along with it, which is
  // what made the page feel like it "rolled up" on every accept.
  //
  // The objective is always settled before anything else downstream, since
  // both the decision framer and the insight generator read whichever
  // objective is accepted as their own strongest signal of what this
  // project is trying to learn. Past that, the two entry points genuinely
  // diverge: "generate" runs the ordinary pyramid (insight leads to
  // decision), so Insights is reached as soon as the objective is set, and
  // Decision only once there are insights to reason from. "validate" keeps
  // a decision-first order, so Decision is reached as soon as the
  // objective is set, and Insights only once a decision is confirmed.
  // Findings is deliberately never gated this way: it's the raw evidence,
  // always available to browse, never the thing you're being steered
  // toward, and neither is Insights once reached, since insights stay
  // worth glancing back at the same way findings do.
  const generateMode = run.entry_point === "generate";

  // Questionnaires and guides sit inside the card of the file they belong to,
  // above its data quality. One with nowhere to go yet keeps its own card.
  const rawDataDocs = documents.filter((x) => x.kind === "table" && x.ingestion_type === "raw");
  const transcriptDocs = documents.filter((x) => x.kind === "transcript");
  const instrumentHome = new Map<string, string>(); // instrument id to host document id, "*" for every transcript
  for (const x of documents) {
    if (x.kind !== "instrument") continue;
    const sm = instrumentSummaries.get(x.id);
    if (!sm) continue;
    if (sm.type === "interview_guide" || sm.type === "focus_group_guide") {
      if (transcriptDocs.length > 0) instrumentHome.set(x.id, "*");
    } else if (rawDataDocs.length > 0) {
      instrumentHome.set(x.id, rawDataDocs.find((r) => r.id === sm.forDocumentId)?.id ?? rawDataDocs[0].id);
    }
  }
  const attachedFor = (d: (typeof documents)[number]): React.ReactNode => {
    const hosted = documents.filter((x) => {
      const h = instrumentHome.get(x.id);
      return h !== undefined && (h === d.id || (h === "*" && d.kind === "transcript"));
    });
    if (hosted.length === 0) return null;
    return (
        <AttachedInstruments
          key={`attached-${d.id}`}
          runId={id}
          instruments={hosted.map((x) => ({
            documentId: x.id,
            filename: x.source_filename,
            summary: instrumentSummaries.get(x.id)!,
            deleteAction: deleteDocument.bind(null, id, x.id),
            deleteConfirm: deleteDocumentConfirmation(impactFor(deletionImpact, x.id)),
          }))}
          targetId={d.kind === "table" ? d.id : undefined}
          dataDocs={d.kind === "table" ? rawDataDocs.map((r) => ({ id: r.id, name: r.source_filename })) : undefined}
          autoStart={d.kind === "table" || transcriptDocs[0]?.id === d.id}
          onlyTranscript={d.kind === "transcript" ? d.id : undefined}
        />
    );
  };
  const uploadDone = documents.length > 0;
  const objectiveDone = Boolean(run.research_objective);
  const decisionReached = generateMode ? insights.length > 0 : objectiveDone;
  const decisionDone = Boolean(run.decision_statement);
  const recommendationsReached = Boolean(run.decision_statement);

  const startingPointLabel =
    run.entry_point === "generate"
      ? "Generate from data"
      : "Validate existing insights";

  const decisionSection = (
    <div
      key={`decision-${decisionReached}-${decisionDone}`}
      className="flex flex-col gap-4"
    >
      <DecisionBriefReview
        runId={id}
        candidates={decisionCandidates}
        hasFindings={findings.length > 0}
        evidenceSynthesis={run.evidence_synthesis}
        refreshPending={decisionRefreshIsPending}
        earlierDecisions={earlierDecisionCounts}
      />
    </div>
  );

  const statedInsightValidationsSection = (
    <CollapsibleSection
      key={`stated-insight-validations-${statedInsightValidations.length}`}
      title={`Report insight validations${statedInsightValidations.length > 0 ? ` (${statedInsightValidations.length})` : ""}`}
      bare
      icon={<CheckIcon className="h-4 w-4 text-primary" />}
      defaultOpen={false}
    >
      <StatedInsightValidationsReview
        validations={statedInsightValidations}
        totalStatedInsights={statedInsightValidations.length}
        inputState={inputCompleteness.state}
      />
    </CollapsibleSection>
  );

  const insightsTabLabel = `Pre-insights${insights.length > 0 ? ` (${insights.length})` : ""}`;
  const insightsTabHeaderRight =
    insights.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/runs/${id}/insights/export`}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400"
        >
          <DownloadIcon className="h-3.5 w-3.5 text-muted" />
          Excel
        </a>
        <a
          href={`/api/runs/${id}/insights/export-deck`}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400"
        >
          <PresentationIcon className="h-3.5 w-3.5 text-muted" />
          Slides
        </a>
      </div>
    ) : undefined;
  const insightsTabContent = (
    <InsightsReview
      insights={insights}
      inputState={inputCompleteness.state}
      totalFindings={findings.length}
      verdictSummary={verdictSummary}
      insightError={insightError}
      failedVerdictSamples={failedVerdictSamples}
    />
  );

  const synthesizedInsightsSection = (
    <div
      key={`synthesized-insights-${synthesizedInsights.length}`}
      className="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="ml-auto">
        <div className="flex flex-wrap items-center gap-2">
          {synthesizedInsights.length > 0 && (
            <>
              <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                <DownloadIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
                <span className="mr-0.5 text-sm font-medium text-foreground">
                  Excel:
                </span>
                <a
                  href={`/api/runs/${id}/synthesized-insights/export?scope=all`}
                  className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
                >
                  All
                </a>
                <a
                  href={`/api/runs/${id}/synthesized-insights/export?scope=accepted`}
                  className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
                >
                  Accepted
                </a>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
                <PresentationIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
                <span className="mr-0.5 text-sm font-medium text-foreground">
                  Slides:
                </span>
                <a
                  href={`/api/runs/${id}/synthesized-insights/export-deck?scope=all`}
                  className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
                >
                  All
                </a>
                <a
                  href={`/api/runs/${id}/synthesized-insights/export-deck?scope=accepted`}
                  className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
                >
                  Accepted
                </a>
              </div>
            </>
          )}
          <form action={synthesizeInsightsWithId}>
            <SubmitButton
              pendingLabel="Synthesizing..."
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400"
              icon={<SparkleIcon className="h-3.5 w-3.5 text-muted" />}
            >
              {synthesizedInsights.length > 0
                ? "Re-run synthesis"
                : "Run synthesis"}
            </SubmitButton>
          </form>
        </div>
        </div>
      </div>
      <SynthesizedInsightsReview runId={id} insights={synthesizedInsights} />
    </div>
  );

  // GT-007: exports of this (main) list, separate from the per-pre-insight list's exports on the
  // Working data tab. Shown whenever the list has anything, including only rejected items. The
  // links are downloads (the download attribute), so a download that fails in transit is reported
  // by the browser's download list and leaves this page, and any open edit, where it is, rather
  // than replacing the page with the browser's error page.
  const mainRecommendationExportControls =
    synthesizedRecommendations.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2" data-testid="main-recommendation-exports">
        <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
          <DownloadIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
          <span className="mr-0.5 text-sm font-medium text-foreground">Main list Excel:</span>
          <a
            href={`/api/runs/${id}/synthesized-recommendations/export?scope=all`}
            download
            aria-label="Excel: all recommendations from the main list"
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            All
          </a>
          <a
            href={`/api/runs/${id}/synthesized-recommendations/export?scope=accepted`}
            download
            aria-label="Excel: accepted recommendations from the main list"
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            Accepted
          </a>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
          <PresentationIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
          <span className="mr-0.5 text-sm font-medium text-foreground">Main list Slides:</span>
          <a
            href={`/api/runs/${id}/synthesized-recommendations/export-deck?scope=all`}
            download
            aria-label="Slides: all recommendations from the main list"
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            All
          </a>
          <a
            href={`/api/runs/${id}/synthesized-recommendations/export-deck?scope=accepted`}
            download
            aria-label="Slides: accepted recommendations from the main list"
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            Accepted
          </a>
        </div>
      </div>
    ) : null;

  const recommendationsSection = (
    <div
      key={`recommendations-${recommendationsReached}`}
      className="flex flex-col gap-4"
    >
      {mainRecommendationExportControls && <div className="flex justify-end">{mainRecommendationExportControls}</div>}
      <SynthesizedRecommendationsReview
        runId={id}
        recommendations={synthesizedRecommendations}
        insightOptions={synthesizedInsights
          .filter((insight) => insight.review_status === "accepted")
          .map((insight) => ({ id: insight.id, headline: insight.headline }))}
        parkedInsights={parkedInsights}
        hasDecision={Boolean(run.decision_statement)}
        hasInsights={acceptedSynthesizedInsightCount > 0}
      />
    </div>
  );

  // The original 1:1 pre-insight recommendations, kept additive alongside
  // the synthesized-insight-level ones above rather than replaced by them
  // (same "add, don't hide" pattern as pre-insights vs synthesized
  // insights). This is also where the Excel/Slides export buttons stay,
  // since those routes were built against this join and still only ever
  // export this list. The main list above has its own exports (GT-007,
  // synthesized-recommendations/export and export-deck).
  const allRecommendationsTabLabel = `Recommendations${recommendations.length > 0 ? ` (${recommendations.length})` : ""}`;
  const allRecommendationsTabHeaderRight =
    recommendations.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
          <DownloadIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
          <span className="mr-0.5 text-sm font-medium text-foreground">
            Excel:
          </span>
          <a
            href={`/api/runs/${id}/recommendations/export?scope=all`}
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            All
          </a>
          <a
            href={`/api/runs/${id}/recommendations/export?scope=accepted`}
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            Accepted
          </a>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
          <PresentationIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
          <span className="mr-0.5 text-sm font-medium text-foreground">
            Slides:
          </span>
          <a
            href={`/api/runs/${id}/recommendations/export-deck?scope=all`}
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            All
          </a>
          <a
            href={`/api/runs/${id}/recommendations/export-deck?scope=accepted`}
            className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
          >
            Accepted
          </a>
        </div>
      </div>
    ) : undefined;
  const allRecommendationsTabContent = (
    <>
      <p className="mb-3 max-w-2xl text-sm text-muted">
        One action per pre-insight, before clustering: more granular and more
        numerous than the Recommendations tab above, kept here as the full audit
        trail rather than hidden.
      </p>
      <RecommendationsReview
        runId={id}
        recommendations={recommendations}
        insightOptions={insights.map((insight) => ({
          id: insight.id,
          headline: insight.headline,
          theme: insight.theme,
        }))}
        hasDecision={Boolean(run.decision_statement)}
        hasInsights={insights.length > 0}
      />
    </>
  );

  const storyReportSection = (
    <div
      key={`story-report-${storyNarrative ? storyNarrative.generated_at : "none"}`}
    >
      <ThreePane
        left={
          <Pane side="left" title="Generate and export">
        <p className="text-xs text-muted">
          Weaves this project&apos;s accepted synthesized insights and
          recommendations into one underlying narrative, then lays it out two
          ways: the slide deck as an SCQA / Pyramid Principle argument built to
          persuade a room, the Word report as a traditional research report a
          reader works through at their own pace (executive summary,
          introduction, methodology, findings, insights, recommendations, next
          steps). Both read from the same narrative, so there is only one thing
          to regenerate: regenerating it updates what both exports will produce
          next, and every export always reflects whatever was generated most
          recently. Only synthesized insights and recommendations that have
          actually been reviewed and accepted feed into either one; nothing on
          the client-facing report is restated or invented by the model.
        </p>

        {storyReportError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {storyReportError}
          </div>
        )}

        <div className="space-y-1.5">
          <form action={generateStoryReportWithId}>
            <SubmitButton
              pendingLabel="Generating..."
              className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
              icon={<SparkleIcon className="h-4 w-4" />}
            >
              {storyNarrative
                ? "Regenerate report content"
                : "Generate Insights Report"}
            </SubmitButton>
          </form>
          {storyNarrative && (
            <p className="text-xs text-muted">
              Updates both export formats at once. Export deck (.pptx) and
              Export report (.docx) above always build fresh from whatever this
              last generated, so re-export either (or both) after regenerating.
            </p>
          )}
        </div>

            {storyNarrative ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`/api/runs/${id}/story/export`}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary"
            >
              <DownloadIcon className="h-3.5 w-3.5 text-muted" />
              Export deck (.pptx)
            </a>
            <a
              href={`/api/runs/${id}/story/export-docx`}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary"
            >
              <DownloadIcon className="h-3.5 w-3.5 text-muted" />
              Export report (.docx)
            </a>
          </div>
        ) : undefined}
          </Pane>
        }
        middle={
          <Pane side="middle" title="Narrative">
            {!storyNarrative && (
              <p className="text-sm text-muted">
                Nothing generated yet. Generate the Insights Report on the left to see the narrative here.
              </p>
            )}
        {storyNarrative && (
          <div className="space-y-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
            {/* FND-001 / REP-OUT-001: counts each support status separately; unknown is never
                reported as changed or removed. Placed above the executive summary and governing
                thought, which it qualifies, so the saved framing never reads unqualified. */}
            <NarrativeSupportBanner
              insightIds={storyNarrative.pillars.flatMap((pillar) => pillar.insight_ids)}
              supportById={Object.fromEntries(
                synthesizedInsights.map((insight) => [insight.id, insight.support]),
              )}
            />
            {storyNarrative.executive_summary && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Executive summary
                </p>
                <p className="text-sm text-foreground">
                  {storyNarrative.executive_summary}
                </p>
              </div>
            )}
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Governing thought
            </p>
            <p className="text-base font-semibold text-foreground">
              {storyNarrative.governing_thought}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Situation
                </p>
                <p className="text-sm text-foreground">
                  {storyNarrative.situation}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  Complication
                </p>
                <p className="text-sm text-foreground">
                  {storyNarrative.complication}
                </p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                Pillars ({storyNarrative.pillars.length})
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
                {storyNarrative.pillars.map((pillar, index) => (
                  <li key={index}>{pillar.headline}</li>
                ))}
              </ul>
            </div>
            {/* Numerical traceability: figures in the narrative that need review, or the stored check. */}
            <FigureCheckNotice check={figureChecks.narrative} />
            <p className="text-xs text-muted">
              Generated {new Date(storyNarrative.generated_at).toLocaleString()}
            </p>
          </div>
        )}

          </Pane>
        }
        right={
          <Pane side="right" title="Objectives and decisions checked">
            {objectiveValidations.length === 0 && !objectiveValidationError && (
              <p className="text-sm text-muted">
                Objectives and decisions, checked against the evidence, show here once the report is generated.
              </p>
            )}
        {objectiveValidationError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {objectiveValidationError}
          </div>
        )}

        {objectiveValidations.length > 0 && (
          <div className="space-y-2 rounded-lg border border-border bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Objectives &amp; decisions, checked against the evidence (
              {objectiveValidations.length})
            </p>
            <ul className="space-y-2">
              {objectiveValidations.map((item, index) => {
                const badge =
                  item.inferred
                    ? {
                        label: "Inferred",
                        className: "bg-slate-100 text-slate-600",
                      }
                    : item.status === "resolved"
                    ? {
                        label: "Resolved",
                        className: "bg-emerald-100 text-emerald-800",
                      }
                    : item.status === "partial"
                      ? {
                          label: "Partial",
                          className: "bg-amber-100 text-amber-800",
                        }
                      : {
                          label: "Gap",
                          className: "bg-slate-200 text-slate-700",
                        };
                return (
                  <li key={index} className="text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.evidence_digest_degraded && (
                        <span
                          className="rounded px-1.5 py-0.5 text-xs font-semibold uppercase bg-orange-100 text-orange-800"
                          title="This conclusion was generated while direct data-evidence retrieval was failing (a connection or permission error, not a missing lane) - it may be missing evidence a working check would have cited."
                        >
                          Evidence check degraded
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">
                        {item.item_kind === "objective"
                          ? "Objective"
                          : "Decision"}
                      </span>
                    </div>
                    <p className="mt-0.5 font-medium text-foreground">
                      {item.item_text}
                    </p>
                    <p className="text-muted">
                      {item.inferred
                        ? "Inferred from this project's own evidence, so not an independent test. "
                        : ""}
                      {item.conclusion}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
          </Pane>
        }
      />
    </div>
  );

  // True whenever a business problem/objective was already given before
  // any evidence existed for this run, via manual text at project creation
  // or an imported brief/proposal, independent of generate-vs-validate:
  // either entry point can arrive with or without one. This, not the entry
  // point, is what decides whether Objective (and, in validate mode, since
  // its decision framer reads raw findings rather than insights, Decision
  // too) can render ahead of Findings, since generateObjectiveCandidates
  // has no evidence to infer an objective from until findings exist.
  const findingsSection = (
    <CollapsibleSection
      key={`findings-${findings.length > 0}`}
      title="Findings"
      bare
      icon={<ChartIcon className="h-4 w-4 text-primary" />}
      // Findings insert as 'accepted' by default now, so there's no
      // 'pending' state left to key this open/closed on; it opens whenever
      // there's anything to look at, since review is now by exception
      // (rejecting the ones that are wrong) rather than a gate everything
      // waits behind.
      defaultOpen={findings.length > 0}
      headerRight={
        findings.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <form action={reverifyFindingsWithId}>
              <SubmitButton
                pendingLabel="Re-verifying..."
                title="Clear every verdict on this run and verify all findings again from scratch"
                className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground"
              >
                Re-verify findings
              </SubmitButton>
            </form>
            <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
              <DownloadIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
              <span className="mr-0.5 text-sm font-medium text-foreground">
                Excel:
              </span>
              <a
                href={`/api/runs/${id}/findings/export?scope=all`}
                className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
              >
                All
              </a>
              <a
                href={`/api/runs/${id}/findings/export?scope=accepted`}
                className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
              >
                Accepted
              </a>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border px-2 py-1">
              <PresentationIcon className="ml-0.5 h-3.5 w-3.5 text-muted" />
              <span className="mr-0.5 text-sm font-medium text-foreground">
                Slides:
              </span>
              <a
                href={`/api/runs/${id}/findings/export-deck?scope=all`}
                className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
              >
                All
              </a>
              <a
                href={`/api/runs/${id}/findings/export-deck?scope=accepted`}
                className="rounded-md px-2 py-1 text-sm font-medium text-foreground transition hover:bg-primary-light hover:text-primary"
              >
                Accepted
              </a>
            </div>
          </div>
        ) : undefined
      }
    >
      {findings.length === 0 ? (
        <p className="text-sm text-muted">None extracted yet.</p>
      ) : (
        <FindingsTable runId={id} findings={findings} wordingEdits={wordingEdits} />
      )}
    </CollapsibleSection>
  );

  // Objective setting sits adjacent to Findings, but which side depends on
  // whether the objective was already known before any evidence existed
  // (runs.initial_research_objective, set at project creation from either
  // manual text or an imported brief/proposal), not on generate-vs-validate.
  // A project can arrive at either entry point with a brief already in
  // hand, or with nothing but raw data/a report and no stated objective;
  // generateObjectiveCandidates can only infer one from findings once they
  // exist (it throws otherwise), so when nothing was given upfront,
  // Findings has to come first regardless of mode. See objectiveKnownUpfront
  // below, computed once in RunPage and used to order both this section and
  // Decision (in validate mode only; in generate mode Decision has its own
  // hard dependency on Insights, unrelated to this).
  const objectiveQuality = await getObjectiveQuality(id);
  const qualityByText = new Map(
    objectiveQuality.rows.map((r) => [r.item_text.trim(), r] as const),
  );
  const objectiveRows: ObjectiveRow[] = objectiveCandidates.map((c): ObjectiveRow => {
        const q = qualityByText.get(c.candidate_text.trim());
        return {
          id: c.id,
          text: c.candidate_text,
          rationale: c.rationale,
          source: c.source,
          status: c.status,
          edited: c.edited,
          scores:
            q && c.status === "accepted"
              ? {
                  specific: q.specific_score,
                  measurable: q.measurable_score,
                  answerable: q.answerable_score,
                  relevant: q.relevant_score,
                  total: q.quality_score,
                  tier: q.quality_tier,
                  rationale: q.rationale,
                  suggestion: q.suggestion,
                }
              : null,
        };
  });
  const objectiveReviewList = (
    <ObjectiveReviewTable
      runId={id}
      hasFindings={findings.length > 0}
      missingMigration={objectiveQuality.missing}
      rows={objectiveRows}
    />
  );


  // Decision's nav placement follows the same hard data dependency this
  // comment used to explain for the old scroll-order build: in generate
  // mode, generateDecisionCandidates reads insights, not raw findings, and
  // throws if none exist yet, so Decision has to stay grouped after
  // Analysis regardless of what's known upfront. In validate mode it reads
  // raw findings directly and needs nothing from Insights, so it's free to
  // sit with Objective instead -- see decisionGroup below, used when
  // building navSections.
  const decisionGroup = run.entry_point === "validate" ? "Setup" : "Decisions";

  // The granular, per-finding/per-pre-insight audit trail: pre-insights,
  // the full (unclustered) recommendations list, and a record of anything
  // archived along the way. Grouped into one collapsed-by-default section
  // rather than three competing top-level headers, since none of these are
  // meant to be the first thing read; the curated synthesized sections
  // above are.
  const historyTabLabel = `History${findingHistory.length > 0 ? ` (${findingHistory.length})` : ""}`;
  const historyTabHeaderRight =
    findingHistory.length > 0 ? (
      <a
        href={`/api/runs/${id}/history/export`}
        className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary"
        title="Download this run's full audit trail (removed findings and API cost) as a CSV file"
      >
        <DownloadIcon className="h-3.5 w-3.5 text-muted" />
        Export CSV
      </a>
    ) : undefined;
  const historyTabContent =
    findingHistory.length > 0 ? (
      <>
        <p className="mb-3 text-xs text-muted">
          Findings removed by &quot;Regenerate unreviewed&quot; or
          &quot;Reprocess all documents&quot; land here rather than disappearing
          outright, along with whatever insight had been built on them at the
          time. A finding you had explicitly accepted or rejected only shows up
          here if it was removed by &quot;Reprocess all documents&quot;, the one
          tier that does not protect reviewed findings.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
                <th className="py-1.5 pr-4">Finding</th>
                <th className="py-1.5 pr-4">Status when removed</th>
                <th className="py-1.5 pr-4">Insight it fed</th>
                <th className="py-1.5 pr-4">Removed by</th>
                <th className="py-1.5 pr-4">Archived</th>
              </tr>
            </thead>
            <tbody>
              {findingHistory.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-0 align-top"
                >
                  <td className="py-1.5 pr-4 text-foreground">
                    {row.finding_text}
                  </td>
                  <td className="py-1.5 pr-4 text-foreground">
                    {findingHistoryStatusLabel[row.status] ?? row.status}
                  </td>
                  <td className="py-1.5 pr-4 text-foreground">
                    {row.insight_headline
                      ? `${row.insight_headline}${
                          row.insight_quality_tier
                            ? ` (${row.insight_quality_tier})`
                            : ""
                        }`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-4 text-foreground">
                    {findingHistoryReasonLabel[row.archived_reason] ??
                      row.archived_reason}
                  </td>
                  <td className="py-1.5 pr-4 whitespace-nowrap text-foreground">
                    {new Date(row.archived_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ) : (
      <p className="text-sm text-muted">Nothing archived yet.</p>
    );

  const workingDataSection = (
    <div key={`working-data-${insights.length}-${recommendations.length}-${findingHistory.length}`}>
      <WorkingDataTabs
        layout="pane"
        intro={
          <p className="text-xs text-muted">
            The granular layer underneath the sections above: one pre-insight per verified finding,
            one recommendation per pre-insight, and anything removed along the way. Kept as a full
            audit trail, not meant as the first thing to read.
          </p>
        }
        tabs={[
          {
            id: "pre-insights",
            label: insightsTabLabel,
            headerRight: insightsTabHeaderRight,
            content: insightsTabContent,
          },
          {
            id: "recommendations",
            label: allRecommendationsTabLabel,
            headerRight: allRecommendationsTabHeaderRight,
            content: allRecommendationsTabContent,
          },
          {
            id: "history",
            label: historyTabLabel,
            headerRight: historyTabHeaderRight,
            content: historyTabContent,
          },
        ]}
      />
    </div>
  );

  // objectiveSection's own comment explains the dependency this mirrors:
  // generateObjectiveCandidates reads findings and throws without any, so
  // when nothing was given upfront, Objective setting can't usefully come
  // before Findings -- it has nothing to generate from yet. Previously this
  // nav list hardcoded "objective" first regardless of objectiveKnownUpfront,
  // so a run with no upfront objective still showed it ahead of Findings,
  // the same regression objectiveKnownUpfront already fixed for the content
  // order (RunPage) but never for this list.
  // Per-document cards, one list per kind of document, so Cross tabs (tables),
  // Coding (transcripts) and Reports each show only their own.
  const documentCards = (
    kind: "table" | "transcript" | "report",
    single = false,
    onlyId?: string,
    omitSide = false,
  ) => (
                        <ul
                          className={`grid grid-cols-1 items-start gap-4 ${single ? "" : "xl:grid-cols-2"}`}
                        >
                          {documents
                            .filter((d) => d.kind === kind && (!onlyId || d.id === onlyId))
                            .map((doc) => {
                            const extractAction = extractFindingsAction.bind(
                              null,
                              id,
                              doc.id,
                            );
                            const generateAction = generateFindingsAction.bind(
                              null,
                              id,
                              doc.id,
                            );
                            const codeAction = codeThemesAction.bind(
                              null,
                              id,
                              doc.id,
                            );
                            const deleteAction = deleteDocument.bind(
                              null,
                              id,
                              doc.id,
                            );
                            return (
                              <li
                                key={doc.id}
                                className={`flex flex-col justify-between gap-3 rounded-lg border border-l-4 border-border bg-white p-3 transition hover:border-primary/30 ${DOC_ACCENTS[documents.indexOf(doc) % DOC_ACCENTS.length].border}`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div
                                      className="truncate text-sm font-medium text-foreground"
                                      title={doc.source_filename}
                                    >
                                      {doc.source_filename}
                                    </div>
                                    <div className="text-xs text-muted">
                                      <span
                                        className={`mr-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${DOC_KIND_STYLE[doc.kind]?.badge ?? ""}`}
                                      >
                                        {DOC_KIND_STYLE[doc.kind]?.label ??
                                          doc.kind}
                                      </span>{" "}
                                      {doc.processing_status === "failed" && (
                                        <span
                                          className="mr-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-800"
                                          title="The last processing attempt for this document failed. Check the error banner above, fix the issue, then try again."
                                        >
                                          processing failed
                                        </span>
                                      )}
                                      {doc.processing_status === "incomplete" && (
                                        <span
                                          className="mr-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-800"
                                          title="Coding finished, but at least one batch of turns came back without a decision for every unit it was asked about. Findings from this transcript may be missing some coded passages. Try Code again."
                                        >
                                          coding incomplete
                                        </span>
                                      )}
                                      {new Date(
                                        doc.uploaded_at,
                                      ).toLocaleDateString()}
                                    </div>
                                  </div>
                                  <form
                                    action={deleteAction}
                                    className="shrink-0"
                                  >
                                    <DeleteDocumentButton confirmMessage={deleteDocumentConfirmation(impactFor(deletionImpact, doc.id))} />
                                  </form>
                                </div>
                                {doc.kind === "report" && (
                                  <form action={extractAction}>
                                    {(() => {
                                      const docFindings = rawFindings.filter(
                                        (f) => f.source_document_id === doc.id,
                                      );
                                      const ranAt = reportReadStats.get(doc.id)?.ranAt;
                                      if (docFindings.length === 0 && !ranAt) {
                                        return (
                                          <SubmitButton
                                            pendingLabel="Extracting..."
                                            className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
                                            icon={<DocumentIcon className="h-3.5 w-3.5" />}
                                          >
                                            Extract findings
                                          </SubmitButton>
                                        );
                                      }
                                      const when = ranAt
                                        ? new Date(ranAt.replace(" ", "T").replace(/\+00$/, "Z")).toLocaleString("en-ZA", {
                                            dateStyle: "medium",
                                            timeStyle: "short",
                                          })
                                        : null;
                                      return (
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="min-w-0 text-xs text-muted">
                                            <span className="font-medium text-emerald-700">Extracted</span>
                                            {when && !when.includes("Invalid") ? ` ${when}` : ""}
                                            {`, ${docFindings.length} ${docFindings.length === 1 ? "finding" : "findings"}`}
                                          </span>
                                          <RerunExtractButton />
                                        </div>
                                      );
                                    })()}
                                    <CodingFormProgress runId={id} />
                                  </form>
                                )}
                                {doc.kind === "report" && (
                                  <ReportReadSummary
                                    stats={reportReadStats.get(doc.id) ?? null}
                                    findings={rawFindings.filter(
                                      (f) => f.source_document_id === doc.id,
                                    )}
                                  />
                                )}
                                {doc.kind === "table" &&
                                  doc.ingestion_type !== "raw" && (
                                    <form action={generateAction}>
                                      <SubmitButton
                                        pendingLabel="Generating..."
                                        className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-success px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 hover:shadow-md"
                                        icon={
                                          <ChartIcon className="h-3.5 w-3.5" />
                                        }
                                      >
                                        Generate findings
                                      </SubmitButton>
                                    </form>
                                  )}
                                {doc.kind === "table" &&
                                  doc.ingestion_type === "raw" &&
                                  !single && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                                      Case-level data. Nothing is compared automatically.
                                      Build tables with the cross tab tool below, or start
                                      from a set of suggested tables, and keep the ones
                                      worth keeping. Committed tables become findings.
                                      Every comparison is flagged as uncorrected for
                                      multiple comparisons and assumes simple random
                                      sampling; complex survey designs are not applied yet.
                                    </div>
                                  )}
                                {doc.kind === "table" &&
                                  (isStatsFileName(doc.source_filename) ||
                                    (doc.ingestion_type === "raw" &&
                                      isCaseTableFileName(doc.source_filename))) &&
                                  (!dataSetups.has(doc.id) || dataSetups.get(doc.id)?.accepted ? (
                                    <AnalyticsBuilder
                                      runId={id}
                                      documentId={doc.id}
                                      filename={doc.source_filename}
                                      waveFiles={waveFiles}
                                      saved={(
                                        documentTablesByDocument.get(doc.id) ?? []
                                      )
                                        .filter((t) => t.table_index >= 100)
                                        .map((t) => ({
                                          id: t.id,
                                          label: t.label ?? "Crosstab",
                                        }))}
                                    />
                                  ) : (
                                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                                      <span>
                                        The set-up for this file changed, or acceptance was undone. Accept it to carry on, or review it
                                        under Import data first.
                                      </span>
                                      <span className="flex flex-wrap items-center gap-2">
                                        <GoToSection id="upload">Review in Import data</GoToSection>
                                        <AcceptDataButton runId={id} documentId={doc.id} setup={dataSetups.get(doc.id)!} />
                                      </span>
                                    </div>
                                  ))}
                                {doc.kind === "table" &&
                                  doc.ingestion_type !== "raw" &&
                                  (() => {
                                    const tables = (
                                      documentTablesByDocument.get(doc.id) ?? []
                                    ).filter(
                                      (t) =>
                                        t.headers.length > 0 &&
                                        t.rows.length > 0,
                                    );
                                    if (tables.length === 0) return null;
                                    return (
                                      <details className="rounded-lg border border-border bg-slate-50 p-2 text-xs">
                                        <summary className="cursor-pointer select-none font-medium text-muted">
                                          Preview extracted table
                                          {tables.length > 1
                                            ? `s (${tables.length})`
                                            : ""}
                                        </summary>
                                        <div className="mt-2 space-y-4">
                                          {tables.map((t) => {
                                            const previewRows = t.rows.slice(
                                              0,
                                              10,
                                            );
                                            return (
                                              <div key={t.id}>
                                                <p className="mb-1 text-[11px] font-medium text-foreground">
                                                  {t.label ??
                                                    `Table ${t.table_index + 1}`}
                                                  {t.source_page
                                                    ? ` (page ${t.source_page})`
                                                    : ""}
                                                </p>
                                                <div className="overflow-x-auto">
                                                  <table className="w-full border-collapse text-left text-[11px]">
                                                    <thead>
                                                      <tr className="border-b border-border">
                                                        {t.headers.map((h) => (
                                                          <th
                                                            key={h}
                                                            className="py-1 pr-3 font-semibold text-muted"
                                                          >
                                                            {h}
                                                          </th>
                                                        ))}
                                                      </tr>
                                                    </thead>
                                                    <tbody>
                                                      {previewRows.map(
                                                        (row, rowIndex) => (
                                                          <tr
                                                            key={rowIndex}
                                                            className="border-b border-border last:border-0"
                                                          >
                                                            {t.headers.map(
                                                              (h) => (
                                                                <td
                                                                  key={h}
                                                                  className="py-1 pr-3 text-foreground"
                                                                >
                                                                  {row[h] ?? ""}
                                                                </td>
                                                              ),
                                                            )}
                                                          </tr>
                                                        ),
                                                      )}
                                                    </tbody>
                                                  </table>
                                                </div>
                                                {t.rows.length >
                                                  previewRows.length && (
                                                  <p className="mt-1 text-[11px] text-muted">
                                                    Showing first{" "}
                                                    {previewRows.length} of{" "}
                                                    {t.rows.length} rows.
                                                  </p>
                                                )}
                                                {t.table_index < 100 && (
                                                  <TableDigest
                                                    headers={t.headers}
                                                    rows={t.rows}
                                                  />
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </details>
                                    );
                                  })()}
                                {doc.kind === "transcript" && (
                                  <CodeGate
                                    documentId={doc.id}
                                    initialReady={
                                      transcriptSetups.get(doc.id)?.confirmed ??
                                      false
                                    }
                                    initialSummary={(() => {
                                      const setup = transcriptSetups.get(
                                        doc.id,
                                      );
                                      if (!setup) return null;
                                      // Transcripts confirmed by migration 0051 have no
                                      // session type stored, so name only what exists.
                                      const parts = [
                                        SESSION_LABEL[setup.sessionType],
                                        MODE_LABEL[setup.mode],
                                      ].filter(Boolean);
                                      return parts.length > 0
                                        ? parts.join("; ")
                                        : "confirmed";
                                    })()}
                                  >
                                    <form action={codeAction}>
                                      <SubmitButton
                                        pendingLabel="Coding..."
                                        className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 hover:shadow-md"
                                        icon={
                                          <DocumentIcon className="h-3.5 w-3.5" />
                                        }
                                      >
                                        Code themes
                                      </SubmitButton>
                                      <CodingFormProgress runId={id} />
                                    </form>
                                    <details className="rounded-lg border border-border bg-white p-2 text-xs">
                                      <summary className="cursor-pointer select-none font-medium text-muted">
                                        Already coded? Import your coding
                                      </summary>
                                      <form
                                        action={importCodingAction.bind(
                                          null,
                                          id,
                                          doc.id,
                                        )}
                                        className="mt-2 flex flex-col gap-2"
                                      >
                                        <p className="text-muted">
                                          An Excel, CSV or Word file: a table
                                          of themes, sub-themes and quotes, one
                                          row per coded sentence (an ATLAS.ti
                                          quotation report works), a coding
                                          matrix, or a themed extract with
                                          headings and quoted bullets. Quotes
                                          are matched to this transcript and
                                          every count is recomputed from it,
                                          so counts in your file are ignored.
                                          A file with codes and definitions
                                          but no quotes is read as a codebook
                                          and applied to the transcript.
                                        </p>
                                        <input
                                          type="file"
                                          name="codingFile"
                                          accept=".xlsx,.xls,.csv,.docx"
                                          required
                                          className="text-xs"
                                        />
                                        <SubmitButton
                                          pendingLabel="Importing..."
                                          className="flex w-fit items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90"
                                          icon={
                                            <UploadIcon className="h-3.5 w-3.5" />
                                          }
                                        >
                                          Import coding
                                        </SubmitButton>
                                      </form>
                                    </details>
                                  </CodeGate>
                                )}
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <CodebookPanel
                                      key={`codebook-${doc.id}-${codebooksByDocument.get(doc.id)!.version}-${codebooksByDocument.get(doc.id)!.codes.map((c) => `${c.theme}~${c.keywords}~${c.note}`).join("|")}`}
                                      codebook={codebooksByDocument.get(
                                        doc.id,
                                      )!}
                                      reapply={reapplyForRun}
                                    />
                                  )}
                                {doc.kind === "transcript" &&
                                  codingAnalysis.has(doc.id) && (
                                    <CodingAnalysisPanel
                                      key={`coding-analysis-${doc.id}-${codingAnalysis.get(doc.id)!.version}`}
                                      runId={id}
                                      view={codingAnalysis.get(doc.id)!}
                                    />
                                  )}
                                {!omitSide && (
                                  <>
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <CodingExtras
                                      runId={id}
                                      documentId={doc.id}
                                      filename={doc.source_filename}
                                    />
                                  )}
                                {doc.kind === "transcript" &&
                                  codingAnalysis.has(doc.id) && (
                                    <TranscriptQualityPanel
                                      key={`coding-quality-${doc.id}-${codingAnalysis.get(doc.id)!.version}`}
                                      runId={id}
                                      title="Quality control"
                                      items={[
                                        {
                                          documentId: doc.id,
                                          filename: doc.source_filename,
                                          view: codingAnalysis.get(doc.id)!,
                                        },
                                      ]}
                                    />
                                  )}
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <a
                                      href={`/api/runs/${id}/coding/export`}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-slate-50"
                                    >
                                      Export codebook and coding checks (.xlsx)
                                    </a>
                                  )}
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <a
                                      href={`/api/runs/${id}/coding/extract`}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-slate-50"
                                    >
                                      Themed extract for writing up (.docx)
                                    </a>
                                  )}
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>
  );
  // The quality checks, extras and exports of one transcript, shown in the right-hand pane of Coding.
  const transcriptSide = (doc: (typeof documents)[number]) => (
    <div className="flex flex-col gap-3">
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <CodingExtras
                                      key="extras"
                                      runId={id}
                                      documentId={doc.id}
                                      filename={doc.source_filename}
                                    />
                                  )}
                                {doc.kind === "transcript" &&
                                  codingAnalysis.has(doc.id) && (
                                    <TranscriptQualityPanel
                                      key={`coding-quality-${doc.id}-${codingAnalysis.get(doc.id)!.version}`}
                                      runId={id}
                                      title="Quality control"
                                      items={[
                                        {
                                          documentId: doc.id,
                                          filename: doc.source_filename,
                                          view: codingAnalysis.get(doc.id)!,
                                        },
                                      ]}
                                    />
                                  )}
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <a
                                      key="export"
                                      href={`/api/runs/${id}/coding/export`}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-slate-50"
                                    >
                                      Export codebook and coding checks (.xlsx)
                                    </a>
                                  )}
                                {doc.kind === "transcript" &&
                                  codebooksByDocument.has(doc.id) && (
                                    <a
                                      key="extract"
                                      href={`/api/runs/${id}/coding/extract`}
                                      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:bg-slate-50"
                                    >
                                      Themed extract for writing up (.docx)
                                    </a>
                                  )}
    </div>
  );
  const documentsToolbar =
    documents.length > 0 ? (
<div className="flex flex-wrap items-center gap-2">
                    <form action={processRunWithId}>
                      <SubmitButton
                        pendingLabel="Running..."
                        title="Reads the reports, tables and raw data, codes any transcripts, checks the findings and writes the insights. Qual and quant files are analysed together."
                        className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
                        icon={<BoltIcon className="h-4 w-4" />}
                      >
                        Run analysis
                      </SubmitButton>
                      <ProcessProgress runId={id} />
                    </form>
                    <form action={regenerateUnreviewedWithId}>
                      <SubmitButton
                        pendingLabel="Regenerating..."
                        title="Redo every document's extraction, but only replace findings you've rejected -- accepted findings (and everything built on them) are left alone"
                        className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground"
                      >
                        Regenerate rejected
                      </SubmitButton>
                      <ProcessProgress runId={id} />
                    </form>
                    <form action={reprocessAllWithId}>
                      <SubmitButton
                        pendingLabel="Reprocessing..."
                        title="Delete and redo every document's extraction from scratch, including findings you've already accepted or rejected"
                        className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground"
                      >
                        Reprocess all documents
                      </SubmitButton>
                      <ProcessProgress runId={id} />
                    </form>
                  </div>
    ) : null;

  const navSections: RunNavSection[] = [
    { id: "objective", group: "Objectives", label: "Set Objectives" },
    { id: "objectives", group: "Objectives", label: "Review Objectives" },
    { id: "upload", group: "Setup", label: "Import data" },
    {
      id: "crosstabs",
      group: "Analysis",
      label: "Analytics",
      badge: documents.filter((d) => d.kind === "table").length,
    },
    {
      id: "coding",
      group: "Analysis",
      label: "Coding",
      badge: documents.filter((d) => d.kind === "transcript").length,
    },
    {
      id: "reports",
      group: "Analysis",
      label: "Reports and decks",
      badge: documents.filter((d) => d.kind === "report").length,
    },
    {
      id: "findings",
      group: "Findings",
      label: "Findings",
      badge: findings.length,
    },
    {
      id: "synthesized",
      group: "Findings",
      label: "Insights",
      badge: synthesizedInsights.length,
    },
    { id: "decisions", group: decisionGroup, label: "Business decisions" },
    {
      id: "recommendations",
      group: "Decisions",
      label: "Recommendations",
      badge: synthesizedRecommendations.length,
    },
    // Lives in Decisions, not Analysis: generating it draws on the
    // decision statement and on accepted recommendations, both of which
    // sit above it in this same group, not on raw findings analysis alone.
    { id: "insights-report", group: "Decisions", label: "Insights report" },
    { id: "assistant", group: "Tools", label: "Research assistant" },
    // Grouped with Tools, not Analysis, and placed right before API usage &
    // cost: this nav list is meant to mirror the page's own scroll order
    // (see SectionPanel id="working-data" below, which sits directly between
    // the assistant and api-usage panels), and "Analysis" would have put it
    // near the top of the sidebar while the actual section lives at the very
    // bottom of the page -- clicking it jumped the reader straight past
    // everything the sidebar implied came after it.
    { id: "working-data", group: "Tools", label: "Working data" },
    ...(apiUsage.length > 0
      ? [{ id: "api-usage", group: "Tools", label: "API usage & cost" }]
      : []),
  ];
  // The section a researcher lands on: whichever of the workflow's own
  // gating steps (see the reached/done flags above) is next up, falling
  // back to Findings -- the raw evidence, always relevant -- once nothing
  // is pending.
  // A new project starts with context (all optional), then data import;
  // once there are documents, the work is Findings.
  const defaultSectionId =
    documents.length === 0
      ? "objective"
      : findings.length === 0
        ? "upload"
        : "findings";

  timing.bodyBuilt();
  return (
    <FigureChecksProvider checks={figureChecks}>
    <RunSectionProvider
      defaultId={defaultSectionId}
      validIds={navSections.map((s) => s.id)}
    >
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[90rem] px-6 pt-3">
          <PipelineStatus runId={id} />
          <div className="mb-2 flex flex-col items-start gap-y-0.5 text-left">
          <h1 className="text-xl font-bold tracking-tight text-foreground">
            {run.project_name ??
              run.research_objective ??
              run.business_problem ??
              "Untitled project"}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            {run.audience && (
              <>
                <span>Audience: {run.audience}</span>
                <span className="text-border">&middot;</span>
              </>
            )}
            <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              {run.status.replace(/_/g, " ")}
            </span>
            <span className="text-border">&middot;</span>
            <span>Starting point: {startingPointLabel}</span>
          </div>
          </div>

          {/* Program/wave membership is a Documents-page concern (it's
              about this project's identity, not any one analysis step), but
              lived outside every SectionPanel, so it rendered above
              whichever section was selected instead of only on Documents. */}

          {latestProcessErrors && (
            <div className="mb-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              <p className="font-medium">
                The last processing run hit an error on{" "}
                {latestProcessErrors.errors.length === 1
                  ? "one document"
                  : `${latestProcessErrors.errors.length} documents`}
                , at {new Date(latestProcessErrors.occurredAt).toLocaleString()}
                .
              </p>
              <p className="mt-1 text-red-800">
                Whatever succeeded elsewhere in that run still went through;
                only the document(s) below didn&apos;t. Try processing again,
                and if the same error keeps coming back, it&apos;s worth looking
                into rather than retrying.
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-red-800">
                {latestProcessErrors.errors.map((error, index) => (
                  <li key={index} className="break-words">
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendingLegacyConfirmations.map((pending) => {
            const n = pending.findings.length;
            const confirmAction = confirmLegacyReplacementAction.bind(null, id, pending.documentId);
            return (
              <div
                key={pending.documentId}
                className="mb-8 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
              >
                <p className="font-medium">
                  A new reading of {pending.filename} was not applied: {n} existing finding{n === 1 ? "" : "s"}{" "}
                  {n === 1 ? "predates" : "predate"} review tracking.
                </p>
                <p className="mt-1 text-amber-800">
                  Whether a researcher accepted or edited {n === 1 ? "it" : "them"} cannot be established, so every
                  existing finding was kept. Review {n === 1 ? "it" : "them"} under Findings (accepting, rejecting or
                  editing a finding keeps it), or re-read the document and replace exactly the findings below. Replaced
                  findings are archived to history; any that have been reviewed, edited, annotated or used since are
                  kept regardless.
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-800">
                  {pending.findings.slice(0, 5).map((f) => (
                    <li key={f.id} className="break-words">
                      {f.text}
                    </li>
                  ))}
                  {n > 5 && <li>and {n - 5} more</li>}
                </ul>
                <form action={confirmAction} className="mt-3">
                  {pending.findings.map((f) => (
                    <input key={f.id} type="hidden" name="findingId" value={f.id} />
                  ))}
                  <button
                    type="submit"
                    className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100"
                  >
                    Re-read and replace {n === 1 ? "this finding" : `these ${n} findings`}
                  </button>
                </form>
              </div>
            );
          })}
        </div>

        <RunNav sections={navSections} />

        <div className="px-6 pb-6 pt-2">
          <SectionPanel id="upload">
            <ImportDetailProvider>
            <h2 className="mb-0.5 text-lg font-semibold text-foreground">Import data</h2>
            <p className="mb-2 max-w-3xl text-sm text-muted">
              Add files on the left. Everything you have added is listed in the middle, and the right pane
              shows what to do next.
            </p>
            <ThreePane
              wideRight
              left={
                <Pane side="left" title="Add files">
                  <CollapsibleSection
              key={`upload-${uploadDone}`}
              title="Upload documents"
              bare
              icon={<UploadIcon className="h-4 w-4 text-primary" />}
              defaultOpen={!uploadDone}
            >
              <UploadForm runId={id} />
            </CollapsibleSection>
            <StorageCleanupNotice runId={id} />
          
                  
            <div className="rounded-lg border border-dashed border-border bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <ChartIcon className="h-3.5 w-3.5 text-primary" />
                Tracking
              </div>
              {currentProgram ? (
                <div>
                  <p className="text-xs text-foreground">
                    Part of{" "}
                    <Link
                      href="/programs"
                      className="font-medium text-primary hover:underline"
                    >
                      {currentProgram.name}
                    </Link>
                    {run.wave_label ? (
                      <>
                        {" "}
                        as <span className="font-medium">{run.wave_label}</span>
                      </>
                    ) : null}
                    .
                  </p>
                  {programWaves.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
                      {programWaves.map((wave) => (
                        <li key={wave.id}>
                          Other wave:{" "}
                          <Link
                            href={`/runs/${wave.id}`}
                            className="text-foreground hover:text-primary"
                          >
                            {wave.wave_label ?? wave.project_name ?? "Untitled"}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form action={updateProgramLinkWithId} className="mt-3">
                    <input type="hidden" name="action" value="unlink" />
                    <SubmitButton
                      pendingLabel="Removing..."
                      className="w-fit rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
                    >
                      Remove from program
                    </SubmitButton>
                  </form>
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-xs text-muted">
                    Not part of a program yet. If this project is one wave of an
                    ongoing tracking study, link it to a program below, picking
                    an existing one or naming a new one.
                  </p>
                  <form
                    action={updateProgramLinkWithId}
                    className="flex flex-col gap-2"
                  >
                    <label className="block">
                      <span className="text-xs font-medium text-foreground">
                        Existing program
                      </span>
                      <select
                        name="programId"
                        className="mt-1 block w-full rounded-lg border border-border px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">None</option>
                        {programs.map((program) => (
                          <option key={program.id} value={program.id}>
                            {program.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-foreground">
                        Or new program name
                      </span>
                      <input
                        name="newProgramName"
                        placeholder="e.g. Acme Member Satisfaction Tracker"
                        className="mt-1 block w-full rounded-lg border border-border px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-foreground">
                        Wave label
                      </span>
                      <input
                        name="waveLabel"
                        placeholder="e.g. Wave 1"
                        className="mt-1 block w-full rounded-lg border border-border px-2 py-1 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    <SubmitButton
                      pendingLabel="Linking..."
                      className="w-fit rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover"
                    >
                      Link
                    </SubmitButton>
                  </form>
                </div>
              )}
            </div>
          
                </Pane>
              }
              middle={
                <Pane
                  side="middle"
                  title="Documents"
                  badge={
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {documents.filter((d) => d.kind !== "output").length}
                    </span>
                  }
                >
                  {outputSets.length > 0 && (
              <div className="space-y-3">
                <h2 className="text-xl font-semibold text-foreground">
                  Statistical output ({outputSets.length} {outputSets.length === 1 ? "set" : "sets"})
                </h2>
                {outputSets.map((set) => (
                  <OutputSetCard key={set.id} runId={id} set={set} />
                ))}
                {outputSets.length > 1 && <RelatedOutputSets runId={id} sets={outputSets} />}
              </div>
            )}
                  {documents.some((d) => d.kind !== "output") && (
              <div className="">
                <TranscriptSetupTable
                  runId={id}
                  rows={documents.filter((d) => !instrumentHome.has(d.id) && d.kind !== "output").map((d) => ({
                    documentId: d.id,
                    filename: d.source_filename,
                    kind: d.kind,
                    kindLabel: d.kind === "table" && d.ingestion_type === "raw" ? "Raw data" : (DOC_KIND_STYLE[d.kind]?.label ?? d.kind),
                    kindBadge: DOC_KIND_STYLE[d.kind]?.badge ?? "",
                    uploadedAt: d.uploaded_at,
                    isRawData: d.kind === "table" && d.ingestion_type === "raw",
                    dataSetup: dataSetups.get(d.id) ?? null,
                    preview:
                      d.kind === "instrument" || importPreviewIdentities.get(d.id)?.error
                        ? null
                        : d.kind === "table"
                        ? {
                            kind: "tables" as const,
                            // row_count, not rows.length: getDocumentTablePreviews caps a raw
                            // table's rows at a small sample (it can be huge in full), with
                            // row_count holding the true count instead. Filtering or counting by
                            // rows.length here used to always read a raw file's table as having
                            // zero rows - it was filtered out of this list entirely regardless of
                            // its real size, which in turn made TranscriptSetup's `unread` check
                            // see "no tables yet" for every raw import and re-trigger a re-read on
                            // every page load, not only on a genuinely unread file (IMP-010).
                            tables: (documentTablesByDocument.get(d.id) ?? [])
                              .filter((t) => t.table_index < 100 && t.headers.length > 0 && t.row_count > 0)
                              .map((t) => ({
                                label: t.label ?? `Table ${t.table_index + 1}`,
                                headers: t.headers.slice(0, 12),
                                totalColumns: t.headers.length,
                                rows: t.rows.slice(0, 8),
                                totalRows: t.row_count,
                              })),
                          }
                        : documentExcerpts.has(d.id)
                          ? {
                              kind: "text" as const,
                              excerpt: documentExcerpts.get(d.id)!.excerpt,
                              length: documentExcerpts.get(d.id)!.length,
                            }
                          : null,
                    attached: attachedFor(d),
                    quality:
                      importPreviewIdentities.get(d.id)?.error ? (
                        <ImportPreviewRecovery error={importPreviewIdentities.get(d.id)!.error!} />
                      ) : d.kind === "instrument" && instrumentSummaries.has(d.id) ? (
                        <InstrumentCard
                          key="instrument"
                          runId={id}
                          documentId={d.id}
                          summary={instrumentSummaries.get(d.id)!}
                          dataDocs={
                            instrumentSummaries.get(d.id)!.type === "questionnaire" ||
                            instrumentSummaries.get(d.id)!.type === null
                              ? documents
                                  .filter((x) => x.kind === "table" && x.ingestion_type === "raw")
                                  .map((x) => ({ id: x.id, name: x.source_filename }))
                              : []
                          }
                        />
                      ) : d.kind === "transcript" && transcriptQuality.has(d.id) ? (
                        <details key="data-quality" className="rounded-lg border border-border bg-white p-3">
                          <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
                            Data quality
                          </summary>
                          <div className="mt-3">
                            <TranscriptImportQualityPanel q={transcriptQuality.get(d.id)!} />
                          </div>
                        </details>
                      ) : d.kind === "table" &&
                        d.ingestion_type !== "raw" &&
                        (documentTablesByDocument.get(d.id) ?? []).length > 0 ? (
                        <details key="data-quality" className="rounded-lg border border-border bg-white p-3">
                          <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
                            Data quality
                          </summary>
                          <div className="mt-3">
                            <AggregatedQualityPanel
                              q={computeAggregatedQuality(
                                (documentTablesByDocument.get(d.id) ?? [])
                                  .filter((t) => t.table_index < 100)
                                  .map((t) => ({ label: t.label, headers: t.headers, rows: t.rows })),
                              )}
                            />
                          </div>
                        </details>
                      ) : d.kind === "table" &&
                        importQualityTables.some((t) => t.documentId === d.id) ? (
                        <div key="data-quality" className="flex flex-col gap-3">
                          <details className="rounded-lg border border-border bg-white p-3">
                            <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
                              Data quality
                            </summary>
                            <div className="mt-3">
                              <ImportQualityPanel
                                tables={importQualityTables.filter((t) => t.documentId === d.id)}
                                hasReportOnly={false}
                              />
                              {d.ingestion_type === "raw" && <DataAuditPanel runId={id} documentId={d.id} />}
                            </div>
                          </details>
                          <details className="rounded-lg border border-border bg-white p-3">
                            <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
                              Variables
                            </summary>
                            <div className="mt-3">
                              <ImportVariablesPanel
                                runId={id}
                                tables={importQualityTables.filter((t) => t.documentId === d.id)}
                              />
                            </div>
                          </details>
                        </div>
                      ) : null,
                    detail:
                      d.kind === "instrument"
                        ? "Read for its questions, then linked to your data or transcripts. Nothing is applied until you confirm the links."
                        : d.kind === "table"
                        ? d.ingestion_type === "raw"
                          ? "Case-level data. Tables are built in Analysis, Analytics once you accept it here."
                          : "Already-aggregated table, read as it is."
                        : d.kind === "report"
                          ? "Report, read for the findings it states."
                          : "Context for the project, not mined for findings.",
                    initial: transcriptSetups.get(d.id) ?? null,
                    suggestion: setupSuggestions.get(d.id) ?? null,
                    hasCoding: codebooksByDocument.has(d.id),
                    accent:
                      DOC_ACCENTS[documents.indexOf(d) % DOC_ACCENTS.length],
                    deleteAction: deleteDocument.bind(null, id, d.id),
                    deleteConfirm: deleteDocumentConfirmation(impactFor(deletionImpact, d.id)),
                  }))}
                />
              </div>
            )}
                  {documents.length === 0 && outputSets.length === 0 && (
                    <p className="text-sm text-muted">Nothing here yet. Drop a report, data table or transcript on the left.</p>
                  )}
                </Pane>
              }
              right={
                <Pane side="right" title="Selected file">
                  <SelectedFileDetail />
                  <div className="h-px shrink-0 bg-border" />
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        ["Reports", documents.filter((d) => d.kind === "report").length],
                        ["Data tables", documents.filter((d) => d.kind === "table").length],
                        ["Transcripts", documents.filter((d) => d.kind === "transcript").length],
                      ] as const
                    ).map(([label, n]) => (
                      <div key={label} className="rounded-lg border border-border bg-slate-50 px-2.5 py-2">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                        <div className="mt-0.5 text-lg font-semibold leading-none text-foreground">{n}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-foreground">
                    <span className="font-semibold">{findings.length}</span>{" "}
                    {findings.length === 1 ? "finding" : "findings"} so far
                  </div>
                  {documents.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white p-4">
                <p className="max-w-2xl text-xs text-muted">
                  Files are read and accepted as they arrive. Next, build tables in Analysis, Analytics, code
                  transcripts under Coding, or run the full analysis from Findings.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <GoToSection id="crosstabs">Open Analysis</GoToSection>
                </div>
              </div>
            )}
                </Pane>
              }
            />
            </ImportDetailProvider>
          </SectionPanel>

          <SectionPanel id="objective">
            <h2 className="mb-0.5 text-lg font-semibold text-foreground">Set up objectives</h2>
            <p className="mb-2 max-w-3xl text-sm text-muted">
              Add the business problem and your own objectives, or import them from a brief or proposal.
              They are scored and checked against the evidence on the Objectives page.
            </p>
            <ThreePane
              left={
                <Pane side="left" title="Objective and context">
                  <RunContextForm
                    runId={id}
                    businessProblem={run.business_problem}
                    objective={run.stated_objectives_text}
                    audience={run.audience}
                  />
                </Pane>
              }
              middle={
                <Pane side="middle" title="Your objectives">
                  <StatedObjectivesList
                    runId={id}
                    lines={parseObjectiveLines(run.stated_objectives_text)}
                  />
                  <p className="text-xs text-muted">
                    Quality scores, the evidence check and suggested objectives are on the{" "}
                    <GoToSection id="objectives">Review page</GoToSection>.
                  </p>
                </Pane>
              }
            />
          </SectionPanel>

          <SectionPanel id="objectives">
            <h2 className="mb-0.5 text-lg font-semibold text-foreground">Review objectives</h2>
            <p className="mb-2 max-w-3xl text-sm text-muted">
              Pick an objective to see its quality score and what the evidence says about it. With none picked,
              the middle shows every objective scored side by side.
            </p>
            <ObjectiveSelectionProvider>
              <ThreePane
                left={
                  <Pane side="left" title="Objectives">
                    <ObjectiveList
                      rows={objectiveRows}
                      verdicts={objectiveValidations.map((v) => ({
                        item_text: v.item_text,
                        status: v.status,
                        inferred: v.inferred,
                      }))}
                    />
                  </Pane>
                }
                middle={
                  <Pane side="middle" title="Objective detail">
                    <ObjectiveMiddle runId={id} rows={objectiveRows} overview={objectiveReviewList} />
                  </Pane>
                }
                right={
                  <Pane side="right" title="Objective review">
                    <ObjectiveCoverage
                      runId={id}
                      validations={objectiveValidations}
                      insights={synthesizedInsights.map((i) => ({
                        id: i.id,
                        headline: i.headline,
                        review_status: i.review_status,
                      }))}
                      hasObjectiveOrDecision={Boolean(
                      (run.research_objective && run.research_objective.trim()) ||
                        (run.decision_statement && run.decision_statement.trim()),
                    )}
                    />
                    <ObjectiveEvidence
                      runId={id}
                      dataFiles={documents
                        .filter(
                          (d) =>
                            d.kind === "table" &&
                            (isStatsFileName(d.source_filename) ||
                              (d.ingestion_type === "raw" && isCaseTableFileName(d.source_filename))),
                        )
                        .map((d) => ({ id: d.id, name: d.source_filename }))}
                      hasObjectiveOrDecision={Boolean(
                      (run.research_objective && run.research_objective.trim()) ||
                        (run.decision_statement && run.decision_statement.trim()),
                    )}
                    />
                  </Pane>
                }
              />
            </ObjectiveSelectionProvider>
          </SectionPanel>

          <SectionPanel id="crosstabs">
            <DocumentPicker
              title="Data files"
              empty="No data files yet. Add a survey data file or a table under Import data."
              rightTitle="Before you build tables"
              items={documents
                .filter((d) => d.kind === "table")
                .map((d) => {
                  const saved = (documentTablesByDocument.get(d.id) ?? []).filter((t) => t.table_index >= 100).length;
                  return {
                    id: d.id,
                    name: d.source_filename,
                    meta: d.ingestion_type === "raw" ? "Case-level data" : "Aggregated tables",
                    badge: saved > 0 ? `${saved} table${saved === 1 ? "" : "s"}` : undefined,
                    node: documentCards("table", true, d.id),
                  };
                })}
              accents={documents
                .filter((d) => d.kind === "table")
                .map((d) => DOC_ACCENTS[documents.indexOf(d) % DOC_ACCENTS.length].border)}
              right={
                <>
                  <p className="text-sm text-muted">
                    Survey and other numeric data. Build tables here, commit the ones worth keeping, and
                    their comparisons flow into Findings.
                  </p>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Case-level data is not compared automatically. Every comparison is flagged as uncorrected
                    for multiple comparisons and assumes simple random sampling. Complex survey designs are not
                    applied yet.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-white px-3 py-2">
                      <div className="text-lg font-semibold text-foreground">
                        {documents.filter((d) => d.kind === "table").length}
                      </div>
                      <div className="text-xs text-muted">Data files</div>
                    </div>
                    <div className="rounded-lg border border-border bg-white px-3 py-2">
                      <div className="text-lg font-semibold text-foreground">{findings.length}</div>
                      <div className="text-xs text-muted">Findings so far</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    Open the crosstab workspace to see the full variable list beside the table you are
                    building. Analyses (drivers, segments) are run from the same file.
                  </p>
                </>
              }
            />
          </SectionPanel>

          <SectionPanel id="coding">
            <DocumentPicker
              title="Transcripts"
              empty="No transcripts yet. Add one under Import data."
              rightTitle="Quality and exports"
              items={documents
                .filter((d) => d.kind === "transcript")
                .map((d) => {
                  const view = codingAnalysis.get(d.id);
                  const confirmed = transcriptSetups.get(d.id)?.confirmed ?? false;
                  return {
                    id: d.id,
                    name: d.source_filename,
                    meta: codebooksByDocument.has(d.id) ? "Coded" : confirmed ? "Ready to code" : "Needs set-up",
                    badge: view ? "Analysed" : undefined,
                    node: documentCards("transcript", true, d.id, true),
                    side: transcriptSide(d),
                  };
                })}
              accents={documents
                .filter((d) => d.kind === "transcript")
                .map((d) => DOC_ACCENTS[documents.indexOf(d) % DOC_ACCENTS.length].border)}
              right={
                <p className="text-xs text-muted">
                  Interviews and group discussions. Code the themes in the middle, and the coded themes
                  flow into Findings.
                </p>
              }
            />
            {codingAnalysis.size > 1 && (
              <div className="mt-4">
                <AcrossTranscripts
                  rows={crossTranscriptThemes(codingAnalysis)}
                  documentNames={Object.fromEntries(
                    documents.map((d) => [d.id, d.source_filename]),
                  )}
                  runId={id}
                />
              </div>
            )}
          </SectionPanel>

          <SectionPanel id="reports">
            <ThreePane
              left={
                <Pane side="left" title="About reports and decks">
                  <p className="text-sm text-muted">
                    Written reports and presentations. Extract the claims they make, which are then
                    checked in Findings.
                  </p>
                  <p className="text-xs text-muted">
                    Add more under Import. Each card has its own Extract findings and Run again
                    buttons.
                  </p>
                </Pane>
              }
              middle={
                <Pane
                  side="middle"
                  title="Reports and decks"
                  badge={
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {documents.filter((d) => d.kind === "report").length}
                    </span>
                  }
                >
                  {!documents.some((d) => d.kind === "report") ? (
                    <p className="text-sm text-muted">
                      No reports yet. Add one under Import data.
                    </p>
                  ) : (
                    documentCards("report", true)
                  )}
                </Pane>
              }
              right={
                <Pane side="right" title="At a glance">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg border border-border bg-white px-3 py-2">
                      <div className="text-lg font-semibold text-foreground">
                        {documents.filter((d) => d.kind === "report").length}
                      </div>
                      <div className="text-xs text-muted">Reports and decks</div>
                    </div>
                    <div className="rounded-lg border border-border bg-white px-3 py-2">
                      <div className="text-lg font-semibold text-foreground">
                        {findings.length}
                      </div>
                      <div className="text-xs text-muted">Findings so far</div>
                    </div>
                  </div>
                  <p className="text-xs text-muted">
                    Findings from every report and table are reviewed together under Findings.
                  </p>
                </Pane>
              }
            />
          </SectionPanel>

          <SectionPanel id="findings">
            <h2 className="mb-0.5 text-lg font-semibold text-foreground">
              Findings
            </h2>
            <p className="mb-2 max-w-3xl text-sm text-muted">
              Every claim in one place: comparisons from committed tables, themes from coding, and
              claims extracted from reports.
            </p>
            {documentsToolbar && <div className="mb-4">{documentsToolbar}</div>}
            <WorkingDataTabs
              tabs={[
                {
                  id: "findings",
                  label: `Findings (${findings.length})`,
                  content: findingsSection,
                },
                {
                  id: "report-claims",
                  label: `Report claims${statedInsightValidations.length > 0 ? ` (${statedInsightValidations.length})` : ""}`,
                  content: (
                    <>
                      {statedInsightValidationsSection}
                      <ClaimTableChecks runId={id} />
                    </>
                  ),
                },
              ]}
            />
          </SectionPanel>


          <SectionPanel id="synthesized">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Synthesized insights
            </h2>
            {synthesizedInsightsSection}
          </SectionPanel>

          <SectionPanel id="decisions">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Business decisions
            </h2>
            {decisionSection}
          </SectionPanel>

          <SectionPanel id="recommendations">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Recommendations
            </h2>
            {recommendationsSection}
          </SectionPanel>

          <SectionPanel id="insights-report">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Insights report
            </h2>
            {storyReportSection}
          </SectionPanel>

          <SectionPanel id="assistant">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Research assistant
            </h2>
            <ResearchAssistantCard
              key="research-assistant"
              runId={id}
              initialMessages={assistantMessages}
              hasReport={Boolean(storyNarrative)}
            />
          </SectionPanel>

          <SectionPanel id="working-data">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              Working data
            </h2>
            {workingDataSection}
          </SectionPanel>

          <SectionPanel id="api-usage">
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              API usage &amp; cost
            </h2>
            {apiUsage.length > 0 && (
              <CollapsibleSection
                key="api-usage"
                title="API usage & cost"
                bare
                icon={<ChartIcon className="h-4 w-4 text-primary" />}
                defaultOpen={false}
              >
                <p className="mb-3 text-xs text-muted">
                  Every Claude call this run has made, by agent. Cost is an
                  estimate at Sonnet 5&apos;s current published pricing ($2/MTok
                  input, $10/MTok output), not a reconciliation against your
                  Anthropic invoice.
                </p>

                {apiUsageBatches.length > 0 && (
                  <div className="mb-5">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Cost per run
                    </h4>
                    <p className="mb-3 text-xs text-muted">
                      One row per time you clicked a processing action on this
                      run, most recent first.
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
                            <th className="py-1.5 pr-4">Action</th>
                            <th className="py-1.5 pr-4">When</th>
                            <th className="py-1.5 pr-4">Calls</th>
                            <th className="py-1.5 pr-4">Input tokens</th>
                            <th className="py-1.5 pr-4">Output tokens</th>
                            <th className="py-1.5 pr-4">Est. cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {apiUsageBatches.map((batch) => (
                            <tr
                              key={batch.batch_id}
                              className="border-b border-border last:border-0"
                            >
                              <td className="py-1.5 pr-4 text-foreground">
                                {apiUsageBatchModeLabel[batch.mode] ??
                                  batch.mode}
                              </td>
                              <td className="py-1.5 pr-4 whitespace-nowrap text-foreground">
                                {new Date(batch.started_at).toLocaleString()}
                              </td>
                              <td className="py-1.5 pr-4 text-foreground">
                                {batch.calls.toLocaleString()}
                              </td>
                              <td className="py-1.5 pr-4 text-foreground">
                                {batch.input_tokens.toLocaleString()}
                              </td>
                              <td className="py-1.5 pr-4 text-foreground">
                                {batch.output_tokens.toLocaleString()}
                              </td>
                              <td className="py-1.5 pr-4 text-foreground">
                                $
                                {estimateCostUsd(
                                  batch.input_tokens,
                                  batch.output_tokens,
                                ).toFixed(3)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  All-time total, by agent
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs font-semibold uppercase tracking-wide text-muted">
                        <th className="py-1.5 pr-4">Agent</th>
                        <th className="py-1.5 pr-4">Calls</th>
                        <th className="py-1.5 pr-4">Input tokens</th>
                        <th className="py-1.5 pr-4">Output tokens</th>
                        <th className="py-1.5 pr-4">Est. cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiUsage.map((row) => (
                        <tr
                          key={row.agent}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-1.5 pr-4 text-foreground">
                            {apiUsageAgentLabel[row.agent] ?? row.agent}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground">
                            {row.calls.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground">
                            {row.input_tokens.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground">
                            {row.output_tokens.toLocaleString()}
                          </td>
                          <td className="py-1.5 pr-4 text-foreground">
                            $
                            {estimateCostUsd(
                              row.input_tokens,
                              row.output_tokens,
                            ).toFixed(3)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold text-foreground">
                        <td className="py-1.5 pr-4">Total</td>
                        <td className="py-1.5 pr-4">
                          {apiUsage
                            .reduce((sum, row) => sum + row.calls, 0)
                            .toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4">
                          {apiUsage
                            .reduce((sum, row) => sum + row.input_tokens, 0)
                            .toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4">
                          {apiUsage
                            .reduce((sum, row) => sum + row.output_tokens, 0)
                            .toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-4">
                          $
                          {estimateCostUsd(
                            apiUsage.reduce(
                              (sum, row) => sum + row.input_tokens,
                              0,
                            ),
                            apiUsage.reduce(
                              (sum, row) => sum + row.output_tokens,
                              0,
                            ),
                          ).toFixed(3)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CollapsibleSection>
            )}
          </SectionPanel>
        </div>
      </main>
    </RunSectionProvider>
    </FigureChecksProvider>
  );
}

const apiUsageAgentLabel: Record<string, string> = {
  extract_findings: "Extract findings (report)",
  extract_themes: "Extract themes (transcript)",
  generate_findings_table: "Generate findings (table)",
  extract_document_tables: "Extract tables (Word/PDF)",
  objective_framer: "Objective framer",
  decision_framer_synthesis: "Decision framer (evidence synthesis)",
  decision_framer_candidates: "Decision framer (candidates)",
  verify_findings: "Verify findings",
  insight_generator: "Insight generator",
  insight_quality_scorer: "Insight quality scorer",
  recommendation_agent: "Recommendation agent",
  story_narrative: "Insights Report narrative",
  objective_validator: "Objective & decision validator",
  brief_intake: "Brief intake",
};

const findingHistoryReasonLabel: Record<string, string> = {
  regenerate_unreviewed: "Regenerate rejected",
  full_reprocess: "Reprocess all documents",
  manual_reextract: "Manual re-extract",
  wave_recompare: "Wave comparison re-run",
};

const findingHistoryStatusLabel: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

const apiUsageBatchModeLabel: Record<string, string> = {
  new: "Process new documents",
  unreviewed: "Regenerate rejected",
  all: "Reprocess all documents",
  single_document: "Retry one document",
};
