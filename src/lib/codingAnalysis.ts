import { computeDataQuality, type DataQuality } from "./qualQuality";
import { clearCodingLabel, relabelCodingWork } from "./codingProgress";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { cachedSystem, cachedUserThen } from "./promptCache";
import { mapWithConcurrency } from "./concurrency";
import { withTenant, withTenantRead } from "./db";
import {
  applyCodebook,
  APPLY_PROMPT_HASH,
  recordManifest,
  recordTrace,
  type CodeRow,
  type StoredSegment,
} from "./extractThemes";
import { loadMeaningChecks, type MeaningCheck } from "./meaningCheck";
import {
  buildApplyBatches,
  sha256,
  summariseSegmentation,
  type ResolvedSegmentMode,
  type SegmentMode,
  type SegmentRole,
  type SegmentationSummary,
} from "./qualCoding";
import {
  MAX_NEGATIVE_CASES_PER_CODE,
  buildRespondents,
  cohenKappa,
  computeCodeStats,
  findCaseRow,
  flagDissonance,
  kappaBand,
  kappaCaveat,
  numericVariables,
  parseNegativeCases,
  parseNumber,
  selectCalibrationSample,
  validateLinkProposals,
  type AgreementCounts,
  type AnalysisSegment,
  type CodeStats,
  type Dissonance,
  type NegativeCaseProposal,
  sessionOfSpeaker,
} from "./qualAnalysis";
import type { CellValue } from "./dataQuality";
import { changeTurnCode, codeKey } from "./codingOverrides";
import {
  attentionCheck,
  auditSampleSize,
  compareRuns,
  codeKappas,
  MIN_TURNS_TO_JUDGE,
  estimateAudit,
  extendedAgreement,
  looserAgreement,
  selectAuditSample,
  summariseStability,
  type AttentionCheck,
  type AuditEstimate,
  type ExtendedAgreement,
  type StabilitySummary,
  type TurnStability,
} from "./qualAudit";
import {
  countKeyword,
  loadCodeMetaForDocuments,
  loadTurnNotes,
  splitKeywords,
  type CodeMeta,
} from "./codingMeta";

/**
 * The checks that sit on top of a coded transcript, in two halves.
 *
 * getCodingAnalysis reads what is stored and computes everything that can be
 * computed (counts with denominators, echoes, agreement with the researcher,
 * the respondent by theme matrix and dissonance flags). The functions below
 * it change that state: the researcher's calibration labels, session type,
 * survey mapping and review decisions, plus the two model calls (proposing
 * links to closed questions, and searching for negative cases).
 *
 * Counts only need migration 0043. Everything else needs 0044 and the view
 * says so through `setupMissing` rather than failing.
 */

const MODEL_CONCURRENCY = 3;
const CALIBRATION_SAMPLE_SIZE = 24;

// --- View types ------------------------------------------------------------

export type CalibrationTurn = {
  segmentId: string;
  index: number;
  speaker: string | null;
  text: string;
  reviewed: boolean;
  // Audit samples only: the stratum the turn was drawn from.
  stratum?: string | null;
  // Only filled once the turn has been reviewed, so the researcher codes it
  // without seeing what the model decided.
  researcherCodeIds: string[];
  modelCodeIds: string[];
};

export type StabilityTurn = {
  segmentId: string;
  index: number;
  speaker: string | null;
  text: string;
  runs: number;
  agree: number;
  confidence: "high" | "medium" | "low";
  // The codes on the turn now, after any change you made by hand.
  currentCodeIds: string[];
  // Codes another run gave that the original did not.
  altCodeIds: string[];
  // Codes the original gave that another run left out.
  droppedCodeIds: string[];
  resolved: boolean;
  // What the researcher coded before seeing the model's themes or the other
  // runs'. null until saved; the model's side stays hidden until then.
  blindCodeIds: string[] | null;
};

export type StabilityView = {
  runs: number;
  summary: StabilitySummary;
  // Looser readings beside the strict whole-turn figure. themeShare: turns where every run gave the same
  // broader themes (null when the codes are not grouped). overlap: average share of codes two runs have in
  // common on a turn. Both null when the individual runs were not kept (checks made before migration 0074,
  // with more than one re-run).
  looser: { themeShare: number | null; overlap: number | null } | null;
  perCode: {
    codeId: string;
    name: string;
    usedTurns: number;
    consistent: number;
    // Average pairwise Cohen's kappa over the runs; null when it cannot be worked out (older checks that did not keep each run).
    kappa: number | null;
    // Came up in too few turns for its agreement figure to mean much.
    tooFew: boolean;
  }[];
  // Average kappa over the themes that came up in enough turns; null when not available.
  kappaAverage: number | null;
  // Headline figure: the average, over themes that came up at all, of the share of their turns that
  // every run agreed on. null when no theme came up.
  codeAgreement: number | null;
  // Settling by majority of runs: possible once the check kept each run (migration 0074) with 3 or more runs.
  majority: { available: boolean; applied: boolean };
  // Turns the runs did not agree on, least agreed first.
  queue: StabilityTurn[];
  // Pattern of the researcher's decisions, to catch rubber-stamping.
  attention: AttentionCheck | null;
};

export type NegativeCaseView = {
  id: string;
  segmentId: string;
  index: number;
  speaker: string | null;
  text: string;
  reason: string;
  status: "pending" | "confirmed" | "dismissed";
  assignedToCode: boolean;
};

export type KeywordCount = {
  term: string;
  mentions: number; // occurrences in participant turns
  turns: number; // participant turns that contain it
  speakers: number | null; // distinct speakers who used it, null without labels
};

// A theme that groups several codes (Theme > Sub-theme / code), with the
// counts for the theme as a whole: a turn or speaker is counted once even if
// it carries several of the theme's codes.
export type ThemeRollup = {
  theme: string;
  codeIds: string[];
  codeNames: string[];
  stats: CodeStats;
  note: string;
};

export type CodeAnalysis = {
  id: string;
  name: string;
  number: number;
  // The broader theme this code sits under, when the researcher gave one.
  theme: string | null;
  note: string;
  keywords: string;
  keywordCounts: KeywordCount[];
  stats: CodeStats;
  // Focus groups only: groups in this run where a code of the same name
  // was applied, out of all focus groups coded.
  // names lists the groups where it came up.
  groups: { with: number; total: number; names: string[] } | null;
  agreement: {
    counts: AgreementCounts;
    extended: ExtendedAgreement;
    band: string;
    caveat: string | null;
  } | null;
  negativeCases: NegativeCaseView[];
};

export type RespondentView = {
  key: string;
  label: string;
  caseKey: string | null;
  turns: number;
  codeTurns: Record<string, number>; // code id to turns
  attributes: Record<string, string>; // profile lines read from the file, if any
  matched: boolean | null; // null when no survey table is mapped
  values: Record<string, number | null>; // linked variable to this respondent's answer
};

export type LinkView = {
  id: string;
  codeName: string;
  variable: string;
  direction: "higher" | "lower";
  rationale: string;
  status: "proposed" | "accepted" | "rejected";
  source: "model" | "researcher";
};

export type SurveyTableOption = {
  id: string;
  label: string;
  headers: string[];
  numeric: string[];
};

// How the file was split into respondents and turns, and what can be changed.
export type ReadingView = {
  requested: SegmentMode;
  resolved: ResolvedSegmentMode | null;
  moderators: string[];
  summary: SegmentationSummary;
  speakers: { label: string; turns: number; moderator: boolean }[];
  // False until migration 0046 is applied; the controls are then disabled.
  controlsAvailable: boolean;
};

export type VerbatimView = {
  segmentId: string;
  index: number;
  speaker: string | null;
  group: string | null; // the session inside the file, when the file holds several
  page: number | null;
  text: string;
  codeIds: string[];
  researcherCodeIds: string[]; // the subset a researcher added by hand
  note: string; // the researcher's own note on this turn
};

export type OverrideView = {
  segmentId: string;
  index: number;
  speaker: string | null;
  text: string;
  codeName: string;
  action: "add" | "remove";
  createdAt: string;
};

export type CodingAnalysisView = {
  documentId: string;
  codebookId: string;
  version: number;
  sessionType: "individual" | "focus_group";
  codes: CodeAnalysis[];
  // Roll-ups for themes that hold more than one code. Empty when no theme
  // has been given to any code.
  themes: ThemeRollup[];
  calibration: {
    kind: "targeted" | "audit";
    drawn: number;
    reviewed: number;
    turns: CalibrationTurn[];
    // Audit samples only: the estimate for the whole transcript.
    estimate: AuditEstimate | null;
  } | null;
  // Participant turns in the transcript and the size an audit would suggest.
  participantTurns: number;
  suggestedAuditSize: number;
  stability: StabilityView | null;
  respondents: RespondentView[];
  surveyTables: SurveyTableOption[];
  caseTableId: string | null;
  caseColumn: string | null;
  links: LinkView[];
  dissonance: {
    flags: Dissonance[];
    checked: number;
    unmatched: number;
  } | null;
  setupMissing: boolean;
  reading: ReadingView;
  quality: DataQuality;
  // Every coded participant turn with the themes it carries: the trail from a
  // theme back to what people actually said.
  verbatims: VerbatimView[];
  // Model-assisted meaning saturation check per code id (migration 0049).
  meaningChecks: Record<string, MeaningCheck>;
  // Manual theme changes by the researcher (migration 0050).
  overrides: OverrideView[];
  // Themes created by hand after coding.
  researcherCodeIds: string[];
};

type TableRow = Record<string, string | number | null>;

// Numeric column names per stored table, keyed by the table's row version.
const numericCache = new Map<string, { version: string; numeric: string[] }>();

function rowsToArrays(headers: string[], rows: TableRow[]): CellValue[][] {
  return rows.map((r) => headers.map((h) => r?.[h] ?? null));
}

const normName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

// --- Reading -----------------------------------------------------------------

