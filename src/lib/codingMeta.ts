// Theme (parent), researcher note and keywords for each code of a transcript,
// stored by code NAME so they follow the codes across codebook versions
// (migration 0055), and researcher notes on single turns, bound to the turn's
// text from migration 0127 (see the section below). Reads return nothing and
// writes say which migration is needed when one has not been applied, so the
// rest of the app keeps working.
import type { PoolClient } from "pg";
import { withTenant } from "./db";
import { findingProvenanceAvailable } from "./findingProvenance";
import { lockOwnedTranscript } from "./codingTranscriptOwnership";

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

/**
 * A row stored against this transcript by another tenant before COD500-F01 is invisible here but still
 * holds the key, and the upsert's update is refused by row-level security (42501). Said plainly rather
 * than as a database error; such a row needs removing by an administrator (see the batch21 handover).
 */
function foreignRowBlocks(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "42501";
}
const FOREIGN_ROW_MESSAGE =
  "This could not be saved: the transcript holds a stored entry under the same name that this account cannot see. Ask an administrator to remove it, then save again.";

async function upsertOrExplain<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (foreignRowBlocks(error)) throw new Error(FOREIGN_ROW_MESSAGE);
    throw error;
  }
}

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
  runId: string,
  documentId: string,
  entries: { name: string; theme?: string; note?: string; keywords?: string }[],
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    if (!(await metaAvailable(client)))
      throw new Error(
        `Themes, notes and keywords need migration 0055 to be applied first (the app is connected to ${dbLabel()}).`,
      );
    await lockOwnedTranscript(client, tenantId, runId, documentId, "share");
    const val = (v: string | undefined, max: number) =>
      v === undefined ? null : v.trim().slice(0, max);
    for (const e of entries) {
      const key = codeKey(e.name);
      if (!key) continue;
      await upsertOrExplain(() => client.query(
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
      ));
    }
  });
}

// --- Notes on single turns (0055; bound to their turn by 0127, Codex COD5K-F02) ---------------
//
// A note belongs to the turn it was written on, not to a position. coding_segments are replaced
// wholesale when a transcript is read again (extractThemes.replaceSegments), and the new turn at an
// index can be different speech, so after 0127 a note carries the md5 of its turn's text and counts
// as that turn's note only while the turn at its index still has exactly that text. A note whose turn
// is gone or changed is set aside, wording kept, as an orphan (coding_turn_note_orphans): shown to
// the researcher as such, never as the note of whatever now sits at its index, and cleared or
// attached to a current turn only by an explicit action. Before 0127 notes are read by index as they
// always were; a save is still refused for a turn that does not exist.

const TURN_GONE =
  "That turn is no longer in this transcript (it may have been read again). Reload the transcript to see its current turns; nothing was saved.";
const TURN_CHANGED =
  "That turn has changed since the page was loaded (the transcript was read again). Reload to see the current turn; nothing was saved.";

async function turnNotesAvailable(client: PoolClient): Promise<boolean> {
  const ok = await client.query("select to_regclass('public.coding_turn_notes') is not null as ok");
  return ok.rows[0]?.ok === true;
}

/** Migration 0127: notes carry their turn's text hash and orphans have a table of their own. */
export async function turnNoteIdentityAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `select exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'coding_turn_notes' and column_name = 'segment_text_hash'
     ) and to_regclass('public.coding_turn_note_orphans') is not null as ok`,
  );
  return r.rows[0]?.ok === true;
}

/**
 * The current note of each turn, keyed by turn index. After 0127 only a note whose stored hash
 * matches its turn's current text is returned; any other row is an orphan (loadOrphanTurnNotes).
 */
export async function loadTurnNotes(
  tenantId: string,
  documentId: string,
): Promise<Map<number, string>> {
  return withTenant(tenantId, async (client) => {
    const map = new Map<number, string>();
    if (!(await turnNotesAvailable(client))) return map;
    const r = (await turnNoteIdentityAvailable(client))
      ? await client.query<{ segment_index: number; note: string }>(
          `select n.segment_index, n.note
             from coding_turn_notes n
             join coding_segments s
               on s.document_id = n.document_id and s.segment_index = n.segment_index
              and md5(s.text) = n.segment_text_hash
            where n.document_id = $1`,
          [documentId],
        )
      : await client.query<{ segment_index: number; note: string }>(
          "select segment_index, note from coding_turn_notes where document_id = $1",
          [documentId],
        );
    for (const row of r.rows) if (row.note) map.set(row.segment_index, row.note);
    return map;
  });
}

