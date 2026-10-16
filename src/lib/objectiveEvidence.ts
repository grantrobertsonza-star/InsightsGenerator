import type Anthropic from "@anthropic-ai/sdk";
import type { PoolClient } from "pg";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant, withTenantRepeatableRead } from "./db";
import { buildCrosstab, loadCrosstab, loadVariableDictionary, loadVariableDictionaryWithStatus } from "./crosstabs";
import { resolveSurveyDesign, effectiveDesignChoice } from "./surveyDesign";
import { loadDataSetupWithStatus } from "./dataSetup";
import { planCrosstabFromText } from "./crosstabAsk";
import { isLookupEligible } from "./variableKinds";
import { defaultWeight } from "./starterTables";
import { capWords, parseNumberedItems } from "./text";
import { isCaseTableFileName, isStatsFileName } from "./statsFileName";
import {
  combineStances,
  locateRow,
  parseExpectation,
  readExpectation,
  responseSelectorCandidates,
  responseSelectorUnresolved,
  selectorAcceptance,
  type EvidenceEstimate,
  type Expectation,
  type Stance,
} from "./evidenceStance";
import type { CrosstabResult } from "./parseStatsFile";

/**
 * The objective evidence lane. Each research objective (and confirmed
 * decision) is broken into a few evidence questions: what is measured, for
 * whom, and what result would support or undermine it. Each question is
 * answered with a table from the same engine as every other crosstab, and the
 * result is stored as evidence with a stance: supports, against, mixed,
 * inconclusive, or silent.
 *
 * It needs no column and no significance. An estimate with its interval, a
 * comparison of two groups, or a level against a stated threshold all count.
 * Where the expectation is measurable the stance is computed in code
 * (evidenceStance.ts) and labelled "computed". Otherwise the model reads the
 * table and the stance is labelled "judged".
 *
 * The questions, and the margin for "no meaningful difference", are written
 * before any table is seen, so the expectation cannot be fitted to the result.
 * They are stored visibly and can be edited or excluded; the lane runs on its
 * own by default.
 *
 * Deliberately separate from finding extraction and from discovery: those stay
 * objective-blind so patterns that fit no objective can still surface.
 */

export type EvidenceQuestion = {
  id: string;
  item_kind: "objective" | "decision";
  item_order: number;
  /** The candidate this question is currently linked to (migration 0081; set null when that
   *  candidate is deleted). Identity is decided by evidenceIdentity together with the recorded
   *  origin below - an unlinked row is never matched by position alone. */
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
  /** OBJ-REV-001/002 Rule B (migration 0095): the candidate this row was written for, kept even
   *  after that candidate is deleted (no foreign key). Null for a known free-text origin, or when
   *  the origin was never recorded (see origin_recorded). */
  origin_candidate_id: string | null;
  /** True only when the writer explicitly recorded the origin. False for rows written before
   *  0095 with no candidate link, and for every row read on a database without 0095. */
  origin_recorded: boolean;
  item_text: string;
  question: string;
  request_text: string;
  supports_if: string;
  against_if: string;
  expectation: Expectation | null;
  source: "auto" | "edited" | "manual";
  excluded: boolean;
  /** Bumped by editEvidenceQuestion on a wording change; see migration 0082 (OBJ-REV-007). */
  question_revision: number;
  /** Derived from `results`: the stance across data sets, and how it was decided. */
  stance: Stance | null;
  basis: "computed" | "judged" | null;
  error: string | null;
  /** One answer per data file. */
  results: DatasetResult[];
};

export type DatasetResult = {
  document_id: string;
  dataset_name: string;
  table_id: string | null;
  stance: Stance | null;
  basis: "computed" | "judged" | null;
  estimate: EvidenceEstimate | null;
  summary: string | null;
  error: string | null;
  evaluated_at: string | null;
  /** OBJ-REV-007: true when this result was computed from a built crosstab table (migration
   * 0086's had_table) that `table_id` no longer points to - the table (or its document) was
   * deleted after this result was stored. `table_id is null` alone can't tell this apart from
   * a result that never had a table to begin with (the "no matching variable" silent verdict),
   * which also stores no table_id. A stale result's stance/summary are what was once computed,
   * not evidence that still exists to re-check - shape()/rollUp() exclude it from "answered",
   * and it becomes eligible for pendingPairs to re-evaluate again. Always false on a
   * pre-migration-0086 database (the column doesn't exist yet), same as every other
   * migration-guarded flag in this codebase. */
  stale: boolean;
};

export type ItemEvidence = {
  item_kind: "objective" | "decision";
  item_order: number;
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
  item_text: string;
  stance: Stance;
  questions: EvidenceQuestion[];
  /** The group's identity key (evidenceIdentity): stable, and distinct for groups with no proved common origin. */
  key: string;
  /** How the group's identity was established (evidenceIdentity). */
  identity: EvidenceIdentityState;
  /** True when the group belongs to no current objective or decision (see rollUp). */
  orphaned: boolean;
};

type RawItem = { kind: "objective" | "decision"; order: number; text: string; candidateId: string | null };

const MAX_QUESTIONS_PER_ITEM = 3;
const COLUMNS = `id, item_kind, item_order, objective_candidate_id, decision_candidate_id, item_text, question, request_text, supports_if, against_if, expectation, source, excluded, question_revision`;

/**
 * OBJ-REV-001 / OBJ-REV-002, Rule B (migration 0095): the identity an evidence row (or a rollUp
 * group) is matched on, and the identity of a current objective or decision. One rule, shared by
 * rollUp, evidenceDigest, the validator lookup (objectiveValidator.ts), the generation "kept"
 * check and the listing's orphan classification.
 *
 * Row identity, from the row's current candidate link and its recorded origin only. Nothing is
 * inferred from wording, position, generation_id or objective_candidates_seeded:
 *   - "linked":   a current candidate link of the row's own kind -> `id:<candidate>`. Associates
 *                 only with that candidate, across any reorder (unchanged behaviour).
 *   - "deleted":  no link, origin recorded as a candidate (the candidate was deleted, 0081's set
 *                 null) -> `deleted:<kind>:<origin candidate>`. Never matches a current item,
 *                 including a free-text objective with identical wording and position.
 *   - "text":     no link, origin explicitly recorded as free text -> `text:<kind>:<order>:<text>`.
 *                 The ONLY state that may match a current free-text item, and only when kind,
 *                 position and normalised wording (whitespace and case) all agree. This is the
 *                 bounded free-text matching policy, not a claim of identity across an arbitrary
 *                 delete-and-recreate of identical free text.
 *   - "unknown":  no link, origin never recorded (written before 0095, or read without 0095) ->
 *                 `unknown:<row id>`. Distinct per row, so unrelated historical rows sharing text
 *                 and position never merge; never matches a current item.
 *   - "conflict": link and origin disagree, a link of the other kind is set, or an origin
 *                 candidate is present without the explicit record -> `conflict:<row id>`. Fails
 *                 closed: never matches, never silently picks an identity.
 */
export type EvidenceIdentityState = "linked" | "text" | "deleted" | "unknown" | "conflict";

/** A current objective or decision: an accepted candidate, or a free-text line when its kind has no accepted candidates. */
export type CurrentEvidenceItem = { kind: "objective" | "decision"; order: number; text: string; candidateId: string | null };

type IdentityRow = {
  id: string;
  item_kind: "objective" | "decision";
  item_order: number;
  item_text: string;
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
  origin_candidate_id?: string | null;
  origin_recorded?: boolean | null;
};

// Stored item_text is capWords(text, 40) (publishGeneratedQuestions), so a current item's text is
// capped the same way before comparing; otherwise a long objective could never match its own rows.
function normaliseItemText(text: string): string {
  return capWords(text, 40).replace(/\s+/g, " ").trim().toLowerCase();
}

export function currentItemKey(item: CurrentEvidenceItem): string {
  return item.candidateId ? `id:${item.candidateId}` : `text:${item.kind}:${item.order}:${normaliseItemText(item.text)}`;
}

export function evidenceIdentity(row: IdentityRow): { state: EvidenceIdentityState; key: string } {
  const link = row.item_kind === "objective" ? row.objective_candidate_id : row.decision_candidate_id;
  const otherKindLink = row.item_kind === "objective" ? row.decision_candidate_id : row.objective_candidate_id;
  const recorded = row.origin_recorded === true;
  const origin = row.origin_candidate_id ?? null;
  const conflict = { state: "conflict" as const, key: `conflict:${row.id}` };
  if (otherKindLink) return conflict;
  if (!recorded && origin) return conflict;
  if (link) {
    if (recorded && origin !== link) return conflict;
    return { state: "linked", key: `id:${link}` };
  }
  if (recorded && origin) return { state: "deleted", key: `deleted:${row.item_kind}:${origin}` };
  if (recorded) return { state: "text", key: `text:${row.item_kind}:${row.item_order}:${normaliseItemText(row.item_text)}` };
  return { state: "unknown", key: `unknown:${row.id}` };
}

const ORIGIN_COLUMNS = ["origin_candidate_id", "origin_recorded"];

export const ORIGIN_MIGRATION_MESSAGE =
  "Evidence questions cannot be written yet: database migration 0095_objective_evidence_origin has not been applied, " +
  "so the origin of new evidence could not be recorded. Apply it (npx.cmd supabase migration up), then gather again. " +
  "Nothing was changed.";

function isMissingOriginColumn(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /origin_candidate_id|origin_recorded/.test(message) && /does not exist/.test(message);
}

