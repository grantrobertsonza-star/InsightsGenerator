import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { MAX_CODES } from "./qualCoding";

// Researcher changes to the themes on a turn. They are stored as overrides
// keyed by theme name, so a later "Save as new version and re-apply" (which
// gives every theme a new id) can lay them back on top of the model's work.

export const codeKey = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

export type OverrideRow = {
  segmentId: string;
  codeName: string;
  action: "add" | "remove";
  createdAt: string;
};

export async function overridesAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query(
    `select 1 from information_schema.tables
     where table_name = 'coding_assignment_overrides'`,
  );
  return r.rows.length > 0;
}

/**
 * Lays the researcher's overrides over the assignments of a codebook version.
 * Called inside the transaction that has just written the model's assignments.
 * Overrides for a theme that no longer exists are kept and counted as dormant.
 */
export async function applyOverrides(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  codes: { id: string; name: string }[],
): Promise<{ applied: number; dormant: number }> {
  if (!(await overridesAvailable(client))) return { applied: 0, dormant: 0 };
  const rows = await client.query<{
    segment_id: string;
    code_key: string;
    action: "add" | "remove";
  }>(
    `select segment_id, code_key, action from coding_assignment_overrides
     where document_id = $1`,
    [documentId],
  );
  const byKey = new Map(codes.map((c) => [codeKey(c.name), c.id]));
  let applied = 0;
  let dormant = 0;
  for (const o of rows.rows) {
    const codeId = byKey.get(o.code_key);
    if (!codeId) {
      dormant += 1;
      continue;
    }
    if (o.action === "add") {
      await client.query(
        `insert into coding_assignments (tenant_id, segment_id, code_id, source)
         values ($1, $2, $3, 'researcher')
         on conflict (segment_id, code_id) do update set source = 'researcher'`,
        [tenantId, o.segment_id, codeId],
      );
    } else {
      await client.query(
        "delete from coding_assignments where segment_id = $1 and code_id = $2",
        [o.segment_id, codeId],
      );
    }
    applied += 1;
  }
  return { applied, dormant };
}

async function loadCodeInForce(
  client: PoolClient,
  documentId: string,
  codeId: string,
) {
  const r = await client.query<{
    id: string;
    name: string;
    codebook_id: string;
  }>(
    `select c.id, c.name, c.codebook_id from coding_codes c
     join coding_codebooks b on b.id = c.codebook_id
     where c.id = $1 and b.document_id = $2
       and b.version = (select max(version) from coding_codebooks where document_id = $2)`,
    [codeId, documentId],
  );
  return r.rows[0] ?? null;
}

async function changeInTx(
  client: PoolClient,
  tenantId: string,
  runId: string,
  documentId: string,
  segmentId: string,
  code: { id: string; name: string },
  action: "add" | "remove",
) {
  const seg = await client.query(
    `select 1 from coding_segments where id = $1 and document_id = $2 and role <> 'moderator'`,
    [segmentId, documentId],
  );
  if (seg.rows.length === 0)
    throw new Error("That turn was not found, or it is a moderator turn.");
  const key = codeKey(code.name);
  const existing = await client.query<{ source: string }>(
    "select source from coding_assignments where segment_id = $1 and code_id = $2",
    [segmentId, code.id],
  );
  const have = existing.rows[0];
  const prior = await client.query<{ action: "add" | "remove" }>(
    `select action from coding_assignment_overrides
     where segment_id = $1 and code_key = $2`,
    [segmentId, key],
  );
  if (action === "add") {
    if (have) return;
    if (prior.rows[0]?.action === "remove") {
      // Putting back what the model had: no longer an override.
      await client.query(
        "delete from coding_assignment_overrides where segment_id = $1 and code_key = $2",
        [segmentId, key],
      );
      await client.query(
        `insert into coding_assignments (tenant_id, segment_id, code_id, source)
         values ($1, $2, $3, 'model')`,
        [tenantId, segmentId, code.id],
      );
    } else {
      await client.query(
        `insert into coding_assignments (tenant_id, segment_id, code_id, source)
         values ($1, $2, $3, 'researcher')`,
        [tenantId, segmentId, code.id],
      );
      await client.query(
        `insert into coding_assignment_overrides
           (segment_id, code_key, code_name, action, tenant_id, run_id, document_id)
         values ($1, $2, $3, 'add', $4, $5, $6)
         on conflict (segment_id, code_key) do update set action = 'add', created_at = now()`,
        [segmentId, key, code.name, tenantId, runId, documentId],
      );
    }
    return;
  }
  if (!have) return;
  await client.query(
    "delete from coding_assignments where segment_id = $1 and code_id = $2",
    [segmentId, code.id],
  );
  if (have.source === "researcher") {
    await client.query(
      "delete from coding_assignment_overrides where segment_id = $1 and code_key = $2",
      [segmentId, key],
    );
  } else {
    await client.query(
      `insert into coding_assignment_overrides
         (segment_id, code_key, code_name, action, tenant_id, run_id, document_id)
       values ($1, $2, $3, 'remove', $4, $5, $6)
       on conflict (segment_id, code_key) do update set action = 'remove', created_at = now()`,
      [segmentId, key, code.name, tenantId, runId, documentId],
    );
  }
}

