// Removing, restoring and erasing a project's file (Grant, 2026-10-25; the contract is
// claude/document-deletion-contract.md, migration 0115).
//
// Removing a file takes it, and everything resting on it, out of the project's current research at
// once, and keeps it restorable for BIN_DAYS:
//   - its findings (extracted from it, calculated from its tables, or posted from its saved driver
//     analyses) are archived to the finding history (reason 'source_removed', with review decisions,
//     provenance and notes) and leave the findings table; what cascades from them (verdicts, per-finding
//     insights and their recommendations, table checks, contradictions, synthesized-insight source
//     links) goes with them. A full copy of every deleted row is kept in document_removals.snapshot, so
//     a restore puts back the same rows under the same ids;
//   - the file and its own material (imported tables, coding, analyses, instrument items and links,
//     objective evidence) move into the project's bin, a hidden run (runs.bin_of), so no project
//     query, count, search, calculation or export sees them;
//   - unreviewed objective and decision suggestions drawn only from this file are removed; kept ones
//     drawn from it are marked (source_removed_at); the rules are in candidateSourceDocuments.ts;
//   - shared work (synthesized insights, recommendations, narratives) is not changed: its support is
//     derived from current findings, so it reads "no longer valid" or changed, wording kept.
// Erasing removes the file for good: its row and material, the history copies and the snapshot of
// its findings, and the Research quality text read from it; stored bytes are queued for removal.
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { archiveAndReplaceFindings } from "./findingArchive";
import { driverAnalysesPresent, legacyDriverFindingOf } from "./driverFindingSource";
import { lockRunForContextChange, syncDecisionStatement } from "./runSync";
import { DECISION_REMOVED_WITH_FILE, KEPT_AND_MARKED, OBJECTIVE_REMOVED_WITH_FILE } from "./candidateSourceDocuments";
import { convertedCopyPath, finishDocumentStorageCleanup, queueDocumentStorageCleanup } from "./documentStorageCleanup";
import { purgeSourceText } from "./researchQualityRepository";

export const BIN_DAYS = 30;

/**
 * Tables holding a file's own material that carry a run: moved into the bin with the file and back
 * on restore. Every table with both a document_id and a run_id column must be in this list or in
 * NOT_MOVED_WITH_DOCUMENT; a test fails otherwise, so a new table cannot be missed silently.
 */
export const MOVED_WITH_DOCUMENT = [
  "document_tables",
  "coding_codebooks",
  "coding_segments",
  "coding_assignment_overrides",
  "coding_document_settings",
  "coding_meaning_checks",
  "coding_memos",
  "coding_negative_cases",
  "coding_respondent_attributes",
  "coding_run_manifest",
  "coding_variable_links",
  "csm_modules",
  "brand_health_modules",
  "driver_analyses",
  "instrument_items",
  "objective_evidence",
  "objective_evidence_results",
  "claim_table_checks",
] as const;

/**
 * Tables with document_id and run_id that stay in the project: Research quality keeps its reviews
 * and source snapshots by design (erasing a file purges their text); the removal record is the bin's
 * own.
 */
export const NOT_MOVED_WITH_DOCUMENT = ["research_quality_sources", "document_removals"] as const;

export type RemovalCounts = {
  findings: number;
  reviewed: number;
  notes: number;
  insights: number;
  recommendations: number;
  suggestionsRemoved: number;
  objectivesMarked: number;
};

export type BinItem = {
  removalId: string;
  documentId: string;
  filename: string;
  kind: string;
  removedAt: string;
  expiresAt: string;
  counts: RemovalCounts;
};

type Snapshot = {
  findings: unknown[];
  verdicts: unknown[];
  insights: unknown[];
  recommendations: unknown[];
  claimTableChecks: unknown[];
  contradictions: unknown[];
  synthesizedSources: unknown[];
  groundedBy: { id: string; grounded_by_finding_id: string }[];
};

let binColumns: boolean | null = null;
/** Migration 0115. Before it a file cannot be removed (it would be lost without the bin). */
export async function binAvailable(client: PoolClient): Promise<boolean> {
  if (binColumns) return true;
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'documents' and column_name = 'removed_from_run'",
  );
  binColumns = r.rows[0]?.n === 1;
  return binColumns;
}
const NEEDS_BIN = "Removing a file needs database migration 0115 (the bin). Apply it and try again; nothing was changed.";

