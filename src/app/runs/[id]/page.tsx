import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { withTenant, withTenantRead } from "@/lib/db";
import { extractFindingsFromDocument } from "@/lib/extractFindings";
import { processTableDocument } from "@/lib/documentTables";
import { generateFindingsFromBannerPlan } from "@/lib/generateFindingsFromBannerPlan";
import {
  extractThemesFromTranscript,
  reapplyCodebook,
  type CodebookEdit,
} from "@/lib/extractThemes";
import { detectDuplicateFindings } from "@/lib/dedupe";
import { mapWithConcurrency } from "@/lib/concurrency";
import { deleteDocument } from "@/lib/documentActions";
import { storeUploadedDocument } from "@/lib/documentUpload";
import { generateDecisionCandidates } from "@/lib/decisionFramer";
import { generateObjectiveCandidates } from "@/lib/objectiveFramer";
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
import ObjectiveBriefReview from "./ObjectiveBriefReview";
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
} from "./RunShell";
import type { FindingKind } from "@/lib/findingActions";
import DeleteDocumentButton from "@/app/DeleteDocumentButton";
import SubmitButton from "@/components/SubmitButton";
import ProcessProgress from "./ProcessProgress";
import PipelineStatus from "./PipelineStatus";
import WorkingDataTabs from "./WorkingDataTabs";
import ImportQualityPanel from "./ImportQualityPanel";
import TranscriptQualityPanel from "./TranscriptQualityPanel";
import CodebookPanel, { type CodebookView } from "./CodebookPanel";
import CodingAnalysisPanel from "./CodingAnalysisPanel";
import TranscriptSetupTable, {
  CodeGate,
  MODE_LABEL,
  SESSION_LABEL,
} from "./TranscriptSetup";
import {
  findUnconfirmedTranscripts,
  getSetupSuggestions,
  getTranscriptSetups,
  SETUP_NEEDED_MESSAGE,
} from "@/lib/transcriptSetup";
import ObjectiveQualityPanel, {
  type ObjectiveQualityRow,
} from "./ObjectiveQualityPanel";
import { parseNumberedItems } from "@/lib/text";
import {
  getCodingAnalysis,
  getFindingCodingCounts,
} from "@/lib/codingAnalysis";
import FindingsTable from "./FindingsTable";
import TableDigest from "./TableDigest";
import ResearchAssistantCard, {
  type AssistantChatMessage,
} from "./ResearchAssistantCard";
import {
  ArrowLeftIcon,
  UploadIcon,
  BoltIcon,
  DocumentIcon,
  ChartIcon,
  GridIcon,
  DownloadIcon,
  PresentationIcon,
  TranscriptIcon,
  ListIcon,
  SparkleIcon,
  TargetIcon,
  CheckIcon,
  ChatIcon,
  BookIcon,
  InfoIcon,
} from "@/components/icons";
import FileInput from "@/components/FileInput";
import {
  computeCrossTabPreview,
  type CrossTabPreviewTable,
} from "@/lib/crossTabPreview";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

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
const objectiveRefreshesInFlight = new Set<string>();
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
  program_id: string | null;
  wave_label: string | null;
};

type Document = {
  id: string;
  kind: "report" | "table" | "evidence" | "transcript";
  source_filename: string;
  uploaded_at: string;
  ingestion_type: "raw" | "aggregated" | null;
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
};

async function getRun(runId: string): Promise<Run | null> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Run>(
      `select id, project_name, business_problem, research_objective, decision_statement,
              evidence_synthesis, audience, status, entry_point, initial_research_objective,
              program_id, wave_label
       from runs where id = $1`,
      [runId],
    );
    return result.rows[0] ?? null;
  });
}

type Program = {
  id: string;
  name: string;
};

async function getPrograms(): Promise<Program[]> {
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

async function getDocuments(runId: string): Promise<Document[]> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Document>(
      "select id, kind, source_filename, uploaded_at, ingestion_type from documents where run_id = $1 order by uploaded_at desc",
      [runId],
    );
    return result.rows;
  });
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
  try {
    return await withTenantRead(TENANT_ID, async (client) => {
      const result = await client.query<DocumentTablePreview>(
        `select id, document_id, table_index, label, source_page, headers, rows,
                ingestion_type, banner_columns, stub_columns
         from document_tables
         where run_id = $1
         order by document_id, table_index`,
        [runId],
      );
      return result.rows;
    });
  } catch {
    return [];
  }
}

/**
 * The codebook now in force for each coded transcript, with how many turns
 * and speakers each code rests on and what the open coding passes recorded.
 * Wrapped in try/catch for the same reason getDocumentTablePreviews is: the
 * coding tables only exist once migration 0043 has been applied.
 */
