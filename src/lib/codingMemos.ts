// Analytic memos (migration 0063) and reuse of one transcript's codebook on
// another. Memos are stored by code name so they follow a code across versions.
// Every function degrades quietly when the migration has not been applied.
import { withTenant } from "./db";
import { codeKey, loadCodeMeta, saveCodeMeta } from "./codingMeta";
import { reapplyCodebook, type CodebookEdit } from "./extractThemes";

export type MemoKind = "analytic" | "reflexivity" | "decision";
export type Memo = {
  id: string;
  documentId: string | null;
  codeKey: string | null;
  kind: MemoKind;
  body: string;
  createdAt: string;
};

const KINDS: MemoKind[] = ["analytic", "reflexivity", "decision"];

export async function loadMemos(tenantId: string, runId: string): Promise<Memo[]> {
  return withTenant(tenantId, async (client) => {
    const ok = await client.query("select to_regclass('public.coding_memos') is not null as ok");
    if (!ok.rows[0]?.ok) return [];
    const r = await client.query<{
      id: string;
      document_id: string | null;
      code_key: string | null;
      kind: MemoKind;
      body: string;
      created_at: Date;
    }>(
      "select id, document_id, code_key, kind, body, created_at from coding_memos where run_id = $1 order by created_at desc",
      [runId],
    );
    return r.rows.map((m) => ({
      id: m.id,
      documentId: m.document_id,
      codeKey: m.code_key,
      kind: m.kind,
      body: m.body,
      createdAt: m.created_at.toISOString(),
    }));
  });
}

export async function addMemo(
  tenantId: string,
  runId: string,
  input: { documentId: string | null; codeName: string | null; kind: MemoKind; body: string },
): Promise<void> {
  const body = input.body.trim().slice(0, 8000);
  if (!body) throw new Error("A memo needs some text.");
  if (!KINDS.includes(input.kind)) throw new Error("Unknown memo kind.");
  await withTenant(tenantId, async (client) => {
    const ok = await client.query("select to_regclass('public.coding_memos') is not null as ok");
    if (!ok.rows[0]?.ok) throw new Error("Memos need migration 0063 to be applied first.");
    if (input.documentId) {
      const own = await client.query("select 1 from documents where id = $1 and run_id = $2", [input.documentId, runId]);
      if (own.rows.length === 0) throw new Error("That transcript does not belong to this project.");
    }
    await client.query(
      "insert into coding_memos (tenant_id, run_id, document_id, code_key, kind, body) values ($1, $2, $3, $4, $5, $6)",
      [tenantId, runId, input.documentId, input.codeName ? codeKey(input.codeName) : null, input.kind, body],
    );
  });
}

export async function deleteMemo(tenantId: string, runId: string, memoId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("delete from coding_memos where id = $1 and run_id = $2", [memoId, runId]);
  });
}

/**
 * Codes of the newest codebook version of every transcript in the run, for the
 * "use another transcript's codebook" choice.
 */
export async function codebooksByTranscript(
  tenantId: string,
  runId: string,
): Promise<{ documentId: string; filename: string; codes: { name: string; definition: string }[] }[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ document_id: string; filename: string; name: string; definition: string }>(
      `select b.document_id, d.source_filename as filename, c.name, c.definition
       from coding_codebooks b
       join documents d on d.id = b.document_id
       join coding_codes c on c.codebook_id = b.id
       where b.run_id = $1
         and b.version = (select max(version) from coding_codebooks where document_id = b.document_id)
       order by d.source_filename, c.position`,
      [runId],
    );
    const out = new Map<string, { documentId: string; filename: string; codes: { name: string; definition: string }[] }>();
    for (const row of r.rows) {
      const e = out.get(row.document_id) ?? { documentId: row.document_id, filename: row.filename, codes: [] };
      e.codes.push({ name: row.name, definition: row.definition });
      out.set(row.document_id, e);
    }
    return [...out.values()];
  });
}

/**
 * Applies the codebook of one transcript to another that has already been read
 * (so its turns exist). The target gets a new version, the codes keep their
 * criteria, themes, notes and keywords, and a decision memo records where the
 * codebook came from. Comparing transcripts on one shared codebook is what
 * makes counts across transcripts mean the same thing.
 */
export async function reuseCodebook(
  tenantId: string,
  runId: string,
  targetDocumentId: string,
  sourceDocumentId: string,
): Promise<{ codes: number }> {
  if (targetDocumentId === sourceDocumentId) throw new Error("Choose a different transcript.");
  const source = await withTenant(tenantId, async (client) => {
    const r = await client.query<{
      name: string;
      definition: string;
      inclusion_criteria: string;
      exclusion_criteria: string;
      filename: string;
    }>(
      `select c.name, c.definition, c.inclusion_criteria, c.exclusion_criteria, d.source_filename as filename
       from coding_codes c
       join coding_codebooks b on b.id = c.codebook_id
       join documents d on d.id = b.document_id
       where b.document_id = $1 and b.run_id = $2
         and b.version = (select max(version) from coding_codebooks where document_id = $1)
       order by c.position`,
      [sourceDocumentId, runId],
    );
    return r.rows;
  });
  if (source.length === 0) throw new Error("The chosen transcript has no codebook yet.");
  const edits: CodebookEdit[] = source.map((c) => ({
    id: null,
    name: c.name,
    definition: c.definition,
    inclusion: c.inclusion_criteria,
    exclusion: c.exclusion_criteria,
  }));
  await reapplyCodebook(tenantId, runId, targetDocumentId, edits);
  const meta = await loadCodeMeta(tenantId, sourceDocumentId);
  const entries = source.map((c) => {
    const m = meta.get(codeKey(c.name));
    return { name: c.name, theme: m?.theme, note: m?.note, keywords: m?.keywords };
  });
  await saveCodeMeta(tenantId, runId, targetDocumentId, entries);
  try {
    await addMemo(tenantId, runId, {
      documentId: targetDocumentId,
      codeName: null,
      kind: "decision",
      body: `Codebook reused from ${source[0].filename} (${source.length} codes), so counts are comparable across transcripts.`,
    });
  } catch {
    // memos are optional
  }
  return { codes: source.length };
}