/** The project's bin run, made on first use. Locked for the transaction. */
async function binRunFor(client: PoolClient, tenantId: string, runId: string): Promise<string> {
  const existing = await client.query<{ id: string }>("select id from runs where bin_of = $1 and tenant_id = $2 for update", [runId, tenantId]);
  if (existing.rows[0]) return existing.rows[0].id;
  const made = await client.query<{ id: string }>(
    "insert into runs (tenant_id, bin_of, project_name) values ($1, $2, 'Removed files') on conflict (bin_of) where bin_of is not null do nothing returning id",
    [tenantId, runId],
  );
  if (made.rows[0]) return made.rows[0].id;
  // Made by a concurrent removal between the two statements.
  const again = await client.query<{ id: string }>("select id from runs where bin_of = $1 and tenant_id = $2 for update", [runId, tenantId]);
  return again.rows[0].id;
}

/** The ids of every finding resting on this file: extracted from it, from its tables, or from its saved driver analyses. */
async function findingIdsOf(client: PoolClient, documentId: string): Promise<string[]> {
  const legacyDrivers = (await driverAnalysesPresent(client)) ? ` or ${legacyDriverFindingOf("f", "$1")}` : "";
  const r = await client.query<{ id: string }>(
    `select f.id from findings f
     where f.source_document_id = $1
        or f.source_table_id in (select id from document_tables where document_id = $1)${legacyDrivers}`,
    [documentId],
  );
  return r.rows.map((x) => x.id);
}

async function rowsOf(client: PoolClient, sql: string, params: unknown[]): Promise<unknown[]> {
  return (await client.query<{ row: unknown }>(sql, params)).rows.map((r) => r.row);
}

async function moveOwnMaterial(client: PoolClient, documentId: string, fromRun: string, toRun: string): Promise<void> {
  for (const table of MOVED_WITH_DOCUMENT) {
    await client.query(`update ${table} set run_id = $3 where document_id = $1 and run_id = $2`, [documentId, fromRun, toRun]);
  }
  // Rows tied to the file through one of its tables rather than its id.
  for (const table of ["objective_evidence", "objective_evidence_results", "claim_table_checks"]) {
    await client.query(`update ${table} set run_id = $3 where run_id = $2 and table_id in (select id from document_tables where document_id = $1)`, [documentId, fromRun, toRun]);
  }
  // A questionnaire link joins one of the questionnaire's items to a data file's variable: it goes with
  // whichever of the two is removed, and comes back only when both are in the project again.
  await client.query(
    `update instrument_links set run_id = $3
     where run_id = $2 and (data_document_id = $1 or item_id in (select id from instrument_items where document_id = $1))`,
    [documentId, fromRun, toRun],
  );
}

async function moveOwnMaterialBack(client: PoolClient, documentId: string, binRun: string, runId: string): Promise<void> {
  for (const table of MOVED_WITH_DOCUMENT) {
    await client.query(`update ${table} set run_id = $3 where document_id = $1 and run_id = $2`, [documentId, binRun, runId]);
  }
  for (const table of ["objective_evidence", "objective_evidence_results", "claim_table_checks"]) {
    await client.query(`update ${table} set run_id = $3 where run_id = $2 and table_id in (select id from document_tables where document_id = $1)`, [documentId, binRun, runId]);
  }
  await client.query(
    `update instrument_links l set run_id = $3
     where l.run_id = $2
       and (l.data_document_id = $1 or l.item_id in (select id from instrument_items where document_id = $1))
       and exists (select 1 from documents d where d.id = l.data_document_id and d.run_id = $3)
       and exists (select 1 from instrument_items i join documents d on d.id = i.document_id where i.id = l.item_id and d.run_id = $3)`,
    [documentId, binRun, runId],
  );
}

/**
 * What removing a file will do, counted now. The removal counts again under its lock and records
 * what it actually did.
 */