export async function getCodingAnalysis(
  tenantId: string,
  runId: string,
): Promise<Map<string, CodingAnalysisView>> {
  const out = new Map<string, CodingAnalysisView>();

  type Book = { id: string; document_id: string; version: number };
  type Code = {
    id: string;
    codebook_id: string;
    name: string;
    position: number;
  };
  type Seg = {
    id: string;
    document_id: string;
    segment_index: number;
    speaker: string | null;
    role: SegmentRole;
    page: number | null;
    text: string;
  };
  type Assign = { segment_id: string; code_id: string };
  type Doc = { id: string; source_filename: string };

  let books: Book[] = [];
  let codes: Code[] = [];
  let segs: Seg[] = [];
  let assigns: Assign[] = [];
  let docs: Doc[] = [];
  try {
    await withTenantRead(tenantId, async (client) => {
      books = (
        await client.query<Book>(
          `select distinct on (document_id) id, document_id, version
           from coding_codebooks where run_id = $1
           order by document_id, version desc`,
          [runId],
        )
      ).rows;
      if (books.length === 0) return;
      const bookIds = books.map((b) => b.id);
      const docIds = books.map((b) => b.document_id);
      codes = (
        await client.query<Code>(
          `select id, codebook_id, name, position from coding_codes
           where codebook_id = any($1::uuid[]) order by codebook_id, position`,
          [bookIds],
        )
      ).rows;
      segs = (
        await client.query<Seg>(
          `select id, document_id, segment_index, speaker, role, page, text
           from coding_segments where document_id = any($1::uuid[])
           order by document_id, segment_index`,
          [docIds],
        )
      ).rows;
      assigns = (
        await client.query<Assign>(
          `select a.segment_id, a.code_id from coding_assignments a
           join coding_codes c on c.id = a.code_id
           where c.codebook_id = any($1::uuid[])`,
          [bookIds],
        )
      ).rows;
      docs = (
        await client.query<Doc>(
          "select id, source_filename from documents where run_id = $1",
          [runId],
        )
      ).rows;
    });
  } catch {
    return out; // migration 0043 not applied
  }
  if (books.length === 0) return out;
  const docName = new Map(docs.map((d) => [d.id, d.source_filename]));

  // These reads only need the codebooks found above, so they run together.
  // Each keeps its own try/catch: a missing later migration must only
  // switch off its own part.
  let tables: TableRecord[] = [];
  let setupMissing = false;
  let settings: Settings[] = [];
  let keys: { document_id: string; speaker_key: string; case_key: string }[] =
    [];
  let samples: {
    codebook_id: string;
    segment_id: string;
    reviewed_at: string | null;
  }[] = [];
  let labels: { segment_id: string; code_id: string; applies: boolean }[] = [];
  let links: (LinkView & { document_id: string })[] = [];
  let negatives: {
    id: string;
    document_id: string;
    code_id: string;
    segment_id: string;
    reason: string;
    status: "pending" | "confirmed" | "dismissed";
  }[] = [];
  let readings: Reading[] = [];
  let attrs: {
    document_id: string;
    speaker_key: string;
    attribute: string;
    value: string;
  }[] = [];
  let readingMissing = false;
  const truncatedByDoc = new Map<string, boolean>();
  // Migration 0064: audit samples and stability checks. Read separately so
  // a missing 0064 leaves the rest of the view working.
  const sampleExt = new Map<
    string,
    { kind: "targeted" | "audit"; stratum: string | null; stratumSize: number | null }
  >();
  // Migration 0065, read on its own for the same reason.
  const reviewExt = new Map<
    string,
    { blind: string[] | null; changed: boolean | null; resolvedMs: number | null }
  >();
  let stabilityRows: {
    codebook_id: string;
    segment_id: string;
    runs: number;
    agree: number;
    orig_codes: number[];
    alt_codes: number[];
    dropped_codes: number[];
    resolved_at: string | null;
  }[] = [];
  // Migration 0074, read on its own for the same reason.
  const majorityExt = new Map<string, { withRuns: number; applied: number }>();
  const runCodesExt = new Map<string, number[][]>();
  const researcherPairs = new Set<string>();
  const researcherCodes = new Set<string>();
  let overrideRows: {
    segment_id: string;
    document_id: string;
    code_key: string;
    code_name: string;
    action: "add" | "remove";
    created_at: string;
  }[] = [];
  await Promise.all([
    (async () => {
    try {
      tables = await withTenantRead(tenantId, async (client) => {
        // Rows are left out here: they can be huge. The few places that need
        // them (numeric column names, a linked case table) get them below.
        const r = await client.query<TableRecord>(
          `select id, document_id, table_index, label, headers, '[]'::jsonb as rows,
                  xmin::text as row_version
           from document_tables
           where run_id = $1 and coalesce(crosstab_status, 'committed') <> 'evidence'
           order by document_id, table_index`,
          [runId],
        );
        return r.rows.filter(
          (t) => Array.isArray(t.headers) && t.headers.length > 0,
        );
      });
    } catch {
      tables = [];
    }
    })(),
    (async () => {
    try {
      await withTenantRead(tenantId, async (client) => {
        const docIds = books.map((b) => b.document_id);
        const bookIds = books.map((b) => b.id);
        settings = (
          await client.query<Settings>(
            "select document_id, session_type, case_table_id, case_column from coding_document_settings where run_id = $1",
            [runId],
          )
        ).rows;
        keys = (
          await client.query(
            "select document_id, speaker_key, case_key from coding_respondent_keys where document_id = any($1::uuid[])",
            [docIds],
          )
        ).rows;
        samples = (
          await client.query(
            "select codebook_id, segment_id, reviewed_at::text as reviewed_at from coding_calibration_samples where codebook_id = any($1::uuid[])",
            [bookIds],
          )
        ).rows;
        labels = (
          await client.query(
            `select l.segment_id, l.code_id, l.applies from coding_calibration_labels l
             join coding_codes c on c.id = l.code_id where c.codebook_id = any($1::uuid[])`,
            [bookIds],
          )
        ).rows;
        links = (
          await client.query(
            `select id, document_id, code_name as "codeName", variable, direction, rationale, status, source
             from coding_variable_links where run_id = $1 order by created_at`,
            [runId],
          )
        ).rows;
        negatives = (
          await client.query(
            `select n.id, n.document_id, n.code_id, n.segment_id, n.reason, n.status
             from coding_negative_cases n join coding_codes c on c.id = n.code_id
             where c.codebook_id = any($1::uuid[]) order by n.created_at`,
            [bookIds],
          )
        ).rows;
      });
    } catch {
      setupMissing = true;
    }
    })(),
    (async () => {
    try {
      await withTenantRead(tenantId, async (client) => {
        readings = (
          await client.query<Reading>(
            `select document_id, segmentation_mode, segmentation_resolved, segmentation_notes, moderator_labels
             from coding_document_settings where run_id = $1`,
            [runId],
          )
        ).rows;
        attrs = (
          await client.query(
            `select document_id, speaker_key, attribute, value
             from coding_respondent_attributes where run_id = $1`,
            [runId],
          )
        ).rows;
      });
    } catch {
      readingMissing = true;
    }
    })(),
    (async () => {
    try {
      await withTenantRead(tenantId, async (client) => {
        const r = await client.query<{
          document_id: string;
          detail: Record<string, unknown>;
        }>(
          `select m.document_id, m.detail from coding_run_manifest m
           where m.stage = 'open_coding' and m.codebook_id = any($1::uuid[])`,
          [books.map((b) => b.id)],
        );
        for (const row of r.rows) {
          if (row.detail.input_truncated === true)
            truncatedByDoc.set(row.document_id, true);
          else if (!truncatedByDoc.has(row.document_id))
            truncatedByDoc.set(row.document_id, false);
        }
      });
    } catch {
      // manifest unavailable: truncation stays unknown
    }
    })(),
    (async () => {
    try {
      await withTenantRead(tenantId, async (client) => {
        const bookIds = books.map((b) => b.id);
        const r = await client.query<{ segment_id: string; code_id: string }>(
          `select a.segment_id, a.code_id from coding_assignments a
           join coding_codes c on c.id = a.code_id
           where c.codebook_id = any($1::uuid[]) and a.source = 'researcher'`,
          [bookIds],
        );
        for (const row of r.rows)
          researcherPairs.add(`${row.segment_id}|${row.code_id}`);
        const rc = await client.query<{ id: string }>(
          `select id from coding_codes
           where codebook_id = any($1::uuid[]) and added_by_researcher`,
          [bookIds],
        );
        for (const row of rc.rows) researcherCodes.add(row.id);
        overrideRows = (
          await client.query(
            `select segment_id, document_id, code_key, code_name, action, created_at::text as created_at
             from coding_assignment_overrides where run_id = $1 order by created_at`,
            [runId],
          )
        ).rows;
      });
    } catch {
      // migration 0050 not applied
    }
    })(),
    (async () => {
    try {
      await withTenantRead(tenantId, async (client) => {
        const bookIds = books.map((b) => b.id);
        const ext = await client.query<{
          codebook_id: string;
          segment_id: string;
          kind: "targeted" | "audit";
          stratum: string | null;
          stratum_size: number | null;
        }>(
          `select codebook_id, segment_id, kind, stratum, stratum_size
           from coding_calibration_samples where codebook_id = any($1::uuid[])`,
          [bookIds],
        );
        for (const r of ext.rows)
          sampleExt.set(`${r.codebook_id}|${r.segment_id}`, {
            kind: r.kind,
            stratum: r.stratum,
            stratumSize: r.stratum_size,
          });
        stabilityRows = (
          await client.query(
            `select codebook_id, segment_id, runs, agree, orig_codes, alt_codes, dropped_codes, resolved_at::text as resolved_at
             from coding_turn_stability where codebook_id = any($1::uuid[])`,
            [bookIds],
          )
        ).rows;
        try {
          const rv = await client.query<{
            codebook_id: string;
            segment_id: string;
            blind_codes: string[] | null;
            blind_at: string | null;
            changed: boolean | null;
            resolved_ms: string | null;
          }>(
            `select codebook_id, segment_id, blind_codes, blind_at::text as blind_at, changed,
                    (extract(epoch from resolved_at) * 1000)::text as resolved_ms
             from coding_turn_stability where codebook_id = any($1::uuid[])`,
            [bookIds],
          );
          for (const r of rv.rows)
            reviewExt.set(`${r.codebook_id}|${r.segment_id}`, {
              blind: r.blind_at ? (r.blind_codes ?? []) : null,
              changed: r.changed,
              resolvedMs: r.resolved_ms ? Number(r.resolved_ms) : null,
            });
        } catch {
          // migration 0065 not applied
        }
        try {
          const mj = await client.query<{ codebook_id: string; with_runs: number; applied: number }>(
            `select codebook_id,
                    count(*) filter (where run_codes is not null)::int as with_runs,
                    count(*) filter (where consensus_at is not null)::int as applied
               from coding_turn_stability where codebook_id = any($1::uuid[]) group by codebook_id`,
            [bookIds],
          );
          for (const r of mj.rows) majorityExt.set(r.codebook_id, { withRuns: r.with_runs, applied: r.applied });
          const rc = await client.query<{ codebook_id: string; segment_id: string; run_codes: number[][] | null }>(
            `select codebook_id, segment_id, run_codes from coding_turn_stability
              where codebook_id = any($1::uuid[]) and run_codes is not null`,
            [bookIds],
          );
          for (const r of rc.rows) if (r.run_codes) runCodesExt.set(`${r.codebook_id}|${r.segment_id}`, r.run_codes);
        } catch {
          // migration 0074 not applied
        }
      });
    } catch {
      // migration 0064 not applied
    }
    })(),
  ]);

  // Survey tables the respondents can be matched to.
  type TableRecord = {
    id: string;
    document_id: string;
    table_index: number;
    label: string | null;
    headers: string[];
    rows: TableRow[];
    row_version?: string;
  };
  // Which columns are numeric is worked out from the stored rows, which is
  // slow for a large file. It only changes when the table is rewritten, so
  // it is kept per table and the rows are fetched only when it is missing
  // (and for a table the researcher linked as a case table).
  const linkedTableIds = new Set(
    settings.map((x) => x.case_table_id).filter((x): x is string => !!x),
  );
  const needRows = tables.filter(
    (t) =>
      linkedTableIds.has(t.id) ||
      numericCache.get(t.id)?.version !== `${t.row_version}|${t.headers.length}`,
  );
  if (needRows.length > 0) {
    try {
      const fetched = await withTenantRead(tenantId, async (client) => {
        const r = await client.query<{ id: string; rows: TableRow[] }>(
          "select id, rows from document_tables where id = any($1::uuid[])",
          [needRows.map((t) => t.id)],
        );
        return new Map(r.rows.map((x) => [x.id, x.rows] as const));
      });
      for (const t of needRows) {
        const rows = fetched.get(t.id) ?? [];
        const version = `${t.row_version}|${t.headers.length}`;
        if (numericCache.get(t.id)?.version !== version) {
          if (numericCache.size >= 200) numericCache.delete(numericCache.keys().next().value as string);
          numericCache.set(t.id, {
            version,
            numeric: numericVariables(t.headers, rowsToArrays(t.headers, rows)).map((v) => v.name),
          });
        }
        if (linkedTableIds.has(t.id)) t.rows = rows;
      }
    } catch {
      // leave numeric lists empty rather than fail the whole view
    }
  }
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const surveyTables: SurveyTableOption[] = tables.map((t) => ({
    id: t.id,
    label: `${docName.get(t.document_id) ?? "Table"}${t.label ? `, ${t.label}` : ` (table ${t.table_index + 1})`}`,
    headers: t.headers,
    numeric: numericCache.get(t.id)?.numeric ?? [],
  }));

  // The researcher's own state (migration 0044).
  type Settings = {
    document_id: string;
    session_type: "individual" | "focus_group";
    case_table_id: string | null;
    case_column: string | null;
  };

  // How each file was read (migration 0046). A separate read, so a missing
  // 0046 only disables the controls and leaves everything above working.
  type Reading = {
    document_id: string;
    segmentation_mode: SegmentMode;
    segmentation_resolved: ResolvedSegmentMode | null;
    segmentation_notes: string[];
    moderator_labels: string[];
  };
  const readingByDoc = new Map(readings.map((r) => [r.document_id, r]));
  const attrsByDoc = new Map<string, Map<string, Record<string, string>>>();
  for (const a of attrs) {
    const byKey =
      attrsByDoc.get(a.document_id) ??
      new Map<string, Record<string, string>>();
    const rec = byKey.get(a.speaker_key) ?? {};
    rec[a.attribute] = a.value;
    byKey.set(a.speaker_key, rec);
    attrsByDoc.set(a.document_id, byKey);
  }

  const sessionByDoc = new Map(settings.map((s) => [s.document_id, s]));
  const keysByDoc = new Map<string, Map<string, string>>();
  for (const k of keys) {
    const m = keysByDoc.get(k.document_id) ?? new Map<string, string>();
    m.set(k.speaker_key, k.case_key);
    keysByDoc.set(k.document_id, m);
  }

  const codeNumber = new Map<string, number>();
  const codesByBook = new Map<string, Code[]>();
  for (const c of codes) {
    const list = codesByBook.get(c.codebook_id) ?? [];
    list.push(c);
    codesByBook.set(c.codebook_id, list);
    codeNumber.set(c.id, list.length);
  }
  const assignBySeg = new Map<string, number[]>();
  for (const a of assigns) {
    const n = codeNumber.get(a.code_id);
    if (!n) continue;
    const list = assignBySeg.get(a.segment_id) ?? [];
    list.push(n);
    assignBySeg.set(a.segment_id, list);
  }

  const segsByDoc = new Map<string, AnalysisSegment[]>();
  for (const s of segs) {
    const list = segsByDoc.get(s.document_id) ?? [];
    list.push({
      id: s.id,
      index: s.segment_index,
      speaker: s.speaker,
      role: s.role,
      text: s.text,
    });
    segsByDoc.set(s.document_id, list);
  }

  // Whether open coding saw the whole transcript, from the run manifest.
  const assignIdsBySeg = new Map<string, string[]>();
  for (const a of assigns) {
    const list = assignIdsBySeg.get(a.segment_id) ?? [];
    list.push(a.code_id);
    assignIdsBySeg.set(a.segment_id, list);
  }

  const focusDocs = books.filter(
    (b) => sessionByDoc.get(b.document_id)?.session_type === "focus_group",
  );

  // What the researcher changed by hand (migration 0050). Separate reads, so a
  // missing 0050 leaves everything else working.
  const removedKeys = new Map<string, Set<string>>();
  for (const o of overrideRows) {
    if (o.action !== "remove") continue;
    const set = removedKeys.get(o.segment_id) ?? new Set<string>();
    set.add(o.code_key);
    removedKeys.set(o.segment_id, set);
  }

  // A focus group is a session inside a file when the file holds several
  // ("P3 (Focus group 2)"), otherwise the file itself.
  const codeNameKey = new Map(codes.map((c) => [c.id, normName(c.name)]));
  const focusSegments: { id: string; group: string }[] = [];
  const focusGroupKeys = new Set<string>();
  const groupLabel = new Map<string, string>();
  for (const fb of focusDocs) {
    for (const seg of segsByDoc.get(fb.document_id) ?? []) {
      if (seg.role === "moderator") continue;
      const session = sessionOfSpeaker(seg.speaker);
      const key = session ? `${fb.document_id}|${session}` : fb.document_id;
      if (!groupLabel.has(key))
        groupLabel.set(
          key,
          session
            ? `${docName.get(fb.document_id) ?? "File"}, ${session}`
            : (docName.get(fb.document_id) ?? "File"),
        );
      focusGroupKeys.add(key);
      focusSegments.push({ id: seg.id, group: key });
    }
  }

  // Themes, notes and keywords per code (migration 0055); empty until applied.
  let metaByDoc = new Map<string, Map<string, CodeMeta>>();
  try {
    metaByDoc = await loadCodeMetaForDocuments(
      tenantId,
      books.map((b) => b.document_id),
    );
  } catch {
    // migration 0055 not applied
  }

  // Meaning checks and turn notes for every book at once, rather than two
  // round trips per book one after another.
  const perBook = new Map(
    await Promise.all(
      books.map(async (b) => {
        const [mc, tn] = await Promise.all([
          loadMeaningChecks(tenantId, b.document_id),
          loadTurnNotes(tenantId, b.document_id).catch(
            () => new Map<number, string>(), // migration 0055 not applied
          ),
        ]);
        return [b.document_id, { mc, tn }] as const;
      }),
    ),
  );

  for (const book of books) {
    const meaningChecks = perBook.get(book.document_id)?.mc ?? new Map();
    const turnNotes = perBook.get(book.document_id)?.tn ?? new Map<number, string>();
    const docMeta = metaByDoc.get(book.document_id) ?? new Map<string, CodeMeta>();
    const metaOf = (name: string): CodeMeta | undefined =>
      docMeta.get(normName(name));
    const bookCodes = codesByBook.get(book.id) ?? [];
    const segments = segsByDoc.get(book.document_id) ?? [];
    const setting = sessionByDoc.get(book.document_id);
    const focusGroup = setting?.session_type === "focus_group";
    const stats = computeCodeStats({
      segments,
      assignments: assignBySeg,
      codeCount: bookCodes.length,
      focusGroup,
    });
    const segById = new Map(segments.map((s) => [s.id, s]));

    // Calibration.
    const bookSamples = samples.filter((s) => s.codebook_id === book.id);
    const labelBySeg = new Map<string, Map<string, boolean>>();
    for (const l of labels) {
      const m = labelBySeg.get(l.segment_id) ?? new Map<string, boolean>();
      m.set(l.code_id, l.applies);
      labelBySeg.set(l.segment_id, m);
    }
    const reviewedSegIds = new Set(
      bookSamples.filter((s) => s.reviewed_at).map((s) => s.segment_id),
    );
    const turns: CalibrationTurn[] = bookSamples
      .map((s) => {
        const seg = segById.get(s.segment_id);
        if (!seg) return null;
        const reviewed = reviewedSegIds.has(s.segment_id);
        const researcher = labelBySeg.get(s.segment_id);
        return {
          segmentId: s.segment_id,
          index: seg.index,
          speaker: seg.speaker,
          text: seg.text,
          reviewed,
          stratum: sampleExt.get(`${book.id}|${s.segment_id}`)?.stratum ?? null,
          researcherCodeIds: reviewed
            ? bookCodes
                .filter((c) => researcher?.get(c.id) === true)
                .map((c) => c.id)
            : [],
          modelCodeIds: reviewed
            ? bookCodes
                .filter(
                  (c, i) =>
                    ((assignBySeg.get(s.segment_id) ?? []).includes(i + 1) &&
                      !researcherPairs.has(`${s.segment_id}|${c.id}`)) ||
                    removedKeys.get(s.segment_id)?.has(normName(c.name)),
                )
                .map((c) => c.id)
            : [],
        } as CalibrationTurn;
      })
      .filter((t): t is CalibrationTurn => t !== null)
      .sort((a, b) => a.index - b.index);

    // Audit samples (migration 0064): a random, stratified draw whose result
    // can be read as an estimate for the whole transcript.
    const bookSampleKinds = bookSamples
      .map((smp) => sampleExt.get(`${book.id}|${smp.segment_id}`))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const calibrationKind: "targeted" | "audit" =
      bookSampleKinds[0]?.kind === "audit" ? "audit" : "targeted";
    const participantCount = segments.filter((sg) => sg.role !== "moderator").length;
    let auditEstimate: AuditEstimate | null = null;
    if (calibrationKind === "audit") {
      const rows = turns
        .filter((t) => t.reviewed)
        .map((t) => {
          const ext = sampleExt.get(`${book.id}|${t.segmentId}`);
          const a = new Set(t.modelCodeIds);
          const b = new Set(t.researcherCodeIds);
          return {
            stratum: ext?.stratum ?? "none",
            stratumSize: ext?.stratumSize ?? 1,
            match: a.size === b.size && [...a].every((x) => b.has(x)),
          };
        });
      const drawn = [
        ...new Set(bookSampleKinds.map((k) => k.stratum ?? "none")),
      ];
      auditEstimate = estimateAudit(rows, drawn);
    }

    // Stability checks (migration 0064): the codebook applied again to the
    // same turns, and which turns came out differently.
    let stabilityView: StabilityView | null = null;
    const bookStability = stabilityRows.filter((r) => r.codebook_id === book.id);
    if (bookStability.length > 0) {
      const idOfNumber = (n: number) => bookCodes[n - 1]?.id;
      const toIds = (nums: number[]) =>
        nums.map(idOfNumber).filter((x): x is string => !!x);
      const queue: StabilityTurn[] = [];
      const perCodeUse = bookCodes.map(() => ({ used: 0, consistent: 0 }));
      for (const r of bookStability) {
        const seg = segById.get(r.segment_id);
        if (!seg) continue;
        const current = assignBySeg.get(r.segment_id) ?? [];
        const inOriginal = new Set(r.orig_codes);
        const alt = new Set(r.alt_codes);
        // Per code: used when the original or any other run gave it;
        // consistent when all runs did.
        for (let n = 1; n <= bookCodes.length; n++) {
          const used = inOriginal.has(n) || alt.has(n);
          if (!used) continue;
          perCodeUse[n - 1].used += 1;
          if (!alt.has(n) && !r.dropped_codes.includes(n))
            perCodeUse[n - 1].consistent += 1;
        }
        const conf =
          r.agree >= r.runs ? "high" : r.agree * 2 > r.runs ? "medium" : "low";
        if (conf === "high") continue;
        queue.push({
          segmentId: r.segment_id,
          index: seg.index,
          speaker: seg.speaker,
          text: seg.text,
          runs: r.runs,
          agree: r.agree,
          confidence: conf,
          currentCodeIds: toIds(current),
          altCodeIds: toIds(r.alt_codes),
          droppedCodeIds: toIds(r.dropped_codes),
          resolved: !!r.resolved_at,
          blindCodeIds:
            reviewExt.get(`${book.id}|${r.segment_id}`)?.blind ?? null,
        });
      }
      queue.sort(
        (a, b) =>
          Number(a.resolved) - Number(b.resolved) ||
          a.agree / a.runs - b.agree / b.runs ||
          a.index - b.index,
      );
      const kappaByCode: (number | null)[] = (() => {
        const haveAll = bookStability.every((r) => runCodesExt.has(`${book.id}|${r.segment_id}`));
        if (!haveAll) return [];
        const perTurn = bookStability.map((r) => [
          r.orig_codes,
          ...(runCodesExt.get(`${book.id}|${r.segment_id}`) ?? []),
        ]);
        const ks = codeKappas(perTurn, bookCodes.length);
        return ks.map((x) => x.kappa);
      })();
      const runsHere = Math.max(...bookStability.map((r) => r.runs));
      // The code numbers each run gave, per turn. Exact when each run was kept; with a single re-run it can be
      // rebuilt from what was added and dropped; otherwise it is unknown.
      const perTurnRuns: number[][][] | null = (() => {
        const kept = bookStability.every((r) => runCodesExt.has(`${book.id}|${r.segment_id}`));
        if (kept)
          return bookStability.map((r) => [r.orig_codes, ...(runCodesExt.get(`${book.id}|${r.segment_id}`) ?? [])]);
        if (runsHere === 2)
          return bookStability.map((r) => [
            r.orig_codes,
            [...r.orig_codes.filter((c) => !r.dropped_codes.includes(c)), ...r.alt_codes],
          ]);
        return null;
      })();
      const looser = (() => {
        if (!perTurnRuns) return null;
        const r = looserAgreement(perTurnRuns, (n) => {
          const code = bookCodes[n - 1];
          return code ? (metaOf(code.name)?.theme ?? null) : null;
        });
        return { themeShare: r.themeShare, overlap: r.overlap };
      })();
      stabilityView = {
        runs: Math.max(...bookStability.map((r) => r.runs)),
        looser,
        summary: summariseStability(bookStability),
        majority: (() => {
          const m = majorityExt.get(book.id);
          const runsHere = Math.max(...bookStability.map((r) => r.runs));
          return {
            available: !!m && m.withRuns === bookStability.length && runsHere >= 3,
            applied: !!m && m.applied > 0,
          };
        })(),
        codeAgreement: (() => {
          const used = perCodeUse.filter((u) => u.used > 0);
          const enough = used.filter((u) => u.used >= MIN_TURNS_TO_JUDGE);
          // Themes with very few turns are left out of the headline; if that leaves nothing, use all.
          const pool = enough.length > 0 ? enough : used;
          return pool.length === 0 ? null : pool.reduce((a, u) => a + u.consistent / u.used, 0) / pool.length;
        })(),
        perCode: bookCodes.map((c, i) => ({
          codeId: c.id,
          name: c.name,
          usedTurns: perCodeUse[i].used,
          consistent: perCodeUse[i].consistent,
          kappa: kappaByCode[i] ?? null,
          tooFew: perCodeUse[i].used > 0 && perCodeUse[i].used < MIN_TURNS_TO_JUDGE,
        })),
        kappaAverage: (() => {
          const ks = bookCodes
            .map((_, i) => ({ k: kappaByCode[i] ?? null, used: perCodeUse[i].used }))
            .filter((x) => x.k !== null && x.used >= MIN_TURNS_TO_JUDGE)
            .map((x) => x.k as number);
          return ks.length === 0 ? null : ks.reduce((a, b) => a + b, 0) / ks.length;
        })(),
        queue,
        attention: attentionCheck(
          bookStability
            .map((r) => reviewExt.get(`${book.id}|${r.segment_id}`))
            .filter(
              (x): x is NonNullable<typeof x> =>
                !!x && x.resolvedMs !== null && x.changed !== null,
            )
            .map((x) => ({ at: x.resolvedMs as number, changed: !!x.changed })),
        ),
      };
    }

    // Respondents and the survey join.
    const respondents = buildRespondents(
      segments,
      assignBySeg,
      keysByDoc.get(book.document_id) ?? new Map(),
    );
    const caseTable = setting?.case_table_id
      ? tableById.get(setting.case_table_id)
      : undefined;
    const caseColumn = setting?.case_column ?? null;
    const tableRows = caseTable
      ? rowsToArrays(caseTable.headers, caseTable.rows ?? [])
      : [];
    const docLinks = links.filter((l) => l.document_id === book.document_id);
    const accepted = docLinks.filter((l) => l.status === "accepted");
    const respondentViews: RespondentView[] = respondents.map((r) => {
      const values: Record<string, number | null> = {};
      let matched: boolean | null = null;
      if (caseTable && caseColumn) {
        const found = r.caseKey
          ? findCaseRow(caseTable.headers, tableRows, caseColumn, r.caseKey)
          : { row: null, matches: 0 };
        matched = found.matches > 0;
        for (const link of accepted) {
          const col = caseTable.headers.indexOf(link.variable);
          values[link.variable] =
            found.row && col >= 0 ? parseNumber(found.row[col]) : null;
        }
      }
      const codeTurns: Record<string, number> = {};
      for (const [n, count] of r.codes) {
        const code = bookCodes[n - 1];
        if (code) codeTurns[code.id] = count;
      }
      return {
        key: r.key,
        label: r.label,
        caseKey: r.caseKey,
        attributes: attrsByDoc.get(book.document_id)?.get(r.key) ?? {},
        turns: r.turns,
        codeTurns,
        matched,
        values,
      };
    });
    const dissonance =
      caseTable && caseColumn && accepted.length > 0
        ? flagDissonance({
            respondents,
            codeNames: bookCodes.map((c) => c.name),
            links: accepted.map((l) => ({
              codeName: l.codeName,
              variable: l.variable,
              direction: l.direction,
            })),
            headers: caseTable.headers,
            rows: tableRows,
            caseColumn,
          })
        : null;

    const codeViews: CodeAnalysis[] = bookCodes.map((c, i) => {
      const pairs = turns
        .filter((t) => t.reviewed)
        .map((t) => ({
          model: t.modelCodeIds.includes(c.id),
          researcher: t.researcherCodeIds.includes(c.id),
        }));
      const counts = pairs.length > 0 ? cohenKappa(pairs) : null;
      const nameKey = normName(c.name);
      const withGroups = new Set<string>();
      for (const seg of focusSegments) {
        if (
          (assignIdsBySeg.get(seg.id) ?? []).some(
            (cid) => codeNameKey.get(cid) === nameKey,
          )
        )
          withGroups.add(seg.group);
      }
      const groups = focusGroup
        ? {
            with: withGroups.size,
            total: focusGroupKeys.size,
            names: [...withGroups].map((g) => groupLabel.get(g) ?? g),
          }
        : null;
      const meta = metaOf(c.name);
      const terms = splitKeywords(meta?.keywords ?? "");
      const keywordCounts: KeywordCount[] = terms.map((term) => {
        let mentions = 0;
        let turnsWith = 0;
        const who = new Set<string>();
        for (const sg of segments) {
          if (sg.role === "moderator") continue;
          const n = countKeyword(sg.text, term);
          if (n === 0) continue;
          mentions += n;
          turnsWith += 1;
          if (sg.speaker) who.add(sg.speaker);
        }
        const labelled = segments.some((sg) => sg.speaker);
        return {
          term,
          mentions,
          turns: turnsWith,
          speakers: labelled ? who.size : null,
        };
      });
      return {
        id: c.id,
        name: c.name,
        number: i + 1,
        theme: meta?.theme ? meta.theme : null,
        note: meta?.note ?? "",
        keywords: meta?.keywords ?? "",
        keywordCounts,
        stats: stats[i],
        groups,
        agreement: counts
          ? {
              counts,
              extended: extendedAgreement(counts),
              band: kappaBand(counts.kappa),
              caveat: kappaCaveat(counts),
            }
          : null,
        negativeCases: negatives
          .filter((n) => n.code_id === c.id)
          .map((n) => {
            const seg = segById.get(n.segment_id);
            return seg
              ? ({
                  id: n.id,
                  segmentId: n.segment_id,
                  index: seg.index,
                  speaker: seg.speaker,
                  text: seg.text,
                  reason: n.reason,
                  status: n.status,
                  assignedToCode: (
                    assignBySeg.get(n.segment_id) ?? []
                  ).includes(i + 1),
                } as NegativeCaseView)
              : null;
          })
          .filter((n): n is NegativeCaseView => n !== null),
      };
    });

    // Theme roll-ups: re-run the same counting with every code of a theme
    // standing for the theme, so a turn or speaker is counted once.
    const themeNames: string[] = [];
    for (const cv of codeViews)
      if (cv.theme && !themeNames.includes(cv.theme)) themeNames.push(cv.theme);
    let themeRollups: ThemeRollup[] = [];
    if (themeNames.length > 0) {
      const themeIndex = new Map(themeNames.map((t, k) => [t, k + 1]));
      const themeAssign = new Map<string, number[]>();
      for (const [segId, nums] of assignBySeg) {
        const mapped = new Set<number>();
        for (const n of nums) {
          const t = codeViews[n - 1]?.theme;
          const idx = t ? themeIndex.get(t) : undefined;
          if (idx) mapped.add(idx);
        }
        if (mapped.size > 0) themeAssign.set(segId, [...mapped]);
      }
      const themeStats = computeCodeStats({
        segments,
        assignments: themeAssign,
        codeCount: themeNames.length,
        focusGroup,
      });
      themeRollups = themeNames.map((t, k) => {
        const members = codeViews.filter((cv) => cv.theme === t);
        return {
          theme: t,
          codeIds: members.map((m) => m.id),
          codeNames: members.map((m) => m.name),
          stats: themeStats[k],
          note: metaOf(t)?.note ?? "",
        };
      });
    }

    const readingRow = readingByDoc.get(book.document_id);
    const moderatorLabels = readingRow?.moderator_labels ?? [];
    const resolvedMode = readingRow?.segmentation_resolved ?? null;
    const speakerTurns = new Map<
      string,
      { turns: number; moderator: boolean }
    >();
    for (const sg of segments) {
      if (sg.speaker === null) continue;
      const cur = speakerTurns.get(sg.speaker) ?? {
        turns: 0,
        moderator: sg.role === "moderator",
      };
      cur.turns += 1;
      speakerTurns.set(sg.speaker, cur);
    }
    const reading: ReadingView = {
      requested: readingRow?.segmentation_mode ?? "auto",
      resolved: resolvedMode,
      moderators: moderatorLabels,
      summary: summariseSegmentation(
        segments,
        resolvedMode ?? "none",
        readingRow?.segmentation_notes ?? [],
      ),
      speakers: [...speakerTurns.entries()].map(([label, v]) => ({
        label,
        turns: v.turns,
        moderator: v.moderator,
      })),
      controlsAvailable: !readingMissing,
    };

    out.set(book.document_id, {
      documentId: book.document_id,
      codebookId: book.id,
      version: book.version,
      sessionType: focusGroup ? "focus_group" : "individual",
      codes: codeViews,
      themes: themeRollups,
      calibration:
        turns.length > 0
          ? {
              kind: calibrationKind,
              drawn: turns.length,
              reviewed: turns.filter((t) => t.reviewed).length,
              turns,
              estimate: auditEstimate,
            }
          : null,
      participantTurns: participantCount,
      suggestedAuditSize: auditSampleSize(participantCount),
      stability: stabilityView,
      respondents: respondentViews,
      surveyTables,
      caseTableId: setting?.case_table_id ?? null,
      caseColumn,
      links: docLinks.map((l) => ({
        id: l.id,
        codeName: l.codeName,
        variable: l.variable,
        direction: l.direction,
        rationale: l.rationale,
        status: l.status,
        source: l.source,
      })),
      dissonance,
      setupMissing,
      reading,
      meaningChecks: Object.fromEntries(meaningChecks),
      verbatims: segs
        .filter(
          (sg) => sg.document_id === book.document_id && sg.role !== "moderator",
        )
        .map((sg) => {
          const ids = (assignIdsBySeg.get(sg.id) ?? []).filter((cid) =>
            bookCodes.some((bc) => bc.id === cid),
          );
          return {
            segmentId: sg.id,
            index: sg.segment_index,
            speaker: sg.speaker,
            group: sessionOfSpeaker(sg.speaker),
            page: sg.page,
            text: sg.text,
            codeIds: ids,
            researcherCodeIds: ids.filter((cid) =>
              researcherPairs.has(`${sg.id}|${cid}`),
            ),
            note: turnNotes.get(sg.segment_index) ?? "",
          };
        }),
      overrides: overrideRows
        .filter((o) => o.document_id === book.document_id)
        .map((o) => {
          const sg = segById.get(o.segment_id);
          return {
            segmentId: o.segment_id,
            index: sg?.index ?? -1,
            speaker: sg?.speaker ?? null,
            text: sg?.text ?? "",
            codeName: o.code_name,
            action: o.action,
            createdAt: o.created_at,
          };
        }),
      researcherCodeIds: bookCodes
        .filter((c) => researcherCodes.has(c.id))
        .map((c) => c.id),
      quality: computeDataQuality({
        segments,
        assignments: assignIdsBySeg,
        codes: bookCodes.map((c) => ({ id: c.id, name: c.name })),
        truncated: truncatedByDoc.get(book.document_id) ?? null,
      }),
    });
  }
  return out;
}

