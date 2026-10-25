import type { PoolClient } from "pg";
import { findingProvenanceAvailable } from "./findingProvenance";
import { findingOriginalAvailable } from "./findingWording";

let historyNoteColumn: boolean | null = null;
async function historyNoteAvailable(client: PoolClient): Promise<boolean> {
  if (historyNoteColumn) return true;
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'finding_history' and column_name = 'researcher_note'",
  );
  historyNoteColumn = r.rows[0]?.n === 1;
  return historyNoteColumn;
}

export type ArchiveReason =
  "regenerate_unreviewed" | "full_reprocess" | "manual_reextract" | "wave_recompare";

/**
 * Before any delete that would remove findings (and, by cascade, their
 * verdicts, insights, and recommendations), this snapshots exactly what's
 * about to be lost into the *_history tables (see
 * 0021_finding_history.sql), then performs the delete. Must be called with
 * a client already inside a withTenant transaction: the caller's own
 * begin/commit is what makes the snapshot and the delete atomic, so if
 * anything later in that transaction fails and rolls back, the snapshot
 * rolls back with it rather than leaving a record of something that was
 * never actually removed.
 *
 * documentColumn/documentId scope this to one document's findings, the
 * same scope every call site already used for its own delete. onlyRejected
 * narrows it to findings still at status 'rejected' ("Regenerate
 * rejected" -- findings insert as 'accepted' by default now, so a
 * researcher reviews by exception, rejecting the ones that are wrong);
 * false archives and replaces everything regardless of review status
 * ("Reprocess all documents", or a single-document manual re-extract).
 *
 * insight_history.original_finding_id is unique (see 0021), but the live
 * `insights` table has no equivalent constraint stopping two insight rows
 * from ever pointing at the same finding_id (a race between two generation
 * passes on the same run is the way that actually happens). Without a
 * safeguard, archiving a finding with duplicate insights would throw a
 * unique-violation on the insight_history insert and roll back this entire
 * function, findings and all, with no visible error and nothing archived.
 * `picked_insights` below picks one insight per finding deterministically
 * (the oldest, as the one most likely to be the "real" one) before either
 * insert touches it, so a duplicate can't abort the archive; the insight
 * that loses the pick is still deleted via cascade when findings are
 * deleted below, it just isn't the one kept in history. `on conflict do
 * nothing` on the insight_history insert is a second line of defense for
 * the same failure mode, in case of a concurrent archive on the same
 * document somehow racing this one.
 */