export async function changeTurnCode(
  tenantId: string,
  runId: string,
  documentId: string,
  segmentId: string,
  codeId: string,
  action: "add" | "remove",
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    if (!(await overridesAvailable(client)))
      throw new Error(
        "Changing themes by hand needs database migration 0050. Run it and try again.",
      );
    const code = await loadCodeInForce(client, documentId, codeId);
    if (!code)
      throw new Error(
        "That theme is not in the current codebook. Reload the page and try again.",
      );
    await changeInTx(
      client,
      tenantId,
      runId,
      documentId,
      segmentId,
      code,
      action,
    );
  });
}

/**
 * Creates a theme by hand in the codebook now in force and, optionally, puts
 * it on one turn. The codebook version does not change: the theme is marked as
 * added by the researcher, and it stays in the codebook when the next version
 * is saved. It is applied to no other turn until you re-apply the codebook.
 */
export async function addResearcherCode(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
  name: string,
  definition: string,
  segmentId: string | null,
): Promise<void> {
  const cleanName = name.trim();
  const cleanDef = definition.trim();
  if (!cleanName || !cleanDef)
    throw new Error("A new theme needs a name and a definition.");
  await withTenant(tenantId, async (client) => {
    if (!(await overridesAvailable(client)))
      throw new Error(
        "Adding a theme by hand needs database migration 0050. Run it and try again.",
      );
    const book = await client.query(
      `select 1 from coding_codebooks b
       where b.id = $1 and b.document_id = $2
         and b.version = (select max(version) from coding_codebooks where document_id = $2)`,
      [codebookId, documentId],
    );
    if (book.rows.length === 0)
      throw new Error(
        "That is not the codebook now in force. Reload and try again.",
      );
    const existing = await client.query<{ name: string; position: number }>(
      "select name, position from coding_codes where codebook_id = $1",
      [codebookId],
    );
    if (existing.rows.some((c) => codeKey(c.name) === codeKey(cleanName)))
      throw new Error(`There is already a theme called "${cleanName}".`);
    if (existing.rows.length >= MAX_CODES + 8)
      throw new Error(`A codebook can have at most ${MAX_CODES + 8} themes.`);
    const position =
      existing.rows.reduce((m, c) => Math.max(m, c.position), -1) + 1;
    const inserted = await client.query<{ id: string }>(
      `insert into coding_codes
         (tenant_id, codebook_id, position, name, definition, added_by_researcher)
       values ($1, $2, $3, $4, $5, true) returning id`,
      [tenantId, codebookId, position, cleanName, cleanDef],
    );
    if (segmentId) {
      await changeInTx(
        client,
        tenantId,
        runId,
        documentId,
        segmentId,
        { id: inserted.rows[0].id, name: cleanName },
        "add",
      );
    }
  });
}

/** The researcher's overrides for a transcript, or none when 0050 is missing. */
export async function loadOverrides(
  tenantId: string,
  documentId: string,
): Promise<
  { segment_id: string; code_key: string; action: "add" | "remove" }[]
> {
  return withTenant(tenantId, async (client) => {
    if (!(await overridesAvailable(client))) return [];
    const r = await client.query<{
      segment_id: string;
      code_key: string;
      action: "add" | "remove";
    }>(
      `select segment_id, code_key, action from coding_assignment_overrides
       where document_id = $1`,
      [documentId],
    );
    return r.rows;
  });
}

/**
 * A new codebook version keeps the "added by researcher" mark on themes of
 * the same name from earlier versions, so exports stay honest about origin.
 */
