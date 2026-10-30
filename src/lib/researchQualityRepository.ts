// Research Quality Review v1: scoped persistence (brief sections 5 to 7).
//
// Every function takes the request's tenant and run and re-checks ownership inside the same
// transaction as its write. Network work (reading documents, calling the model) never happens
// inside a transaction. Guarantees, and how each is established:
//   - one explicit start creates one review: unique (run_id, request_key), and a repeat returns the
//     existing review;
//   - a task result (success or failure) is recorded only by the lease that claimed it and only
//     while that lease is unexpired at the moment the result is written: the UPDATE matches
//     (id, lease_token, status 'running', lease_expires_at > clock_timestamp()), so a late answer
//     from an expired lease writes nothing, whether or not another attempt has claimed the task
//     since. Lease times are compared with clock_timestamp(), never now(): now() is frozen at the
//     start of the transaction, so a publication that waited on a source lock (or the task row)
//     would otherwise be judged by the time it started, not the time it writes (Codex 2026-10-18,
//     twice). Each write first locks the task row (lockTaskRow, after any source locks), and only
//     then runs the lease UPDATE, so the lease is judged after every wait, whether on a source
//     version or on the task row itself. Holding the row lock to commit also means a reclaim
//     cannot slip in between the check and the commit. A refused answer's token usage is still
//     added to the cost totals, because it was paid for;
//   - a result never outlives a purge of the text it was made from: publication first locks the
//     source versions it rests on FOR SHARE, purgeSourceText locks them FOR UPDATE, both in id order
//     and both before touching task rows, so the two serialise without deadlock. A purge that
//     commits first makes the publication refuse (the task fails with no attempts left); a
//     publication that commits first is then blanked by the purge like any published result;
//   - an attempt that died (running, lease expired) is not stranded: claimTask can take it over
//     and resetFailedTasks puts it back to pending for an explicit retry, within attempt bounds;
//   - observation identity is the server-derived logical key, unique per run; one version per
//     observation per review (unique (review_id, observation_id));
//   - researcher status and wording decisions lock the observation row and compare its revision; a
//     stale revision is a visible conflict, never a silent overwrite; every entry has an idempotency
//     key so a repeated click records once;
//   - a source version is immutable; re-reading identical text reuses the current version.
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { ResearchQualityConflictError, ResearchQualityError, ResearchQualitySetupError, type ObservationPayload, type ResearcherEntryKind, type SourceRole } from "./researchQualityTypes";
import { canonicalJson, sha256 } from "./researchQualityRules";
import type { SourceSnapshot } from "./researchQualitySources";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Fails before any write when migration 0105 is missing. */
export async function assertModuleTables(client: PoolClient): Promise<void> {
  const r = await client.query<{ ok: boolean }>(`select to_regclass('public.research_quality_researcher_entries') is not null as ok`);
  if (!r.rows[0]?.ok) throw new ResearchQualitySetupError();
}

export async function assertRunOwned(client: PoolClient, tenantId: string, runId: string): Promise<void> {
  if (!isUuid(runId)) throw new ResearchQualityError("Unknown project.");
  const r = await client.query(`select 1 from runs where id = $1 and tenant_id = $2 for share`, [runId, tenantId]);
  if (r.rowCount !== 1) throw new ResearchQualityError("Unknown project.");
}

// ---------------------------------------------------------------- sources

export type OwnedDocument = { id: string; storage_path: string; source_filename: string };

/** An owned project document, or a refusal: another tenant's or run's document id is "not found". */
export async function loadOwnedDocument(tenantId: string, runId: string, documentId: string): Promise<OwnedDocument> {
  if (!isUuid(documentId)) throw new ResearchQualityError("Unknown document.");
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    const r = await client.query<OwnedDocument>(`select id, storage_path, source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3`, [documentId, runId, tenantId]);
    if (!r.rows[0]) throw new ResearchQualityError("Unknown document.");
    return r.rows[0];
  });
}