/**
 * Denominators for the findings list: for each coded finding, how many of
 * the transcript's participants and turns support it, and in a focus group
 * how many of them were independent and in how many groups the theme came
 * up. Keyed by finding id.
 */
export type FindingCodingCounts = {
  turns: number;
  participantTurns: number;
  speakersWith: number | null;
  speakersTotal: number | null;
  independentSpeakers: number | null;
  echoTurns: number;
  groupsWith: number | null;
  groupsTotal: number | null;
  // The code behind the finding and the theme it sits under, when it has one.
  codeName: string;
  theme: string | null;
  // The theme as a whole, within this transcript, when the code sits under one.
  themeRollup: {
    codes: number;
    turns: number;
    speakersWith: number | null;
    speakersTotal: number | null;
  } | null;
};

export async function getFindingCodingCounts(
  tenantId: string,
  runId: string,
  analysis: Map<string, CodingAnalysisView>,
): Promise<Map<string, FindingCodingCounts>> {
  const out = new Map<string, FindingCodingCounts>();
  if (analysis.size === 0) return out;
  const byCodeId = new Map<string, CodeAnalysis>();
  const rollupByCodeId = new Map<string, ThemeRollup>();
  for (const view of analysis.values()) {
    for (const c of view.codes) byCodeId.set(c.id, c);
    for (const t of view.themes)
      for (const id of t.codeIds) rollupByCodeId.set(id, t);
  }
  try {
    const rows = await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ id: string; coding_code_id: string }>(
        "select id, coding_code_id from findings where run_id = $1 and coding_code_id is not null",
        [runId],
      );
      return r.rows;
    });
    for (const row of rows) {
      const c = byCodeId.get(row.coding_code_id);
      if (!c) continue;
      out.set(row.id, {
        turns: c.stats.turns,
        participantTurns: c.stats.participantTurns,
        speakersWith: c.stats.speakersWith,
        speakersTotal: c.stats.speakersTotal,
        independentSpeakers: c.stats.independentSpeakers,
        echoTurns: c.stats.echoTurns,
        groupsWith: c.groups?.with ?? null,
        groupsTotal: c.groups?.total ?? null,
        codeName: c.name,
        theme: c.theme,
        themeRollup: (() => {
          const t = rollupByCodeId.get(row.coding_code_id);
          return t && t.codeIds.length >= 1
            ? {
                codes: t.codeIds.length,
                turns: t.stats.turns,
                speakersWith: t.stats.speakersWith,
                speakersTotal: t.stats.speakersTotal,
              }
            : null;
        })(),
      });
    }
  } catch {
    // Same reasoning as getCodingAnalysis: counts are an addition, not a requirement.
  }
  return out;
}