/**
 * Fails closed before any evidence is written when 0095 is not applied: every creation must
 * record its origin explicitly, and there is no legacy insert fallback. A catalogue query, so it
 * never aborts the surrounding transaction.
 */
export async function assertOriginRecordingAvailable(client: PoolClient): Promise<void> {
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'objective_evidence' and column_name = any($1::text[])`,
    [ORIGIN_COLUMNS],
  );
  if ((r.rows[0]?.n ?? 0) !== ORIGIN_COLUMNS.length) throw new Error(ORIGIN_MIGRATION_MESSAGE);
}

/**
 * The current objectives and decisions, read through the caller's client (so, inside
 * loadObjectiveEvidenceAndCoverage, from the same REPEATABLE READ snapshot as the evidence rows).
 * Mirrors loadItems' choice of candidates or free-text lines, but keeps inferred (ai_suggested)
 * candidates: they are current objectives for classification, even though no evidence is drafted
 * for them. A missing run is an error, never an empty list.
 */
export async function readCurrentEvidenceItems(client: PoolClient, runId: string): Promise<CurrentEvidenceItem[]> {
  const run = await client.query<{ research_objective: string | null; decision_statement: string | null }>(
    "select research_objective, decision_statement from runs where id = $1",
    [runId],
  );
  if (run.rows.length === 0) throw new Error("Project not found");
  const oc = await client.query<{ id: string; candidate_text: string }>(
    "select id, candidate_text, source from objective_candidates where run_id = $1 and status = 'accepted' order by created_at",
    [runId],
  );
  const dc = await client.query<{ id: string; candidate_text: string }>(
    "select id, candidate_text, source from decision_candidates where run_id = $1 and status = 'accepted' order by created_at",
    [runId],
  );
  const pick = (kind: "objective" | "decision", cands: { id: string; candidate_text: string }[], text: string | null): CurrentEvidenceItem[] =>
    cands.length > 0
      ? cands.map((c, order) => ({ kind, order, text: c.candidate_text, candidateId: c.id }))
      : parseNumberedItems(text).map((t, order) => ({ kind, order, text: t, candidateId: null }));
  return [...pick("objective", oc.rows, run.rows[0].research_objective), ...pick("decision", dc.rows, run.rows[0].decision_statement)];
}
const RESULT_COLUMNS = `evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at`;

/** The question's own stance is the combination of its per-data-set answers. Silent counts only when nothing else spoke.
 * OBJ-REV-007: a stale result (its table was deleted after this result was computed - see
 * DatasetResult.stale) is excluded from "answered" the same as an unanswered one, not combined
 * into the stance as if it were still live evidence. Its stance/summary are still returned on
 * the row itself so a caller that wants to show "this used to say X" can, but neither this
 * question's own stance nor rollUp()'s item-level stance counts it. */
function shape(r: Record<string, unknown>, results: DatasetResult[]): EvidenceQuestion {
  const answered = results.filter((x) => x.stance && !x.stale);
  const errors = results.filter((x) => x.error).map((x) => `${x.dataset_name}: ${x.error}`);
  return {
    ...(r as unknown as EvidenceQuestion),
    origin_candidate_id: (r.origin_candidate_id as string | null | undefined) ?? null,
    origin_recorded: r.origin_recorded === true,
    expectation: parseExpectation(r.expectation),
    results,
    stance: answered.length ? combineStances(answered.map((x) => x.stance as Stance)) : null,
    basis: answered.length ? (answered.every((x) => x.basis === "computed") ? "computed" : "judged") : null,
    error: errors.length ? errors.join(" ").slice(0, 600) : null,
  };
}

export type EvidenceDataset = { id: string; name: string };

/** The data files in the project that questions are asked of: SPSS, Stata or SAS files, and raw case tables. */
export async function evidenceDatasets(tenantId: string, runId: string): Promise<EvidenceDataset[]> {
  const rows = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; source_filename: string; ingestion_type: string | null }>(
      "select id, source_filename, ingestion_type from documents where run_id = $1 and kind = 'table' order by source_filename",
      [runId],
    );
    return r.rows;
  });
  return rows
    .filter((d) => isStatsFileName(d.source_filename) || (d.ingestion_type === "raw" && isCaseTableFileName(d.source_filename)))
    .map((d) => ({ id: d.id, name: d.source_filename }));
}

/** Stated objectives and confirmed decisions. Ones the app inferred from this project's own data are left out: reading the data against them would be circular. */
async function loadItems(tenantId: string, runId: string): Promise<{ items: RawItem[]; skippedInferred: number }> {
  const d = await withTenant(tenantId, async (client) => {
    const run = await client.query<{ research_objective: string | null; decision_statement: string | null }>(
      "select research_objective, decision_statement from runs where id = $1",
      [runId],
    );
    const oc = await client.query<{ id: string; candidate_text: string; source: string }>(
      "select id, candidate_text, source from objective_candidates where run_id = $1 and status = 'accepted' order by created_at",
      [runId],
    );
    const dc = await client.query<{ id: string; candidate_text: string; source: string }>(
      "select id, candidate_text, source from decision_candidates where run_id = $1 and status = 'accepted' order by created_at",
      [runId],
    );
    return { run: run.rows[0], oc: oc.rows, dc: dc.rows };
  });
  if (!d.run) throw new Error("Project not found");
  let skippedInferred = 0;
  const pick = (kind: "objective" | "decision", cands: { id: string; candidate_text: string; source: string }[], text: string | null): RawItem[] => {
    if (cands.length > 0) {
      const out: RawItem[] = [];
      cands.forEach((c, order) => {
        if (c.source === "ai_suggested") skippedInferred++;
        else out.push({ kind, order, text: c.candidate_text, candidateId: c.id });
      });
      return out;
    }
    return parseNumberedItems(text).map((t, order): RawItem => ({ kind, order, text: t, candidateId: null }));
  };
  return {
    items: [...pick("objective", d.oc, d.run.research_objective), ...pick("decision", d.dc, d.run.decision_statement)],
    skippedInferred,
  };
}

/**
 * The shared body of listObjectiveEvidence(), pulled out so it can be run against an already-
 * open client - OBJ-REV-009 (fourth pass): loadObjectiveEvidenceWithCoverage below needs to
 * read these same rows inside its own REPEATABLE READ transaction, not a fresh withTenant() of
 * its own, for the one-snapshot guarantee that function exists to provide.
 */
async function fetchObjectiveEvidenceRows(
  client: PoolClient,
  runId: string,
): Promise<{ questions: EvidenceQuestion[]; originAvailable: boolean }> {
  // OBJ-REV-001/002 Rule B: origin columns come from migration 0095. Only a missing origin column
  // falls back (savepoint-safe, so the transaction is not left aborted); then every row reads as
  // origin unknown and the caller is told (originAvailable = false). Any other failure -
  // permission, connection, a missing table - propagates and fails the read visibly.
  let rows: Record<string, unknown>[];
  let originAvailable = true;
  await client.query("savepoint objective_evidence_origin_read");
  try {
    const r = await client.query(
      `select ${COLUMNS}, origin_candidate_id, origin_recorded from objective_evidence where run_id = $1 order by item_kind desc, item_order, created_at`,
      [runId],
    );
    await client.query("release savepoint objective_evidence_origin_read");
    rows = r.rows;
  } catch (error) {
    if (!isMissingOriginColumn(error)) throw error;
    await client.query("rollback to savepoint objective_evidence_origin_read");
    const r = await client.query(
      `select ${COLUMNS} from objective_evidence where run_id = $1 order by item_kind desc, item_order, created_at`,
      [runId],
    );
    rows = r.rows.map((x: Record<string, unknown>) => ({ ...x, origin_candidate_id: null, origin_recorded: false }));
    originAvailable = false;
  }
  // OBJ-REV-007: had_table (migration 0086) lets a result computed from a since-deleted
  // table (table_id nulled by the FK's on delete set null, had_table still true) be told
  // apart from one that never had a table to begin with (the "no matching variable" silent
  // verdict, which also stores no table_id). Migration-guarded: on a pre-0086 database the
  // column doesn't exist, so every result is read as never-stale, the same as before this fix.
  let resRows: (DatasetResult & { evidence_id: string; had_table?: boolean })[];
  // A failed SELECT (the column doesn't exist pre-migration) aborts the rest of this
  // transaction, including the fallback SELECT below, unless rolled back to a savepoint
  // first - the same reason every other migration-guarded query in this file and
  // elsewhere in this codebase wraps its risky statement in one (see OBJ-SET-002/003,
  // ANA-QUAL-002). A bare try/catch here looks like recovery but isn't: the fallback query
  // would itself fail with "current transaction is aborted."
  await client.query("savepoint objective_evidence_had_table_read");
  try {
    const res = await client.query(
      `select ${RESULT_COLUMNS}, had_table from objective_evidence_results where run_id = $1 order by dataset_name`,
      [runId],
    );
    await client.query("release savepoint objective_evidence_had_table_read");
    resRows = res.rows as (DatasetResult & { evidence_id: string; had_table?: boolean })[];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/had_table/.test(message)) throw error;
    await client.query("rollback to savepoint objective_evidence_had_table_read");
    const res = await client.query(
      `select ${RESULT_COLUMNS} from objective_evidence_results where run_id = $1 order by dataset_name`,
      [runId],
    );
    resRows = (res.rows as (DatasetResult & { evidence_id: string })[]).map((x) => ({ ...x, had_table: false }));
  }
  const byQuestion = new Map<string, DatasetResult[]>();
  for (const x of resRows) {
    const stale = !!x.had_table && !x.table_id;
    const { had_table: _hadTable, ...rest } = x;
    byQuestion.set(x.evidence_id, [...(byQuestion.get(x.evidence_id) ?? []), { ...rest, stale }]);
  }
  return { questions: rows.map((row) => shape(row, byQuestion.get(row.id as string) ?? [])), originAvailable };
}

export async function listObjectiveEvidence(tenantId: string, runId: string): Promise<EvidenceQuestion[]> {
  return withTenant(tenantId, async (client) => (await fetchObjectiveEvidenceRows(client, runId)).questions);
}

/**
 * OBJ-REV-009 (fourth pass): loads a run's evidence questions AND its coverage verdict together,
 * from one consistent snapshot, so the two can never describe different generations. The two
 * reads used to be separate withTenant() calls (listObjectiveEvidence, then
 * getLatestVariablesTruncated) - two independent transactions, each seeing whatever was already
 * committed at the moment IT ran. A publish committing in between them could leave a caller
 * holding generation N+1's questions next to generation N's now-superseded warning, or the
 * reverse - a controlled test of objectiveEvidenceActions.ts's own loadObjectiveEvidenceAction
 * reproduced exactly this mixed response. This runs both reads inside one
 * withTenantRepeatableRead() transaction instead: REPEATABLE READ takes its snapshot once and
 * holds it for every statement in the transaction, so no publish that commits while this is
 * open can be "seen" by one read here and not the other, however their relative commit order
 * falls.
 *
 * The coverage read keeps its own savepoint-guarded fallback to `null` on ANY failure (a
 * pre-migration-0092 database missing the table, a permission error, anything else) - the same
 * resilience loadObjectiveEvidenceAction's own prior `.catch(() => null)` provided when this was
 * two separate calls (see that function's history for why `null`, meaning "unknown", is the
 * only safe fallback here - never `false`). The questions read is not wrapped the same way: a
 * genuine failure reading objective_evidence itself still fails this whole call, exactly as
 * listObjectiveEvidence's own failures always have.
 */
// Exported and client-parameterized for the same reason publishGeneratedQuestions is (see that
// function's own doc comment): so a controlled test can exercise the REAL two-query sequence -
// coverage read, then questions read, both via the one client this function is given - against
// a fake client, the same dependency-injection shape contradictionDetector.ts's
// downgradeContradictedOriginal already established for this codebase. The only real caller,
// loadObjectiveEvidenceWithCoverage below, supplies the actual REPEATABLE READ client.
export async function loadObjectiveEvidenceAndCoverage(
  client: PoolClient,
  runId: string,
): Promise<{ questions: EvidenceQuestion[]; variablesTruncated: boolean | null; currentItems: CurrentEvidenceItem[]; originAvailable: boolean }> {
  await client.query("savepoint objective_evidence_coverage_read");
  let variablesTruncated: boolean | null;
  try {
    const coverage = await client.query<{ variables_truncated: boolean }>(
      `select variables_truncated from objective_evidence_generations where run_id = $1 and is_current = true limit 1`,
      [runId],
    );
    await client.query("release savepoint objective_evidence_coverage_read");
    variablesTruncated = coverage.rows.length === 0 ? null : coverage.rows[0].variables_truncated;
  } catch {
    await client.query("rollback to savepoint objective_evidence_coverage_read");
    variablesTruncated = null;
  }
  // OBJ-REV-001/002 Rule B, option (a): the current objectives/decisions are read through this SAME
  // client, inside the same REPEATABLE READ snapshot, so orphan classification and the evidence
  // rows can never describe different versions (a candidate deleted or accepted, or the run text
  // changed, between two reads). A failure here fails the whole load, like the questions read:
  // it never becomes an empty or all-orphaned result.
  const currentItems = await readCurrentEvidenceItems(client, runId);
  const { questions, originAvailable } = await fetchObjectiveEvidenceRows(client, runId);
  return { questions, variablesTruncated, currentItems, originAvailable };
}

export async function loadObjectiveEvidenceWithCoverage(
  tenantId: string,
  runId: string,
): Promise<{ questions: EvidenceQuestion[]; variablesTruncated: boolean | null; currentItems: CurrentEvidenceItem[]; originAvailable: boolean }> {
  return withTenantRepeatableRead(tenantId, (client) => loadObjectiveEvidenceAndCoverage(client, runId));
}

/**
 * Per objective or decision: the stance across its evidence questions, ignoring excluded and
 * unanswered ones. Grouped by evidenceIdentity, so only rows with a proved common identity share a
 * group. `currentKeys` (currentItemKey of every current item, from the same snapshot) decides
 * `orphaned`: a group whose key matches no current item. Without it, only the states that can never
 * match a current item (deleted, unknown, conflict) are marked orphaned. Pure: classification never
 * deletes or reassigns evidence.
 */
export function rollUp(questions: EvidenceQuestion[], currentKeys?: ReadonlySet<string>): ItemEvidence[] {
  const groups = new Map<string, { state: EvidenceIdentityState; qs: EvidenceQuestion[] }>();
  for (const q of questions) {
    const { state, key } = evidenceIdentity(q);
    const group = groups.get(key) ?? { state, qs: [] };
    group.qs.push(q);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, { state, qs }]) => {
    const live = qs.filter((q) => !q.excluded && q.stance);
    return {
      item_kind: qs[0].item_kind,
      item_order: qs[0].item_order,
      objective_candidate_id: qs[0].objective_candidate_id,
      decision_candidate_id: qs[0].decision_candidate_id,
      item_text: qs[0].item_text,
      stance: combineStances(live.map((q) => q.stance as Stance)),
      questions: qs,
      key,
      identity: state,
      orphaned: currentKeys ? !currentKeys.has(key) : !(state === "linked" || state === "text"),
    };
  });
}

// ---------------------------------------------------------------------------
// 1. Break each objective into evidence questions.

const DECOMPOSE_TOOL: Anthropic.Tool = {
  name: "submit_questions",
  description: "Submit the evidence questions for this objective.",
  input_schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        maxItems: MAX_QUESTIONS_PER_ITEM,
        items: {
          type: "object",
          properties: {
            question: { type: "string", description: "The evidence question in plain words, e.g. 'Do women use mobile banking more than men?'" },
            request: {
              type: "string",
              description:
                "A plain-English table request using words likely to appear in the survey, e.g. 'mobile banking use by gender'. One measure, at most one split.",
            },
            supports_if: { type: "string", description: "What result would support the objective." },
            against_if: { type: "string", description: "What result would undermine it." },
            expectation: {
              type: "object",
              description:
                "Fill only when the result can be judged from numbers. kind 'none' otherwise. Never invent a threshold: use 'level' only when the objective or the brief states one.",
              properties: {
                kind: { type: "string", enum: ["none", "level", "comparison"] },
                answer: {
                  type: "string",
                  description:
                    "The answer whose share is read, e.g. 'Yes' for 'Do women buy more than men?'. Required for a share (measure 'percent'), including comparisons. Empty only for an average or score.",
                },
                direction: { type: "string", enum: ["above", "below", "higher", "lower"] },
                threshold: { type: "number", description: "level only: percent for a share, or the unit of the average." },
                measure: {
                  type: "string",
                  enum: ["percent", "mean"],
                  description: "What the expectation is in: 'percent' for a share of answers, 'mean' for an average or a score such as NPS. Checked against the table row before judging.",
                },
                groupA: { type: "string", description: "comparison only: the group expected to differ." },
                groupB: { type: "string", description: "comparison only: the group compared with." },
                margin: { type: "number", description: "comparison only, optional: a gap (in points) small enough to count as no meaningful difference." },
              },
              required: ["kind"],
            },
          },
          required: ["question", "request", "supports_if", "against_if", "expectation"],
        },
      },
    },
    required: ["questions"],
  },
};

// OBJ-REV-009: named so the pooled-truncation check in generateEvidenceQuestions checks
// against the exact same cap this function enforces, rather than two independently
// maintained copies of "160" that could silently drift apart.
const POOLED_VAR_SUMMARY_CAP = 160;

function varSummary(names: { name: string; label: string }[]): string {
  return names
    .slice(0, POOLED_VAR_SUMMARY_CAP)
    .map((v) => `${v.name}: ${v.label}`.slice(0, 90))
    .join("\n");
}

type Drafted = { question: string; request: string; supports_if: string; against_if: string; expectation: Expectation | null };

async function decompose(tenantId: string, runId: string, item: RawItem, vars: string): Promise<Drafted[]> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    system:
      "You turn a research objective or decision into a few evidence questions that a survey data file can answer.\n" +
      `- Write at most ${MAX_QUESTIONS_PER_ITEM} questions. Fewer is better than padding. Each must be answerable from the variables listed.\n` +
      "- Evidence does not need a significance test. A level, a share, an average, or a comparison of two groups all count.\n" +
      "- For each, say in words what result would support the objective and what would undermine it. Decide this now, before any data is seen.\n" +
      "- Give a machine-readable expectation only when it can be judged from numbers. Never invent a threshold or a benchmark; if the objective does not state one, use a comparison with a direction, or kind 'none'.\n" +
      "- Use only variables that appear in the list. If the files cannot speak to the objective, return no questions.\n" +
      "- The same question will be put to every data file in the project. A file that lacks the variable will simply answer that it is silent, so write each question about the topic and not about one file.\n\n" +
      `Variables across the project's data files:\n${vars}`,
    tools: [DECOMPOSE_TOOL],
    tool_choice: { type: "tool", name: "submit_questions" },
    messages: [{ role: "user", content: `${item.kind === "objective" ? "Research objective" : "Decision"}: ${item.text}` }],
  });
  await logApiUsage(tenantId, runId, "objective_evidence", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const raw = tu && Array.isArray((tu.input as { questions?: unknown }).questions) ? ((tu.input as { questions: unknown[] }).questions as Record<string, unknown>[]) : [];
  const out: Drafted[] = [];
  for (const q of raw.slice(0, MAX_QUESTIONS_PER_ITEM)) {
    const question = typeof q.question === "string" ? q.question.trim() : "";
    const request = typeof q.request === "string" ? q.request.trim() : "";
    if (!question || request.length < 5) continue;
    const e = (q.expectation ?? {}) as Record<string, unknown>;
    const expectation = e.kind === "none" ? null : parseExpectation({ ...e, answer: typeof e.answer === "string" && e.answer.trim() ? e.answer : null });
    out.push({
      question: capWords(question, 30),
      request: request.slice(0, 300),
      supports_if: capWords(String(q.supports_if ?? ""), 30),
      against_if: capWords(String(q.against_if ?? ""), 30),
      expectation,
    });
  }
  return out;
}