/** Creates the logical source for a document, or updates its roles (revision-checked when given). */
export async function saveSourceRoles(tenantId: string, runId: string, documentId: string, roles: SourceRole[], expectedRevision: number | null): Promise<{ sourceId: string; revision: number }> {
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    await assertRunOwned(client, tenantId, runId);
    const doc = await client.query(`select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3`, [documentId, runId, tenantId]);
    if (doc.rowCount !== 1) throw new ResearchQualityError("Unknown document.");
    const existing = (await client.query<{ id: string; revision: number }>(`select id, revision from research_quality_sources where run_id = $1 and document_id = $2 for update`, [runId, documentId])).rows[0];
    if (!existing) {
      const r = await client.query<{ id: string; revision: number }>(
        `insert into research_quality_sources (tenant_id, run_id, document_id, roles) values ($1, $2, $3, $4) returning id, revision`,
        [tenantId, runId, documentId, roles],
      );
      return { sourceId: r.rows[0].id, revision: r.rows[0].revision };
    }
    if (expectedRevision !== null && existing.revision !== expectedRevision) {
      throw new ResearchQualityConflictError("These roles were changed elsewhere since you opened them. Reload to see the current roles.");
    }
    const r = await client.query<{ revision: number }>(
      `update research_quality_sources set roles = $1, revision = revision + 1, updated_at = now() where id = $2 returning revision`,
      [roles, existing.id],
    );
    return { sourceId: existing.id, revision: r.rows[0].revision };
  });
}

/** Points a logical source at a replacement document; its next read becomes a new version. */
export async function replaceSourceDocument(tenantId: string, runId: string, sourceId: string, documentId: string): Promise<void> {
  if (!isUuid(sourceId) || !isUuid(documentId)) throw new ResearchQualityError("Unknown source or document.");
  await withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    const doc = await client.query(`select 1 from documents where id = $1 and run_id = $2 and tenant_id = $3`, [documentId, runId, tenantId]);
    if (doc.rowCount !== 1) throw new ResearchQualityError("Unknown document.");
    const taken = await client.query(`select 1 from research_quality_sources where run_id = $1 and document_id = $2 and id <> $3`, [runId, documentId, sourceId]);
    if (taken.rowCount) throw new ResearchQualityError("That document is already a separate source in this review.");
    const r = await client.query(`update research_quality_sources set document_id = $1, revision = revision + 1, updated_at = now() where id = $2 and run_id = $3 and tenant_id = $4`, [documentId, sourceId, runId, tenantId]);
    if (r.rowCount !== 1) throw new ResearchQualityError("Unknown source.");
  });
}

/**
 * Records a snapshot as the source's current version. Identical canonical text (same SHA-256 as the
 * current version) reuses that version. The source row is locked so two reads cannot both append.
 */