export async function archiveAndReplaceFindings(
  client: PoolClient,
  params: {
    documentColumn: "source_document_id" | "source_table_id" | "wave_pair";
    /** For "wave_pair": the run id. Otherwise the document or table id. */
    documentId: string;
    /** Only with "wave_pair": `${earlierSetId}:${laterSetId}`. */
    wavePair?: string;
    onlyRejected: boolean;
    archiveReason: ArchiveReason;
    /**
     * IMP-006 / REP-IN-001 with REP-IN-002: when given, archives and deletes EXACTLY this
     * explicit set of finding ids instead of re-querying "every current finding matching
     * documentColumn/documentId[/onlyRejected]". extractFindingsFromDocument's publication
     * transaction decides this set under its document lock (keeping protected human work live,
     * see planReplacement) and inserts the replacement in the same transaction, so a
     * document-scoped delete would be wrong there. An empty array is a safe, explicit no-op
     * (nothing to retire), not an accidental "match everything" - checked before any query runs.
     */
    ids?: string[];
  },
): Promise<void> {
  const { documentColumn, documentId, onlyRejected, archiveReason, ids } = params;
  if (ids && ids.length === 0) return;
  const statusClause = onlyRejected ? "and status = 'rejected'" : "";
  const statusClauseAliased = onlyRejected ? "and f.status = 'rejected'" : "";
  // What "this document's findings" means. A wave comparison has no source file of its own:
  // its findings are the generated ones tagged with the pair of sets compared. An explicit
  // `ids` list overrides all of this: it names the exact rows to retire directly, so neither
  // documentColumn/documentId nor onlyRejected's status filter apply (the caller has already
  // decided which ids qualify before capturing the list).
  let scopeArgs: unknown[] = [documentId];
  let scope = (a: string) => `${a}${documentColumn} = $1`;
  if (ids) {
    scopeArgs = [ids];
    scope = (a: string) => `${a}id = any($1)`;
  } else if (documentColumn === "wave_pair") {
    if (!params.wavePair) throw new Error("wave_pair needs wavePair");
    scopeArgs = [documentId, params.wavePair];
    scope = (a: string) => `${a}run_id = $1 and ${a}origin = 'generated' and ${a}stated_stats->>'wavePair' = $2`;
  }
  const effectiveStatusClause = ids ? "" : statusClause;
  const effectiveStatusClauseAliased = ids ? "" : statusClauseAliased;
  const reasonIx = scopeArgs.length + 1;

  // REP-IN-002 (migration 0094): the history copy keeps review and edit provenance separately, and
  // keeps provenance_tracked, so an archived finding still says whether its researcher actions were
  // recorded or unknown. Before 0094 neither table has these columns and nothing extra is copied.
  const provenanceColumns =
    ((await findingProvenanceAvailable(client))
      ? ", human_reviewed_at, human_review_action, human_edited_at, human_edited_fields, provenance_tracked"
      : "") +
    // FND-001 probe B (migration 0100): an archived edited finding keeps its extracted wording too.
    ((await findingOriginalAvailable(client)) ? ", original_extraction" : "");

  // Codex DI-F07 (migration 0114): the history copy keeps the researcher's note, which used to be
  // dropped with the live row. Before 0114 there is nowhere to keep it, so retiring any finding that
  // has a note is refused (the transaction rolls back) rather than losing it; findings without a note
  // are retired as before.
  const noteColumn = (await historyNoteAvailable(client)) ? ", researcher_note" : "";
  if (!noteColumn) {
    const noted = await client.query(
      `select 1 from findings where ${scope("")} ${effectiveStatusClause} and coalesce(btrim(researcher_note), '') <> '' limit 1`,
      scopeArgs,
    );
    if (noted.rows.length > 0) {
      throw new Error(
        "These findings could not be replaced: one has a researcher note, and keeping notes in the finding history needs database migration 0114. Apply it and try again; nothing was changed.",
      );
    }
  }

  await client.query(
    `insert into finding_history (
       tenant_id, run_id, original_finding_id, origin, finding_text, finding_kind, theme, status,
       source_document_id, source_table_id, source_page, source_quote, data_type, original_created_at,
       archived_reason, pattern_type, stated_stats, quote_verified, extraction_caveats${provenanceColumns}${noteColumn}
     )
     select tenant_id, run_id, id, origin, finding_text, finding_kind, theme, status,
            source_document_id, source_table_id, source_page, source_quote, data_type, created_at, $${reasonIx},
            pattern_type, stated_stats, quote_verified, extraction_caveats${provenanceColumns}${noteColumn}
     from findings
     where ${scope("")} ${effectiveStatusClause}
     on conflict (original_finding_id) do nothing`,
    [...scopeArgs, archiveReason],
  );

  await client.query(
    `insert into verdict_history (
       tenant_id, run_id, original_finding_id, original_verdict_id, verdict_tier, rationale,
       verification_method, corroboration_level, original_created_at
     )
     select v.tenant_id, f.run_id, v.finding_id, v.id, v.verdict_tier, v.rationale,
            v.verification_method, v.corroboration_level, v.created_at
     from verdicts v
     join findings f on f.id = v.finding_id
     where ${scope("f.")} ${effectiveStatusClauseAliased}`,
    scopeArgs,
  );

  await client.query(
    `with picked_insights as (
       select distinct on (i.finding_id)
         i.tenant_id, i.run_id, i.finding_id, i.id, i.headline, i.observation, i.tension,
         i.implication, i.decision_context, i.quality_score, i.quality_tier, i.quality_rationale, i.created_at
       from insights i
       join findings f on f.id = i.finding_id
       where ${scope("f.")} ${effectiveStatusClauseAliased}
       order by i.finding_id, i.created_at asc, i.id asc
     )
     insert into insight_history (
       tenant_id, run_id, original_finding_id, original_insight_id, headline, observation, tension,
       implication, decision_context, quality_score, quality_tier, quality_rationale, original_created_at
     )
     select tenant_id, run_id, finding_id, id, headline, observation, tension,
            implication, decision_context, quality_score, quality_tier, quality_rationale, created_at
     from picked_insights
     on conflict (original_finding_id) do nothing`,
    scopeArgs,
  );

  await client.query(
    `with picked_insights as (
       select distinct on (i.finding_id) i.id as insight_id
       from insights i
       join findings f on f.id = i.finding_id
       where ${scope("f.")} ${effectiveStatusClauseAliased}
       order by i.finding_id, i.created_at asc, i.id asc
     )
     insert into recommendation_history (
       tenant_id, run_id, original_insight_id, original_recommendation_id, action_text, owner_role,
       timeline, metric, priority, status, original_created_at
     )
     select r.tenant_id, r.run_id, r.insight_id, r.id, r.action_text, r.owner_role,
            r.timeline, r.metric, r.priority, r.status, r.created_at
     from recommendations r
     join picked_insights pi on pi.insight_id = r.insight_id`,
    scopeArgs,
  );

  await client.query(
    `delete from findings where ${scope("")} ${effectiveStatusClause}`,
    scopeArgs,
  );
}