/**
 * Writes the evidence questions for every stated objective and decision.
 * Replaces earlier automatic questions; ones the researcher edited or added are kept.
 */
export async function generateEvidenceQuestions(
  tenantId: string,
  runId: string,
): Promise<{ created: number; items: number; skippedInferred: number; datasets: number; variablesTruncated: boolean; generationId: string }> {
  // OBJ-REV-001/002 Rule B: checked before any model call or write, so a database without 0095
  // fails actionably here instead of drafting questions it could not record the origin of.
  // publishGeneratedQuestions checks again inside its own transaction.
  await withTenant(tenantId, (client) => assertOriginRecordingAvailable(client));
  const { items, skippedInferred } = await loadItems(tenantId, runId);
  if (items.length === 0) throw new Error("This project has no stated objective or confirmed decision to gather evidence for.");
  const datasets = await evidenceDatasets(tenantId, runId);
  if (datasets.length === 0) throw new Error("This project has no survey data file (SPSS, Stata, SAS or a raw case table) to gather evidence from.");
  // Questions are written once, from the variables of every file, then asked of each file separately.
  const perFile = Math.max(40, Math.floor(POOLED_VAR_SUMMARY_CAP / datasets.length));
  const seen = new Set<string>();
  const pooled: { name: string; label: string }[] = [];
  // OBJ-REV-009: a file with more eligible variables than `perFile` silently drops every variable
  // past the cap from ever being considered for an evidence question - the same shape of problem
  // IMP-012 fixed for instrument reads (a cap that trims content gets a visible flag instead of
  // disappearing it). This doesn't lift the cap (still real engineering to raise it safely - the
  // same model-context-budget reason the cap exists at all), it just stops hiding that it fired.
  let variablesTruncated = false;
  for (const ds of datasets) {
    const dict = await loadVariableDictionary(tenantId, runId, ds.id);
    // OBJ-REV-006: string categories (e.g. a Gender column of "Male"/"Female") are eligible too.
    const eligible = dict.variables.filter(isLookupEligible);
    if (eligible.length > perFile) variablesTruncated = true;
    for (const v of eligible.slice(0, perFile)) {
      const key = (v.label || v.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      pooled.push(v);
    }
  }
  // Counter-review on OBJ-REV-009: the per-file cap above is not the only place variables can
  // be dropped. varSummary (below) applies its OWN, separate cap - `.slice(0, 160)` - to the
  // POOLED, de-duplicated list across every file, and that second cap can fire even when no
  // single file ever tripped the per-file one. The counter-review's own reproduction: five
  // files of 33 unique variables each (every file comfortably under perFile=40, so the loop
  // above never set variablesTruncated) pool to 165 distinct variables, and varSummary's
  // internal slice silently drops the last 5 before the model ever sees them - exactly the
  // "160 of 165 variables used" case this was supposed to catch and did not. Checked here,
  // against the same 160 figure varSummary itself uses, so the two stay in sync by
  // construction rather than by two separately-maintained magic numbers.
  if (pooled.length > POOLED_VAR_SUMMARY_CAP) variablesTruncated = true;
  const vars = varSummary(pooled);
  const kept = await withTenant(tenantId, async (client) => {
    // A question the researcher has excluded is just as much a human decision as one they
    // edited or added manually (OBJ-REV-004: "exclusion alone does not protect an automatic
    // evidence question") - excluded = true on an otherwise still-'auto' row used to count
    // for nothing here, so regenerating silently deleted the excluded row and drafted a
    // fresh, un-excluded replacement for the same item, reversing the researcher's decision.
    //
    // OBJ-REV-001/002 Rule B: keyed by evidenceIdentity, so only a protected row that genuinely
    // belongs to a current item suppresses drafting for it. Deleted-candidate, unknown-origin and
    // conflicting rows have keys no current item can have, so an orphaned researcher row never
    // stops an unrelated item that now sits in its old position from getting questions.
    const r = await client.query<IdentityRow>(
      "select id, item_kind, item_order, item_text, objective_candidate_id, decision_candidate_id, origin_candidate_id, origin_recorded from objective_evidence where run_id = $1 and (source <> 'auto' or excluded = true)",
      [runId],
    );
    return new Set(r.rows.map((row) => evidenceIdentity(row).key));
  });
  const drafted: { item: RawItem; qs: Drafted[] }[] = [];
  for (const item of items) {
    if (kept.has(currentItemKey(item))) continue; // the researcher has taken over this one
    drafted.push({ item, qs: await decompose(tenantId, runId, item, vars) });
  }
  const { generationId, created } = await withTenant(tenantId, (client) =>
    publishGeneratedQuestions(client, {
      tenantId,
      runId,
      drafted,
      variablesTruncated,
      pooledCount: pooled.length,
      usedCount: Math.min(pooled.length, POOLED_VAR_SUMMARY_CAP),
    }),
  );
  return { created, items: items.length, skippedInferred, datasets: datasets.length, variablesTruncated, generationId };
}

/**
 * OBJ-REV-009 (third pass) - the persistence contract this function exists to guarantee:
 *
 *   Each run has exactly one CURRENT successful question generation at any time. A
 *   generation's auto-generated questions and its coverage/truncation verdict
 *   (variablesTruncated/pooledCount/usedCount) belong to that exact generation - they are
 *   never matched up after the fact by timestamp, only by this shared generationId.
 *
 * Exported and given `client` as a plain parameter (rather than calling withTenant itself)
 * so it can be exercised directly against a fake client in a controlled test, the same shape
 * `downgradeContradictedOriginal` (contradictionDetector.ts) already uses for this reason -
 * generateEvidenceQuestions is the only real caller, wrapping it in withTenant below.
 *
 * Serialization: `select ... for update` on the run's own row is taken FIRST, unconditionally
 * - even when `drafted` is empty (an item list that produced zero questions, or a run with no
 * prior generation at all) - because the thing being serialized is "may another publication
 * for this run proceed at the same time", not "is there something to write this time". The
 * run row always exists for a valid runId, so this lock is available on the very first
 * generation a run ever makes, unlike locking a row in objective_evidence or
 * objective_evidence_generations, neither of which is guaranteed to have a row yet. A second,
 * overlapping call for the same run blocks on this statement until the first call's
 * transaction commits or rolls back - there is no window where two publications interleave.
 *
 * Atomicity: demoting the previous current generation, inserting the new generation row,
 * deleting the superseded auto questions, and inserting the new ones are all statements in
 * ONE transaction (the withTenant call in generateEvidenceQuestions). A failure at ANY point -
 * the generation insert, the delete, or any one question insert - throws, which withTenant
 * rolls back as a whole: the prior generation stays current, the prior questions stay in
 * place, exactly as if this call had never run. This is what closes both failure shapes the
 * counter-review found: a "replacement failure" (a question insert throws) and a "coverage-
 * write failure" (the generation insert itself throws) now have the IDENTICAL outcome -
 * nothing changes - rather than a replacement that can partially apply while its coverage
 * verdict silently does not, or vice versa.
 *
 * Current-generation lookup: `is_current` on objective_evidence_generations, enforced to be
 * at most one true row per run by a partial unique index (migration 0092), is demoted for the
 * OLD generation and set true for the NEW one in this same transaction, so "the current
 * generation" is never ambiguous and never depends on which of two commits happened to land
 * later in wall-clock time - under the serialization above, whichever call's transaction is
 * the one that actually commits is, by construction, the only one still running, and its
 * is_current=true write is the last word.
 */
export async function publishGeneratedQuestions(
  client: PoolClient,
  params: {
    tenantId: string;
    runId: string;
    drafted: { item: RawItem; qs: Drafted[] }[];
    variablesTruncated: boolean;
    pooledCount: number;
    usedCount: number;
  },
): Promise<{ generationId: string; created: number }> {
  const { tenantId, runId, drafted, variablesTruncated, pooledCount, usedCount } = params;
  // Serializes every publication for this run - see the function doc above for why this is
  // unconditional and why the run row (not an objective_evidence/generations row) is what gets
  // locked.
  //
  // OBJ-REV-009 (fourth pass): the lock query used to ignore its own result entirely - it ran
  // "select id from runs where id = $1", took the row lock if one existed, and then proceeded
  // to write a generation and questions under the given tenantId/runId regardless of whether
  // any row was actually returned. A run id that does not exist at all, or that belongs to a
  // different tenant (a case RLS on `runs` would make invisible to this session, returning zero
  // rows rather than an error), was silently accepted: nothing about the writes below checks
  // that the run is real or that it belongs to this tenant, since none of them re-derive
  // tenant/run from the lock query's result - they just use the caller-supplied parameters.
  // Scoping the query to tenant_id too (defense in depth alongside RLS, not instead of it) and
  // requiring a returned row closes that: a missing or foreign-tenant run now throws here,
  // before the demote/insert/delete/insert sequence below ever runs, so it produces zero writes
  // rather than a generation and questions for a run that was never actually ours.
  const runLock = await client.query<{ id: string }>(
    "select id from runs where id = $1 and tenant_id = $2 for update",
    [runId, tenantId],
  );
  if (runLock.rows.length === 0) {
    throw new Error(
      `Run ${runId} was not found for this tenant. Refusing to publish evidence questions for a run that does not exist, or does not belong to the caller.`,
    );
  }
  // OBJ-REV-001/002 Rule B: before any write in this transaction, refuse to publish questions whose
  // origin could not be recorded (migration 0095 missing). If the columns disappear between this
  // check and an insert, that insert fails and the whole publication rolls back as before.
  await assertOriginRecordingAvailable(client);
  // At most one current generation per run (also enforced at the schema level by migration
  // 0092's partial unique index) - demote whatever generation currently holds that flag for
  // this run before promoting the new one. A no-op, not an error, the first time a run ever
  // publishes a generation.
  await client.query("update objective_evidence_generations set is_current = false where run_id = $1 and is_current = true", [runId]);
  const generation = await client.query<{ id: string }>(
    `insert into objective_evidence_generations (tenant_id, run_id, variables_truncated, pooled_count, used_count, is_current)
     values ($1, $2, $3, $4, $5, true)
     returning id`,
    [tenantId, runId, variablesTruncated, pooledCount, usedCount],
  );
  const generationId = generation.rows[0].id;
  // excluded = false here for the same reason as before this pass: an excluded row must
  // survive the sweep that clears untouched auto rows, not just keep its item out of the
  // drafting loop in generateEvidenceQuestions.
  await client.query("delete from objective_evidence where run_id = $1 and source = 'auto' and excluded = false", [runId]);
  let created = 0;
  for (const { item, qs } of drafted) {
    for (const q of qs) {
      await client.query(
        `insert into objective_evidence (tenant_id, run_id, document_id, item_kind, item_order, objective_candidate_id, decision_candidate_id, item_text, question, request_text, supports_if, against_if, expectation, generation_id, origin_candidate_id, origin_recorded)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          tenantId,
          runId,
          null,
          item.kind,
          item.order,
          item.kind === "objective" ? item.candidateId : null,
          item.kind === "decision" ? item.candidateId : null,
          capWords(item.text, 40),
          q.question,
          q.request,
          q.supports_if,
          q.against_if,
          q.expectation ? JSON.stringify(q.expectation) : null,
          generationId,
          // Explicit origin on every creation (never left to the fail-closed column default):
          // the candidate this item is, or null for a known free-text item, recorded = true.
          item.candidateId ?? null,
          true,
        ],
      );
      created++;
    }
  }
  return { generationId, created };
}

/**
 * OBJ-REV-009 (third pass, corrected fourth pass): the current generation's coverage verdict,
 * read through its own identity (objective_evidence_generations.is_current) rather than "the
 * most recent trace event" - a trace-timestamp lookup could not guarantee it was reading the
 * verdict for the SAME generation whose questions are actually in objective_evidence right now
 * (see publishGeneratedQuestions's doc comment for the two ways that drifted). At most one row
 * can ever match (migration 0092's partial unique index), so `limit 1` here is defensive, not
 * load-bearing.
 *
 * Returns one of three states, never conflating them: the generation's own stored `true`/`false`
 * when one exists, or `null` when none does - a run that has never published a generation, or a
 * legacy run whose questions predate migration 0092. The third pass's version of this comment
 * said this function "returns false... when a run has never published a generation", which was
 * the actual bug the fourth pass's review caught: that collapsed "no generation recorded" into
 * the same value a genuinely verified "not truncated" generation returns, so a caller had no way
 * to tell a confirmed-clean verdict apart from "nothing has ever been recorded here." The caller
 * (objectiveEvidenceActions.ts, via loadObjectiveEvidenceWithCoverage below) separately catches
 * a THROWN error (e.g. a pre-migration database where this table does not exist yet) into `null`
 * too, so from the caller's point of view "never recorded" and "could not be checked" already
 * share one "unknown" state - this function's own `null` is the first of those two cases, not
 * the second.
 */
export async function getLatestVariablesTruncated(tenantId: string, runId: string): Promise<boolean | null> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ variables_truncated: boolean }>(
      `select variables_truncated from objective_evidence_generations where run_id = $1 and is_current = true limit 1`,
      [runId],
    );
    // OBJ-REV-009 (fourth pass): `r.rows[0]?.variables_truncated === true` used to collapse
    // "no current generation exists at all" (a run that has never published one, or a legacy
    // run whose questions predate migration 0092) into the exact same `false` a genuinely
    // verified, recorded "not truncated" generation would return - so a caller had no way to
    // tell a confirmed-clean verdict apart from "nothing has ever been recorded here." Returning
    // `null` for the no-row case, and the row's own stored boolean otherwise, restores that
    // distinction: `false` now always means a generation actually recorded "not truncated",
    // never "we don't know."
    if (r.rows.length === 0) return null;
    return r.rows[0].variables_truncated;
  });
}

// ---------------------------------------------------------------------------
// 2. Answer a question with a table and read it.

export function tableText(result: CrosstabResult): string {
  const cols = result.columns.map((c) => c.name);
  const lines: string[] = [`Columns: ${cols.join(" | ")} | Total`];
  for (const q of result.questions) {
    lines.push(`Question: ${q.label}`);
    for (const r of q.rows.slice(0, 40)) {
      const cells = [...r.pct, r.total.pct].map((x) => (x === null || x === undefined ? "-" : String(Math.round(x * 10) / 10)));
      const n = r.isBase ? ` (base: ${[...r.count, r.total.count].join(" | ")})` : "";
      lines.push(`  ${r.label}: ${cells.join(" | ")}${n}`);
    }
  }
  return lines.join("\n").slice(0, 9000);
}

/**
 * OBJ-REV-006: names the one answer a share expectation is about, chosen from this table's own
 * answers by the meaning of the evidence question (for "Does purchase differ between men and
 * women?", the Purchase answer that means having purchased). The model may only pick one of the
 * listed pairs or "none"; "none" is the instruction whenever more than one answer could be meant
 * or a combination of answers would be needed. The caller re-validates the pick against the table.
 * A failed call throws, which stores an actionable error for this question (retryable), never a
 * reading.
 */
async function chooseResponse(
  tenantId: string,
  runId: string,
  q: EvidenceQuestion,
  candidates: { question: string; answer: string }[],
): Promise<{ question: string; answer: string } | null> {
  const options = candidates.slice(0, 60);
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 200,
    system:
      "An evidence question compares or tests the share of people giving one particular answer. Pick which listed answer that is, from the meaning of the question.\n" +
      "- Pick only an answer the question clearly refers to (for 'Do women buy more than men?', the answer meaning they bought).\n" +
      "- Answer 'none' if more than one listed answer could be meant, if a combination of answers would be needed, or if none fits. Never guess.",
    tools: [
      {
        name: "choose_answer",
        description: "Record which listed answer the question is about, or none.",
        input_schema: {
          type: "object",
          properties: { choice: { type: "string", enum: [...options.map((_, i) => String(i + 1)), "none"] } },
          required: ["choice"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "choose_answer" },
    messages: [
      {
        role: "user",
        content:
          `Evidence question: ${q.question}\nSupports if: ${q.supports_if}\nUndermines if: ${q.against_if}\n\nAnswers in the table:\n` +
          options.map((o, i) => `${i + 1}. ${o.question}: ${o.answer}`).join("\n"),
      },
    ],
  });
  await logApiUsage(tenantId, runId, "objective_evidence", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const choice = String((tu?.input as { choice?: unknown } | undefined)?.choice ?? "none");
  const index = Number(choice) - 1;
  return Number.isInteger(index) && index >= 0 && index < options.length ? options[index] : null;
}

async function judge(
  tenantId: string,
  runId: string,
  q: EvidenceQuestion,
  result: CrosstabResult,
): Promise<{ stance: Stance; summary: string }> {
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 700,
    system:
      "You read a survey table as evidence for or against a research objective. Be conservative.\n" +
      "- Percentages are column percentages unless stated. No significance flags are needed: read the level or the gap, and weigh the bases.\n" +
      "- A base (unweighted n) under 30 is too thin to read at all: call the stance silent rather than reading a level or gap off it, the same floor this lane uses everywhere a stance is computed in code.\n" +
      "- Before comparing two columns, check they are actually independent groups. A Net or subtotal column compared against one of its own member categories is not independent (the members are part of the net), so a gap there is not evidence either way; call it inconclusive and say why, rather than reading a difference that is partly definitional.\n" +
      "- supports / against: the numbers clearly point that way, judged against what was written down in advance. inconclusive: the numbers are there but differences are small, bases are thin, or the columns are not independent. silent: the table does not speak to the question. mixed: parts point both ways.\n" +
      "- Do not claim a difference is statistically significant. Say what the numbers show in one or two plain sentences, with the key figures.",
    tools: [
      {
        name: "record_stance",
        description: "Record how the table bears on the objective.",
        input_schema: {
          type: "object",
          properties: {
            stance: { type: "string", enum: ["supports", "against", "mixed", "inconclusive", "silent"] },
            summary: { type: "string" },
          },
          required: ["stance", "summary"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "record_stance" },
    messages: [
      {
        role: "user",
        content:
          `Objective: ${q.item_text}\nEvidence question: ${q.question}\nSupports if: ${q.supports_if}\nUndermines if: ${q.against_if}\n\nTable:\n${tableText(result)}`,
      },
    ],
  });
  await logApiUsage(tenantId, runId, "objective_evidence", response.usage);
  const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (tu?.input ?? {}) as { stance?: string; summary?: string };
  const ok: Stance[] = ["supports", "against", "mixed", "inconclusive", "silent"];
  const stance = ok.find((s) => s === input.stance) ?? "inconclusive";
  return { stance, summary: capWords(String(input.summary ?? "The table was read but no summary came back."), 60) };
}

/**
 * OBJ-REV-007 (shared edit/evaluation concurrency protocol).
 *
 * An earlier version of this function relied on the INSERT's own WHERE EXISTS subquery
 * (below) as the whole protocol: "one statement, so it's atomic." That is true as far as
 * it goes - a single SQL statement's subquery and write do execute against one consistent
 * snapshot, so that statement alone cannot observe a revision that then changes before the
 * write lands. But the claim "closes the race" went further than that: it also requires
 * the OTHER side - editEvidenceQuestion's own read of the current wording, its decision
 * whether this is a real change, and its bump of question_revision - to be serialized
 * against this write, and nothing forced that. editEvidenceQuestion used to read the
 * current row with a plain SELECT (no lock), so this function's revision check and that
 * SELECT could both read the same pre-edit revision, this function's write could land, and
 * only afterward would editEvidenceQuestion's UPDATE/DELETE run - which still deletes the
 * row this function just wrote (the DELETE is unconditional on evidence_id, not on
 * revision), so that particular interleaving does not actually strand a stale result. The
 * gap the reviewer is right to flag is that this was incidental, not guaranteed: nothing
 * in the code says the two operations cannot run in an order where a stale write survives,
 * it happened to work out from the shape of editEvidenceQuestion's own blanket DELETE.
 *
 * This version makes the two sides serialize explicitly instead of relying on that
 * incidental agreement: both this function and editEvidenceQuestion open their respective
 * transaction (withTenant wraps each call in BEGIN ... COMMIT on one client - see db.ts)
 * by taking `select ... for update` on the SAME objective_evidence row before doing
 * anything else. Postgres's row-level lock means whichever transaction reaches that
 * statement first holds the row until it commits or rolls back; the other blocks there
 * until then, and re-reads the row's current state once it proceeds. So an edit that is
 * mid-flight when this function starts is waited out, not raced against - this function's
 * revision check then sees whatever the edit actually committed, not a stale snapshot from
 * before it. The WHERE EXISTS condition on the INSERT/UPDATE below is kept as well, as
 * defense in depth (it costs nothing and remains correct on its own), but the row lock is
 * now what actually closes the race, not the single-statement shape of the write.
 *
 * Returns whether a row was actually written (false when the question moved on since
 * expectedRevision was captured, or the question row no longer exists).
 */
async function storeResult(
  tenantId: string,
  runId: string,
  evidenceId: string,
  ds: EvidenceDataset,
  expectedRevision: number,
  r: { table_id?: string | null; stance?: Stance | null; basis?: "computed" | "judged" | null; estimate?: EvidenceEstimate | null; summary?: string | null; error?: string | null },
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    // Take the lock before anything else in this transaction - see the function comment.
    // A vanished row (the question was deleted outright, not just edited) returns no rows;
    // treated the same as a revision mismatch, since there is nothing left to attach a
    // result to either way.
    const locked = await client.query<{ question_revision: number }>(
      "select question_revision from objective_evidence where id = $1 and run_id = $2 for update",
      [evidenceId, runId],
    );
    const currentRevision = locked.rows[0]?.question_revision;
    if (currentRevision === undefined || currentRevision !== expectedRevision) return false;
    const hadTable = r.table_id != null;
    const params = [
      tenantId,
      runId,
      evidenceId,
      ds.id,
      ds.name,
      r.table_id ?? null,
      r.stance ?? null,
      r.basis ?? null,
      r.estimate ? JSON.stringify(r.estimate) : null,
      r.summary ? r.summary.slice(0, 1200) : null,
      r.error ? r.error.slice(0, 600) : null,
      expectedRevision,
      hadTable,
    ];
    // OBJ-REV-007: had_table (migration 0086) records whether THIS write actually had a table,
    // so a later read can tell a deleted-table result (had_table true, table_id since nulled)
    // apart from one that never had a table. Migration-guarded the same way every other
    // migration-dependent write in this codebase is: on a pre-0086 database the column doesn't
    // exist, so the insert/update falls back to the column list this always had - but a failed
    // INSERT aborts the rest of this transaction unless rolled back to a savepoint first, so
    // the fallback below is wrapped the same way every other migration-guarded write in this
    // file now is (a bare try/catch here would make the fallback itself fail with "current
    // transaction is aborted").
    await client.query("savepoint objective_evidence_results_had_table_write");
    try {
      const result = await client.query(
        `insert into objective_evidence_results (tenant_id, run_id, evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at, had_table)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $13
         where exists (
           select 1 from objective_evidence where id = $3 and run_id = $2 and question_revision = $12
         )
         on conflict (evidence_id, document_id) do update
           set table_id = excluded.table_id, stance = excluded.stance, basis = excluded.basis, estimate = excluded.estimate,
               summary = excluded.summary, error = excluded.error, evaluated_at = now(), had_table = excluded.had_table
           where exists (
             select 1 from objective_evidence where id = excluded.evidence_id and run_id = $2 and question_revision = $12
           )`,
        params,
      );
      await client.query("release savepoint objective_evidence_results_had_table_write");
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/had_table/.test(message)) throw error;
      await client.query("rollback to savepoint objective_evidence_results_had_table_write");
      const result = await client.query(
        `insert into objective_evidence_results (tenant_id, run_id, evidence_id, document_id, dataset_name, table_id, stance, basis, estimate, summary, error, evaluated_at)
         select $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()
         where exists (
           select 1 from objective_evidence where id = $3 and run_id = $2 and question_revision = $12
         )
         on conflict (evidence_id, document_id) do update
           set table_id = excluded.table_id, stance = excluded.stance, basis = excluded.basis, estimate = excluded.estimate,
               summary = excluded.summary, error = excluded.error, evaluated_at = now()
           where exists (
             select 1 from objective_evidence where id = excluded.evidence_id and run_id = $2 and question_revision = $12
           )`,
        params.slice(0, 12),
      );
      return (result.rowCount ?? 0) > 0;
    }
  });
}

/**
 * Builds the table for one question in one data file and reads it.
 * Failures are stored on the row, never thrown (so one bad pair in a batch
 * cannot take the rest of evaluatePending's batch down with it) - a file
 * with no matching variable is silent, not an error. OBJ-REV-M04: that
 * guarantee used to stop at the first storeResult call inside the try
 * block; if the catch block's own storeResult call (recording the
 * failure) itself threw - a connection drop, say - that second error
 * escaped uncaught, exactly the case this comment claimed couldn't happen.
 * The inner try/catch below closes that for anything inside the try block.
 * The one load still outside it - reading the question row itself, right
 * below - gets its own try/catch for the same reason: there is nothing yet
 * to call storeResult with if THAT query is what fails (no revision, no
 * request text), so it is swallowed the same way and reported as "nothing
 * stored" rather than left to propagate and take the rest of the caller's
 * batch down with it.
 */
/**
 * Answers one question/file pair, returning whether anything was actually durably stored
 * for it - a computed/judged result OR a recorded failure both count, since pendingPairs
 * treats a stored error the same as answered until retried. False means nothing was
 * persisted at all (the row vanished, the question moved on mid-evaluation, or even the
 * failure couldn't be recorded), so evaluatePending must NOT count this pair as done
 * (OBJ-REV-013: "failed answer persistence is reported as completed work" - evaluatePending
 * used to count every attempted pair as done regardless of whether storeResult actually
 * succeeded).
 */
export async function evaluateEvidenceQuestion(tenantId: string, runId: string, ds: EvidenceDataset, id: string): Promise<boolean> {
  let q: ReturnType<typeof shape> | null;
  try {
    q = await withTenant(tenantId, async (client) => {
      const r = await client.query(`select ${COLUMNS} from objective_evidence where id = $1 and run_id = $2`, [id, runId]);
      return r.rows[0] ? shape(r.rows[0], []) : null;
    });
  } catch {
    // Nothing was stored, and nothing CAN be - there is no question row in hand to build a
    // storeResult call from. Reported the same way every other "nothing durably stored" case
    // here is (OBJ-REV-013), not left to propagate and fail the rest of evaluatePending's batch.
    return false;
  }
  if (!q) return false;
  try {
    const plan = await planCrosstabFromText(tenantId, runId, ds.id, q.request_text);
    if (plan.rows.length === 0) {
      // OBJ-REV-007: the revision check now lives inside storeResult itself, as part of
      // the same statement that writes the row - see its own comment. Its return value
      // (whether a row was actually written) is this function's only source of truth for
      // whether the question moved on, since a separate pre-check here would reopen the
      // exact gap that fix closes.
      return await storeResult(tenantId, runId, id, ds, q.question_revision, {
        stance: "silent",
        basis: "computed",
        summary: `${ds.name} has no variable that matches "${q.request_text}", so it cannot speak to this question.`,
      });
    }
    // ANA-NPS-003 (Brief 37 repair): the dictionary's build/cache path depends on the
    // document's persisted layout - a required saved input distinct from design, and not
    // superseded by anything this evaluator supplies (it has no per-question design input of
    // its own at all - see below) - so a failed lookup here must fail this question visibly,
    // the same as a failed design-setting lookup already does, rather than silently computing
    // off a defaulted layout.
    const dictStatus = await loadVariableDictionaryWithStatus(tenantId, runId, ds.id);
    if (!dictStatus.ok) {
      throw new Error(
        `This file's saved set-up could not be read, so this question was not evaluated against it: ${dictStatus.error}`,
      );
    }
    const dict = dictStatus.dictionary;
    // ANA-NPS-003 (second counter-review): this batch evaluator discarded resolveSurveyDesign's
    // own ambiguity information by reading only `.design` - an ambiguous PSU/strata candidate set
    // was silently dropped, with no way for a researcher reading this evidence row to learn that
    // the table might be missing a design the file actually has several candidate variables for.
    // Captured here so it can be folded into the stored summary below, the same way plan.unclear
    // already is - this evaluator has no per-question UI of its own to show a warning in instead.
    // ANA-NPS-003 (second counter-review): this batch evaluator has no per-question design input
    // of its own, but now defers to the document's own persisted design setting (set in Cross
    // tabs, say) before falling back to the bare heuristic - "apply it consistently... across
    // Objectives", not just the NPS tool.
    // Codex re-review, package 4 (cross-tab handover repair): this evaluator has no per-question
    // design choice of its own, so a failed lookup of the document's persisted survey-design
    // setting is not a case where "no setting" and "couldn't tell" can be treated alike - falling
    // through to the heuristic here would silently compute (and store) a plain-SRS or
    // wrongly-auto-detected reading while believing it had genuinely checked for a persisted
    // choice. Thrown here, this is caught by this function's own catch block below exactly like
    // every other failure in this evaluator, and stored as an actionable error row via
    // storeResult - never silently computed and saved as if it were a real reading.
    const setupStatus = await loadDataSetupWithStatus(tenantId, ds.id);
    if (!setupStatus.ok) {
      throw new Error(
        `This file's saved survey-design set-up could not be read, so this question was not evaluated against it: ${setupStatus.error}`,
      );
    }
    const setup = setupStatus.setup;
    const resolvedDesign = resolveSurveyDesign(dict, effectiveDesignChoice(setup.design, undefined));
    const built = await buildCrosstab(
      tenantId,
      runId,
      ds.id,
      {
        columnVars: plan.columns.map((c) => c.name),
        rowItems: plan.rows,
        weightVar: defaultWeight(dict),
        filters: plan.filters,
        source: "ask",
        // ANA-NPS-003: same gap as the NPS tool (npsActions.ts) - an Objectives evidence
        // question never exposed a design picker, so this table always used the plain SRS
        // variance even when the file's own Cross tabs workspace would auto-detect and apply a
        // cluster design by default. resolveSurveyDesign (./surveyDesign) is the same
        // ambiguity-safe heuristic npsActions.ts now uses: an auto-detected design is only ever
        // applied when exactly one PSU candidate was found, never guessed between several. This
        // batch evaluator runs with no per-question researcher input of its own (evaluatePending
        // calls it for every pending question in a run), so there is no explicit design choice to
        // thread through yet - only the heuristic path is used here; a stored, per-question design
        // override is a defined but not-yet-built follow-up (see Engineering Brief).
        design: resolvedDesign.design ?? undefined,
      },
      { status: "evidence" },
    );
    const { result } = await loadCrosstab(tenantId, runId, built.tableId);
    if (!result) throw new Error("The table could not be read back.");

    // OBJ-REV-006: a share expectation is never read without knowing which answer it is about.
    // When the stored expectation names none (and the table has no average row to read
    // instead), the answer is matched to this table's own answers from the question's wording,
    // validated against the table, and recorded in the summary - or the reading is stored as
    // unresolved. Never the first or largest answer.
    let expectation = q.expectation;
    let selectorNote = "";
    let computed: ReturnType<typeof readExpectation> = null;
    if (expectation) {
      const candidates = responseSelectorCandidates(result, expectation);
      if (candidates !== null) {
        const chosen = candidates.length > 0 ? await chooseResponse(tenantId, runId, q, candidates) : null;
        // A table-valid choice is not enough: it must also be structurally unambiguous for this
        // question (selectorAcceptance), or the researcher is asked to resolve it.
        const acceptance = chosen ? selectorAcceptance(candidates, chosen, { question: q.question, supportsIf: q.supports_if }) : null;
        if (chosen && acceptance && !acceptance.ok) {
          computed = responseSelectorUnresolved(acceptance.reason);
        } else if (chosen && locateRow(result, chosen.answer, chosen.question) !== null) {
          expectation = { ...expectation, answer: chosen.answer, question: chosen.question };
          selectorNote =
            ` The question did not name which answer to compare, so the share answering "${chosen.answer}" to "${chosen.question}" ` +
            "was matched to this table's answers from the question's wording. Edit the question to name a different answer.";
        } else {
          computed = responseSelectorUnresolved(
            candidates.length === 0
              ? "this table has no answers to choose from"
              : "the question's wording does not identify one of this table's answers unambiguously",
          );
        }
      }
      if (!computed) computed = readExpectation(result, expectation);
    }
    let stance: Stance;
    let basis: "computed" | "judged";
    let summary: string;
    let estimate: EvidenceEstimate | null = null;
    if (computed) {
      ({ stance, summary, estimate } = { stance: computed.stance, summary: computed.summary, estimate: computed.estimate });
      basis = "computed";
    } else {
      const j = await judge(tenantId, runId, q, result);
      stance = j.stance;
      summary = j.summary;
      basis = "judged";
    }
    const designNote =
      resolvedDesign.ambiguous.psu.length > 0 || resolvedDesign.ambiguous.strata.length > 0
        ? ` This file has more than one candidate survey-design variable (${[...resolvedDesign.ambiguous.psu, ...resolvedDesign.ambiguous.strata].join(", ")}), so none was applied automatically; the table below uses plain weighted variance.`
        : "";
    const note = selectorNote + (plan.unclear.length ? ` Table set-up notes: ${plan.unclear.join(" ")}` : "") + designNote;
    // The planner's own "unclear" notes mean the table it built does not fully match what
    // was asked - a requested region, period, or segment it couldn't find, say - and it
    // built the nearest table it could instead of the one actually requested (OBJ-REV-006:
    // "missing requested region/period still permits computed supports with an appended
    // note"). A confident stance from the wrong-scoped table is worse than no stance: the
    // note used to be appended for a reader to notice, but the stance itself still asserted
    // supports/against as if the table matched. Downgrading to inconclusive here means the
    // scope gap actually blocks the verdict rather than just annotating it.
    if (plan.unclear.length > 0 && stance !== "silent") stance = "inconclusive";
    // Await inside this try so a rejected write reaches the durable-failure handler below.
    return await storeResult(tenantId, runId, id, ds, q.question_revision, { table_id: built.tableId, stance, basis, estimate, summary: summary + note });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      return await storeResult(tenantId, runId, id, ds, q.question_revision, { error: message });
    } catch {
      // Couldn't even record the failure (OBJ-REV-M04): nothing further to
      // do from here, and this function's contract is to never throw - but it
      // must report that nothing was actually persisted (OBJ-REV-013), so the
      // caller doesn't count this pair as done.
      return false;
    }
  }
}