export async function recordSourceVersion(tenantId: string, runId: string, sourceId: string, documentId: string, snap: SourceSnapshot): Promise<{ versionId: string; created: boolean }> {
  return withTenant(tenantId, async (client) => {
    const src = (
      await client.query<{ current_version_id: string | null; document_id: string | null }>(
        `select current_version_id, document_id from research_quality_sources where id = $1 and run_id = $2 and tenant_id = $3 for update`,
        [sourceId, runId, tenantId],
      )
    ).rows[0];
    if (!src) throw new ResearchQualityError("Unknown source.");
    if (src.document_id !== documentId) throw new ResearchQualityConflictError("The source's document changed while it was being read; read it again.");
    if (src.current_version_id) {
      const cur = (await client.query<{ canonical_sha256: string; purged_at: string | null }>(`select canonical_sha256, purged_at from research_quality_source_versions where id = $1`, [src.current_version_id])).rows[0];
      if (cur && cur.canonical_sha256 === snap.canonicalSha256 && !cur.purged_at) return { versionId: src.current_version_id, created: false };
    }
    const ordinal = (await client.query<{ n: number }>(`select coalesce(max(ordinal), 0) + 1 as n from research_quality_source_versions where source_id = $1`, [sourceId])).rows[0].n;
    const v = await client.query<{ id: string }>(
      `insert into research_quality_source_versions
         (tenant_id, run_id, source_id, ordinal, original_document_id, filename, content_sha256, canonical_sha256, extractor, extractor_version, canonical_text, segments, char_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
      [tenantId, runId, sourceId, ordinal, documentId, snap.filename, snap.contentSha256, snap.canonicalSha256, snap.extractor, "rq-reader@1", snap.canonicalText, JSON.stringify(snap.segments), snap.canonicalText.length],
    );
    await client.query(`update research_quality_sources set current_version_id = $1, updated_at = now() where id = $2`, [v.rows[0].id, sourceId]);
    return { versionId: v.rows[0].id, created: true };
  });
}

/**
 * Permanently removes a source's retained text: every version's canonical text and segments, and
 * the quoted passages in generated observations and task results that came from it. Review history
 * keeps the fact that an assessment existed, labelled as purged.
 */
export async function purgeSourceText(tenantId: string, runId: string, sourceId: string): Promise<{ versions: number }> {
  if (!isUuid(sourceId)) throw new ResearchQualityError("Unknown source.");
  return withTenant(tenantId, async (client) => purgeSourceTextInTransaction(client, tenantId, runId, sourceId));
}

/**
 * The purge itself, inside a caller's transaction, so a caller can make it part of a larger change that
 * commits or rolls back with it (documentBin.eraseRemovedDocument, SYS5B-F03: erasing a file and purging
 * the Research quality text read from it are one change). Locks the source's versions.
 */
export async function purgeSourceTextInTransaction(client: PoolClient, tenantId: string, runId: string, sourceId: string): Promise<{ versions: number }> {
  if (!isUuid(sourceId)) throw new ResearchQualityError("Unknown source.");
  await assertModuleTables(client);
  const versions = (await client.query<{ id: string }>(`select id from research_quality_source_versions where source_id = $1 and run_id = $2 and tenant_id = $3 order by id for update`, [sourceId, runId, tenantId])).rows.map((r) => r.id);
  if (versions.length === 0) {
    const exists = await client.query(`select 1 from research_quality_sources where id = $1 and run_id = $2 and tenant_id = $3`, [sourceId, runId, tenantId]);
    if (exists.rowCount !== 1) throw new ResearchQualityError("Unknown source.");
    return { versions: 0 };
  }
  const purged = await client.query(`update research_quality_source_versions set canonical_text = '', segments = '[]'::jsonb, purged_at = now() where id = any($1::uuid[])`, [versions]);
  if (purged.rowCount !== versions.length) throw new ResearchQualityError("The source text could not be purged. Try again.");
  // Quotes from purged versions are blanked wherever they were copied.
  await client.query(
    `update research_quality_observation_versions ov
        set payload = jsonb_set(ov.payload, '{statements}', coalesce((
              select jsonb_agg(case when s->>'sourceVersionId' = any($1::text[]) then s || '{"exactQuote": null, "purged": true}'::jsonb else s end)
              from jsonb_array_elements(ov.payload->'statements') s), '[]'::jsonb))
      where ov.run_id = $2 and exists (select 1 from jsonb_array_elements(ov.payload->'statements') s where s->>'sourceVersionId' = any($1::text[]))`,
    [versions, runId],
  );
  await client.query(
    `update research_quality_tasks t
        set result = jsonb_set(t.result, '{facts}', coalesce((
              select jsonb_agg(case when f->>'sourceVersionId' = any($1::text[]) then f || '{"exactQuote": null, "statement": null, "purged": true}'::jsonb else f end)
              from jsonb_array_elements(t.result->'facts') f), '[]'::jsonb))
      where t.run_id = $2 and t.result ? 'facts'`,
    [versions, runId],
  );
  return { versions: versions.length };
}

// ---------------------------------------------------------------- reviews and tasks

export type TaskStage = "extract" | "assess" | "checklist";

/**
 * Whether migration 0106 (the checklist task stage) is applied. Without it a review runs as before
 * with no checklist, and the screen says which migration adds it; nothing fails part-way.
 */
export async function checklistStageAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `select exists (select 1 from pg_constraint where conrelid = 'public.research_quality_tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%checklist%') as ok`,
  );
  return r.rows[0]?.ok === true;
}

export async function checklistAvailable(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, (client) => checklistStageAvailable(client));
}

export type NewTask = { taskKey: string; stage: TaskStage; dependsOn: string[]; inputHash: string | null; maxAttempts: number; input: unknown };

/** Creates the review and its tasks once per request key; a repeat returns the existing review. */
export async function createReview(
  tenantId: string,
  runId: string,
  r: {
    requestKey: string;
    parentReviewId: string | null;
    mode: string;
    studyType: string;
    purpose: string;
    manifest: unknown;
    criteriaRelease: string;
    criteriaHash: string;
    referencesRelease: string;
    referencesHash: string;
    promptVersion: string;
    model: string;
    estimatedCostUsd: number;
    actor: { userId: string | null; email: string | null };
    tasks: NewTask[];
  },
): Promise<{ reviewId: string; created: boolean }> {
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    // One run lock, taken once, FOR UPDATE: it checks ownership and serialises sequence allocation
    // and the request-key check per project. Taking FOR SHARE first and upgrading later deadlocked
    // two concurrent starts (each held the share lock and waited for the other's; Codex
    // 2026-10-18). The request key is checked only after the lock, so a start that waited sees the
    // review the first one committed and returns it.
    if (!isUuid(runId)) throw new ResearchQualityError("Unknown project.");
    const owned = await client.query(`select 1 from runs where id = $1 and tenant_id = $2 for update`, [runId, tenantId]);
    if (owned.rowCount !== 1) throw new ResearchQualityError("Unknown project.");
    const existing = await client.query<{ id: string }>(`select id from research_quality_reviews where run_id = $1 and request_key = $2`, [runId, r.requestKey]);
    if (existing.rows[0]) return { reviewId: existing.rows[0].id, created: false };
    const seq = (await client.query<{ n: number }>(`select coalesce(max(sequence), 0) + 1 as n from research_quality_reviews where run_id = $1`, [runId])).rows[0].n;
    const parent = r.parentReviewId ?? (await client.query<{ id: string }>(`select id from research_quality_reviews where run_id = $1 order by sequence desc limit 1`, [runId])).rows[0]?.id ?? null;
    const inserted = await client.query<{ id: string }>(
      `insert into research_quality_reviews
         (tenant_id, run_id, parent_review_id, sequence, request_key, mode, study_type, purpose, manifest, input_digest,
          criteria_release, criteria_hash, references_release, references_hash, prompt_version, model, state, estimated_cost_usd, created_by, created_by_email)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17,$18,$19)
       on conflict (run_id, request_key) do nothing returning id`,
      [tenantId, runId, parent, seq, r.requestKey, r.mode, r.studyType, r.purpose, JSON.stringify(r.manifest), sha256(canonicalJson(r.manifest)),
        r.criteriaRelease, r.criteriaHash, r.referencesRelease, r.referencesHash, r.promptVersion, r.model, r.estimatedCostUsd, r.actor.userId, r.actor.email],
    );
    if (!inserted.rows[0]) {
      const again = await client.query<{ id: string }>(`select id from research_quality_reviews where run_id = $1 and request_key = $2`, [runId, r.requestKey]);
      return { reviewId: again.rows[0].id, created: false };
    }
    const reviewId = inserted.rows[0].id;
    for (const t of r.tasks) {
      await client.query(
        `insert into research_quality_tasks (tenant_id, run_id, review_id, task_key, stage, depends_on, input_hash, max_attempts, result)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, runId, reviewId, t.taskKey, t.stage, t.dependsOn, t.inputHash, t.maxAttempts, JSON.stringify({ input: t.input })],
      );
    }
    return { reviewId, created: true };
  });
}