export async function removalImpact(client: PoolClient, runId: string, documentId: string): Promise<RemovalCounts> {
  const ids = await findingIdsOf(client, documentId);
  const one = async (sql: string, params: unknown[]) => Number((await client.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0);
  return {
    findings: ids.length,
    reviewed: await one("select count(*)::int as n from findings where id = any($1::uuid[]) and human_reviewed_at is not null", [ids]),
    notes: await one("select count(*)::int as n from findings where id = any($1::uuid[]) and coalesce(btrim(researcher_note), '') <> ''", [ids]),
    insights:
      (await one("select count(*)::int as n from insights where finding_id = any($1::uuid[])", [ids])) +
      (await one(
        "select count(distinct s.synthesized_insight_id)::int as n from synthesized_insight_sources s join insights i on i.id = s.pre_insight_id where i.finding_id = any($1::uuid[])",
        [ids],
      )),
    recommendations: await one("select count(*)::int as n from recommendations r join insights i on i.id = r.insight_id where i.finding_id = any($1::uuid[])", [ids]),
    suggestionsRemoved:
      (await one(`select count(*)::int as n from objective_candidates c where c.run_id = $1 and ${OBJECTIVE_REMOVED_WITH_FILE("c", "$2::uuid")}`, [runId, documentId])) +
      (await one(`select count(*)::int as n from decision_candidates c where c.run_id = $1 and ${DECISION_REMOVED_WITH_FILE("c", "$2::uuid")}`, [runId, documentId])),
    objectivesMarked:
      (await one(
        `select count(*)::int as n from objective_candidates c where c.run_id = $1 and ${KEPT_AND_MARKED("c", "$2::uuid", OBJECTIVE_REMOVED_WITH_FILE)}`,
        [runId, documentId],
      )) +
      (await one(
        `select count(*)::int as n from decision_candidates c where c.run_id = $1 and ${KEPT_AND_MARKED("c", "$2::uuid", DECISION_REMOVED_WITH_FILE)}`,
        [runId, documentId],
      )),
  };
}

/**
 * Removes a file from the project into its bin, in one transaction (see the file header). Refused when
 * the file is not this project's, or is already removed. Returns what was done.
 */
export async function removeDocumentToBin(
  tenantId: string,
  runId: string,
  documentId: string,
  removedBy: string | null,
): Promise<{ removalId: string; counts: RemovalCounts }> {
  return withTenant(tenantId, async (client) => {
    if (!(await binAvailable(client))) throw new Error(NEEDS_BIN);
    // The run first, as every change to the project's objectives does (runSync), then the file.
    await lockRunForContextChange(client, runId, tenantId);
    const doc = await client.query<{ source_filename: string }>(
      "select source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3 and removed_at is null for update",
      [documentId, runId, tenantId],
    );
    if (!doc.rows[0]) throw new Error("That file is not in this project; it may already have been removed. Reload the page.");
    const counts = await removalImpact(client, runId, documentId);
    const ids = await findingIdsOf(client, documentId);
    const insightIds = (await client.query<{ id: string }>("select id from insights where finding_id = any($1::uuid[])", [ids])).rows.map((r) => r.id);
    const snapshot: Snapshot = {
      findings: await rowsOf(client, "select to_jsonb(f) as row from findings f where id = any($1::uuid[])", [ids]),
      verdicts: await rowsOf(client, "select to_jsonb(v) as row from verdicts v where finding_id = any($1::uuid[])", [ids]),
      insights: await rowsOf(client, "select to_jsonb(i) as row from insights i where id = any($1::uuid[])", [insightIds]),
      recommendations: await rowsOf(client, "select to_jsonb(r) as row from recommendations r where insight_id = any($1::uuid[])", [insightIds]),
      claimTableChecks: await rowsOf(client, "select to_jsonb(c) as row from claim_table_checks c where finding_id = any($1::uuid[])", [ids]),
      contradictions: await rowsOf(
        client,
        "select to_jsonb(c) as row from finding_contradictions c where original_finding_id = any($1::uuid[]) or contradicting_finding_id = any($1::uuid[])",
        [ids],
      ),
      synthesizedSources: await rowsOf(client, "select to_jsonb(s) as row from synthesized_insight_sources s where pre_insight_id = any($1::uuid[])", [insightIds]),
      groundedBy: (
        await client.query<{ id: string; grounded_by_finding_id: string }>(
          "select id, grounded_by_finding_id from findings where grounded_by_finding_id = any($1::uuid[]) and not (id = any($1::uuid[]))",
          [ids],
        )
      ).rows,
    };
    // Archived with their review decisions, provenance and notes, then deleted with what cascades.
    await archiveAndReplaceFindings(client, { documentColumn: "source_document_id", documentId, ids, onlyRejected: false, archiveReason: "source_removed" });
    // Suggestions drawn only from this file go with it; kept objectives and decisions that name it are
    // marked (candidateSourceDocuments.ts). Marking first, so the delete cannot change what is marked.
    for (const [table, removed] of [
      ["objective_candidates", OBJECTIVE_REMOVED_WITH_FILE],
      ["decision_candidates", DECISION_REMOVED_WITH_FILE],
    ] as const) {
      await client.query(`update ${table} c set source_removed_at = now() where c.run_id = $1 and ${KEPT_AND_MARKED("c", "$2::uuid", removed)}`, [runId, documentId]);
      await client.query(`delete from ${table} c where c.run_id = $1 and ${removed("c", "$2::uuid")}`, [runId, documentId]);
    }
    // A decision suggestion lands accepted, so removing one changes the project's decision statement.
    await syncDecisionStatement(client, runId);
    const binRun = await binRunFor(client, tenantId, runId);
    await moveOwnMaterial(client, documentId, runId, binRun);
    const moved = await client.query(
      "update documents set run_id = $3, removed_at = now(), removed_by = $4, removed_from_run = $2 where id = $1 and run_id = $2 and tenant_id = $5",
      [documentId, runId, binRun, removedBy, tenantId],
    );
    if (moved.rowCount !== 1) throw new Error("The file could not be removed. Try again.");
    const removal = await client.query<{ id: string }>(
      `insert into document_removals (tenant_id, run_id, document_id, filename, removed_by, snapshot, counts)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [tenantId, runId, documentId, doc.rows[0].source_filename, removedBy, JSON.stringify(snapshot), JSON.stringify(counts)],
    );
    return { removalId: removal.rows[0].id, counts };
  });
}

/** Inserts snapshot rows into a table as they were (same ids); a row whose parent is gone is skipped. */
async function putBack(client: PoolClient, table: string, rows: unknown[], keepIf = "true"): Promise<number> {
  if (rows.length === 0) return 0;
  const r = await client.query(
    `insert into ${table} select * from jsonb_populate_recordset(null::${table}, $1::jsonb) x where ${keepIf} on conflict do nothing`,
    [JSON.stringify(rows)],
  );
  return r.rowCount ?? 0;
}

/**
 * Restores a removed file from the bin into its project, in one transaction: the file and its own
 * material move back, and its findings and what rested on them are put back under their original ids,
 * with their review decisions and notes; their history copies made by the removal are removed again.
 * Refused when the item is not this project's, was already restored or erased, or when the project now
 * has a file with the same kind and content (the researcher keeps one or the other).
 */
export async function restoreDocumentFromBin(tenantId: string, runId: string, removalId: string): Promise<{ findings: number }> {
  return withTenant(tenantId, async (client) => {
    if (!(await binAvailable(client))) throw new Error(NEEDS_BIN);
    await lockRunForContextChange(client, runId, tenantId);
    const removal = (
      await client.query<{ document_id: string; snapshot: Snapshot; restored_at: string | null }>(
        "select document_id, snapshot, restored_at from document_removals where id = $1 and run_id = $2 and tenant_id = $3 for update",
        [removalId, runId, tenantId],
      )
    ).rows[0];
    if (!removal || removal.restored_at) throw new Error("That file is no longer in the bin. Reload the page.");
    const binRun = await binRunFor(client, tenantId, runId);
    const doc = (
      await client.query<{ kind: string; content_sha256: string | null; source_filename: string }>(
        "select kind, content_sha256, source_filename from documents where id = $1 and run_id = $2 and removed_from_run = $3 and tenant_id = $4 for update",
        [removal.document_id, binRun, runId, tenantId],
      )
    ).rows[0];
    if (!doc) throw new Error("That file is no longer in the bin; it may have been erased. Reload the page.");
    if (doc.content_sha256) {
      const twin = await client.query<{ source_filename: string }>(
        "select source_filename from documents where run_id = $1 and kind = $2 and content_sha256 = $3 limit 1",
        [runId, doc.kind, doc.content_sha256],
      );
      if (twin.rows[0]) {
        throw new Error(
          `The project already has this file again (${twin.rows[0].source_filename}), so it was not restored. Remove that copy first if you want this one and its findings back.`,
        );
      }
    }
    await client.query("update documents set run_id = $2, removed_at = null, removed_by = null, removed_from_run = null where id = $1", [removal.document_id, runId]);
    // A file of an output set that was removed as a whole brings its set back with it.
    await client.query(
      "update output_sets set run_id = $2 where run_id = $3 and id = (select output_set_id from documents where id = $1)",
      [removal.document_id, runId, binRun],
    );
    await moveOwnMaterialBack(client, removal.document_id, binRun, runId);
    const s = removal.snapshot;
    const findings = await putBack(client, "findings", s.findings);
    const findingIds = (s.findings as { id: string }[]).map((f) => f.id);
    await putBack(client, "verdicts", s.verdicts);
    await putBack(client, "insights", s.insights);
    await putBack(client, "recommendations", s.recommendations);
    await putBack(client, "claim_table_checks", s.claimTableChecks, "exists (select 1 from findings f where f.id = x.finding_id)");
    await putBack(
      client,
      "finding_contradictions",
      s.contradictions,
      "exists (select 1 from findings f where f.id = x.original_finding_id) and (x.contradicting_finding_id is null or exists (select 1 from findings f where f.id = x.contradicting_finding_id)) and (x.contradicting_synthesized_insight_id is null or exists (select 1 from synthesized_insights si where si.id = x.contradicting_synthesized_insight_id))",
    );
    await putBack(client, "synthesized_insight_sources", s.synthesizedSources, "exists (select 1 from synthesized_insights si where si.id = x.synthesized_insight_id)");
    for (const g of s.groundedBy) {
      await client.query("update findings set grounded_by_finding_id = $2 where id = $1 and grounded_by_finding_id is null", [g.id, g.grounded_by_finding_id]);
    }
    // The removal's history copies described findings that are current again.
    const insightIds = (s.insights as { id: string }[]).map((i) => i.id);
    await client.query("delete from recommendation_history where original_insight_id = any($1::uuid[])", [insightIds]);
    for (const table of ["insight_history", "verdict_history"]) {
      await client.query(`delete from ${table} where original_finding_id = any($1::uuid[])`, [findingIds]);
    }
    await client.query("delete from finding_history where original_finding_id = any($1::uuid[]) and archived_reason = 'source_removed'", [findingIds]);
    // A kept objective or decision is unmarked once none of its files is in the bin. Suggestions removed
    // with the file are not put back: reading the file again makes them again (contract).
    for (const table of ["objective_candidates", "decision_candidates"]) {
      await client.query(
        `update ${table} c set source_removed_at = null
         where c.run_id = $1 and $2::uuid = any(c.source_document_ids)
           and not exists (select 1 from documents d where d.id = any(c.source_document_ids) and d.removed_at is not null and d.id <> $2::uuid)`,
        [runId, removal.document_id],
      );
    }
    await client.query("update document_removals set restored_at = now() where id = $1", [removalId]);
    return { findings };
  });
}

/**
 * Erases a removed file for good. Removes its document row (cascading its own material), the snapshot
 * and history copies of its findings, and the Research quality text read from it; queues its stored
 * bytes, preview and converted copy for removal. Synthesized insights and narratives keep the
 * researcher's wording and stay "no longer valid". Downloaded reports cannot be recalled.
 */
export async function eraseRemovedDocument(tenantId: string, runId: string, documentId: string): Promise<void> {
  const prepared = await withTenant(tenantId, async (client) => {
    if (!(await binAvailable(client))) throw new Error(NEEDS_BIN);
    await lockRunForContextChange(client, runId, tenantId);
    const binRun = await binRunFor(client, tenantId, runId);
    const doc = (
      await client.query<{ storage_path: string; preview_storage_path: string | null }>(
        "select storage_path, preview_storage_path from documents where id = $1 and run_id = $2 and removed_from_run = $3 and tenant_id = $4 for update",
        [documentId, binRun, runId, tenantId],
      )
    ).rows[0];
    if (!doc) throw new Error("That file is not in this project's bin. Reload the page.");
    const removals = await client.query<{ snapshot: Snapshot }>("select snapshot from document_removals where document_id = $1 and run_id = $2", [documentId, runId]);
    const findingIds = removals.rows.flatMap((r) => (r.snapshot.findings as { id: string }[]).map((f) => f.id));
    const insightIds = removals.rows.flatMap((r) => (r.snapshot.insights as { id: string }[]).map((i) => i.id));
    await client.query("delete from recommendation_history where original_insight_id = any($1::uuid[])", [insightIds]);
    for (const table of ["insight_history", "verdict_history", "finding_history"]) {
      await client.query(`delete from ${table} where original_finding_id = any($1::uuid[])`, [findingIds]);
    }
    const sources = (await client.query<{ id: string }>("select id from research_quality_sources where run_id = $1 and document_id = $2", [runId, documentId])).rows.map((r) => r.id);
    const paths = [doc.storage_path, doc.preview_storage_path, convertedCopyPath(doc.storage_path)].filter((p): p is string => Boolean(p));
    const cleanupId = paths.length ? await queueDocumentStorageCleanup(client, tenantId, runId, documentId, paths) : null;
    await client.query("delete from document_removals where document_id = $1 and run_id = $2", [documentId, runId]);
    const deleted = await client.query<{ output_set_id: string | null }>("delete from documents where id = $1 and run_id = $2 returning output_set_id", [documentId, binRun]);
    if (deleted.rowCount !== 1) throw new Error("The file could not be erased. Try again.");
    // A removed output set goes once its last file is erased.
    await client.query(
      "delete from output_sets s where s.id = $1 and s.run_id = $2 and not exists (select 1 from documents d where d.output_set_id = s.id)",
      [deleted.rows[0].output_set_id, binRun],
    );
    await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'document_erased', $3)`, [
      tenantId,
      runId,
      JSON.stringify({ documentId, findings: findingIds.length }),
    ]);
    return { cleanupId, sources };
  });
  // Research quality keeps its reviews; the text read from this file is purged from them.
  for (const source of prepared.sources) await purgeSourceText(tenantId, runId, source);
  if (prepared.cleanupId) await finishDocumentStorageCleanup(tenantId, runId, prepared.cleanupId).catch(() => {});
}

/** The project's bin, newest first. */
export async function listBin(tenantId: string, runId: string): Promise<BinItem[]> {
  return withTenantRead(tenantId, async (client) => {
    if (!(await binAvailable(client))) return [];
    const r = await client.query<{ id: string; document_id: string; filename: string; kind: string; removed_at: Date; counts: RemovalCounts }>(
      `select r.id, r.document_id, r.filename, d.kind, r.removed_at, r.counts
       from document_removals r join documents d on d.id = r.document_id
       where r.run_id = $1 and r.restored_at is null and d.removed_from_run = $1
       order by r.removed_at desc`,
      [runId],
    );
    return r.rows.map((x) => ({
      removalId: x.id,
      documentId: x.document_id,
      filename: x.filename,
      kind: x.kind,
      removedAt: new Date(x.removed_at).toISOString(),
      expiresAt: new Date(new Date(x.removed_at).getTime() + BIN_DAYS * 86400000).toISOString(),
      counts: x.counts,
    }));
  });
}

/** Erases every item that has been in the bin longer than BIN_DAYS. Returns how many were erased. */
export async function eraseExpiredBinItems(tenantId: string, runId: string, now = new Date()): Promise<number> {
  const items = await listBin(tenantId, runId);
  const expired = items.filter((i) => new Date(i.expiresAt).getTime() <= now.getTime());
  for (const item of expired) await eraseRemovedDocument(tenantId, runId, item.documentId);
  return expired.length;
}

/**
 * Removes a whole output set: each of its files goes to the bin as above, and the set itself moves
 * into the bin too, so restoring any of its files brings the set back, and erasing the last one
 * erases it.
 */
export async function removeOutputSetToBin(tenantId: string, runId: string, setId: string, removedBy: string | null): Promise<number> {
  const ids = await withTenantRead(tenantId, async (client) =>
    (await client.query<{ id: string }>("select id from documents where output_set_id = $1 and run_id = $2 and tenant_id = $3", [setId, runId, tenantId])).rows.map((r) => r.id),
  );
  for (const id of ids) await removeDocumentToBin(tenantId, runId, id, removedBy);
  await withTenant(tenantId, async (client) => {
    if (!(await binAvailable(client))) throw new Error(NEEDS_BIN);
    await lockRunForContextChange(client, runId, tenantId);
    const binRun = await binRunFor(client, tenantId, runId);
    const moved = await client.query("update output_sets set run_id = $3 where id = $1 and run_id = $2 and tenant_id = $4", [setId, runId, binRun, tenantId]);
    if (moved.rowCount !== 1) throw new Error("That output set is not in this project. Reload the page.");
  });
  return ids.length;
}