// --- Session type, survey mapping ---------------------------------------------

async function ensureSettings(
  client: import("pg").PoolClient,
  tenantId: string,
  runId: string,
  documentId: string,
) {
  await client.query(
    `insert into coding_document_settings (tenant_id, run_id, document_id)
     values ($1, $2, $3) on conflict (document_id) do nothing`,
    [tenantId, runId, documentId],
  );
}

export async function setSessionType(
  tenantId: string,
  runId: string,
  documentId: string,
  sessionType: "individual" | "focus_group",
) {
  await withTenant(tenantId, async (client) => {
    await ensureSettings(client, tenantId, runId, documentId);
    await client.query(
      "update coding_document_settings set session_type = $2, updated_at = now() where document_id = $1",
      [documentId, sessionType],
    );
  });
}

export async function setCaseMapping(
  tenantId: string,
  runId: string,
  documentId: string,
  tableId: string | null,
  column: string | null,
) {
  await withTenant(tenantId, async (client) => {
    await ensureSettings(client, tenantId, runId, documentId);
    await client.query(
      `update coding_document_settings
       set case_table_id = $2, case_column = $3, updated_at = now() where document_id = $1`,
      [documentId, tableId, tableId ? column : null],
    );
  });
}

export async function setRespondentKey(
  tenantId: string,
  documentId: string,
  speakerKey: string,
  caseKey: string,
) {
  await withTenant(tenantId, async (client) => {
    if (!caseKey.trim()) {
      await client.query(
        "delete from coding_respondent_keys where document_id = $1 and speaker_key = $2",
        [documentId, speakerKey],
      );
      return;
    }
    await client.query(
      `insert into coding_respondent_keys (tenant_id, document_id, speaker_key, case_key)
       values ($1, $2, $3, $4)
       on conflict (document_id, speaker_key) do update set case_key = excluded.case_key`,
      [tenantId, documentId, speakerKey, caseKey.trim()],
    );
  });
}