export type OrphanTurnNote = {
  /** "orphan:<id>" for a note set aside in coding_turn_note_orphans; "turn:<index>" for a note row
   * still keyed by index whose turn no longer matches (left by code older than 0127). */
  ref: string;
  /** The turn number (0-based index) the note was written on. */
  formerIndex: number;
  note: string;
  reason: "turn_missing" | "turn_changed" | "turn_unverified";
  writtenAt: string;
  /** md5 of the text of the turn the note was written on; null when it was never recorded. */
  segmentTextHash: string | null;
  /** The exact words of the turn the note was written on, kept when a re-read set it aside; null when
   * they were not available (set aside before they could be captured, or the fingerprint is unknown). */
  turnText: string | null;
  /** When it was set aside; null for a "turn:" row found unbound on reading, not yet moved. */
  setAsideAt: string | null;
};

/**
 * Notes whose turn is gone or changed, wording verbatim. Empty before 0127 (nothing records which turn
 * a note was written for, so none can be told apart).
 */
export async function loadOrphanTurnNotes(tenantId: string, documentId: string): Promise<OrphanTurnNote[]> {
  return withTenant(tenantId, async (client) => {
    if (!(await turnNotesAvailable(client)) || !(await turnNoteIdentityAvailable(client))) return [];
    const r = await client.query<{
      ref: string; segment_index: number; note: string; reason: OrphanTurnNote["reason"]; written_at: Date;
      segment_text_hash: string | null; set_aside_at: Date | null; turn_text: string | null;
    }>(
      `select 'orphan:' || o.id as ref, o.segment_index, o.note, o.reason, o.written_at,
              o.segment_text_hash, o.orphaned_at as set_aside_at, o.turn_text
         from coding_turn_note_orphans o
        where o.document_id = $1 and o.note <> ''
       union all
       select 'turn:' || n.segment_index, n.segment_index, n.note,
              case when n.segment_text_hash is null then 'turn_unverified'
                   when s.document_id is null then 'turn_missing'
                   else 'turn_changed' end,
              n.updated_at, n.segment_text_hash, null, null
         from coding_turn_notes n
         left join coding_segments s on s.document_id = n.document_id and s.segment_index = n.segment_index
        where n.document_id = $1 and n.note <> ''
          and (s.document_id is null or n.segment_text_hash is null or md5(s.text) <> n.segment_text_hash)
        order by 2, 5`,
      [documentId],
    );
    return r.rows.map((row) => ({
      ref: row.ref,
      formerIndex: row.segment_index,
      note: row.note,
      reason: row.reason,
      writtenAt: new Date(row.written_at).toISOString(),
      segmentTextHash: row.segment_text_hash,
      turnText: row.turn_text,
      setAsideAt: row.set_aside_at === null ? null : new Date(row.set_aside_at).toISOString(),
    }));
  });
}

/**
 * The turn a note is about to be written on, read and share-locked so a re-read cannot replace it
 * before the write commits (replaceSegments takes the transcript's update lock, so it waits for this
 * transaction, and a save that waited for a re-read reads the new turns). Throws when the turn does
 * not exist, or when `expectedText` is given and the turn no longer says it.
 */
async function lockCurrentTurn(
  client: PoolClient,
  documentId: string,
  segmentIndex: number,
  expectedText: string | undefined,
): Promise<{ text: string; hash: string }> {
  const r = await client.query<{ text: string; hash: string }>(
    "select text, md5(text) as hash from coding_segments where document_id = $1 and segment_index = $2 for share",
    [documentId, segmentIndex],
  );
  const turn = r.rows[0];
  if (!turn) throw new Error(TURN_GONE);
  if (expectedText !== undefined && turn.text !== expectedText) throw new Error(TURN_CHANGED);
  return turn;
}

/**
 * Moves the note row at this index to the orphans table when it is not bound to the turn now there,
 * so writing the current turn's note never overwrites (and never inherits) the wording of a note
 * written for different speech. An empty unbound row is simply dropped (it holds no wording).
 */
async function setAsideUnboundNote(
  client: PoolClient,
  documentId: string,
  segmentIndex: number,
  turnHash: string,
): Promise<void> {
  await client.query(
    `with moved as (
       delete from coding_turn_notes
        where document_id = $1 and segment_index = $2
          and (segment_text_hash is null or segment_text_hash <> $3)
       returning tenant_id, document_id, segment_index, note, segment_text_hash, updated_at
     )
     insert into coding_turn_note_orphans (tenant_id, document_id, segment_index, note, segment_text_hash, written_at, reason)
     select tenant_id, document_id, segment_index, note, segment_text_hash, updated_at,
            case when segment_text_hash is null then 'turn_unverified' else 'turn_changed' end
       from moved where note <> ''`,
    [documentId, segmentIndex, turnHash],
  );
}

function checkTurnIndex(segmentIndex: number) {
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) throw new Error("That turn is not in this transcript.");
}

