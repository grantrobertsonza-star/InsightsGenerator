import { computeDataQuality, type DataQuality } from "./qualQuality";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant, withTenantRead } from "./db";
import { recordManifest } from "./extractThemes";
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
  // Only filled once the turn has been reviewed, so the researcher codes it
  // without seeing what the model decided.
  researcherCodeIds: string[];
  modelCodeIds: string[];
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

export type CodeAnalysis = {
  id: string;
  name: string;
  number: number;
  stats: CodeStats;
  // Focus groups only: groups in this run where a code of the same name
  // was applied, out of all focus groups coded.
  // names lists the groups where it came up.
  groups: { with: number; total: number; names: string[] } | null;
  agreement: {
    counts: AgreementCounts;
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
  calibration: {
    drawn: number;
    reviewed: number;
    turns: CalibrationTurn[];
  } | null;
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
        const r = await client.query<TableRecord>(
          `select id, document_id, table_index, label, headers, rows
           from document_tables where run_id = $1 order by document_id, table_index`,
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
  ]);

  // Survey tables the respondents can be matched to.
  type TableRecord = {
    id: string;
    document_id: string;
    table_index: number;
    label: string | null;
    headers: string[];
    rows: TableRow[];
  };
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const surveyTables: SurveyTableOption[] = tables.map((t) => ({
    id: t.id,
    label: `${docName.get(t.document_id) ?? "Table"}${t.label ? `, ${t.label}` : ` (table ${t.table_index + 1})`}`,
    headers: t.headers,
    numeric: numericVariables(
      t.headers,
      rowsToArrays(t.headers, t.rows ?? []),
    ).map((v) => v.name),
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

  for (const book of books) {
    const meaningChecks = await loadMeaningChecks(tenantId, book.document_id);
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
      return {
        id: c.id,
        name: c.name,
        number: i + 1,
        stats: stats[i],
        groups,
        agreement: counts
          ? {
              counts,
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
      calibration:
        turns.length > 0
          ? {
              drawn: turns.length,
              reviewed: turns.filter((t) => t.reviewed).length,
              turns,
            }
          : null,
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
};

export async function getFindingCodingCounts(
  tenantId: string,
  runId: string,
  analysis: Map<string, CodingAnalysisView>,
): Promise<Map<string, FindingCodingCounts>> {
  const out = new Map<string, FindingCodingCounts>();
  if (analysis.size === 0) return out;
  const byCodeId = new Map<string, CodeAnalysis>();
  for (const view of analysis.values())
    for (const c of view.codes) byCodeId.set(c.id, c);
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
) {
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
    const ids = selectCalibrationSample(
      segs.rows.map((s) => ({
        id: s.id,
        index: s.segment_index,
        role: s.role,
        codes: bySeg.get(s.id) ?? [],
      })),
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
        const user = `Codebook:\n${block}\n\nTurns:\n${turns}`;
        const response = await anthropic.messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 4000,
          system: NEGATIVE_SYSTEM,
          tool_choice: { type: "tool", name: "record_negative_cases" },
          tools: NEGATIVE_TOOLS,
          messages: [{ role: "user", content: user }],
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
        )
          return null;
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
      } catch {
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