// --- Calibration --------------------------------------------------------------

export async function startCalibration(
  tenantId: string,
  documentId: string,
  codebookId: string,
  options: { kind?: "targeted" | "audit"; size?: number } = {},
) {
  const kind = options.kind ?? "targeted";
  await withTenant(tenantId, async (client) => {
    const existing = await client.query(
      "select 1 from coding_calibration_samples where codebook_id = $1 limit 1",
      [codebookId],
    );
    if (existing.rows.length > 0) return;
    const codes = await client.query<{ id: string }>(
      "select id from coding_codes where codebook_id = $1 order by position",
      [codebookId],
    );
    const segs = await client.query<{
      id: string;
      segment_index: number;
      role: SegmentRole;
    }>(
      "select id, segment_index, role from coding_segments where document_id = $1",
      [documentId],
    );
    const assigned = await client.query<{
      segment_id: string;
      code_id: string;
    }>(
      `select a.segment_id, a.code_id from coding_assignments a
       join coding_codes c on c.id = a.code_id where c.codebook_id = $1`,
      [codebookId],
    );
    const numberOf = new Map(codes.rows.map((c, i) => [c.id, i + 1]));
    const bySeg = new Map<string, number[]>();
    for (const a of assigned.rows) {
      const n = numberOf.get(a.code_id);
      if (!n) continue;
      bySeg.set(a.segment_id, [...(bySeg.get(a.segment_id) ?? []), n]);
    }
    const pool = segs.rows.map((s) => ({
      id: s.id,
      index: s.segment_index,
      role: s.role,
      codes: bySeg.get(s.id) ?? [],
    }));
    if (kind === "audit") {
      const participants = pool.filter((p) => p.role !== "moderator").length;
      const size = Math.max(
        1,
        Math.min(
          participants,
          Math.round(options.size ?? auditSampleSize(participants)),
        ),
      );
      const picks = selectAuditSample(pool, {
        size,
        seed: `${codebookId}:audit`,
      });
      if (picks.length === 0) return;
      try {
        await client.query(
          `insert into coding_calibration_samples
             (tenant_id, codebook_id, segment_id, kind, stratum, stratum_size)
           select $1, $2, t.s, 'audit', t.k, t.z
           from unnest($3::uuid[], $4::text[], $5::int[]) as t(s, k, z)
           on conflict do nothing`,
          [
            tenantId,
            codebookId,
            picks.map((p) => p.id),
            picks.map((p) => p.stratum),
            picks.map((p) => p.stratumSize),
          ],
        );
      } catch {
        throw new Error(
          "A random audit needs database migration 0064. Run it and try again.",
        );
      }
      return;
    }
    const ids = selectCalibrationSample(
      pool,
      codes.rows.length,
      { size: CALIBRATION_SAMPLE_SIZE, seed: codebookId },
    );
    if (ids.length === 0) return;
    await client.query(
      `insert into coding_calibration_samples (tenant_id, codebook_id, segment_id)
       select $1, $2, s from unnest($3::uuid[]) as t(s) on conflict do nothing`,
      [tenantId, codebookId, ids],
    );
  });
}