export type TaskRow = {
  id: string;
  task_key: string;
  stage: TaskStage;
  depends_on: string[];
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  max_attempts: number;
  input_hash: string | null;
  result: { input?: unknown; facts?: unknown[]; observations?: unknown[]; [k: string]: unknown } | null;
  validation: unknown;
  error: string | null;
  lease_expires_at: string | null;
  /** Running with a lease that has run out: the attempt died or is too slow to be accepted. Decided by the database clock. */
  lease_expired: boolean;
};

export async function loadTasks(tenantId: string, reviewId: string): Promise<TaskRow[]> {
  return withTenant(tenantId, async (client) => (await client.query<TaskRow>(`select id, task_key, stage, depends_on, status, attempts, max_attempts, input_hash, result, validation, error, lease_expires_at::text, (status = 'running' and lease_expires_at < clock_timestamp()) as lease_expired from research_quality_tasks where review_id = $1 order by task_key`, [reviewId])).rows);
}

/**
 * Claims a task for one attempt: pending, or running with an expired lease (an attempt that died).
 * A failed task is claimed only through resetFailedTasks. Returns the lease token, or null when the
 * task is not claimable (already running elsewhere, finished, or out of attempts).
 */
export async function claimTask(tenantId: string, taskId: string, leaseSeconds = 300): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ lease_token: string }>(
      `update research_quality_tasks
          set status = 'running', attempts = attempts + 1, lease_token = gen_random_uuid(),
              lease_expires_at = clock_timestamp() + make_interval(secs => $2), updated_at = now()
        where id = $1 and attempts < max_attempts
          and (status = 'pending' or (status = 'running' and lease_expires_at < clock_timestamp()))
        returning lease_token`,
      [taskId, leaseSeconds],
    );
    return r.rows[0]?.lease_token ?? null;
  });
}