/** Question and data-file pairs with no answer yet (a stored error counts as answered until retried). */
async function pendingPairs(tenantId: string, runId: string): Promise<{ id: string; ds: EvidenceDataset }[]> {
  const datasets = await evidenceDatasets(tenantId, runId);
  return withTenant(tenantId, async (client) => {
    const qs = await client.query<{ id: string }>(
      "select id from objective_evidence where run_id = $1 and excluded = false order by item_kind desc, item_order, created_at",
      [runId],
    );
    // OBJ-REV-007: a result left stale by its table being deleted (had_table true, table_id now
    // null - see DatasetResult.stale) does not count as "done" here, or this pair would never
    // be offered to evaluatePending again and the stale verdict would stand forever. Migration-
    // guarded: on a pre-0086 database, stale is always false (had_table doesn't exist), so every
    // existing result still counts as done, exactly as before this fix.
    let doneRows: { evidence_id: string; document_id: string; had_table?: boolean; table_id: string | null }[];
    // Same savepoint requirement as listObjectiveEvidence/storeResult above: a failed SELECT
    // here aborts the rest of this transaction, so the fallback below needs a rollback first,
    // not a bare catch.
    await client.query("savepoint objective_evidence_pending_had_table_read");
    try {
      const done = await client.query<{ evidence_id: string; document_id: string; had_table: boolean; table_id: string | null }>(
        "select evidence_id, document_id, had_table, table_id from objective_evidence_results where run_id = $1",
        [runId],
      );
      await client.query("release savepoint objective_evidence_pending_had_table_read");
      doneRows = done.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/had_table/.test(message)) throw error;
      await client.query("rollback to savepoint objective_evidence_pending_had_table_read");
      const done = await client.query<{ evidence_id: string; document_id: string; table_id: string | null }>(
        "select evidence_id, document_id, table_id from objective_evidence_results where run_id = $1",
        [runId],
      );
      doneRows = done.rows.map((x) => ({ ...x, had_table: false }));
    }
    const have = new Set(doneRows.filter((x) => !(x.had_table && !x.table_id)).map((x) => `${x.evidence_id}:${x.document_id}`));
    const out: { id: string; ds: EvidenceDataset }[] = [];
    for (const q of qs.rows) for (const ds of datasets) if (!have.has(`${q.id}:${ds.id}`)) out.push({ id: q.id, ds });
    return out;
  });
}