export async function resetCalibration(tenantId: string, codebookId: string) {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `delete from coding_calibration_labels where code_id in
         (select id from coding_codes where codebook_id = $1)`,
      [codebookId],
    );
    await client.query(
      "delete from coding_calibration_samples where codebook_id = $1",
      [codebookId],
    );
  });
}

/**
 * Saves the researcher's coding of one sampled turn. Every code in the
 * codebook gets a row, so a code left unticked is recorded as "does not
 * apply" and counts in the agreement figures.
 */
export async function saveCalibrationTurn(
  tenantId: string,
  codebookId: string,
  segmentId: string,
  appliedCodeIds: string[],
) {
  await withTenant(tenantId, async (client) => {
    const sample = await client.query(
      "select 1 from coding_calibration_samples where codebook_id = $1 and segment_id = $2",
      [codebookId, segmentId],
    );
    if (sample.rows.length === 0)
      throw new Error("That turn is not in the calibration sample.");
    const codes = await client.query<{ id: string }>(
      "select id from coding_codes where codebook_id = $1",
      [codebookId],
    );
    const valid = new Set(codes.rows.map((c) => c.id));
    const applied = new Set(appliedCodeIds.filter((id) => valid.has(id)));
    await client.query(
      `delete from coding_calibration_labels where segment_id = $1 and code_id = any($2::uuid[])`,
      [segmentId, [...valid]],
    );
    await client.query(
      `insert into coding_calibration_labels (tenant_id, segment_id, code_id, applies)
       select $1, $2, t.c, t.a from unnest($3::uuid[], $4::boolean[]) as t(c, a)`,
      [
        tenantId,
        segmentId,
        [...valid],
        [...valid].map((id) => applied.has(id)),
      ],
    );
    await client.query(
      `update coding_calibration_samples set reviewed_at = now()
       where codebook_id = $1 and segment_id = $2`,
      [codebookId, segmentId],
    );
  });
}

// --- Stability of the coding -------------------------------------------------

/**
 * Stores the result of applying the codebook again. `original` is what the
 * stored coding was; each entry of `reruns` is one fresh application. The
 * original counts as one run. Replaces any earlier stability result for this
 * codebook.
 */
export async function saveStability(
  tenantId: string,
  codebookId: string,
  rows: { segmentId: string; stability: TurnStability; original: number[]; runCodes?: number[][] }[],
) {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "delete from coding_turn_stability where codebook_id = $1",
      [codebookId],
    );
    if (rows.length === 0) return;
    const base = [
      tenantId,
      codebookId,
      rows.map((r) => r.segmentId),
      rows.map((r) => r.stability.runs),
      rows.map((r) => r.stability.agree),
      rows.map((r) => `{${r.original.join(",")}}`),
      rows.map((r) => `{${r.stability.altCodes.join(",")}}`),
      rows.map((r) => `{${r.stability.droppedCodes.join(",")}}`),
    ];
    // Migration 0074 keeps what each re-run gave, so the coding can be settled by majority.
    const hasColumn = await client.query(
      `select 1 from information_schema.columns
        where table_name = 'coding_turn_stability' and column_name = 'run_codes'`,
    );
    if (hasColumn.rows.length > 0) {
      await client.query(
        `insert into coding_turn_stability
           (tenant_id, codebook_id, segment_id, runs, agree, orig_codes, alt_codes, dropped_codes, run_codes)
         select $1, $2, t.s, t.r, t.a, t.o::int[], t.al::int[], t.d::int[], t.rc::jsonb
         from unnest($3::uuid[], $4::int[], $5::int[], $6::text[], $7::text[], $8::text[], $9::text[])
           as t(s, r, a, o, al, d, rc)`,
        [...base, rows.map((r) => JSON.stringify(r.runCodes ?? []))],
      );
      return;
    }
    await client.query(
      `insert into coding_turn_stability
         (tenant_id, codebook_id, segment_id, runs, agree, orig_codes, alt_codes, dropped_codes)
       select $1, $2, t.s, t.r, t.a, t.o::int[], t.al::int[], t.d::int[]
       from unnest($3::uuid[], $4::int[], $5::int[], $6::text[], $7::text[], $8::text[])
         as t(s, r, a, o, al, d)`,
      base,
    );
  });
}

/**
 * Settles the coding by the majority of runs: a theme stays on a turn, or is added to it, when more than
 * half of the runs (the original included) gave it. This uses runs already paid for, so it adds no cost, and
 * it removes the one-run flips that make a single application unsteady. Turns the researcher has settled,
 * and any theme the researcher added or removed by hand, are left as they are.
 */
export async function applyMajorityCoding(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
): Promise<string> {
  void runId;
  void documentId;
  return withTenant(tenantId, async (client) => {
    const hasColumn = await client.query(
      `select 1 from information_schema.columns
        where table_name = 'coding_turn_stability' and column_name = 'run_codes'`,
    );
    if (hasColumn.rows.length === 0)
      throw new Error("Settling by majority needs database migration 0074. Run it, then run the stability check again.");
    const rows = (
      await client.query<{
        segment_id: string;
        runs: number;
        orig_codes: number[];
        run_codes: number[][] | null;
        resolved_at: string | null;
      }>(
        `select segment_id, runs, orig_codes, run_codes, resolved_at::text as resolved_at
           from coding_turn_stability where codebook_id = $1`,
        [codebookId],
      )
    ).rows;
    if (rows.length === 0) throw new Error("Run the stability check first.");
    if (rows.some((r) => !r.run_codes))
      throw new Error("That check was run before each run was kept. Run it again with 2 more times, then settle by majority.");
    const runs = rows[0].runs;
    if (runs < 3)
      throw new Error("A majority needs at least three runs: the original and two more. Run the check with 2 more times.");

    const codes = (
      await client.query<{ id: string; name: string }>(
        "select id, name from coding_codes where codebook_id = $1 order by position",
        [codebookId],
      )
    ).rows;
    const current = await client.query<{ segment_id: string; code_id: string; source: string }>(
      `select a.segment_id, a.code_id, a.source from coding_assignments a
         join coding_codes cc on cc.id = a.code_id where cc.codebook_id = $1`,
      [codebookId],
    );
    const have = new Map<string, Map<string, string>>();
    for (const a of current.rows) {
      const m = have.get(a.segment_id) ?? new Map<string, string>();
      m.set(a.code_id, a.source);
      have.set(a.segment_id, m);
    }
    // Themes the researcher added or removed by hand stay as they decided.
    const decided = new Set<string>();
    const overridesTable = await client.query("select to_regclass('coding_assignment_overrides') as t");
    if (overridesTable.rows[0]?.t) {
      const ov = await client.query<{ segment_id: string; code_key: string }>(
        `select o.segment_id, o.code_key from coding_assignment_overrides o
           join coding_segments sg on sg.id = o.segment_id where sg.document_id = $1`,
        [documentId],
      );
      for (const o of ov.rows) decided.add(`${o.segment_id}|${o.code_key}`);
    }

    const addSeg: string[] = [];
    const addCode: string[] = [];
    const delSeg: string[] = [];
    const delCode: string[] = [];
    const changedTurns = new Set<string>();
    for (const r of rows) {
      if (r.resolved_at) continue;
      const tally = new Map<number, number>();
      for (const c of new Set(r.orig_codes)) tally.set(c, (tally.get(c) ?? 0) + 1);
      for (const run of r.run_codes ?? []) for (const c of new Set(run)) tally.set(c, (tally.get(c) ?? 0) + 1);
      const mine = have.get(r.segment_id) ?? new Map<string, string>();
      for (let n = 1; n <= codes.length; n++) {
        const code = codes[n - 1];
        if (decided.has(`${r.segment_id}|${codeKey(code.name)}`)) continue;
        const keep = (tally.get(n) ?? 0) * 2 > runs;
        const has = mine.has(code.id);
        if (keep && !has) {
          addSeg.push(r.segment_id);
          addCode.push(code.id);
          changedTurns.add(r.segment_id);
        } else if (!keep && has && mine.get(code.id) === "model") {
          delSeg.push(r.segment_id);
          delCode.push(code.id);
          changedTurns.add(r.segment_id);
        }
      }
    }
    if (delSeg.length > 0)
      await client.query(
        `delete from coding_assignments
          where (segment_id, code_id) in (select * from unnest($1::uuid[], $2::uuid[]))`,
        [delSeg, delCode],
      );
    if (addSeg.length > 0)
      await client.query(
        `insert into coding_assignments (segment_id, code_id, tenant_id, source)
         select s, c, $3, 'model' from unnest($1::uuid[], $2::uuid[]) as t(s, c)
         on conflict do nothing`,
        [addSeg, addCode, tenantId],
      );
    await client.query("update coding_turn_stability set consensus_at = now() where codebook_id = $1", [codebookId]);
    return (
      `Coding settled by the majority of ${runs} runs: ${addSeg.length} theme${addSeg.length === 1 ? "" : "s"} added ` +
      `and ${delSeg.length} removed across ${changedTurns.size} turn${changedTurns.size === 1 ? "" : "s"}.`
    );
  });
}

/**
 * Applies the stored codebook to the same turns again, `reruns` more times,
 * and keeps which turns came out differently. The original coding counts as
 * the first run. Each re-run is as long as the original application, so the
 * cost grows with `reruns`. Nothing about the stored coding changes.
 */