export async function updateTaskInput(tenantId: string, taskId: string, input: unknown, inputHash: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(`update research_quality_tasks set result = jsonb_build_object('input', $2::jsonb), input_hash = $3 where id = $1 and status <> 'succeeded'`, [taskId, JSON.stringify(input), inputHash]);
  });
}

type Usage = { input: number; output: number; cost: number };

// The lease condition every result write shares: this attempt's token, still running, and unexpired
// by the clock at the moment of the write (clock_timestamp(), not the transaction-start now()).
const CURRENT_LEASE = `id = $1 and lease_token = $2 and status = 'running' and lease_expires_at > clock_timestamp()`;

const SOURCE_PURGED_ERROR = "The source text was purged while this was being worked on, so the result was discarded. Start a new review version to assess the remaining material.";

/**
 * Locks the task row before its lease is judged. The lease UPDATE alone is not enough: if another
 * session holds the row without changing it, PostgreSQL decides the UPDATE's WHERE before waiting
 * and does not re-check it afterwards, so an expiry that passed during the wait went unnoticed
 * (Codex 2026-10-18). Taking the row lock first, by id only, means the lease UPDATE that follows is
 * a new statement evaluated with clock_timestamp() after any wait. Lock order everywhere: source
 * versions (sourcesPurged), then the task row.
 */
async function lockTaskRow(client: PoolClient, taskId: string): Promise<void> {
  await client.query(`select 1 from research_quality_tasks where id = $1 for update`, [taskId]);
}

/** Adds a call's usage to the task and review totals. Used when its result is not accepted: the call was still paid for. */
async function recordUsageOnly(client: PoolClient, taskId: string, usage: Usage): Promise<void> {
  await client.query(`update research_quality_tasks set input_tokens = input_tokens + $2, output_tokens = output_tokens + $3, cost_usd = cost_usd + $4 where id = $1`, [taskId, usage.input, usage.output, usage.cost]);
  await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = (select review_id from research_quality_tasks where id = $1)`, [taskId, usage.cost]);
}

/**
 * Locks the given source versions FOR SHARE (id order, the same order purgeSourceText uses for its
 * FOR UPDATE) and reports whether any has been purged. Called before the task row is touched.
 */
async function sourcesPurged(client: PoolClient, versionIds: (string | null | undefined)[]): Promise<boolean> {
  const ids = [...new Set(versionIds.filter(isUuid))].sort();
  if (ids.length === 0) return false;
  const r = await client.query<{ purged: boolean }>(`select purged_at is not null as purged from research_quality_source_versions where id = any($1::uuid[]) order by id for share`, [ids]);
  return r.rows.some((x) => x.purged);
}

/** Fails the task for good (no attempts left) because its source was purged; only for the current lease. */
async function discardForPurge(client: PoolClient, taskId: string, lease: string, usage: Usage): Promise<void> {
  await lockTaskRow(client, taskId);
  const r = await client.query(
    `update research_quality_tasks
        set status = 'failed', attempts = max_attempts, error = $3, lease_token = null, lease_expires_at = null,
            input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, cost_usd = cost_usd + $6, updated_at = now()
      where ${CURRENT_LEASE}`,
    [taskId, lease, SOURCE_PURGED_ERROR, usage.input, usage.output, usage.cost],
  );
  if (r.rowCount === 1) await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = (select review_id from research_quality_tasks where id = $1)`, [taskId, usage.cost]);
  else await recordUsageOnly(client, taskId, usage);
}

