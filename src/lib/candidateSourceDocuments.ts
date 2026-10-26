import type { PoolClient } from "pg";

/**
 * Which files an objective or decision suggestion was drawn from (migration 0115,
 * claude/document-deletion-contract.md section 4). Removing a file removes an unreviewed suggestion
 * only when that file was its only recorded source, and marks a kept one as having lost a source.
 * `null` means the sources are not known (typed by the researcher, made before 0115, or drawn from
 * evidence with no recorded file); such a suggestion is never removed with a file.
 */

const available = new Map<string, boolean>();
/** Whether `table` has 0115's source_document_ids column. Before it, suggestions record no source. */
export async function candidateSourceColumnAvailable(client: PoolClient, table: "objective_candidates" | "decision_candidates"): Promise<boolean> {
  if (available.get(table)) return true;
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'source_document_ids'",
    [table],
  );
  const present = r.rows[0]?.n === 1;
  available.set(table, present);
  return present;
}

/**
 * SQL for the file a finding came from, for finding alias `f`: its own source document, or the
 * document of the imported table it was computed on. Null for a finding with neither (a legacy
 * driver result, a synthesized one).
 */
export const FINDING_SOURCE_DOCUMENT_SQL = (f: string) =>
  `coalesce(${f}.source_document_id, (select dt.document_id from document_tables dt where dt.id = ${f}.source_table_id))`;

/**
 * The distinct files behind a set of evidence rows, or null when any row's file is unknown: a
 * suggestion drawn partly from unattributed evidence cannot be said to come only from one file.
 */
export function sourceDocumentsOf(rows: { source_document: string | null }[]): string[] | null {
  if (rows.length === 0 || rows.some((r) => !r.source_document)) return null;
  return [...new Set(rows.map((r) => r.source_document as string))].sort();
}

/**
 * The suggestions removing file `doc` removes, for candidate alias `c` (SQL predicates; `doc` is a SQL
 * expression for the document id). Both require the file to be the suggestion's only recorded source
 * and the researcher never to have changed it.
 * - Objectives: still pending (not yet accepted or rejected).
 * - Decisions: the decision framer's own suggestions, which land accepted (decisionFramer.ts), so
 *   "unreviewed" is the framer's own test for "never touched by a researcher": not edited and not
 *   rejected. A suggestion the researcher kept without changing it looks the same and is removed too;
 *   reading the file again makes it again.
 * Everything else that names the file among its sources is kept and marked (source_removed_at).
 */
export const OBJECTIVE_REMOVED_WITH_FILE = (c: string, doc: string) =>
  `${c}.status = 'pending' and not ${c}.edited and ${c}.source_document_ids = array[${doc}]`;
export const DECISION_REMOVED_WITH_FILE = (c: string, doc: string) =>
  `${c}.source = 'ai_suggested' and ${c}.status <> 'rejected' and not ${c}.edited and ${c}.source_document_ids = array[${doc}]`;
/** Kept objectives and decisions that name the file among their sources (status accepted). */
export const KEPT_AND_MARKED = (c: string, doc: string, removedWithFile: (c: string, doc: string) => string) =>
  `${c}.status = 'accepted' and ${doc} = any(${c}.source_document_ids) and not (${removedWithFile(c, doc)})`;

/**
 * Every recorded source of candidate `c` is an active file of project `run` (SQL; `run` is a SQL
 * expression): it exists, belongs to the project and is not in the bin. The one test for clearing a
 * kept objective's or decision's "Source document removed" marker (SYS5B-F02): a source that was erased
 * no longer exists, so it is never active again, and the marker stays.
 */
export const ALL_SOURCES_ACTIVE = (c: string, run: string) =>
  `not exists (select 1 from unnest(${c}.source_document_ids) as s(id)
                where not exists (select 1 from documents d where d.id = s.id and d.run_id = ${run} and d.removed_at is null))`;