async function getCodebooks(runId: string): Promise<Map<string, CodebookView>> {
  const out = new Map<string, CodebookView>();
  try {
    await withTenantRead(TENANT_ID, async (client) => {
      const books = await client.query<{
        id: string;
        document_id: string;
        version: number;
        source: "induced" | "edited";
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
        source: "induced" | "edited";
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
            .map(({ codebook_id: _codebookId, ...c }) => c),
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

async function getFindings(runId: string): Promise<Finding[]> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<Finding>(
      `select c.id, c.origin, c.finding_text, c.finding_kind, c.theme, c.status,
              coalesce(d1.source_filename, d2.source_filename) as source_filename,
              c.source_page, c.quote_verified, c.source_document_id, c.source_table_id,
              c.source_cells, c.duplicate_group_id, c.researcher_note, c.data_type,
              c.pattern_type, c.stated_stats, c.created_at::text as created_at,
              c.reproduced_runs, c.total_runs, c.supporting_segments, c.supporting_speakers, c.quote_match,
              exists (select 1 from findings g where g.grounded_by_finding_id = c.id) as corroborates_report_claim,
              exists (select 1 from finding_contradictions fc where fc.original_finding_id = c.id) as is_contradicted,
              exists (select 1 from finding_contradictions fc where fc.contradicting_finding_id = c.id) as contradicts_report
       from findings c
       left join documents d1 on d1.id = c.source_document_id
       left join documents d2 on d2.id = c.source_table_id
       where c.run_id = $1
       order by c.created_at`,
      [runId],
    );
    return result.rows;
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
};

// Sorted by quality_score first (highest first, unscored insights last via
// nulls last) so the insights most worth a researcher's attention surface
// at the top of each theme, then by theme and creation order as before.
// This is purely a sort, nothing here filters an insight out: an insight
// that hasn't been scored yet, or that scored low, still appears, it just
// sorts lower.
async function getInsights(runId: string): Promise<InsightRow[]> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<InsightRow>(
      `select i.id, i.headline, i.observation, i.tension, i.implication, i.decision_context,
              f.finding_text, f.theme, v.verdict_tier, v.verification_basis,
              (f.origin in ('stated', 'coded')
                or exists (select 1 from findings g where g.grounded_by_finding_id = f.id)) as from_report,
              coalesce(v.statistical_checks->'caveats', '[]'::jsonb) as caveats
       from insights i
       join findings f on f.id = i.finding_id
       join verdicts v on v.finding_id = f.id
       where i.run_id = $1
       order by f.theme nulls last, i.created_at`,
      [runId],
    );
    return result.rows;
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
): Promise<SynthesizedInsightRow[]> {
  const rows = await withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<SynthesizedInsightQueryRow>(
      `select si.id, si.headline, si.observation, si.tension, si.implication, si.action_plan_status,
              si.triangulation_count, si.source_theme_count, si.materiality_rationale, si.confidence_tier,
              si.review_status, si.why_score, si.actionability_score, si.novelty_score, si.synthesis_score,
              si.evidentiary_score, si.quality_score, si.quality_tier, si.quality_rationale,
              si.stability_testable_count, si.stability_reappeared_count, si.stability_checked_at::text,
              array_agg(pi.headline order by pi.created_at) as source_headlines,
              array_agg(
                case when pf.origin in ('stated', 'coded')
                       or exists (select 1 from findings g where g.grounded_by_finding_id = pf.id)
                     then 'validated' else 'net_new' end
                order by pi.created_at
              ) as member_discovery_types
       from synthesized_insights si
       join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       join insights pi on pi.id = s.pre_insight_id
       join findings pf on pf.id = pi.finding_id
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

  return rows.map(({ member_discovery_types, ...row }) => ({
    ...row,
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
type VerdictSummary = {
  verdictedCount: number;
  passedCount: number;
};

async function getVerdictSummary(runId: string): Promise<VerdictSummary> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<{ tier: string; count: string }>(
      `select v.verdict_tier as tier, count(*) as count
       from verdicts v
       join findings f on f.id = v.finding_id
       where f.run_id = $1
       group by v.verdict_tier`,
      [runId],
    );
    let verdictedCount = 0;
    let passedCount = 0;
    for (const row of result.rows) {
      const count = Number(row.count);
      verdictedCount += count;
      if (row.tier === "robust" || row.tier === "use_with_caution") {
        passedCount += count;
      }
    }
    return { verdictedCount, passedCount };
  });
}

type FailedVerdictSample = {
  finding_text: string;
  verdict_tier: string;
  rationale: string;
};

// A count alone ("0 of 58 passed") says something is off but not what,
// verification is a model judgment call, not a fixed rule, so seeing a
// couple of its actual rationales is the fastest way to tell "this
// evidence genuinely is that weak" apart from "the verifier is being
// unreasonably strict here". Only worth fetching when nothing passed at
// all; once some findings are passing, the ones that didn't are a much
// less urgent question.
async function getSampleFailedVerdicts(
  runId: string,
): Promise<FailedVerdictSample[]> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<FailedVerdictSample>(
      `select f.finding_text, v.verdict_tier, v.rationale
       from verdicts v
       join findings f on f.id = v.finding_id
       where f.run_id = $1 and v.verdict_tier in ('not_supported', 'insufficient_information')
       order by v.id
       limit 3`,
      [runId],
    );
    return result.rows;
  });
}

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
       left join verdicts v on v.finding_id = f.id
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

async function getLatestTraceMessage(
  runId: string,
  events: string[],
): Promise<string | null> {
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
): Promise<SynthesizedRecommendation[]> {
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<SynthesizedRecommendation>(
      `select r.id, r.synthesized_insight_id, si.headline as synthesized_insight_headline, r.action_text,
              r.owner_role, r.owner_feasibility_note, r.timeline, r.metric, r.priority,
              r.assumptions_and_risks, r.alternatives_considered, r.source, r.status, r.edited,
              si.confidence_tier, si.quality_score, si.quality_tier
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1
         and r.synthesized_insight_id is not null
       order by si.quality_score desc nulls last, r.created_at`,
      [runId],
    );
    return result.rows;
  });
}

type ParkedInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  action_plan_status: "has_action" | "retained_no_action";
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
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<ParkedInsight>(
      `select si.id, si.headline, si.observation, si.tension, si.implication, si.action_plan_status
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
  return withTenantRead(TENANT_ID, async (client) => {
    const result = await client.query<ObjectiveValidation>(
      `select item_kind, item_order, item_text, status, conclusion, synthesized_insight_ids
       from objective_validations
       where run_id = $1
       order by item_kind, item_order`,
      [runId],
    );
    return result.rows;
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
async function refreshObjectiveCandidates(runId: string) {
  try {
    await generateObjectiveCandidates(TENANT_ID, runId);
  } catch (error) {
    await withTenant(TENANT_ID, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'objective_framer_error', $3)`,
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

async function refreshDecisionCandidates(runId: string) {
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
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    await extractFindingsFromDocument(TENANT_ID, runId, documentId);
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
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
 * Captures the banner plan for one raw document_tables row: which columns
 * are the banner (segmenting/breaking variables, e.g. Gender, Age band)
 * and which are the stub (outcome measures), picked from that table's own
 * headers rather than typed freehand, so there's no mismatch between what
 * was named and what the table actually contains. Per the 2026-10-04
 * decision, every category within a named banner column is compared
 * against every other by default once the dedicated statistical path
 * reads this, naming a column is the only discipline needed, not naming
 * individual comparison pairs within it.
 *
 * Schema-only consumer for now: nothing downstream reads banner_columns or
 * stub_columns yet, since the banner-plan-driven statistical service
 * itself hasn't been built. This just gives a raw table's plan somewhere
 * real to live, and a visible confirmation that it was captured, while
 * that table sits in the table_awaiting_statistical_path state (see
 * generateFindingsFromTable.ts).
 */
async function saveBannerPlanAction(
  runId: string,
  documentTableId: string,
  formData: FormData,
) {
  "use server";
  const bannerColumns = formData
    .getAll("bannerColumns")
    .map(String)
    .filter(Boolean);
  const stubColumns = formData
    .getAll("stubColumns")
    .map(String)
    .filter(Boolean);
  const strataColumn = String(formData.get("strataColumn") ?? "").trim();
  const weightColumn = String(formData.get("weightColumn") ?? "").trim();
  const samplingDesign =
    strataColumn || weightColumn
      ? {
          strataColumn: strataColumn || null,
          weightColumn: weightColumn || null,
        }
      : null;

  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      `update document_tables
       set banner_columns = $1, stub_columns = $2, sampling_design = $3
       where id = $4 and run_id = $5`,
      [
        JSON.stringify(bannerColumns),
        JSON.stringify(stubColumns),
        JSON.stringify(samplingDesign),
        documentTableId,
        runId,
      ],
    );
  });

  revalidatePath(`/runs/${runId}`);
}

async function generateFindingsAction(runId: string, documentId: string) {
  "use server";
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    await processTableDocument(TENANT_ID, runId, documentId);
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
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
 * The raw-table counterpart to generateFindingsAction: runs the
 * pre-specified banner x stub comparisons (generateFindingsFromBannerPlan,
 * bannerPlanComputation.ts) against a raw document_tables row instead of
 * processTableDocument's exploratory scan, then feeds whatever findings
 * come out through the same verify -> insight -> decision chain every
 * other generation path uses, so a banner-plan finding is reviewed,
 * verified, and synthesized exactly like any other.
 */
async function computeBannerPlanAction(runId: string, documentTableId: string) {
  "use server";
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    await generateFindingsFromBannerPlan(TENANT_ID, runId, documentTableId);
  } catch (error) {
    await recordSingleDocumentError(runId, documentTableId, error);
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
  await stampSingleDocumentBatch(runId, "single_document");
  try {
    await reapplyCodebook(TENANT_ID, runId, documentId, codes);
  } catch (error) {
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
    await extractThemesFromTranscript(TENANT_ID, runId, documentId);
  } catch (error) {
    await recordSingleDocumentError(runId, documentId, error);
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
 * Wipes and redoes verification for every finding on this run, then lets
 * that ripple forward into insights and recommendations. A direct
 * researcher action for a run stuck with bad verdicts (see
 * reverifyFindings's own comment), not something triggered automatically,
 * so it stays a deliberate, visible reset rather than something that could
 * silently fire on every page load.
 */
async function reverifyFindingsAction(runId: string) {
  "use server";
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
                where (d.kind = 'table' and f.source_table_id = d.id)
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
          await extractFindingsFromDocument(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
        } else if (doc.kind === "table") {
          await processTableDocument(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
        } else if (doc.kind === "transcript") {
          await extractThemesFromTranscript(TENANT_ID, runId, doc.id, {
            onlyReplacePending,
            archiveReason,
          });
        }
        // "evidence" documents are not processed by either agent yet.
      } catch (error) {
        errors.push(
          `${doc.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
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

async function uploadDocument(runId: string, formData: FormData) {
  "use server";
  const reportFiles = (formData.getAll("reportFiles") as File[]).filter(
    (file) => file.size > 0,
  );
  const tableFiles = (formData.getAll("tableFiles") as File[]).filter(
    (file) => file.size > 0,
  );
  const rawTableFiles = (formData.getAll("rawTableFiles") as File[]).filter(
    (file) => file.size > 0,
  );
  const transcriptFiles = (formData.getAll("transcriptFiles") as File[]).filter(
    (file) => file.size > 0,
  );

  if (
    reportFiles.length +
      tableFiles.length +
      rawTableFiles.length +
      transcriptFiles.length ===
    0
  ) {
    return;
  }

  await Promise.all([
    ...reportFiles.map((file) =>
      storeUploadedDocument(TENANT_ID, runId, "report", file),
    ),
    ...tableFiles.map((file) =>
      storeUploadedDocument(TENANT_ID, runId, "table", file, "aggregated"),
    ),
    ...rawTableFiles.map((file) =>
      storeUploadedDocument(TENANT_ID, runId, "table", file, "raw"),
    ),
    ...transcriptFiles.map((file) =>
      storeUploadedDocument(TENANT_ID, runId, "transcript", file),
    ),
  ]);

  revalidatePath(`/runs/${runId}`);
}

/**
 * A quick, non-statistical look at a saved banner plan's shape, rendered
 * right below it once both sides have at least one column (see
 * computeCrossTabPreview for why a continuous stub gets a group-summary
 * table here instead of a frequency grid). This is purely descriptive --
 * nothing here runs a significance test or writes a finding -- so a
 * degenerate column choice (a near-unique continuous measure ticked as a
 * banner, say) is visible before "Compute banner comparisons" turns it
 * into hundreds of meaningless findings.
 */
function CrossTabPreviewSection({
  tables,
}: {
  tables: CrossTabPreviewTable[];
}) {
  if (tables.length === 0) return null;
  return (
    <details
      open
      className="mt-2 rounded-lg border border-border bg-white p-2 text-[11px]"
    >
      <summary className="cursor-pointer select-none font-medium text-foreground">
        Preview cross-tabs ({tables.length})
      </summary>
      <p className="mt-1 text-muted">
        Every banner x stub pairing in this plan, counts and averages only, no
        significance testing. Check this before computing: a banner or stub
        column that looks sparse or near-unique here will produce the same kind
        of noise once comparisons actually run.
      </p>
      <div className="mt-2 space-y-4">
        {tables.map((table) => {
          const bannerIsTooGranular = table.bannerTruncated;
          return (
            <div key={`${table.bannerColumn}__${table.stubColumn}`}>
              <p className="mb-1 font-medium text-foreground">
                {table.bannerColumn} &times; {table.stubColumn}
              </p>
              {table.kind === "categorical" && table.bannerIsContinuous && (
                <p className="mb-1 rounded border border-red-200 bg-red-50 px-1.5 py-1 text-red-800">
                  {table.bannerColumn} looks like a continuous measurement
                  rather than a set of categories (more than{" "}
                  {table.bannerCategories.length} distinct values), so it&apos;s
                  excluded as a banner: comparing individual readings against
                  each other row by row isn&apos;t meaningful. If you want a
                  mean {table.bannerColumn} per {table.stubColumn}, swap them:
                  make {table.stubColumn} the banner and {table.bannerColumn}{" "}
                  the stub instead. (Compute banner comparisons already skips
                  this column as a banner for the same reason, nothing will
                  actually be generated from it.)
                </p>
              )}
              {bannerIsTooGranular &&
                !(table.kind === "categorical" && table.bannerIsContinuous) && (
                  <p className="mb-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-1 text-amber-800">
                    {table.bannerColumn} has more than{" "}
                    {table.bannerCategories.length} distinct values; only the
                    first {table.bannerCategories.length} are shown below. A
                    column this granular is closer to an ID than a segment, and
                    usually makes a poor banner.
                  </p>
                )}
              {table.kind === "categorical" &&
              table.bannerIsContinuous ? null : table.kind === "categorical" ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-1 pr-3 font-semibold text-muted">
                          {table.bannerColumn}
                        </th>
                        {table.stubCategories.map((stubCategory) => (
                          <th
                            key={stubCategory}
                            className="py-1 pr-3 font-semibold text-muted"
                          >
                            {stubCategory}
                          </th>
                        ))}
                        <th className="py-1 pr-3 font-semibold text-muted">
                          n
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.bannerCategories.map((bannerCategory, i) => (
                        <tr
                          key={bannerCategory}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-1 pr-3 text-foreground">
                            {bannerCategory}
                          </td>
                          {table.counts[i].map((count, j) => (
                            <td
                              key={table.stubCategories[j]}
                              className="py-1 pr-3 text-foreground"
                            >
                              {count}
                              {table.rowTotals[i] > 0 && (
                                <span className="text-muted">
                                  {" "}
                                  (
                                  {Math.round(
                                    (count / table.rowTotals[i]) * 1000,
                                  ) / 10}
                                  %)
                                </span>
                              )}
                            </td>
                          ))}
                          <td className="py-1 pr-3 text-muted">
                            {table.rowTotals[i]}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {table.stubTruncated && (
                    <p className="mt-1 text-muted">
                      Showing first {table.stubCategories.length} categories of{" "}
                      {table.stubColumn}.
                    </p>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {table.anova && (
                    <p
                      className={`mb-1 inline-block rounded px-1.5 py-0.5 ${
                        table.anova.significant
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-50 text-slate-500"
                      }`}
                    >
                      One-way ANOVA across {table.bannerCategories.length}{" "}
                      groups:{" "}
                      {table.anova.fStat !== null && table.anova.pValue !== null
                        ? `F=${table.anova.fStat}, p=${table.anova.pValue}`
                        : "not enough data per group"}
                      {table.anova.significant
                        ? " -- significant overall"
                        : " -- not significant overall"}
                    </p>
                  )}
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="py-1 pr-3 font-semibold text-muted">
                          {table.bannerColumn}
                        </th>
                        <th className="py-1 pr-3 font-semibold text-muted">
                          n
                        </th>
                        <th className="py-1 pr-3 font-semibold text-muted">
                          Mean {table.stubColumn}
                        </th>
                        <th className="py-1 pr-3 font-semibold text-muted">
                          Std dev
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.bannerCategories.map((bannerCategory, i) => (
                        <tr
                          key={bannerCategory}
                          className="border-b border-border last:border-0"
                        >
                          <td className="py-1 pr-3 text-foreground">
                            {bannerCategory}
                          </td>
                          <td className="py-1 pr-3 text-foreground">
                            {table.n[i]}
                          </td>
                          <td className="py-1 pr-3 text-foreground">
                            {table.mean[i] ?? "--"}
                          </td>
                          <td className="py-1 pr-3 text-muted">
                            {table.stdDev[i] ??
                              (table.n[i] < 2 ? "n too small" : "--")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </details>
  );
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
  const { id } = await params;
  // Every loader below only needs the run id, so they all run at once. They
  // used to run one after another, which meant the page waited on the sum of
  // some thirty database round trips instead of the slowest one.
  const timing = startPageTiming();
  const [
    run,
    documents,
    rawFindings,
    codingAnalysis,
    transcriptSetups,
    setupSuggestions,
    latestProcessErrors,
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
  ] = await Promise.all([
    timing("run", getRun(id)),
    timing("documents", getDocuments(id)),
    timing("findings", getFindings(id)),
    timing("codingAnalysis", getCodingAnalysis(TENANT_ID, id)),
    timing("transcriptSetups", getTranscriptSetups(TENANT_ID, id)),
    timing("setupSuggestions", getSetupSuggestions(TENANT_ID, id)),
    timing("latestProcessErrors", getLatestProcessErrors(id)),
    timing("documentTablePreviews", getDocumentTablePreviews(id)),
    timing("codebooks", getCodebooks(id)),
    timing("objectiveCandidates", getObjectiveCandidates(id)),
    timing("decisionCandidates", getDecisionCandidates(id)),
    timing("insights", getInsights(id)),
    timing("synthesizedInsights", getSynthesizedInsights(id)),
    timing("statedInsightValidations", getStatedInsightValidations(id)),
    timing("inputCompleteness", getRunInputCompleteness(TENANT_ID, id)),
    timing("recommendations", getRecommendations(id)),
    timing("recommendationQuality", getRecommendationQuality(id)),
    timing("synthesizedRecommendations", getSynthesizedRecommendations(id)),
    timing("parkedInsights", getParkedInsights(id)),
    timing("apiUsage", getApiUsage(id)),
    timing("findingHistory", getFindingHistory(id)),
    timing("storyNarrative", getStoryNarrative(id)),
    timing("objectiveValidations", getObjectiveValidations(id)),
    timing("assistantMessages", getAssistantMessages(id)),
    timing("programs", getPrograms()),
    timing("apiUsageBatches", getApiUsageBatches(id)),
  ]);
  if (!run) {
    notFound();
  }

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
    needsVerdictSummary ? getVerdictSummary(id) : Promise.resolve(null),
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
      ? await getSampleFailedVerdicts(id)
      : [];
  timing.done();
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
  const tableIdsWithFindings = new Set(
    findings
      .map((f) => f.source_table_id)
      .filter((tableId): tableId is string => tableId !== null),
  );
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
  const importQualityTables = documentTablePreviews
    .filter((t) => t.headers.length > 0)
    .map((t) => ({
      id: t.id,
      documentName: documentNameById.get(t.document_id) ?? "Table",
      label: t.label,
      tableIndex: t.table_index,
      headers: t.headers,
      rows: t.rows,
      ingestionType: t.ingestion_type,
    }));

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
  if (findings.length > 0 && objectiveCandidates.length === 0) {
    refreshInBackground(
      id,
      objectiveRefreshesInFlight,
      () => refreshObjectiveCandidates(id),
      `objective:${id}`,
    );
  }

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
      () => refreshRecommendations(TENANT_ID, id),
      `recommendation:${id}`,
    );
  }

  const currentProgram = run.program_id
    ? (programs.find((program) => program.id === run.program_id) ?? null)
    : null;

  const uploadWithRunId = uploadDocument.bind(null, id);
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

  const uploadDone = documents.length > 0;
  const documentsReached = uploadDone;
  const documentsDone = findings.length > 0;
  const objectiveReached = findings.length > 0;
  const objectiveDone = Boolean(run.research_objective);
  const decisionReached = generateMode ? insights.length > 0 : objectiveDone;
  const decisionDone = Boolean(run.decision_statement);
  const insightsReached = generateMode ? objectiveDone : decisionDone;
  const recommendationsReached = Boolean(run.decision_statement);

  const startingPointLabel =
    run.entry_point === "generate"
      ? "Generate from data"
      : "Validate existing insights";

  const decisionSection = (
    <CollapsibleSection
      key={`decision-${decisionReached}-${decisionDone}`}
      title="Business decisions"
      bare
      icon={<ListIcon className="h-4 w-4 text-primary" />}
      defaultOpen={decisionReached && !decisionDone}
    >
      <DecisionBriefReview
        runId={id}
        candidates={decisionCandidates}
        hasFindings={findings.length > 0}
        evidenceSynthesis={run.evidence_synthesis}
      />
    </CollapsibleSection>
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
    <CollapsibleSection
      key={`synthesized-insights-${synthesizedInsights.length}`}
      title={`Synthesized insights${synthesizedInsights.length > 0 ? ` (${synthesizedInsights.length})` : ""}`}
      bare
      icon={<SparkleIcon className="h-4 w-4 text-primary" />}
      defaultOpen={false}
      headerRight={
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
      }
    >
      <SynthesizedInsightsReview runId={id} insights={synthesizedInsights} />
    </CollapsibleSection>
  );

  const recommendationsSection = (
    <CollapsibleSection
      key={`recommendations-${recommendationsReached}`}
      title={`Recommendations${synthesizedRecommendations.length > 0 ? ` (${synthesizedRecommendations.length})` : ""}`}
      bare
      icon={<TargetIcon className="h-4 w-4 text-primary" />}
      defaultOpen={false}
    >
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
    </CollapsibleSection>
  );

  // The original 1:1 pre-insight recommendations, kept additive alongside
  // the synthesized-insight-level ones above rather than replaced by them
  // (same "add, don't hide" pattern as pre-insights vs synthesized
  // insights). This is also where the Excel/Slides export buttons stay,
  // since those routes were built against this join and still only ever
  // export this list.
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
    <CollapsibleSection
      key={`story-report-${storyNarrative ? storyNarrative.generated_at : "none"}`}
      title="Insights Report"
      bare
      icon={<PresentationIcon className="h-4 w-4 text-primary" />}
      defaultOpen={false}
      headerRight={
        storyNarrative ? (
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
        ) : undefined
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
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

        {storyNarrative && (
          <div className="space-y-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
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
            <p className="text-xs text-muted">
              Generated {new Date(storyNarrative.generated_at).toLocaleString()}
            </p>
          </div>
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
                  item.status === "resolved"
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
                    <p className="text-muted">{item.conclusion}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </CollapsibleSection>
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
        <FindingsTable runId={id} findings={findings} />
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
  const objectiveQualityRows: ObjectiveQualityRow[] = parseNumberedItems(
    run.research_objective,
  ).map((text, order) => {
    const stored = objectiveQuality.rows.find(
      (r) => r.item_order === order && r.item_text === text,
    );
    return {
      order,
      text,
      scores: stored
        ? {
            specific: stored.specific_score,
            measurable: stored.measurable_score,
            answerable: stored.answerable_score,
            relevant: stored.relevant_score,
            total: stored.quality_score,
            tier: stored.quality_tier,
            rationale: stored.rationale,
            suggestion: stored.suggestion,
          }
        : null,
    };
  });

  const objectiveSection = (
    <CollapsibleSection
      key={`objective-${objectiveReached}-${objectiveDone}`}
      title="Objective setting"
      bare
      icon={<ListIcon className="h-4 w-4 text-primary" />}
      defaultOpen={objectiveReached && !objectiveDone}
    >
      <WorkingDataTabs
        tabs={[
          {
            id: "objectives",
            label: "Objectives",
            content: (
              <ObjectiveBriefReview
                runId={id}
                candidates={objectiveCandidates}
                hasFindings={findings.length > 0}
              />
            ),
          },
          {
            id: "objective-quality",
            label: "Quality scores",
            content: (
              <ObjectiveQualityPanel
                runId={id}
                rows={objectiveQualityRows}
                missingMigration={objectiveQuality.missing}
              />
            ),
          },
        ]}
      />
    </CollapsibleSection>
  );

  const objectiveKnownUpfront = Boolean(
    run.initial_research_objective &&
    run.initial_research_objective.trim().length > 0,
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
    <CollapsibleSection
      key={`working-data-${insights.length}-${recommendations.length}-${findingHistory.length}`}
      title="Working data"
      bare
      icon={<ListIcon className="h-4 w-4 text-muted" />}
      defaultOpen={false}
    >
      <p className="mb-6 max-w-2xl text-sm text-muted">
        The granular layer underneath the sections above: one pre-insight per
        verified finding, one recommendation per pre-insight, and anything
        removed along the way. Kept here as a full audit trail rather than
        hidden, not meant as the first thing to read.
      </p>
      <WorkingDataTabs
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
    </CollapsibleSection>
  );

  // objectiveSection's own comment explains the dependency this mirrors:
  // generateObjectiveCandidates reads findings and throws without any, so
  // when nothing was given upfront, Objective setting can't usefully come
  // before Findings -- it has nothing to generate from yet. Previously this
  // nav list hardcoded "objective" first regardless of objectiveKnownUpfront,
  // so a run with no upfront objective still showed it ahead of Findings,
  // the same regression objectiveKnownUpfront already fixed for the content
  // order (RunPage) but never for this list.
  const navSections: RunNavSection[] = [
    ...(objectiveKnownUpfront
      ? [{ id: "objective", group: "Setup", label: "Objective setting" }]
      : []),
    { id: "upload", group: "Setup", label: "Upload documents" },
    {
      id: "documents",
      group: "Setup",
      label: "Documents",
      badge: documents.length,
    },
    {
      id: "findings",
      group: "Analysis",
      label: "Findings",
      badge: findings.length,
    },
    ...(objectiveKnownUpfront
      ? []
      : [{ id: "objective", group: "Analysis", label: "Objective setting" }]),
    {
      id: "validations",
      group: "Analysis",
      label: "Report validations",
      badge: statedInsightValidations.length,
    },
    {
      id: "synthesized",
      group: "Analysis",
      label: "Synthesized insights",
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
  const defaultSectionId = !objectiveDone
    ? "objective"
    : decisionReached && !decisionDone
      ? "decisions"
      : "findings";

  return (
    <RunSectionProvider defaultId={defaultSectionId}>
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-[90rem] px-6 pt-8">
          <PipelineStatus runId={id} />
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">
            {run.project_name ??
              run.research_objective ??
              run.business_problem ??
              "Untitled project"}
          </h1>
          {run.project_name && run.business_problem && (
            <p className="mb-3 text-sm text-foreground">
              <span className="font-medium text-muted">Business problem: </span>
              {run.business_problem}
            </p>
          )}
          <div className="mb-10 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
            <span>Audience: {run.audience}</span>
            <span className="text-border">&middot;</span>
            <span className="inline-flex items-center rounded-full bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
              {run.status.replace(/_/g, " ")}
            </span>
            <span className="text-border">&middot;</span>
            <span>Starting point: {startingPointLabel}</span>
          </div>

          {/* Program/wave membership is a Documents-page concern (it's
              about this project's identity, not any one analysis step), but
              lived outside every SectionPanel, so it rendered above
              whichever section was selected instead of only on Documents. */}
          <SectionPanel id="documents">
            <div className="mb-8 rounded-lg border border-dashed border-border bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
                <ChartIcon className="h-4 w-4 text-primary" />
                Tracking
              </div>
              {currentProgram ? (
                <div>
                  <p className="text-sm text-foreground">
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
                  <p className="mb-3 text-sm text-muted">
                    Not part of a program yet. If this project is one wave of an
                    ongoing tracking study, link it to a program below, picking
                    an existing one or naming a new one.
                  </p>
                  <form
                    action={updateProgramLinkWithId}
                    className="flex flex-col gap-2 sm:flex-row sm:items-end"
                  >
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-foreground">
                        Existing program
                      </span>
                      <select
                        name="programId"
                        className="mt-1 block w-full rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">None</option>
                        {programs.map((program) => (
                          <option key={program.id} value={program.id}>
                            {program.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-foreground">
                        Or new program name
                      </span>
                      <input
                        name="newProgramName"
                        placeholder="e.g. Acme Member Satisfaction Tracker"
                        className="mt-1 block w-full rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    <label className="block flex-1">
                      <span className="text-xs font-medium text-foreground">
                        Wave label
                      </span>
                      <input
                        name="waveLabel"
                        placeholder="e.g. Wave 1"
                        className="mt-1 block w-full rounded-lg border border-border px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
          </SectionPanel>

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
        </div>

        <RunNav sections={navSections} />

        <div className="px-8 py-8">
          <SectionPanel id="upload">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Upload documents
            </h2>
            <CollapsibleSection
              key={`upload-${uploadDone}`}
              title="Upload additional documents"
              bare
              icon={<UploadIcon className="h-4 w-4 text-primary" />}
              defaultOpen={!uploadDone}
            >
              <form
                action={uploadWithRunId}
                className="flex max-w-xl flex-col gap-3"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <FileInput
                    name="reportFiles"
                    multiple
                    icon={<DocumentIcon className="h-3.5 w-3.5 text-primary" />}
                    label="Reports"
                  />
                  <FileInput
                    name="tableFiles"
                    multiple
                    accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
                    icon={<ChartIcon className="h-3.5 w-3.5 text-primary" />}
                    label="Tables"
                    caption="Already aggregated"
                  />
                  <FileInput
                    name="rawTableFiles"
                    multiple
                    accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
                    icon={<GridIcon className="h-3.5 w-3.5 text-primary" />}
                    label="Quant data"
                    caption="One row per respondent"
                  />
                  <FileInput
                    name="transcriptFiles"
                    multiple
                    icon={
                      <TranscriptIcon className="h-3.5 w-3.5 text-primary" />
                    }
                    label="Qual data"
                    caption="Uncoded transcripts"
                  />
                </div>
                <SubmitButton
                  pendingLabel="Uploading..."
                  className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
                  icon={<UploadIcon className="h-4 w-4" />}
                >
                  Upload
                </SubmitButton>
              </form>
            </CollapsibleSection>
          </SectionPanel>

          {documents.some((d) => d.kind === "transcript") && (
            <SectionPanel id="documents">
              <TranscriptSetupTable
                  runId={id}
                  rows={documents
                    .filter((d) => d.kind === "transcript")
                    .map((d) => ({
                      documentId: d.id,
                      filename: d.source_filename,
                      initial: transcriptSetups.get(d.id) ?? null,
                      suggestion: setupSuggestions.get(d.id) ?? null,
                      hasCoding: codebooksByDocument.has(d.id),
                      accent:
                        DOC_ACCENTS[documents.indexOf(d) % DOC_ACCENTS.length],
                    }))}
                />
            </SectionPanel>
          )}

          <SectionPanel id="documents">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Documents
            </h2>
            <CollapsibleSection
              key={`documents-${documentsReached}-${documentsDone}`}
              title="Documents"
              bare
              icon={<DocumentIcon className="h-4 w-4 text-primary" />}
              defaultOpen={documentsReached && !documentsDone}
              headerRight={
                documents.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={processRunWithId}>
                      <SubmitButton
                        pendingLabel="Processing..."
                        className="flex items-center gap-2 whitespace-nowrap rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:opacity-90 hover:shadow-md"
                        icon={<BoltIcon className="h-4 w-4" />}
                      >
                        Process new documents
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
                ) : undefined
              }
            >
              <WorkingDataTabs
                tabs={[
                  {
                    id: "files",
                    label: "Files",
                    content: (
                      <>
                        {documents.length === 0 && (
                          <p className="text-sm text-muted">
                            Nothing uploaded yet.
                          </p>
                        )}
                        <ul className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
                          {documents.map((doc) => {
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
                                      {new Date(
                                        doc.uploaded_at,
                                      ).toLocaleDateString()}
                                    </div>
                                  </div>
                                  <form
                                    action={deleteAction}
                                    className="shrink-0"
                                  >
                                    <DeleteDocumentButton />
                                  </form>
                                </div>
                                {doc.kind === "report" && (
                                  <form action={extractAction}>
                                    <SubmitButton
                                      pendingLabel="Extracting..."
                                      className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
                                      icon={
                                        <DocumentIcon className="h-3.5 w-3.5" />
                                      }
                                    >
                                      Extract findings
                                    </SubmitButton>
                                  </form>
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
                                  doc.ingestion_type === "raw" && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                                      Flagged as raw data. This skips the
                                      automatic scan used for aggregated tables,
                                      since an open search over case-level data
                                      risks far more uncorrected comparisons.
                                      Name a banner plan below (which columns to
                                      compare), then compute it directly.
                                      Stratified survey designs (strata/weight
                                      columns) aren&apos;t applied yet,
                                      that&apos;s later work, every comparison
                                      here assumes quota or simple-random
                                      sampling.
                                    </div>
                                  )}
                                {doc.kind === "table" &&
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
                                                <TableDigest
                                                  headers={t.headers}
                                                  rows={t.rows}
                                                />
                                                {t.ingestion_type === "raw" && (
                                                  <form
                                                    action={saveBannerPlanAction.bind(
                                                      null,
                                                      id,
                                                      t.id,
                                                    )}
                                                    className="mt-2 rounded-lg border border-border bg-white p-2"
                                                  >
                                                    <p className="mb-1 text-[11px] font-medium text-foreground">
                                                      Banner plan{" "}
                                                      <span className="font-normal text-muted">
                                                        (which columns to
                                                        compare once the
                                                        statistical path exists)
                                                      </span>
                                                    </p>
                                                    <div className="grid grid-cols-2 gap-2">
                                                      <div>
                                                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                                          Banner (segmenting
                                                          columns)
                                                        </p>
                                                        <div className="max-h-28 space-y-0.5 overflow-y-auto">
                                                          {t.headers.map(
                                                            (h) => (
                                                              <label
                                                                key={h}
                                                                className="flex items-center gap-1 text-[11px] text-foreground"
                                                              >
                                                                <input
                                                                  type="checkbox"
                                                                  name="bannerColumns"
                                                                  value={h}
                                                                  defaultChecked={
                                                                    t.banner_columns?.includes(
                                                                      h,
                                                                    ) ?? false
                                                                  }
                                                                  className="h-3 w-3"
                                                                />
                                                                {h}
                                                              </label>
                                                            ),
                                                          )}
                                                        </div>
                                                      </div>
                                                      <div>
                                                        <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                                          Stub (outcome columns)
                                                        </p>
                                                        <div className="max-h-28 space-y-0.5 overflow-y-auto">
                                                          {t.headers.map(
                                                            (h) => (
                                                              <label
                                                                key={h}
                                                                className="flex items-center gap-1 text-[11px] text-foreground"
                                                              >
                                                                <input
                                                                  type="checkbox"
                                                                  name="stubColumns"
                                                                  value={h}
                                                                  defaultChecked={
                                                                    t.stub_columns?.includes(
                                                                      h,
                                                                    ) ?? false
                                                                  }
                                                                  className="h-3 w-3"
                                                                />
                                                                {h}
                                                              </label>
                                                            ),
                                                          )}
                                                        </div>
                                                      </div>
                                                    </div>
                                                    <p className="mb-0.5 mt-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                                      Stratified design (leave
                                                      blank for
                                                      quota/simple-random)
                                                    </p>
                                                    <div className="grid grid-cols-2 gap-2">
                                                      <label className="block">
                                                        <span
                                                          className="inline-flex items-center gap-1 text-[10px] text-muted"
                                                          title="Name the column that records which stratum (named sub-group) each respondent was drawn from, only if your sample was deliberately split into groups sampled at different rates (e.g. a province oversampled to get enough responses there). Leave on None for an ordinary simple-random or quota sample, the common case."
                                                        >
                                                          Strata column
                                                          <InfoIcon className="h-3 w-3 shrink-0" />
                                                        </span>
                                                        <select
                                                          name="strataColumn"
                                                          defaultValue=""
                                                          className="mt-0.5 block w-full rounded border border-border px-1.5 py-1 text-[11px]"
                                                        >
                                                          <option value="">
                                                            None
                                                          </option>
                                                          {t.headers.map(
                                                            (h) => (
                                                              <option
                                                                key={h}
                                                                value={h}
                                                              >
                                                                {h}
                                                              </option>
                                                            ),
                                                          )}
                                                        </select>
                                                      </label>
                                                      <label className="block">
                                                        <span
                                                          className="inline-flex items-center gap-1 text-[10px] text-muted"
                                                          title="Name the numeric column that already holds each respondent's survey weight (a correction factor for being over- or under-represented in the raw sample), if your data has one. Leave on None if respondents should all count equally."
                                                        >
                                                          Weight column
                                                          <InfoIcon className="h-3 w-3 shrink-0" />
                                                        </span>
                                                        <select
                                                          name="weightColumn"
                                                          defaultValue=""
                                                          className="mt-0.5 block w-full rounded border border-border px-1.5 py-1 text-[11px]"
                                                        >
                                                          <option value="">
                                                            None
                                                          </option>
                                                          {t.headers.map(
                                                            (h) => (
                                                              <option
                                                                key={h}
                                                                value={h}
                                                              >
                                                                {h}
                                                              </option>
                                                            ),
                                                          )}
                                                        </select>
                                                      </label>
                                                    </div>
                                                    <SubmitButton
                                                      pendingLabel="Saving..."
                                                      className="mt-2 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition hover:bg-primary-hover"
                                                    >
                                                      Save banner plan
                                                    </SubmitButton>
                                                  </form>
                                                )}
                                                {t.ingestion_type === "raw" &&
                                                  (t.banner_columns?.length ??
                                                    0) > 0 &&
                                                  (t.stub_columns?.length ??
                                                    0) > 0 && (
                                                    <CrossTabPreviewSection
                                                      tables={computeCrossTabPreview(
                                                        t.rows,
                                                        t.banner_columns ?? [],
                                                        t.stub_columns ?? [],
                                                      )}
                                                    />
                                                  )}
                                                {t.ingestion_type === "raw" &&
                                                  (t.banner_columns?.length ??
                                                    0) > 0 &&
                                                  (t.stub_columns?.length ??
                                                    0) > 0 && (
                                                    <form
                                                      action={computeBannerPlanAction.bind(
                                                        null,
                                                        id,
                                                        t.id,
                                                      )}
                                                      className="mt-1.5"
                                                    >
                                                      <SubmitButton
                                                        pendingLabel="Computing..."
                                                        className="flex items-center gap-1.5 rounded-lg bg-success px-2.5 py-1 text-[11px] font-medium text-white shadow-sm transition hover:opacity-90"
                                                        icon={
                                                          <ChartIcon className="h-3 w-3" />
                                                        }
                                                      >
                                                        {tableIdsWithFindings.has(
                                                          t.id,
                                                        )
                                                          ? "Recompute banner comparisons"
                                                          : "Compute banner comparisons"}
                                                      </SubmitButton>
                                                    </form>
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
                                      return setup
                                        ? `${SESSION_LABEL[setup.sessionType]}; ${MODE_LABEL[setup.mode]}`
                                        : null;
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
                                    </form>
                                  </CodeGate>
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
                                    <CodebookPanel
                                      key={`codebook-${doc.id}-${codebooksByDocument.get(doc.id)!.version}`}
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
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    ),
                  },
                  {
                    id: "import-quality",
                    label: "Data quality",
                    content: (() => {
                      const codedTranscripts = documents.filter(
                        (d) =>
                          d.kind === "transcript" && codingAnalysis.has(d.id),
                      );
                      return (
                        <div className="space-y-8">
                          {(importQualityTables.length > 0 ||
                            codedTranscripts.length === 0) && (
                            <ImportQualityPanel
                              tables={importQualityTables}
                              hasReportOnly={
                                importQualityTables.length === 0 &&
                                documents.length > 0
                              }
                            />
                          )}
                          {codedTranscripts.length > 0 && (
                            <TranscriptQualityPanel
                              runId={id}
                              items={codedTranscripts.map((d) => ({
                                documentId: d.id,
                                filename: d.source_filename,
                                view: codingAnalysis.get(d.id)!,
                              }))}
                            />
                          )}
                        </div>
                      );
                    })(),
                  },
                ]}
              />
            </CollapsibleSection>
          </SectionPanel>

          <SectionPanel id="objective">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Objective setting
            </h2>
            {objectiveSection}
          </SectionPanel>

          <SectionPanel id="findings">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Findings
            </h2>
            {findingsSection}
          </SectionPanel>

          <SectionPanel id="validations">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Report insight validations
            </h2>
            {statedInsightValidationsSection}
          </SectionPanel>

          <SectionPanel id="synthesized">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Synthesized insights
            </h2>
            {synthesizedInsightsSection}
          </SectionPanel>

          <SectionPanel id="decisions">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Business decisions
            </h2>
            {decisionSection}
          </SectionPanel>

          <SectionPanel id="recommendations">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Recommendations
            </h2>
            {recommendationsSection}
          </SectionPanel>

          <SectionPanel id="insights-report">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Insights report
            </h2>
            {storyReportSection}
          </SectionPanel>

          <SectionPanel id="assistant">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Research assistant
            </h2>
            <CollapsibleSection
              key="research-assistant"
              title="Research assistant"
              bare
              icon={<ChatIcon className="h-4 w-4 text-primary" />}
              defaultOpen={false}
            >
              <ResearchAssistantCard
                runId={id}
                initialMessages={assistantMessages}
                hasReport={Boolean(storyNarrative)}
              />
            </CollapsibleSection>
          </SectionPanel>

          <SectionPanel id="working-data">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
              Working data
            </h2>
            {workingDataSection}
          </SectionPanel>

          <SectionPanel id="api-usage">
            <h2 className="mb-5 text-xl font-semibold text-foreground">
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