export async function carryResearcherFlags(
  tenantId: string,
  documentId: string,
  newCodebookId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const col = await client.query(
      `select 1 from information_schema.columns
       where table_name = 'coding_codes' and column_name = 'added_by_researcher'`,
    );
    if (col.rows.length === 0) return;
    await client.query(
      `update coding_codes n set added_by_researcher = true
       from coding_codes o
       join coding_codebooks ob on ob.id = o.codebook_id
       where n.codebook_id = $1 and ob.document_id = $2 and ob.id <> $1
         and o.added_by_researcher
         and lower(trim(o.name)) = lower(trim(n.name))`,
      [newCodebookId, documentId],
    );
  });
}

/**
 * Brings an earlier codebook version back as a new version, without calling
 * the model: the themes and the turn assignments of that version are copied,
 * then the researcher's own changes are laid over them again. Findings are
 * not regenerated, so they keep reflecting the last re-apply until the
 * codebook is applied again.
 */
export async function restoreCodebookVersion(
  tenantId: string,
  runId: string,
  documentId: string,
  codebookId: string,
): Promise<number> {
  return withTenant(tenantId, async (client) => {
    const old = await client.query<{ id: string; version: number }>(
      `select id, version from coding_codebooks where id = $1 and document_id = $2`,
      [codebookId, documentId],
    );
    if (old.rows.length === 0) throw new Error("That version was not found.");
    const latest = await client.query<{ v: number }>(
      "select max(version) as v from coding_codebooks where document_id = $1",
      [documentId],
    );
    if (old.rows[0].version === latest.rows[0].v)
      throw new Error("That is already the version in force.");
    const next = latest.rows[0].v + 1;
    const book = await client.query<{ id: string }>(
      `insert into coding_codebooks (tenant_id, run_id, document_id, version, source)
       values ($1, $2, $3, $4, 'edited') returning id`,
      [tenantId, runId, documentId, next],
    );
    const newBookId = book.rows[0].id;
    const flag = await client.query(
      `select 1 from information_schema.columns
       where table_name = 'coding_codes' and column_name = 'added_by_researcher'`,
    );
    const hasFlag = flag.rows.length > 0;
    const src = await client.query<{
      id: string;
      position: number;
      name: string;
      definition: string;
      inclusion_criteria: string;
      exclusion_criteria: string;
      reproduced_runs: number | null;
      total_runs: number | null;
      added_by_researcher?: boolean;
    }>(
      `select id, position, name, definition, inclusion_criteria, exclusion_criteria,
              reproduced_runs, total_runs${hasFlag ? ", added_by_researcher" : ""}
       from coding_codes where codebook_id = $1 order by position`,
      [codebookId],
    );
    const mapping = new Map<string, string>();
    const created: { id: string; name: string }[] = [];
    for (const c of src.rows) {
      const ins = await client.query<{ id: string }>(
        `insert into coding_codes
           (tenant_id, codebook_id, position, name, definition, inclusion_criteria, exclusion_criteria,
            reproduced_runs, total_runs${hasFlag ? ", added_by_researcher" : ""})
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9${hasFlag ? ", $10" : ""}) returning id`,
        [
          tenantId,
          newBookId,
          c.position,
          c.name,
          c.definition,
          c.inclusion_criteria,
          c.exclusion_criteria,
          c.reproduced_runs,
          c.total_runs,
          ...(hasFlag ? [c.added_by_researcher ?? false] : []),
        ],
      );
      mapping.set(c.id, ins.rows[0].id);
      created.push({ id: ins.rows[0].id, name: c.name });
    }
    const srcCol = await client.query(
      `select 1 from information_schema.columns
       where table_name = 'coding_assignments' and column_name = 'source'`,
    );
    const hasSource = srcCol.rows.length > 0;
    const oldAssign = await client.query<{
      segment_id: string;
      code_id: string;
      source?: string;
    }>(
      `select segment_id, code_id${hasSource ? ", source" : ""} from coding_assignments
       where code_id = any($1::uuid[])`,
      [[...mapping.keys()]],
    );
    for (const a of oldAssign.rows) {
      const target = mapping.get(a.code_id);
      if (!target) continue;
      if (hasSource) {
        await client.query(
          `insert into coding_assignments (tenant_id, segment_id, code_id, source)
           values ($1, $2, $3, $4) on conflict do nothing`,
          [tenantId, a.segment_id, target, a.source ?? "model"],
        );
      } else {
        await client.query(
          `insert into coding_assignments (tenant_id, segment_id, code_id)
           values ($1, $2, $3) on conflict do nothing`,
          [tenantId, a.segment_id, target],
        );
      }
    }
    await applyOverrides(client, tenantId, documentId, created);
    return next;
  });
}