/** Answers up to `limit` question and file pairs. Returns how many remain, so the caller can keep going. */
export async function evaluatePending(tenantId: string, runId: string, limit = 2): Promise<{ done: number; remaining: number }> {
  const todo = await pendingPairs(tenantId, runId);
  const batch = todo.slice(0, limit);
  // done counts pairs that actually got something durably stored, not just attempted
  // (OBJ-REV-013): a pair whose storeResult call itself failed used to be counted as done
  // anyway, so the caller believed progress was made and reported none remaining when the
  // pair was, in fact, still unanswered and would silently never be retried from here.
  let done = 0;
  for (const p of batch) if (await evaluateEvidenceQuestion(tenantId, runId, p.ds, p.id)) done++;
  // A pair that failed to persist is still pending (pendingPairs will offer it again next
  // time, since it's genuinely absent from objective_evidence_results), so it belongs in
  // remaining, not silently dropped.
  return { done, remaining: todo.length - done };
}

// ---------------------------------------------------------------------------
// 3. Researcher controls.

export async function editEvidenceQuestion(
  tenantId: string,
  runId: string,
  id: string,
  patch: { question?: string; request_text?: string; supports_if?: string; against_if?: string; excluded?: boolean },
): Promise<void> {
  // migration 0082's own comment (and this function's) say question_revision bumps "only on
  // an actual wording change" - but `changedWording` used to mean only "a wording FIELD was
  // supplied in this call", true even when the caller passes back exactly the text already
  // stored (a form re-save, a client that always sends every field). That bumped the
  // revision, cleared the numeric expectation, and deleted existing results for an edit that
  // changed nothing - the comment's claim was aspirational, not what the code actually did.
  // Comparing each supplied field against what is actually on file first is what makes
  // "actual wording change" true in code, not just in the comment.
  const nextQuestion = patch.question?.trim().slice(0, 400);
  const nextRequestText = patch.request_text?.trim().slice(0, 300);
  const nextSupportsIf = patch.supports_if?.trim().slice(0, 400);
  const nextAgainstIf = patch.against_if?.trim().slice(0, 400);
  await withTenant(tenantId, async (client) => {
    // OBJ-REV-007 (shared edit/evaluation concurrency protocol): `for update` locks this
    // row for the rest of this transaction (released on commit/rollback, same as any other
    // write in this file), so a storeResult call that is mid-flight for this same question
    // - see storeResult's own comment - is either already finished and committed by the
    // time this SELECT runs (so this read sees its result row and whatever revision it
    // wrote against), or is forced to wait for THIS transaction to finish before it can
    // take the lock itself, rather than racing it on an unlocked read. Read-only callers
    // (listObjectiveEvidence, etc.) do not take this lock, so an edit does not block
    // researchers from simply viewing the question list - only against another writer
    // (another edit, or an evaluation's storeResult) touching the same row.
    const current = await client.query<{ question: string | null; request_text: string | null; supports_if: string | null; against_if: string | null }>(
      "select question, request_text, supports_if, against_if from objective_evidence where id = $1 and run_id = $2 for update",
      [id, runId],
    );
    const row = current.rows[0];
    // A lock query must confirm its row (standing requirement 4): editing a question deleted
    // meanwhile (regenerated away, or its run removed) used to report success while changing
    // nothing. It now fails with an actionable message instead.
    if (!row) throw new Error("This evidence question no longer exists. Reload the page to see the current questions.");
    const changedWording = Boolean(
      row && (
        (nextQuestion !== undefined && nextQuestion !== (row.question ?? "")) ||
        (nextRequestText !== undefined && nextRequestText !== (row.request_text ?? "")) ||
        (nextSupportsIf !== undefined && nextSupportsIf !== (row.supports_if ?? "")) ||
        (nextAgainstIf !== undefined && nextAgainstIf !== (row.against_if ?? ""))
      ),
    );
    await client.query(
      `update objective_evidence set
         question = coalesce($3, question),
         request_text = coalesce($4, request_text),
         supports_if = coalesce($5, supports_if),
         against_if = coalesce($6, against_if),
         excluded = coalesce($7, excluded),
         source = case when $8 then 'edited' else source end,
         -- an edit drops the numeric expectation: the old threshold no longer matches the new wording
         expectation = case when $8 then null else expectation end,
         -- OBJ-REV-009 (fourth pass): migration 0092's own comment defines generation_id as
         -- "null for a row the researcher has edited... a generation's identity describes an
         -- automatic replacement pass, not a researcher's own decision" - this is the first
         -- place that definition has to actually be enforced in code, not just stated in a
         -- migration comment. Clearing it only on the same changedWording condition that already
         -- flips source to 'edited' keeps the two in lockstep: generation_id identifies which
         -- automatic pass is the CURRENT author of this row's text, cleared the moment that
         -- author becomes the researcher instead. Excluding a row without changing its wording
         -- does not change who authored the text, so it leaves generation_id untouched.
         generation_id = case when $8 then null else generation_id end,
         -- bumped only on an actual wording change, so an in-flight evaluation reading the
         -- old wording can tell its answer has gone stale before writing it (OBJ-REV-007)
         question_revision = case when $8 then question_revision + 1 else question_revision end
       where id = $1 and run_id = $2`,
      [
        id,
        runId,
        nextQuestion ?? null,
        nextRequestText ?? null,
        nextSupportsIf ?? null,
        nextAgainstIf ?? null,
        patch.excluded ?? null,
        changedWording,
      ],
    );
    // an edit clears the old answers; they are read again on the next run
    if (changedWording) await client.query("delete from objective_evidence_results where evidence_id = $1 and run_id = $2", [id, runId]);
  });
}