/**
 * Saves (or, with an empty note, clears) the researcher's note on one turn. The transcript must be
 * this run's and tenant's (share lock), and the turn must exist now; with `expectedTurnText` (what the
 * screen showed) it must also still say that, so a note is never written onto a turn the researcher
 * did not see. Clearing removes only the note bound to the current turn; an orphan at the same index
 * is kept. Retrying the same save writes the same row once.
 */
export async function saveTurnNote(
  tenantId: string,
  runId: string,
  documentId: string,
  segmentIndex: number,
  note: string,
  expectedTurnText?: string,
): Promise<void> {
  checkTurnIndex(segmentIndex);
  await withTenant(tenantId, async (client) => {
    if (!(await turnNotesAvailable(client)))
      throw new Error("Notes need migration 0055 to be applied first.");
    await lockOwnedTranscript(client, tenantId, runId, documentId, "share");
    const turn = await lockCurrentTurn(client, documentId, segmentIndex, expectedTurnText);
    const bound = await turnNoteIdentityAvailable(client);
    if (bound) await setAsideUnboundNote(client, documentId, segmentIndex, turn.hash);
    const clean = note.trim().slice(0, 4000);
    if (!clean) {
      await client.query(
        "delete from coding_turn_notes where document_id = $1 and segment_index = $2",
        [documentId, segmentIndex],
      );
      return;
    }
    await upsertOrExplain(() =>
      bound
        ? client.query(
            `insert into coding_turn_notes (tenant_id, document_id, segment_index, note, segment_text_hash)
             values ($1, $2, $3, $4, $5)
             on conflict (document_id, segment_index) do update
               set note = excluded.note, segment_text_hash = excluded.segment_text_hash, updated_at = now()`,
            [tenantId, documentId, segmentIndex, clean, turn.hash],
          )
        : client.query(
            `insert into coding_turn_notes (tenant_id, document_id, segment_index, note)
             values ($1, $2, $3, $4)
             on conflict (document_id, segment_index) do update
               set note = excluded.note, updated_at = now()`,
            [tenantId, documentId, segmentIndex, clean],
          ),
    );
  });
}

/** Locks and returns one orphan note of this transcript by its ref, or throws when it is gone. */
async function lockOrphan(
  client: PoolClient,
  documentId: string,
  ref: string,
): Promise<{ note: string; remove: () => Promise<void> }> {
  const gone = "That note is no longer set aside (it may have been cleared or attached already). Reload to see the current notes.";
  const orphan = /^orphan:([0-9a-f-]{36})$/i.exec(ref);
  if (orphan) {
    const r = await client.query<{ note: string }>(
      "select note from coding_turn_note_orphans where id = $1 and document_id = $2 for update",
      [orphan[1], documentId],
    );
    if (!r.rows[0]) throw new Error(gone);
    return {
      note: r.rows[0].note,
      remove: async () => {
        await client.query("delete from coding_turn_note_orphans where id = $1 and document_id = $2", [orphan[1], documentId]);
      },
    };
  }
  const inPlace = /^turn:(\d+)$/.exec(ref);
  if (inPlace) {
    const index = Number(inPlace[1]);
    const r = await client.query<{ note: string }>(
      `select n.note from coding_turn_notes n
         left join coding_segments s on s.document_id = n.document_id and s.segment_index = n.segment_index
        where n.document_id = $1 and n.segment_index = $2
          and (s.document_id is null or n.segment_text_hash is null or md5(s.text) <> n.segment_text_hash)
        for update of n`,
      [documentId, index],
    );
    if (!r.rows[0]) throw new Error(gone);
    return {
      note: r.rows[0].note,
      remove: async () => {
        await client.query("delete from coding_turn_notes where document_id = $1 and segment_index = $2", [documentId, index]);
      },
    };
  }
  throw new Error(gone);
}

async function lockForOrphanChange(client: PoolClient, tenantId: string, runId: string, documentId: string) {
  if (!(await turnNotesAvailable(client)) || !(await turnNoteIdentityAvailable(client)))
    throw new Error("Notes set aside from changed turns need migration 0127 to be applied first.");
  await lockOwnedTranscript(client, tenantId, runId, documentId, "share");
}

/** Deletes one orphan note: the researcher's explicit decision that its wording is no longer needed. */
export async function clearOrphanTurnNote(
  tenantId: string,
  runId: string,
  documentId: string,
  ref: string,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await lockForOrphanChange(client, tenantId, runId, documentId);
    const orphan = await lockOrphan(client, documentId, ref);
    await orphan.remove();
  });
}

/**
 * Attaches an orphan note, wording unchanged, to a current turn the researcher chose, binding it to
 * that turn's text. Refused when the turn does not exist or no longer says `expectedTurnText`, and
 * when the turn already has a note of its own (the researcher edits or clears that first, so neither
 * wording is lost).
 */