export async function runStabilityCheck(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  reruns: number,
): Promise<string> {
  const count = Math.min(3, Math.max(1, Math.round(reruns)));
  const { codes, segments, original } = await withTenant(
    tenantId,
    async (client) => {
      const c = await client.query<{
        id: string;
        position: number;
        name: string;
        definition: string;
        inclusion_criteria: string | null;
        exclusion_criteria: string | null;
        reproduced_runs: number | null;
        total_runs: number | null;
      }>(
        `select id, position, name, definition, inclusion_criteria, exclusion_criteria, reproduced_runs, total_runs
         from coding_codes where codebook_id = $1 order by position`,
        [codebookId],
      );
      const sg = await client.query<{
        id: string;
        segment_index: number;
        speaker: string | null;
        role: SegmentRole;
        page: number | null;
        text: string;
      }>(
        `select id, segment_index, speaker, role, page, text
         from coding_segments where document_id = $1 and run_id = $2 order by segment_index`,
        [documentId, runId],
      );
      const a = await client.query<{ segment_id: string; code_id: string }>(
        `select a.segment_id, a.code_id from coding_assignments a
         join coding_codes cc on cc.id = a.code_id
         where cc.codebook_id = $1 and a.source = 'model'`,
        [codebookId],
      );
      return { codes: c.rows, segments: sg.rows, original: a.rows };
    },
  );
  if (codes.length === 0 || segments.length === 0)
    throw new Error("This transcript has no stored coding to check.");
  // The stored coding is run 1. If it was made by an older version of the coding step, every difference
  // the check finds would come from the update, not from the model's consistency.
  const lastApply = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ prompt_hash: string }>(
      `select prompt_hash from coding_run_manifest
        where codebook_id = $1 and stage = 'apply' order by created_at desc limit 1`,
      [codebookId],
    );
    return r.rows[0]?.prompt_hash ?? null;
  }).catch(() => null);
  if (lastApply && lastApply !== APPLY_PROMPT_HASH)
    throw new Error(
      "This coding was made by an earlier version of the coding step. Apply the codebook again first, then check stability, otherwise the differences found come from the update and not from the model.",
    );
  const codeRows: CodeRow[] = codes.map((c) => ({
    id: c.id,
    position: c.position,
    name: c.name,
    definition: c.definition,
    inclusion: c.inclusion_criteria ?? "",
    exclusion: c.exclusion_criteria ?? "",
    reproducedRuns: c.reproduced_runs,
    totalRuns: c.total_runs,
  }));
  const stored: StoredSegment[] = segments.map((s) => ({
    id: s.id,
    index: s.segment_index,
    speaker: s.speaker,
    role: s.role,
    page: s.page,
    text: s.text,
  }));
  const numberOf = new Map(codes.map((c, i) => [c.id, i + 1]));
  const indexOfSeg = new Map(segments.map((s) => [s.id, s.segment_index]));
  const originalByIndex = new Map<number, number[]>();
  for (const a of original) {
    const n = numberOf.get(a.code_id);
    const idx = indexOfSeg.get(a.segment_id);
    if (!n || idx === undefined) continue;
    originalByIndex.set(idx, [...(originalByIndex.get(idx) ?? []), n]);
  }

  const results: Map<number, number[]>[] = [];
  let failedAny = 0;
  let creditStopAt = 0;
  for (let i = 0; i < count; i++) {
    relabelCodingWork(documentId, `Stability check, pass ${i + 1} of ${count}`);
    let applied: Awaited<ReturnType<typeof applyCodebook>>;
    try {
      applied = await applyCodebook(
        tenantId,
        runId,
        documentId,
        codebookId,
        codeRows,
        stored,
        "stability_rerun",
      );
    } catch (error) {
      // Out of credit part-way: keep the passes that finished instead of throwing away the money already spent.
      if (error instanceof Error && /run out of credit/i.test(error.message) && results.length > 0) {
        creditStopAt = i + 1;
        clearCodingLabel(documentId);
        break;
      }
      throw error;
    }
    if (i === count - 1) clearCodingLabel(documentId);
    // A re-run with failed batches would read as disagreement. Drop it.
    if (applied.failedBatches > 0) {
      failedAny += 1;
      continue;
    }
    results.push(applied.assignments);
  }
  if (results.length === 0)
    throw new Error(
      "The codebook could not be applied again. Try again in a moment.",
    );

  const participants = stored.filter((s) => s.role !== "moderator");
  const stability = compareRuns(
    originalByIndex,
    results,
    participants.map((p) => p.index),
  );
  const idByIndex = new Map(stored.map((s) => [s.index, s.id]));
  await saveStability(
    tenantId,
    codebookId,
    stability.map((st) => ({
      segmentId: idByIndex.get(st.index)!,
      stability: st,
      original: originalByIndex.get(st.index) ?? [],
      runCodes: results.map((res) => res.get(st.index) ?? []),
    })),
  );
  const summary = summariseStability(stability);
  return (
    `Applied the codebook ${results.length} more time${results.length === 1 ? "" : "s"}. ` +
    `${summary.stable} of ${summary.turns} turns came out the same every time.` +
    (failedAny > 0
      ? ` ${failedAny} re-run${failedAny === 1 ? "" : "s"} failed and ${failedAny === 1 ? "was" : "were"} left out.`
      : "") +
    (creditStopAt > 0
      ? ` The AI service ran out of credit during pass ${creditStopAt} of ${count}, so this uses the ${results.length} pass${results.length === 1 ? "" : "es"} that finished.`
      : "")
  );
}

/**
 * Step one of settling a flagged turn: the researcher's own coding, saved
 * before the model's themes or the other runs are shown. Once saved it is
 * locked, so it cannot be rewritten after seeing the model's side.
 */
export async function saveBlindStabilityTurn(
  tenantId: string,
  codebookId: string,
  segmentId: string,
  codeIds: string[],
) {
  await withTenant(tenantId, async (client) => {
    const valid = await client.query<{ id: string }>(
      "select id from coding_codes where codebook_id = $1",
      [codebookId],
    );
    const ok = new Set(valid.rows.map((c) => c.id));
    const ids = codeIds.filter((id) => ok.has(id));
    try {
      await client.query(
        `update coding_turn_stability set blind_codes = $3::uuid[], blind_at = now()
         where codebook_id = $1 and segment_id = $2 and blind_at is null`,
        [codebookId, segmentId, ids],
      );
    } catch {
      throw new Error(
        "Blind review needs database migration 0065. Run it and try again.",
      );
    }
  });
}

/**
 * Step two: the final decision. `changes` are the themes added or removed
 * relative to what is on the turn now; an empty list means the model's themes
 * stand. Either way the turn leaves the queue, and whether it changed is kept
 * for the attention check.
 */
export async function resolveStabilityTurn(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  segmentId: string,
  changes: { codeId: string; action: "add" | "remove" }[],
) {
  await withTenant(tenantId, async (client) => {
    let blindAt: string | null | undefined;
    try {
      const r = await client.query<{ blind_at: string | null }>(
        "select blind_at::text as blind_at from coding_turn_stability where codebook_id = $1 and segment_id = $2",
        [codebookId, segmentId],
      );
      blindAt = r.rows[0]?.blind_at;
    } catch {
      throw new Error(
        "Blind review needs database migration 0065. Run it and try again.",
      );
    }
    if (!blindAt) throw new Error("Code the turn yourself first, then settle it.");
  });
  for (const c of changes)
    await changeTurnCode(
      tenantId,
      runId,
      documentId,
      segmentId,
      c.codeId,
      c.action,
    );
  await withTenant(tenantId, async (client) => {
    await client.query(
      `update coding_turn_stability
         set resolved_at = coalesce(resolved_at, now()),
             changed = coalesce(changed, false) or $3
       where codebook_id = $1 and segment_id = $2`,
      [codebookId, segmentId, changes.length > 0],
    );
  });
}

// --- Links to closed questions ---------------------------------------------

const LINK_SYSTEM =
  "You help a researcher connect the themes found in interviews to closed questions in the survey " +
  "the same people answered. For each theme, name at most two numeric survey questions where a " +
  "person who voices the theme would be expected to answer higher, or lower, than a person who does " +
  "not. Propose a link only when the connection is clear from the wording of the question and the " +
  "theme's definition. Skip a theme that has no sensible counterpart; most themes will have none. " +
  "Use the exact column name. Give one sentence stating the expectation, such as: people who say the " +
  "fees are too high should rate fee satisfaction low.";

const LINK_TOOLS = [
  {
    name: "record_links",
    description: "Records proposed links between themes and survey questions.",
    input_schema: {
      type: "object" as const,
      properties: {
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: {
                type: "integer",
                description: "The theme number as shown.",
              },
              variable: {
                type: "string",
                description: "Exact survey column name.",
              },
              direction: {
                type: "string",
                enum: ["higher", "lower"],
                description:
                  "Whether people who voice the theme should answer higher or lower than those who do not.",
              },
              rationale: { type: "string" },
            },
            required: ["code", "variable", "direction", "rationale"],
          },
        },
      },
      required: ["links"],
    },
  },
];

type CodeDetail = {
  id: string;
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
};

async function loadCodes(
  tenantId: string,
  codebookId: string,
): Promise<CodeDetail[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<CodeDetail>(
      `select id, name, definition, inclusion_criteria as inclusion, exclusion_criteria as exclusion
       from coding_codes where codebook_id = $1 order by position`,
      [codebookId],
    );
    return r.rows;
  });
}

function themeBlock(codes: CodeDetail[]): string {
  return codes
    .map(
      (c, i) =>
        `${i + 1}. ${c.name}\n   Definition: ${c.definition}` +
        (c.inclusion ? `\n   Code when: ${c.inclusion}` : "") +
        (c.exclusion ? `\n   Do not code when: ${c.exclusion}` : ""),
    )
    .join("\n");
}

export async function proposeVariableLinks(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
): Promise<{ proposed: number }> {
  const codes = await loadCodes(tenantId, codebookId);
  if (codes.length === 0)
    throw new Error("This transcript has no codebook yet.");
  const mapping = await withTenant(tenantId, async (client) => {
    const r = await client.query<{
      case_table_id: string | null;
      case_column: string | null;
    }>(
      "select case_table_id, case_column from coding_document_settings where document_id = $1",
      [documentId],
    );
    const s = r.rows[0];
    if (!s?.case_table_id) return null;
    const t = await client.query<{ headers: string[]; rows: TableRow[] }>(
      "select headers, rows from document_tables where id = $1",
      [s.case_table_id],
    );
    return t.rows[0] ? { ...t.rows[0], caseColumn: s.case_column } : null;
  });
  if (!mapping)
    throw new Error(
      "Choose the survey table these respondents answered first.",
    );
  const rows = rowsToArrays(mapping.headers, mapping.rows ?? []);
  const vars = numericVariables(mapping.headers, rows).filter(
    (v) => v.name !== mapping.caseColumn,
  );
  if (vars.length === 0)
    throw new Error("The chosen table has no numeric questions to link to.");
  const described = vars.map((v) => {
    const col = mapping.headers.indexOf(v.name);
    const values = rows
      .map((r) => parseNumber(r[col]))
      .filter((n): n is number => n !== null);
    return `- ${v.name} (answers range ${Math.min(...values)} to ${Math.max(...values)})`;
  });
  const user = `Themes:\n${themeBlock(codes)}\n\nNumeric survey questions:\n${described.join("\n")}`;
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    system: LINK_SYSTEM,
    tool_choice: { type: "tool", name: "record_links" },
    tools: LINK_TOOLS,
    messages: [{ role: "user", content: user }],
  });
  await logApiUsage(tenantId, runId, "coding_link_proposal", response.usage);
  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use")
    throw new Error("The model did not return any proposals.");
  const proposals = validateLinkProposals(
    (toolUse.input as { links?: unknown }).links,
    codes.length,
    vars.map((v) => v.name),
  );
  await recordManifest(tenantId, runId, documentId, {
    codebookId,
    stage: "link_proposal",
    runIndex: 0,
    promptHash: sha256(LINK_SYSTEM + JSON.stringify(LINK_TOOLS)),
    inputHash: sha256(user),
    detail: {
      themes: codes.length,
      variables: vars.length,
      proposals: proposals.length,
    },
  });
  if (proposals.length === 0) return { proposed: 0 };
  await withTenant(tenantId, async (client) => {
    for (const p of proposals) {
      await client.query(
        `insert into coding_variable_links
           (tenant_id, run_id, document_id, code_name, variable, direction, rationale)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (document_id, code_name, variable) do nothing`,
        [
          tenantId,
          runId,
          documentId,
          codes[p.code - 1].name,
          p.variable,
          p.direction,
          p.rationale,
        ],
      );
    }
  });
  return { proposed: proposals.length };
}