/** Clears the answers of one question, or every failed answer, so they are read again. */
export async function retryEvidence(tenantId: string, runId: string, id?: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `delete from objective_evidence_results
        where run_id = $1 and (($2::uuid is null and error is not null) or evidence_id = $2::uuid)`,
      [runId, id ?? null],
    );
  });
}

/**
 * A short block for the objective check: what the data itself says about each
 * objective, so a conclusion can cite direct evidence and not only insights.
 * Empty when the lane has not run or its table is not migrated (expected,
 * never flagged). A connection, permission, or other unexpected failure
 * reading that table is a different thing: that digest is also empty, but
 * the caller needs to know retrieval was attempted and failed rather than
 * silently treating the gap the same as "genuinely nothing to report"
 * (OBJ-REV-012 - previously a bare catch swallowed every failure alike).
 */
export async function evidenceDigest(
  tenantId: string,
  runId: string,
): Promise<{ items: Map<string, string>; degraded: boolean }> {
  const out = new Map<string, string>();
  try {
    const { questions: qs, originAvailable } = await withTenant(tenantId, (client) => fetchObjectiveEvidenceRows(client, runId));
    // OBJ-REV-001/002 Rule B: only groups whose identity can match a current item contribute; a
    // deleted-candidate, unknown-origin or conflicting group never lends its evidence to anything.
    // Without 0095 every unlinked row is unknown, so evidence that may belong to a current
    // free-text item cannot be attributed: reported as degraded (unknown), not as "silent".
    let unattributed = false;
    for (const g of rollUp(qs)) {
      if (g.identity !== "linked" && g.identity !== "text") {
        if (!originAvailable && g.identity === "unknown") unattributed = true;
        continue;
      }
      const live = g.questions.filter((q) => !q.excluded && q.stance);
      if (live.length === 0) continue;
      const line = (q: EvidenceQuestion) => {
        const parts = q.results
          .filter((x) => x.stance)
          .map((x) => `${q.results.length > 1 ? `[${x.dataset_name}] ` : ""}${x.stance}${x.basis === "judged" ? " (judged)" : ""}: ${x.summary ?? ""}`);
        return `${q.question} -> ${q.stance}: ${parts.join(" ")}`;
      };
      out.set(g.key, `Direct data evidence (${g.stance}): ` + live.map(line).join(" ").slice(0, 900));
    }
    if (unattributed) return { items: out, degraded: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "does not exist" alone, not also plain "relation" (OBJ-REV-012): Postgres's
    // permission-denied message - "permission denied for relation objective_evidence" -
    // contains the table name and the word "relation" without the table being missing,
    // so the old check (which also matched bare "relation") returned degraded:false for a
    // real permission failure, the same as the harmless not-yet-migrated case. "does not
    // exist" is unique to the actual missing-relation error (42P01).
    const notMigrated = /objective_evidence/.test(message) && /does not exist/.test(message);
    if (notMigrated) return { items: out, degraded: false };
    // Unexpected failure: recorded (best-effort, same pattern used elsewhere
    // for non-blocking bookkeeping) so it's visible outside a database
    // client, and reported back to the caller so it can say so rather than
    // present a quietly empty digest as a normal, complete check.
    try {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'evidence_digest_error', $3)`,
          [tenantId, runId, JSON.stringify({ message })],
        );
      });
    } catch {
      // Best-effort bookkeeping only.
    }
    return { items: out, degraded: true };
  }
  return { items: out, degraded: false };
}