/** Records a failed attempt, only for the current, unexpired lease that made it. */
export async function failTask(tenantId: string, taskId: string, lease: string, error: string, usage: Usage): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    await lockTaskRow(client, taskId);
    const r = await client.query(
      `update research_quality_tasks
          set status = 'failed', error = $3, lease_token = null, lease_expires_at = null,
              input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, cost_usd = cost_usd + $6, updated_at = now()
        where ${CURRENT_LEASE}`,
      [taskId, lease, error.slice(0, 2000), usage.input, usage.output, usage.cost],
    );
    if (r.rowCount === 1) await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = (select review_id from research_quality_tasks where id = $1)`, [taskId, usage.cost]);
    else await recordUsageOnly(client, taskId, usage);
    return r.rowCount === 1;
  });
}

/**
 * Publishes an extraction result, only for the current, unexpired lease, and only while the source
 * version it was read from (and every version its facts cite) is unpurged. Returns false when
 * nothing was published.
 */
export async function publishExtraction(tenantId: string, taskId: string, lease: string, result: { facts: unknown[]; dropped: number; nothingFound: boolean }, usage: Usage): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const pinned = (
      await client.query<{ v: string | null }>(
        `select r.manifest->'sources'->((t.result->'input'->>'sourceIndex')::int)->>'sourceVersionId' as v
           from research_quality_tasks t join research_quality_reviews r on r.id = t.review_id where t.id = $1`,
        [taskId],
      )
    ).rows[0]?.v;
    const cited = result.facts.map((f) => (f as { sourceVersionId?: string } | null)?.sourceVersionId);
    if (await sourcesPurged(client, [pinned, ...cited])) {
      await discardForPurge(client, taskId, lease, usage);
      return false;
    }
    await lockTaskRow(client, taskId);
    const r = await client.query(
      `update research_quality_tasks
          set status = 'succeeded', result = coalesce(result, '{}'::jsonb) || $3::jsonb, validation = $4::jsonb, error = null,
              lease_token = null, lease_expires_at = null,
              input_tokens = input_tokens + $5, output_tokens = output_tokens + $6, cost_usd = cost_usd + $7, updated_at = now()
        where ${CURRENT_LEASE}`,
      [taskId, lease, JSON.stringify({ facts: result.facts, nothingFound: result.nothingFound }), JSON.stringify({ droppedUnverifiableQuotes: result.dropped }), usage.input, usage.output, usage.cost],
    );
    if (r.rowCount === 1) await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = (select review_id from research_quality_tasks where id = $1)`, [taskId, usage.cost]);
    else await recordUsageOnly(client, taskId, usage);
    return r.rowCount === 1;
  });
}

/**
 * Publishes a checklist result (element statuses citing fact ids), under the same rules as an
 * extraction: the current, unexpired lease, and only while the scored document's source version is
 * unpurged (the reasons may paraphrase its text).
 */
export async function publishChecklist(tenantId: string, taskId: string, lease: string, result: { checklistId: string; elements: unknown[] }, usage: Usage): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const pinned = (
      await client.query<{ v: string | null }>(
        `select r.manifest->'sources'->((t.result->'input'->>'sourceIndex')::int)->>'sourceVersionId' as v
           from research_quality_tasks t join research_quality_reviews r on r.id = t.review_id where t.id = $1`,
        [taskId],
      )
    ).rows[0]?.v;
    if (await sourcesPurged(client, [pinned])) {
      await discardForPurge(client, taskId, lease, usage);
      return false;
    }
    await lockTaskRow(client, taskId);
    const r = await client.query(
      `update research_quality_tasks
          set status = 'succeeded', result = coalesce(result, '{}'::jsonb) || $3::jsonb, error = null,
              lease_token = null, lease_expires_at = null,
              input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, cost_usd = cost_usd + $6, updated_at = now()
        where ${CURRENT_LEASE} and stage = 'checklist'`,
      [taskId, lease, JSON.stringify(result), usage.input, usage.output, usage.cost],
    );
    if (r.rowCount === 1) await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = (select review_id from research_quality_tasks where id = $1)`, [taskId, usage.cost]);
    else await recordUsageOnly(client, taskId, usage);
    return r.rowCount === 1;
  });
}

/**
 * Publishes an assessment task's observations atomically with its status, only for the current,
 * unexpired lease and only while every source version in the review's manifest is unpurged (the
 * assessment was given facts from all of them, and its reasoning may paraphrase any). Each observation is found or created by its logical key, then gets one version for this
 * review. Two observations with the same key in one answer are rejected before anything is written.
 */
export async function publishAssessment(
  tenantId: string,
  runId: string,
  reviewId: string,
  taskId: string,
  lease: string,
  observations: { logicalKey: string; anchor: unknown; payload: ObservationPayload }[],
  validation: unknown,
  usage: Usage,
): Promise<boolean> {
  const keys = new Set<string>();
  for (const o of observations) {
    if (keys.has(o.logicalKey)) throw new ResearchQualityError(`two observations share the key ${o.logicalKey}`);
    keys.add(o.logicalKey);
  }
  return withTenant(tenantId, async (client) => {
    const manifestVersions = (
      await client.query<{ v: string | null }>(`select s->>'sourceVersionId' as v from research_quality_reviews r, jsonb_array_elements(r.manifest->'sources') s where r.id = $1`, [reviewId])
    ).rows.map((x) => x.v);
    const cited = observations.flatMap((o) => o.payload.statements.map((st) => st.sourceVersionId));
    if (await sourcesPurged(client, [...manifestVersions, ...cited])) {
      await discardForPurge(client, taskId, lease, usage);
      return false;
    }
    await lockTaskRow(client, taskId);
    const claimed = await client.query(
      `update research_quality_tasks
          set status = 'succeeded', validation = $3::jsonb, error = null, lease_token = null, lease_expires_at = null,
              input_tokens = input_tokens + $4, output_tokens = output_tokens + $5, cost_usd = cost_usd + $6, updated_at = now()
        where ${CURRENT_LEASE} and review_id = $7`,
      [taskId, lease, JSON.stringify(validation), usage.input, usage.output, usage.cost, reviewId],
    );
    if (claimed.rowCount !== 1) {
      await recordUsageOnly(client, taskId, usage);
      return false;
    }
    for (const o of observations) {
      const obs = await client.query<{ id: string }>(
        `insert into research_quality_observations (tenant_id, run_id, logical_key, criterion_id, anchor)
         values ($1, $2, $3, $4, $5)
         on conflict (run_id, logical_key) do update set logical_key = excluded.logical_key
         returning id`,
        [tenantId, runId, o.logicalKey, o.payload.criterionId, JSON.stringify(o.anchor)],
      );
      await client.query(
        `insert into research_quality_observation_versions (tenant_id, run_id, observation_id, review_id, task_id, payload, payload_hash)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, runId, obs.rows[0].id, reviewId, taskId, JSON.stringify(o.payload), sha256(canonicalJson(o.payload))],
      );
    }
    await client.query(`update research_quality_reviews set actual_cost_usd = actual_cost_usd + $2 where id = $1`, [reviewId, usage.cost]);
    return true;
  });
}