export async function addVariableLink(
  tenantId: string,
  runId: string,
  documentId: string,
  link: { codeName: string; variable: string; direction: "higher" | "lower" },
) {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `insert into coding_variable_links
         (tenant_id, run_id, document_id, code_name, variable, direction, rationale, status, source)
       values ($1, $2, $3, $4, $5, $6, 'Added by the researcher.', 'accepted', 'researcher')
       on conflict (document_id, code_name, variable) do update
         set direction = excluded.direction, status = 'accepted'`,
      [
        tenantId,
        runId,
        documentId,
        link.codeName,
        link.variable,
        link.direction,
      ],
    );
  });
}

export async function setLinkStatus(
  tenantId: string,
  runId: string,
  linkIds: string[],
  status: "proposed" | "accepted" | "rejected",
) {
  if (linkIds.length === 0) return;
  await withTenant(tenantId, async (client) => {
    await client.query(
      "update coding_variable_links set status = $3 where run_id = $1 and id = any($2::uuid[])",
      [runId, linkIds, status],
    );
  });
}

// --- Negative cases ---------------------------------------------------------

const NEGATIVE_SYSTEM =
  "You search coded qualitative data for evidence against its own themes. You are given a codebook " +
  "and a batch of numbered participant turns. Find turns that contradict a theme, or clearly qualify " +
  "it: the participant describes the opposite experience, an exception, or says the theme does not " +
  "apply to them. For each, give the theme number, the turn number and one sentence on how it " +
  "conflicts. Judge only what the participant said in that turn. Most turns conflict with nothing, " +
  "so report only real conflicts and return an empty list if there are none.";

const NEGATIVE_TOOLS = [
  {
    name: "record_negative_cases",
    description: "Records turns that contradict or qualify a theme.",
    input_schema: {
      type: "object" as const,
      properties: {
        cases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: {
                type: "integer",
                description: "The theme number as shown.",
              },
              index: {
                type: "integer",
                description: "The turn number as shown.",
              },
              reason: { type: "string" },
            },
            required: ["code", "index", "reason"],
          },
        },
      },
      required: ["cases"],
    },
  },
];

export async function searchNegativeCases(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
): Promise<{ found: number; failedBatches: number; totalBatches: number }> {
  const codes = await loadCodes(tenantId, codebookId);
  if (codes.length === 0)
    throw new Error("This transcript has no codebook yet.");
  const segments = await withTenant(tenantId, async (client) => {
    const r = await client.query<{
      id: string;
      segment_index: number;
      speaker: string | null;
      role: SegmentRole;
      text: string;
    }>(
      `select id, segment_index, speaker, role, text from coding_segments
       where document_id = $1 order by segment_index`,
      [documentId],
    );
    return r.rows;
  });
  const idByIndex = new Map(segments.map((s) => [s.segment_index, s.id]));
  const batches = buildApplyBatches(
    segments.map((s) => ({
      index: s.segment_index,
      speaker: s.speaker,
      role: s.role,
      text: s.text,
    })),
  );
  const block = themeBlock(codes);
  const results = await mapWithConcurrency(
    batches,
    MODEL_CONCURRENCY,
    async (batch, batchIndex) => {
      try {
        const turns = batch.items
          .map(
            (item) =>
              `[${item.index}] ` +
              (item.context ? `(question asked: "${item.context}") ` : "") +
              item.text,
          )
          .join("\n");
        // Every batch sends the same codebook: it comes first and is cached (promptCache.ts), with
        // the instructions, so later batches read it at a tenth of the price. Same text as before,
        // so the recorded input hash is unchanged.
        const codebookPart = `Codebook:\n${block}`;
        const turnsPart = `\n\nTurns:\n${turns}`;
        const user = codebookPart + turnsPart;
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          system: cachedSystem(NEGATIVE_SYSTEM),
          tool_choice: { type: "tool", name: "record_negative_cases" },
          tools: NEGATIVE_TOOLS,
          messages: [cachedUserThen(codebookPart, turnsPart)],
        });
        await logApiUsage(
          tenantId,
          runId,
          "coding_negative_cases",
          response.usage,
        );
        const toolUse = response.content.find((b) => b.type === "tool_use");
        if (
          !toolUse ||
          toolUse.type !== "tool_use" ||
          response.stop_reason === "max_tokens"
        ) {
          await recordTrace(tenantId, runId, "negative_case_batch_failed", {
            document_id: documentId,
            batch: batchIndex,
            reason:
              response.stop_reason === "max_tokens"
                ? "max_tokens"
                : "no_tool_use",
          });
          return null;
        }
        const parsed = parseNegativeCases(
          (toolUse.input as { cases?: unknown }).cases,
          new Set(batch.items.map((i) => i.index)),
          codes.length,
        );
        await recordManifest(tenantId, runId, documentId, {
          codebookId,
          stage: "negative_case_search",
          runIndex: batchIndex,
          promptHash: sha256(NEGATIVE_SYSTEM + JSON.stringify(NEGATIVE_TOOLS)),
          inputHash: sha256(user),
          detail: { turns: batch.items.length, reported: parsed.length },
        });
        return parsed;
      } catch (error) {
        await recordTrace(tenantId, runId, "negative_case_batch_failed", {
          document_id: documentId,
          batch: batchIndex,
          reason: error instanceof Error ? error.message.slice(0, 300) : "error",
        });
        return null;
      }
    },
  );

  const merged: NegativeCaseProposal[] = [];
  const perCode = new Map<number, number>();
  let failed = 0;
  for (const result of results) {
    if (!result) {
      failed += 1;
      continue;
    }
    for (const c of result) {
      if ((perCode.get(c.code) ?? 0) >= MAX_NEGATIVE_CASES_PER_CODE) continue;
      perCode.set(c.code, (perCode.get(c.code) ?? 0) + 1);
      merged.push(c);
    }
  }
  // If every batch failed, leave the existing results alone rather than
  // wiping them for nothing.
  if (batches.length > 0 && failed === batches.length)
    throw new Error("The search failed on every batch. Nothing was changed.");

  await withTenant(tenantId, async (client) => {
    // A new search refreshes what is still pending and keeps whatever the
    // researcher already confirmed or dismissed.
    await client.query(
      `delete from coding_negative_cases where status = 'pending'
         and code_id in (select id from coding_codes where codebook_id = $1)`,
      [codebookId],
    );
    for (const c of merged) {
      const segmentId = idByIndex.get(c.index);
      if (!segmentId) continue;
      await client.query(
        `insert into coding_negative_cases
           (tenant_id, run_id, document_id, code_id, segment_id, reason)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (code_id, segment_id) do nothing`,
        [
          tenantId,
          runId,
          documentId,
          codes[c.code - 1].id,
          segmentId,
          c.reason,
        ],
      );
    }
  });
  return {
    found: merged.length,
    failedBatches: failed,
    totalBatches: batches.length,
  };
}

export async function setNegativeCaseStatus(
  tenantId: string,
  runId: string,
  id: string,
  status: "pending" | "confirmed" | "dismissed",
) {
  await withTenant(tenantId, async (client) => {
    await client.query(
      "update coding_negative_cases set status = $3 where run_id = $1 and id = $2",
      [runId, id, status],
    );
  });
}

// --- Across transcripts -----------------------------------------------------

export type CrossThemeRow = {
  theme: string;
  // Codes that sit under the theme in at least one transcript. Empty for a
  // stand-alone code.
  codes: string[];
  perDocument: {
    documentId: string;
    present: boolean;
    turns: number;
    speakersWith: number | null;
    speakersTotal: number | null;
  }[];
  documentsWith: number;
  documentsTotal: number;
  // Participants who raised it, summed over transcripts. Null when a
  // transcript has no speaker labels, because the sum would then understate.
  speakersWith: number | null;
  speakersTotal: number | null;
  turns: number;
};

/**
 * One row per theme (or stand-alone code) across all coded transcripts of a
 * run, matched by name. Participants are counted per transcript and added up,
 * so the same person in two files would count twice: the table says "people
 * in files", which is the honest unit when files are not linked.
 */
export function crossTranscriptThemes(
  analysis: Map<string, CodingAnalysisView>,
): CrossThemeRow[] {
  const docIds = [...analysis.keys()];
  const rows = new Map<string, CrossThemeRow>();
  const ensure = (name: string): CrossThemeRow => {
    const key = name.trim().toLowerCase();
    let row = rows.get(key);
    if (!row) {
      row = {
        theme: name,
        codes: [],
        perDocument: [],
        documentsWith: 0,
        documentsTotal: docIds.length,
        speakersWith: 0,
        speakersTotal: 0,
        turns: 0,
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const [documentId, view] of analysis) {
    const seen = new Set<string>();
    const add = (
      name: string,
      codes: string[],
      stats: CodeStats,
    ) => {
      const row = ensure(name);
      seen.add(name.trim().toLowerCase());
      for (const c of codes)
        if (c.toLowerCase() !== name.toLowerCase() && !row.codes.includes(c))
          row.codes.push(c);
      const present = stats.turns > 0;
      row.perDocument.push({
        documentId,
        present,
        turns: stats.turns,
        speakersWith: stats.speakersWith,
        speakersTotal: stats.speakersTotal,
      });
      if (present) row.documentsWith += 1;
      row.turns += stats.turns;
      row.speakersWith =
        row.speakersWith === null || stats.speakersWith === null
          ? null
          : row.speakersWith + stats.speakersWith;
      row.speakersTotal =
        row.speakersTotal === null || stats.speakersTotal === null
          ? null
          : row.speakersTotal + stats.speakersTotal;
    };
    for (const t of view.themes) add(t.theme, t.codeNames, t.stats);
    for (const c of view.codes) {
      if (c.theme) continue;
      add(c.name, [], c.stats);
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.documentsWith - a.documentsWith ||
      (b.speakersWith ?? 0) - (a.speakersWith ?? 0) ||
      a.theme.localeCompare(b.theme),
  );
}