export async function attachOrphanTurnNote(
  tenantId: string,
  runId: string,
  documentId: string,
  ref: string,
  segmentIndex: number,
  expectedTurnText: string,
): Promise<void> {
  checkTurnIndex(segmentIndex);
  await withTenant(tenantId, async (client) => {
    await lockForOrphanChange(client, tenantId, runId, documentId);
    const orphan = await lockOrphan(client, documentId, ref);
    const turn = await lockCurrentTurn(client, documentId, segmentIndex, expectedTurnText);
    if (ref !== `turn:${segmentIndex}`) await setAsideUnboundNote(client, documentId, segmentIndex, turn.hash);
    const existing = await client.query<{ note: string; segment_text_hash: string | null }>(
      "select note, segment_text_hash from coding_turn_notes where document_id = $1 and segment_index = $2 for update",
      [documentId, segmentIndex],
    );
    const own = existing.rows[0];
    if (own && own.segment_text_hash === turn.hash && own.note !== "")
      throw new Error(`Turn ${segmentIndex + 1} already has a note. Edit or clear that note first, so neither is lost.`);
    await orphan.remove();
    await upsertOrExplain(() =>
      client.query(
        `insert into coding_turn_notes (tenant_id, document_id, segment_index, note, segment_text_hash)
         values ($1, $2, $3, $4, $5)
         on conflict (document_id, segment_index) do update
           set note = excluded.note, segment_text_hash = excluded.segment_text_hash, updated_at = now()`,
        [tenantId, documentId, segmentIndex, orphan.note, turn.hash],
      ),
    );
  });
}

export type NotedTurnText = { index: number; text: string };

/**
 * The current text of every turn that carries a note bound to it, read by replaceSegments (under its
 * update lock) before the turns are deleted. Empty before 0127.
 */
export async function readNotedTurnTexts(client: PoolClient, documentId: string): Promise<NotedTurnText[]> {
  if (!(await turnNotesAvailable(client)) || !(await turnNoteIdentityAvailable(client))) return [];
  const r = await client.query<{ segment_index: number; text: string }>(
    `select s.segment_index, s.text
       from coding_segments s
       join coding_turn_notes n
         on n.document_id = s.document_id and n.segment_index = s.segment_index
        and n.segment_text_hash = md5(s.text)
      where s.document_id = $1`,
    [documentId],
  );
  return r.rows.map((row) => ({ index: row.segment_index, text: row.text }));
}

/**
 * Called by replaceSegments inside its transaction, after the new turns are inserted: every note not
 * bound to a turn that still has its text is moved to the orphans table, with the words of the turn it
 * was written on (`previous`, read before the delete) when they are known: kept only when their md5
 * equals the note's fingerprint, so the stored text is exactly what the note was about. No-op before
 * 0127.
 */
export async function setAsideNotesOfReplacedTurns(
  client: PoolClient,
  documentId: string,
  previous: NotedTurnText[],
): Promise<void> {
  if (!(await turnNotesAvailable(client)) || !(await turnNoteIdentityAvailable(client))) return;
  await client.query(
    `with moved as (
       delete from coding_turn_notes n
        where n.document_id = $1
          and not exists (
            select 1 from coding_segments s
             where s.document_id = n.document_id and s.segment_index = n.segment_index
               and md5(s.text) = n.segment_text_hash
          )
       returning n.tenant_id, n.document_id, n.segment_index, n.note, n.segment_text_hash, n.updated_at
     )
     insert into coding_turn_note_orphans (tenant_id, document_id, segment_index, note, segment_text_hash, turn_text, written_at, reason)
     select m.tenant_id, m.document_id, m.segment_index, m.note, m.segment_text_hash,
            (select p.tx from unnest($2::int[], $3::text[]) as p(i, tx)
              where p.i = m.segment_index and md5(p.tx) = m.segment_text_hash),
            m.updated_at,
            case when m.segment_text_hash is null then 'turn_unverified'
                 when exists (select 1 from coding_segments s where s.document_id = m.document_id and s.segment_index = m.segment_index)
                   then 'turn_changed'
                 else 'turn_missing' end
       from moved m where m.note <> ''`,
    [documentId, previous.map((p) => p.index), previous.map((p) => p.text)],
  );
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
    // REP-IN-002: a theme a researcher set by hand on a coded finding is not overwritten by the
    // codebook. Before migration 0094 there is no edit record, so this cannot be checked.
    const provenance = await findingProvenanceAvailable(client);
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
          and f.theme is distinct from coalesce(nullif(m.theme, ''), c.name)
          ${provenance ? "and not (f.human_edited_fields @> array['theme'])" : ""}`,
      [documentId],
    );
  });
}