/**
 * Puts the given stage's retryable tasks back to pending: failed ones, and running ones whose lease
 * has expired (the attempt died, for example a worker interrupted mid-call). A running task with a
 * live lease is never taken over, and attempt bounds still apply. Returns how many were reset.
 */
export async function resetFailedTasks(tenantId: string, runId: string, reviewId: string, stage: TaskStage): Promise<number> {
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    const own = await client.query(`select 1 from research_quality_reviews where id = $1 and run_id = $2 and tenant_id = $3 for update`, [reviewId, runId, tenantId]);
    if (own.rowCount !== 1) throw new ResearchQualityError("Unknown review.");
    const r = await client.query(`update research_quality_tasks set status = 'pending', error = null, lease_token = null, lease_expires_at = null, updated_at = now()
        where review_id = $1 and stage = $2 and attempts < max_attempts
          and (status = 'failed' or (status = 'running' and lease_expires_at < clock_timestamp()))`, [reviewId, stage]);
    // Only a reset that found something reopens the review; otherwise a retry with nothing to do
    // would leave it marked running with no runner coming.
    if (r.rowCount) await client.query(`update research_quality_reviews set state = 'running', completed_at = null where id = $1`, [reviewId]);
    return r.rowCount ?? 0;
  });
}

export async function setReviewState(tenantId: string, reviewId: string, state: "running" | "complete" | "partial" | "failed", coverage?: unknown): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `update research_quality_reviews set state = $2, coverage = coalesce($3::jsonb, coverage),
              completed_at = case when $2 = 'running' then null else now() end where id = $1`,
      [reviewId, state, coverage === undefined ? null : JSON.stringify(coverage)],
    );
  });
}

export async function loadReviewRow(tenantId: string, runId: string, reviewId: string) {
  if (!isUuid(reviewId)) throw new ResearchQualityError("Unknown review.");
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    const r = (await client.query(`select * from research_quality_reviews where id = $1 and run_id = $2 and tenant_id = $3`, [reviewId, runId, tenantId])).rows[0];
    if (!r) throw new ResearchQualityError("Unknown review.");
    return r as { id: string; run_id: string; manifest: import("./researchQualityTypes").ReviewManifest; coverage: Record<string, unknown>; state: string; mode: string; study_type: string; sequence: number; prompt_version: string };
  });
}

