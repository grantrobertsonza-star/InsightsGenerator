// Theme (parent), researcher note and keywords for each code of a transcript,
// and researcher notes on single turns. Stored by code NAME so they follow
// the codes across codebook versions (migration 0055). Every function is a
// no-op or returns nothing when the migration has not been applied, so the
// rest of the app keeps working.
import type { PoolClient } from "pg";
import { withTenant } from "./db";

export const codeKey = (name: string) =>
  name.trim().toLowerCase().replace(/\s+/g, " ");

/** Host and port of the database the app is using, for error messages. */
function dbLabel(): string {
  try {
    const u = new URL(process.env.DATABASE_URL ?? "");
    return `${u.hostname}:${u.port || "5432"}`;
  } catch {
    return "an unknown database";
  }
}

export type CodeMeta = { theme: string; note: string; keywords: string };

export async function metaAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query(
    "select to_regclass('public.coding_code_meta') is not null as ok",
  );
  return r.rows[0]?.ok === true;
}

export async function loadCodeMeta(
  tenantId: string,
  documentId: string,
): Promise<Map<string, CodeMeta>> {
  return withTenant(tenantId, async (client) => {
    const map = new Map<string, CodeMeta>();
    if (!(await metaAvailable(client))) return map;
    const r = await client.query<{
      code_key: string;
      theme: string;
      note: string;
      keywords: string;
    }>(
      "select code_key, theme, note, keywords from coding_code_meta where document_id = $1",
      [documentId],
    );
    for (const row of r.rows)
      map.set(row.code_key, {
        theme: row.theme,
        note: row.note,
        keywords: row.keywords,
      });
    return map;
  });
}

/** Meta for many transcripts at once, keyed by document id. */
export async function loadCodeMetaForDocuments(
  tenantId: string,
  documentIds: string[],
): Promise<Map<string, Map<string, CodeMeta>>> {
  return withTenant(tenantId, async (client) => {
    const out = new Map<string, Map<string, CodeMeta>>();
    if (documentIds.length === 0 || !(await metaAvailable(client))) return out;
    const r = await client.query<{
      document_id: string;
      code_key: string;
      theme: string;
      note: string;
      keywords: string;
    }>(
      `select document_id, code_key, theme, note, keywords
       from coding_code_meta where document_id = any($1::uuid[])`,
      [documentIds],
    );
    for (const row of r.rows) {
      const m = out.get(row.document_id) ?? new Map<string, CodeMeta>();
      m.set(row.code_key, {
        theme: row.theme,
        note: row.note,
        keywords: row.keywords,
      });
      out.set(row.document_id, m);
    }
    return out;
  });
}

/**
 * Saves theme, note and keywords for codes. A field left undefined keeps what
 * is already stored, so an import that only knows the theme does not wipe a
 * note the researcher wrote.
 */
export async function saveCodeMeta(
  tenantId: string,
  documentId: string,
  entries: { name: string; theme?: string; note?: string; keywords?: string }[],
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    if (!(await metaAvailable(client)))
      throw new Error(
        `Themes, notes and keywords need migration 0055 to be applied first (the app is connected to ${dbLabel()}).`,
      );
    const val = (v: string | undefined, max: number) =>
      v === undefined ? null : v.trim().slice(0, max);
    for (const e of entries) {
      const key = codeKey(e.name);
      if (!key) continue;
      await client.query(
        `insert into coding_code_meta (tenant_id, document_id, code_key, theme, note, keywords)
         values ($1, $2, $3, coalesce($4::text, ''), coalesce($5::text, ''), coalesce($6::text, ''))
         on conflict (document_id, code_key) do update
           set theme = coalesce($4::text, coding_code_meta.theme),
               note = coalesce($5::text, coding_code_meta.note),
               keywords = coalesce($6::text, coding_code_meta.keywords),
               updated_at = now()`,
        [
          tenantId,
          documentId,
          key,
          val(e.theme, 200),
          val(e.note, 4000),
          val(e.keywords, 1000),
        ],
      );
    }
  });
}

export async function loadTurnNotes(
  tenantId: string,
  documentId: string,
): Promise<Map<number, string>> {
  return withTenant(tenantId, async (client) => {
    const map = new Map<number, string>();
    const ok = await client.query(
      "select to_regclass('public.coding_turn_notes') is not null as ok",
    );
    if (ok.rows[0]?.ok !== true) return map;
    const r = await client.query<{ segment_index: number; note: string }>(
      "select segment_index, note from coding_turn_notes where document_id = $1",
      [documentId],
    );
    for (const row of r.rows) if (row.note) map.set(row.segment_index, row.note);
    return map;
  });
}

export async function saveTurnNote(
  tenantId: string,
  documentId: string,
  segmentIndex: number,
  note: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const ok = await client.query(
      "select to_regclass('public.coding_turn_notes') is not null as ok",
    );
    if (ok.rows[0]?.ok !== true)
      throw new Error("Notes need migration 0055 to be applied first.");
    const clean = note.trim().slice(0, 4000);
    if (!clean) {
      await client.query(
        "delete from coding_turn_notes where document_id = $1 and segment_index = $2",
        [documentId, segmentIndex],
      );
      return;
    }
    await client.query(
      `insert into coding_turn_notes (tenant_id, document_id, segment_index, note)
       values ($1, $2, $3, $4)
       on conflict (document_id, segment_index) do update
         set note = excluded.note, updated_at = now()`,
      [tenantId, documentId, segmentIndex, clean],
    );
  });
}

/** Splits a keyword cell into trimmed, non-empty terms. */
export function splitKeywords(text: string): string[] {
  const quoted = [...text.matchAll(/["“”]([^"“”]+)["“”]/g)].map(
    (m) => m[1].trim(),
  );
  const parts = quoted.length > 0 ? quoted : text.split(/[,;\n|]/);
  return [...new Set(parts.map((p) => p.trim()).filter((p) => p.length > 0 && p.length <= 80))];
}

/** Counts whole-word, case-insensitive occurrences of each keyword in a text. */
export function countKeyword(text: string, keyword: string): number {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "giu");
  return [...text.matchAll(re)].length;
}

/**
 * Makes coded findings follow the themes: a finding is grouped under its
 * code's theme when it has one, otherwise under the code's own name. Only the
 * transcript's current codebook is touched, and only findings that differ.
 */
export async function syncFindingThemes(
  tenantId: string,
  documentId: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    if (!(await metaAvailable(client))) return;
    await client.query(
      `update findings f
          set theme = coalesce(nullif(m.theme, ''), c.name)
         from coding_codes c
         join coding_codebooks b on b.id = c.codebook_id
         left join coding_code_meta m
           on m.document_id = b.document_id
          and m.code_key = lower(regexp_replace(trim(c.name), '\\s+', ' ', 'g'))
        where f.coding_code_id = c.id
          and f.source_document_id = $1
          and f.origin = 'coded'
          and b.version = (select max(version) from coding_codebooks where document_id = $1)
          and f.theme is distinct from coalesce(nullif(m.theme, ''), c.name)`,
      [documentId],
    );
  });
}