/** Source text pinned by a review, for its extraction tasks. */
export async function loadSourceVersionText(tenantId: string, versionId: string): Promise<{ text: string; segments: import("./researchQualityTypes").Segment[]; purged: boolean }> {
  return withTenant(tenantId, async (client) => {
    const r = (await client.query<{ canonical_text: string; segments: import("./researchQualityTypes").Segment[]; purged_at: string | null }>(`select canonical_text, segments, purged_at from research_quality_source_versions where id = $1`, [versionId])).rows[0];
    if (!r) throw new ResearchQualityError("Unknown source version.");
    return { text: r.canonical_text, segments: r.segments, purged: !!r.purged_at };
  });
}

// ---------------------------------------------------------------- researcher entries

/**
 * Records one researcher entry. Status and wording decisions name the observation version they
 * apply to and the observation revision the researcher saw; a different current revision is a
 * conflict. Comments and clarifications are append-only. A repeated idempotency key returns the
 * entry already recorded.
 */
export async function recordResearcherEntry(
  tenantId: string,
  runId: string,
  e: { kind: ResearcherEntryKind; observationId: string | null; observationVersionId: string | null; body: string | null; expectedRevision: number | null; idempotencyKey: string; actor: { userId: string | null; email: string | null } },
): Promise<{ entryId: string; revision: number | null; duplicate: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(e.idempotencyKey)) throw new ResearchQualityError("Invalid request key.");
  return withTenant(tenantId, async (client) => {
    await assertModuleTables(client);
    await assertRunOwned(client, tenantId, runId);
    const dup = (await client.query<{ id: string }>(`select id from research_quality_researcher_entries where run_id = $1 and idempotency_key = $2`, [runId, e.idempotencyKey])).rows[0];
    if (dup) return { entryId: dup.id, revision: null, duplicate: true };
    let revision: number | null = null;
    if (e.observationId) {
      if (!isUuid(e.observationId)) throw new ResearchQualityError("Unknown observation.");
      const obs = (await client.query<{ revision: number }>(`select revision from research_quality_observations where id = $1 and run_id = $2 and tenant_id = $3 for update`, [e.observationId, runId, tenantId])).rows[0];
      if (!obs) throw new ResearchQualityError("Unknown observation.");
      if (e.observationVersionId) {
        if (!isUuid(e.observationVersionId)) throw new ResearchQualityError("Unknown observation version.");
        const v = await client.query(`select 1 from research_quality_observation_versions where id = $1 and observation_id = $2`, [e.observationVersionId, e.observationId]);
        if (v.rowCount !== 1) throw new ResearchQualityError("That version does not belong to this observation.");
      }
      if (["accept", "dismiss", "reopen", "wording"].includes(e.kind)) {
        if (e.expectedRevision === null || e.expectedRevision !== obs.revision) {
          throw new ResearchQualityConflictError("This observation was changed elsewhere since you opened it. Reload to see the current decision; your text is still in the box.");
        }
        revision = (await client.query<{ revision: number }>(`update research_quality_observations set revision = revision + 1 where id = $1 returning revision`, [e.observationId])).rows[0].revision;
      }
    } else if (e.kind !== "clarification") {
      throw new ResearchQualityError("This entry needs an observation.");
    }
    const r = await client.query<{ id: string }>(
      `insert into research_quality_researcher_entries (tenant_id, run_id, observation_id, observation_version_id, kind, body, actor_user_id, actor_email, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [tenantId, runId, e.observationId, e.observationVersionId, e.kind, e.body, e.actor.userId, e.actor.email, e.idempotencyKey],
    );
    return { entryId: r.rows[0].id, revision, duplicate: false };
  });
}

/**
 * The Research quality roles recorded for each of a project's documents (recorded at upload as a
 * brief or a proposal, and changeable in Research quality), for naming a context file in the Import
 * list. null when the module's tables are not there yet, so "not recorded" is never read as "no role".
 */
export async function getDocumentRoles(tenantId: string, runId: string): Promise<Map<string, SourceRole[]> | null> {
  return withTenantRead(tenantId, async (client) => {
    const ok = await client.query<{ ok: boolean }>(`select to_regclass('public.research_quality_sources') is not null as ok`);
    if (!ok.rows[0]?.ok) return null;
    const r = await client.query<{ document_id: string; roles: SourceRole[] }>(
      `select document_id, roles from research_quality_sources where run_id = $1 and tenant_id = $2 and document_id is not null`,
      [runId, tenantId],
    );
    return new Map(r.rows.map((x) => [x.document_id, x.roles]));
  });
}
