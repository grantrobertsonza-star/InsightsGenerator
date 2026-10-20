import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant, withTenantRead } from "./db";
import type { PoolClient } from "pg";
import { extractDocumentText } from "./extractFindings";
import { loadVariableDictionary } from "./crosstabs";
import { matchItems } from "./instrumentMatch";
import { parseRouting, type Routing } from "./routingParse";
import { deriveGotoRouting } from "./gotoRouting";
import { buildLabelOverlay, type LabelOverlay } from "./labelOverlay";

// Questionnaires and interview guides: reading their items out, linking
// questionnaire items to a dataset's variables, and exposing the confirmed
// links to the rest of the app. Everything the model produces here is stored
// as a suggestion for the researcher to check.

export type InstrumentType = "questionnaire" | "interview_guide" | "focus_group_guide";
export type ItemOption = { code: string; label: string; goto?: string | null };
export type InstrumentItem = {
  id: string;
  order: number;
  section: string | null;
  code: string | null;
  text: string;
  options: ItemOption[];
  routingText: string | null;
  routing: Routing | null;
  page: number | null;
};
export type LinkStatus = "suggested" | "confirmed" | "rejected";
export type InstrumentLink = {
  id: string;
  itemId: string;
  dataDocumentId: string;
  variable: string;
  method: "code" | "stem" | "wording" | "manual";
  confidence: number;
  status: LinkStatus;
};

export const CHUNK_CHARS = 14000;
export const MAX_CHUNKS = 40;
export const AUTO_CONFIRM_MIN = 0.9;

type RawItem = {
  code?: unknown;
  text?: unknown;
  options?: unknown;
  routing_text?: unknown;
  section?: unknown;
};

const SYSTEM =
  "You read part of a survey questionnaire, or an interview or focus group guide, and list the question items in the order they appear. " +
  "For each item return: its code exactly as printed (for example Q12, B3a, A1) or null if it has none; the question wording as printed, " +
  "without interviewer instructions; the printed answer options as code and label pairs (empty for open questions); " +
  "any skip or routing instruction printed with the item, copied word for word (for example 'ASK IF Q5 = 1'), or null; " +
  "and the section heading it sits under, or null. " +
  "When an answer option carries a jump (for example 'No -> GO TO Q10' or 'SKIP TO Q12'), put the target code in that option's goto, and use END if it ends the interview. "
  + "Do not invent codes, options or routing. If a question continues from the previous part, still list it with the text you can see. " +
  "Do not list introductions, consent text, thank-you messages or interviewer-only notes as items. " +
  "For a guide with no codes, list each main question and each probe as its own item, in order.";

function chunkPages(pages: { pageNumber: number; text: string }[]): { text: string; page: number }[] {
  const chunks: { text: string; page: number }[] = [];
  let cur = "";
  let first = 1;
  for (const p of pages) {
    if (cur.length > 0 && cur.length + p.text.length > CHUNK_CHARS) {
      chunks.push({ text: cur, page: first });
      cur = "";
    }
    if (cur === "") first = p.pageNumber;
    cur += `\n[page ${p.pageNumber}]\n${p.text}`;
  }
  if (cur.trim()) chunks.push({ text: cur, page: first });
  return chunks;
}

function splitText(text: string): { pageNumber: number; text: string }[] {
  const out: { pageNumber: number; text: string }[] = [];
  for (let i = 0; i * CHUNK_CHARS < text.length; i++) {
    out.push({ pageNumber: i + 1, text: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
  }
  return out;
}

function cleanOptions(raw: unknown): { options: ItemOption[]; truncated: boolean } {
  if (!Array.isArray(raw)) return { options: [], truncated: false };
  const out: ItemOption[] = [];
  for (const o of raw) {
    const r = o as { code?: unknown; label?: unknown; goto?: unknown };
    const label = typeof r?.label === "string" ? r.label.trim() : "";
    const code = r?.code === null || r?.code === undefined ? "" : String(r.code).trim();
    const goto = typeof r?.goto === "string" && r.goto.trim() ? r.goto.trim() : null;
    if (label) out.push(goto ? { code, label, goto } : { code, label });
  }
  // IMP-012: used to cap silently at 80 with no signal that anything was lost. A dropped
  // option is exactly the kind of truncation the read's `complete` flag exists to catch -
  // the same reasoning as a chunk the model never saw - so the caller is told rather than
  // quietly handed a short list that looks like the whole thing.
  return { options: out.slice(0, 80), truncated: out.length > 80 };
}

export type InstrumentReadResult = {
  /** Items now on file for this document (after the merge below), not just the ones this read produced. */
  count: number;
  /** False when one or more chunks of the document could not be read (a model-call failure, a bad
   * response shape): some items may be missing or stale, and a reread is worth trying again. */
  complete: boolean;
  /** How many of the document's chunks failed to read, when not complete. */
  failedChunks: number;
  /** IMP-012: an item or a chunk can each independently make a read incomplete - a chunk failing
   * outright (counted above), an item's `text` coming back unusable, or an item's option list
   * being cut off at the 80 cap. `failedChunks` alone used to be the only number the caller had,
   * so a read made incomplete purely by an invalid item or truncated options (failedChunks: 0)
   * displayed as "0 parts of the document could not be read" - true of chunks specifically, but
   * read by anyone as "nothing went wrong", concealing the actual reason this read is incomplete. */
  incompleteItems: number;
};

/** How long a claim on a read stands before another session may take it over (an abandoned read). */
export const INSTRUMENT_READ_CLAIM_MINUTES = 15;

/** Raised when another session is already reading this questionnaire or guide. Nothing was paid for. */
export class InstrumentReadInFlightError extends Error {}

/**
 * IR-05: the paid read of a questionnaire or guide runs once at a time per document, across every
 * session and server instance, not only once per page. The claim is taken in one short transaction
 * that first locks the document's row (FOR UPDATE, and the row must exist in this project), so two
 * requests decide one after the other; the second sees the first's claim and is refused before any
 * model call. The claim itself is an 'instrument_read_started' trace row (no migration needed): it
 * stands until a later 'instrument_read_finished', 'instrument_read_failed' or
 * 'instrument_read_released' row for the same document (trace ids only grow, so "later" is the id),
 * or until INSTRUMENT_READ_CLAIM_MINUTES pass, after which a read that crashed without releasing can
 * be retried. The trace row is only the record; the serialisation comes from the row lock.
 */
async function claimInstrumentRead(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<{ claimId: string; storage_path: string; source_filename: string }> {
  return withTenant(tenantId, async (client) => {
    const doc = await client.query<{ storage_path: string; source_filename: string; content_sha256: string | null }>(
      "select storage_path, source_filename, content_sha256 from documents where id = $1 and run_id = $2 and kind = 'instrument' for update",
      [documentId, runId],
    );
    if (doc.rowCount !== 1) throw new Error("Questionnaire or guide not found for this run");
    if (await hasActiveReadClaim(client, runId, documentId)) {
      throw new InstrumentReadInFlightError("This file is already being read in another session. It will show here when that read finishes.");
    }
    const claim = await client.query<{ id: string }>(
      "insert into trace(tenant_id,run_id,event,detail) values($1,$2,'instrument_read_started',$3) returning id::text",
      [tenantId, runId, JSON.stringify({ documentId, contentSha256: doc.rows[0].content_sha256 })],
    );
    return { claimId: claim.rows[0].id, storage_path: doc.rows[0].storage_path, source_filename: doc.rows[0].source_filename };
  });
}

/** True while a claim on this document's read stands (see claimInstrumentRead). */
async function hasActiveReadClaim(client: PoolClient, runId: string, documentId: string): Promise<boolean> {
  const active = await client.query(
    `select c.id from trace c
     where c.run_id = $1 and c.event = 'instrument_read_started' and c.detail->>'documentId' = $2
       and c.occurred_at > now() - make_interval(mins => $3)
       and not exists (
         select 1 from trace t
         where t.run_id = c.run_id and t.id > c.id and t.detail->>'documentId' = $2
           and t.event in ('instrument_read_finished', 'instrument_read_failed', 'instrument_read_released'))
     limit 1`,
    [runId, documentId, INSTRUMENT_READ_CLAIM_MINUTES],
  );
  return (active.rowCount ?? 0) > 0;
}

/** Whether a read of this questionnaire or guide is under way in some session now. */
export async function isInstrumentReadInFlight(tenantId: string, runId: string, documentId: string): Promise<boolean> {
  return withTenantRead(tenantId, (client) => hasActiveReadClaim(client, runId, documentId));
}

/** Ends a claim that did not finish (any error after the claim), so a retry need not wait for it to expire. */
async function releaseInstrumentRead(tenantId: string, runId: string, documentId: string, claimId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'instrument_read_released',$3)", [tenantId, runId, JSON.stringify({ documentId, claimId })]);
  });
}

export async function readInstrumentItems(tenantId: string, runId: string, documentId: string): Promise<InstrumentReadResult> {
  const doc = await claimInstrumentRead(tenantId, runId, documentId);
  try {
    return await readClaimedInstrument(tenantId, runId, documentId, doc);
  } catch (e) {
    // Best effort: if even this write fails, the claim lapses after INSTRUMENT_READ_CLAIM_MINUTES.
    await releaseInstrumentRead(tenantId, runId, documentId, doc.claimId).catch(() => {});
    throw e;
  }
}

async function readClaimedInstrument(
  tenantId: string,
  runId: string,
  documentId: string,
  doc: { claimId: string; storage_path: string; source_filename: string },
): Promise<InstrumentReadResult> {
  const extracted = await extractDocumentText(doc.storage_path, doc.source_filename, documentId);
  const pages = extracted.pages.length > 0 ? extracted.pages : splitText(extracted.fullText);
  const allChunks = chunkPages(pages);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  if (chunks.length === 0) throw new Error("No text could be read from this file. A scanned PDF may need to be converted to text first.");

  // IMP-012: a document with more than MAX_CHUNKS chunks used to have the extra ones simply
  // never requested, with nothing distinguishing that from a shorter document that was read
  // in full - the same silent-truncation shape as a chunk whose model call actually failed,
  // so it is counted the same way here, not as a separate, unreported kind of gap.
  let failedChunks = Math.max(0, allChunks.length - MAX_CHUNKS);
  const found = await mapWithConcurrency(chunks, 3, async (chunk) => {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: SYSTEM,
        tool_choice: { type: "tool", name: "record_items" },
        tools: [
          {
            name: "record_items",
            description: "Records the question items found in this part of the document, in order.",
            input_schema: {
              type: "object",
              properties: {
                items: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      code: { type: ["string", "null"] },
                      text: { type: "string" },
                      options: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: { code: { type: ["string", "number", "null"] }, label: { type: "string" }, goto: { type: ["string", "null"] } },
                          required: ["label"],
                        },
                      },
                      routing_text: { type: ["string", "null"] },
                      section: { type: ["string", "null"] },
                    },
                    required: ["text"],
                  },
                },
              },
              required: ["items"],
            },
          },
        ],
        messages: [{ role: "user", content: `Document part:\n\n${chunk.text}` }],
      });
      await logApiUsage(tenantId, runId, "instrument_reader", response.usage);
      // A response cut off by the token budget can still leave a well-formed-looking tool call
      // if the cut happened to land on an array boundary - the JSON parses, but the chunk's
      // true content past that point was never generated at all. Treated as failed here, the
      // same as a missing or malformed tool call, rather than as a legitimately complete read
      // that simply stopped a little short.
      if (response.stop_reason === "max_tokens") {
        failedChunks += 1;
        return [] as (RawItem & { page: number })[];
      }
      const tool = response.content.find((b) => b.type === "tool_use");
      // A missing tool_use block, or one whose `items` field isn't the array the schema
      // requires, is not the same thing as the model genuinely finding zero items in this
      // chunk (that case still comes back as a present, empty `items` array and is a real
      // result). Either one used to fall through to the same empty array a legitimate "no
      // items here" produces, with nothing to tell them apart - so a chunk that failed to
      // return usable output could make its items look like they were read and found absent,
      // rather than simply not read. Counting it as a failed chunk here is what keeps
      // `complete` honest, which is what the deletion below relies on to be safe.
      if (!tool || tool.type !== "tool_use" || !Array.isArray((tool.input as { items?: unknown }).items)) {
        failedChunks += 1;
        return [] as (RawItem & { page: number })[];
      }
      const items = (tool.input as { items: RawItem[] }).items;
      return items.map((i) => ({ ...i, page: chunk.page }));
    } catch {
      failedChunks += 1;
      return [] as (RawItem & { page: number })[];
    }
  });
  // Flatten, tidy and drop repeats at chunk boundaries.
  const seen = new Set<string>();
  // IMP-012: a tool call can come back well-formed (a real `items` array, not the missing/
  // malformed shape already caught above) while one element inside it is individually
  // unusable - most often a `text` the model sent as something other than a string, despite
  // the schema. That element used to be dropped the same way a legitimate duplicate or an
  // empty slot is, with no record that anything was lost - exactly the kind of gap `complete`
  // exists to surface, so it is tracked the same way a failed chunk is.
  let invalidItems = 0;
  let truncatedOptionItems = 0;
  const rows: {
    section: string | null;
    code: string | null;
    text: string;
    options: ItemOption[];
    routingText: string | null;
    routing: Routing | null;
    page: number;
    /** IMP-012: this row's own options list was truncated - see the write loop below, which
     * uses it to avoid overwriting an existing, previously-complete item with this partial one. */
    truncated: boolean;
  }[] = [];
  for (const chunk of found) {
    for (const i of chunk) {
      const text = typeof i.text === "string" ? i.text.replace(/\s+/g, " ").trim() : "";
      if (!text) {
        invalidItems += 1;
        continue;
      }
      const code = typeof i.code === "string" && i.code.trim() ? i.code.trim().replace(/[.:)]+$/, "") : null;
      const key = `${(code ?? "").toLowerCase()}|${text.toLowerCase().slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const routingText = typeof i.routing_text === "string" && i.routing_text.trim() ? i.routing_text.trim() : null;
      const { options, truncated } = cleanOptions(i.options);
      if (truncated) truncatedOptionItems += 1;
      rows.push({
        section: typeof i.section === "string" && i.section.trim() ? i.section.trim() : null,
        code,
        text,
        options,
        routingText,
        routing: parseRouting(routingText),
        page: (i as { page: number }).page,
        truncated,
      });
    }
  }
  if (rows.length === 0) throw new Error("No question items were found in this file.");
  // An invalid item or a truncated option list means something the model actually reported
  // was lost or cut short, not that the document legitimately has no more to give - the same
  // "better a stale item than a silently destroyed confirmed link" reasoning the chunk-level
  // failure already gets, so it folds into the same `complete` flag the deletion below relies on.
  const complete = failedChunks === 0 && invalidItems === 0 && truncatedOptionItems === 0;

  // Jumps printed on answer options ("No: GO TO Q10") skip the items between.
  const derived = deriveGotoRouting(rows.map((r) => ({ code: r.code, routing: r.routing, options: r.options })));
  rows.forEach((r, i) => {
    r.routing = derived[i];
  });

  const itemKey = (code: string | null, text: string) => `${(code ?? "").toLowerCase()}|${text.toLowerCase().slice(0, 80)}`;

  const count = await withTenant(tenantId, async (client) => {
    // Matched by the same (code, text-prefix) key the read itself dedupes
    // chunk boundaries with, so an item that still appears keeps its
    // database identity - and so keeps every instrument_links row pointing
    // at it (those cascade-delete with their item) - instead of a blind
    // delete-then-reinsert handing every item a fresh id on every reread.
    const existing = await client.query<{ id: string; code: string | null; item_text: string }>(
      "select id, code, item_text from instrument_items where document_id = $1",
      [documentId],
    );
    const existingByKey = new Map(existing.rows.map((r) => [itemKey(r.code, r.item_text), r.id] as const));
    const matchedIds = new Set<string>();

    for (let n = 0; n < rows.length; n++) {
      const r = rows[n];
      const existingId = existingByKey.get(itemKey(r.code, r.text));
      if (existingId) {
        matchedIds.add(existingId);
        // IMP-012: an item this row matches was already on file, and this row's OWN
        // options list was truncated (the 80-option cap) - overwriting it would replace
        // whatever this item previously had (which may well have been a complete, untruncated
        // read from an earlier pass) with this pass's cut-short version. "Stale item beats
        // destroyed link" already governs the deletion below for an item missing from `rows`
        // entirely; staging nothing here is the same reasoning for an item that IS in `rows`
        // but in a degraded form - the existing row's full data is preserved instead of
        // being replaced by a partial one.
        if (r.truncated) continue;
        await client.query(
          `update instrument_items
           set item_order = $1, section = $2, code = $3, item_text = $4, response_options = $5,
               routing_text = $6, routing = $7, page = $8
           where id = $9`,
          [n, r.section, r.code, r.text, JSON.stringify(r.options), r.routingText, r.routing ? JSON.stringify(r.routing) : null, r.page, existingId],
        );
      } else {
        await client.query(
          `insert into instrument_items (tenant_id, run_id, document_id, item_order, section, code, item_text, response_options, routing_text, routing, page)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [tenantId, runId, documentId, n, r.section, r.code, r.text, JSON.stringify(r.options), r.routingText, r.routing ? JSON.stringify(r.routing) : null, r.page],
        );
      }
    }

    // An item that genuinely dropped out of the document (the researcher
    // replaced the file, or trimmed a section) is removed, along with its
    // links, same as before. But when this read is incomplete - one or more
    // chunks failed - an item missing from `rows` might just be one that
    // failed to come back this time, not one that actually disappeared, so
    // nothing is deleted on an incomplete read: better a stale item than a
    // silently destroyed confirmed link.
    if (complete) {
      const stale = existing.rows.filter((r) => !matchedIds.has(r.id)).map((r) => r.id);
      if (stale.length > 0) {
        await client.query("delete from instrument_items where id = any($1::uuid[])", [stale]);
      }
    }

    const r = await client.query<{ n: string }>("select count(*)::text as n from instrument_items where document_id = $1", [documentId]);
    // Coverage belongs to the persisted item set: a reload must not turn an incomplete reread
    // into an apparently complete questionnaire merely because older confirmed items survived.
    await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'instrument_read_finished',$3)", [tenantId, runId, JSON.stringify({ documentId, complete, failedChunks, incompleteItems: invalidItems + truncatedOptionItems, claimId: doc.claimId })]);
    return Number(r.rows[0]?.n ?? rows.length);
  });
  return { count, complete, failedChunks, incompleteItems: invalidItems + truncatedOptionItems };
}

/** Suggests links between an instrument's items and a data file's variables. Confirmed and rejected links are kept. */
export async function suggestInstrumentLinks(
  tenantId: string,
  runId: string,
  instrumentId: string,
  dataDocumentId: string,
): Promise<{ suggested: number }> {
  const items = await getInstrumentItems(tenantId, instrumentId);
  const dictionary = await loadVariableDictionary(tenantId, runId, dataDocumentId);
  const candidates = matchItems(
    items.map((i) => ({ id: i.id, code: i.code, text: i.text })),
    dictionary.variables.map((v) => ({ name: v.name, label: v.label })),
  );
  let suggestedNew = 0;
  await withTenant(tenantId, async (client) => {
    await client.query(
      `delete from instrument_links where status = 'suggested' and data_document_id = $2
         and item_id in (select id from instrument_items where document_id = $1)`,
      [instrumentId, dataDocumentId],
    );
    // A variable the researcher has already confirmed for a question (by hand or by confirming a
    // suggestion) is not suggested again for a different question: matching again must not put a
    // second claim on a decision already made (Grant, 2026-10-20, with manual matching).
    const taken = new Map(
      (
        await client.query<{ variable: string; item_id: string }>(
          "select variable, item_id from instrument_links where data_document_id = $1 and status = 'confirmed'",
          [dataDocumentId],
        )
      ).rows.map((r) => [r.variable, r.item_id]),
    );
    for (const c of candidates) {
      if (taken.has(c.variable) && taken.get(c.variable) !== c.itemId) continue;
      // Everything starts as a suggestion. Confirming is the researcher's step.
      const r = await client.query(
        `insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (item_id, data_document_id, variable) do nothing`,
        [tenantId, runId, c.itemId, dataDocumentId, c.variable, c.method, c.confidence, "suggested"],
      );
      if (r.rowCount) suggestedNew += 1;
    }
    await client.query("update documents set instrument_for = $1 where id = $2", [dataDocumentId, instrumentId]);
  });
  return { suggested: suggestedNew };
}

export async function getInstrumentItems(tenantId: string, instrumentId: string): Promise<InstrumentItem[]> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{
      id: string; item_order: number; section: string | null; code: string | null; item_text: string;
      response_options: ItemOption[]; routing_text: string | null; routing: Routing | null; page: number | null;
    }>(
      `select id, item_order, section, code, item_text, response_options, routing_text, routing, page
       from instrument_items where document_id = $1 order by item_order`,
      [instrumentId],
    );
    return r.rows.map((x) => ({
      id: x.id, order: x.item_order, section: x.section, code: x.code, text: x.item_text,
      options: x.response_options ?? [], routingText: x.routing_text, routing: x.routing, page: x.page,
    }));
  });
}

export async function getInstrumentLinks(tenantId: string, instrumentId: string): Promise<InstrumentLink[]> {
  return withTenantRead(tenantId, async (client) => {
    const r = await client.query<{
      id: string; item_id: string; data_document_id: string; variable: string;
      method: InstrumentLink["method"]; confidence: string; status: LinkStatus;
    }>(
      `select l.id, l.item_id, l.data_document_id, l.variable, l.method, l.confidence, l.status
       from instrument_links l join instrument_items i on i.id = l.item_id
       where i.document_id = $1 order by i.item_order, l.confidence desc`,
      [instrumentId],
    );
    return r.rows.map((x) => ({
      id: x.id, itemId: x.item_id, dataDocumentId: x.data_document_id, variable: x.variable,
      method: x.method, confidence: Number(x.confidence), status: x.status,
    }));
  });
}

export type InstrumentSummary = {
  documentId: string;
  type: InstrumentType | null;
  forDocumentId: string | null;
  items: number;
  withRouting: number;
  /** Items whose rule comes from a GO TO jump on an earlier answer option. */
  fromJumps: number;
  statedRoutingText: number;
  links: { suggested: number; confirmed: number; rejected: number };
  /** Questions with at least one suggested link still waiting for the researcher (a grid question's many links count once). */
  itemsToCheck: number;
  readStatus?: { complete: boolean; failedChunks: number; incompleteItems: number };
  /** The reason the latest read failed, when it is newer than any finished read. */
  readFailure?: string;
};

export async function getInstrumentSummaries(tenantId: string, runId: string): Promise<Map<string, InstrumentSummary>> {
  const out = new Map<string, InstrumentSummary>();
  try {
    await withTenantRead(tenantId, async (client) => {
      const docs = await client.query<{ id: string; instrument_type: InstrumentType | null; instrument_for: string | null }>(
        "select id, instrument_type, instrument_for from documents where run_id = $1 and kind = 'instrument'",
        [runId],
      );
      for (const d of docs.rows) {
        out.set(d.id, {
          documentId: d.id, type: d.instrument_type, forDocumentId: d.instrument_for,
          items: 0, withRouting: 0, fromJumps: 0, statedRoutingText: 0, links: { suggested: 0, confirmed: 0, rejected: 0 }, itemsToCheck: 0,
        });
      }
      if (out.size === 0) return;
      const items = await client.query<{ document_id: string; n: string; routed: string; jumped: string; stated: string }>(
        `select document_id, count(*) as n,
                count(*) filter (where routing is not null and routing_text is not null) as routed,
                count(*) filter (where routing is not null and routing_text is null) as jumped,
                count(*) filter (where routing_text is not null) as stated
         from instrument_items where run_id = $1 group by document_id`,
        [runId],
      );
      for (const r of items.rows) {
        const s = out.get(r.document_id);
        if (s) { s.items = Number(r.n); s.withRouting = Number(r.routed); s.fromJumps = Number(r.jumped); s.statedRoutingText = Number(r.stated); }
      }
      const links = await client.query<{ document_id: string; status: LinkStatus; n: string }>(
        `select i.document_id, l.status, count(*) as n
         from instrument_links l join instrument_items i on i.id = l.item_id
         where l.run_id = $1 group by i.document_id, l.status`,
        [runId],
      );
      for (const r of links.rows) {
        const s = out.get(r.document_id);
        if (s) s.links[r.status] = Number(r.n);
      }
      const toCheck = await client.query<{ document_id: string; n: string }>(
        `select i.document_id, count(distinct l.item_id) as n
         from instrument_links l join instrument_items i on i.id = l.item_id
         where l.run_id = $1 and l.status = 'suggested' group by i.document_id`,
        [runId],
      );
      for (const r of toCheck.rows) {
        const s = out.get(r.document_id);
        if (s) s.itemsToCheck = Number(r.n);
      }
      const coverage = await client.query<{ detail: { documentId?: unknown; complete?: unknown; failedChunks?: unknown; incompleteItems?: unknown } }>(
        "select distinct on (detail->>'documentId') detail from trace where run_id=$1 and event='instrument_read_finished' order by detail->>'documentId', occurred_at desc, id desc", [runId],
      );
      for (const { detail } of coverage.rows) {
        if (typeof detail.documentId !== "string" || typeof detail.complete !== "boolean" || !Number.isInteger(detail.failedChunks) || !Number.isInteger(detail.incompleteItems)) continue;
        const summary = out.get(detail.documentId);
        if (summary) summary.readStatus = { complete: detail.complete, failedChunks: Number(detail.failedChunks), incompleteItems: Number(detail.incompleteItems) };
      }
      // A failed read counts when it is the latest attempt: a later finished read supersedes it.
      const failures = await client.query<{ detail: { documentId?: unknown; error?: unknown }; superseded: boolean }>(
        `select distinct on (f.detail->>'documentId') f.detail,
                exists (select 1 from trace t where t.run_id = f.run_id and t.event = 'instrument_read_finished'
                          and t.detail->>'documentId' = f.detail->>'documentId' and t.occurred_at >= f.occurred_at) as superseded
         from trace f where f.run_id = $1 and f.event = 'instrument_read_failed'
         order by f.detail->>'documentId', f.occurred_at desc, f.id desc`,
        [runId],
      );
      for (const { detail, superseded } of failures.rows) {
        if (superseded || typeof detail.documentId !== "string" || typeof detail.error !== "string") continue;
        const summary = out.get(detail.documentId);
        if (summary) summary.readFailure = detail.error;
      }
    });
  } catch {
    // Migration 0060 not applied yet: no instruments to show.
  }
  return out;
}

/**
 * Confirmed links for a data file, with each item's stated routing and answer
 * options, for the data quality check and the cross tab labels.
 */
export type ConfirmedItem = {
  itemId: string;
  variable: string;
  code: string | null;
  text: string;
  options: ItemOption[];
  routing: Routing | null;
  routingText: string | null;
  /** False for a high-confidence same-code suggestion, which is used only as a gate, never as a target. */
  confirmed: boolean;
};
export async function getConfirmedItemsForData(tenantId: string, runId: string, dataDocumentId: string): Promise<ConfirmedItem[]> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ variable: string; item_id: string; code: string | null; item_text: string; response_options: ItemOption[]; routing: Routing | null; routing_text: string | null; status: string }>(
        `select l.variable, i.id as item_id, i.code, i.item_text, i.response_options, i.routing, i.routing_text, l.status
         from instrument_links l join instrument_items i on i.id = l.item_id
         where l.run_id = $1 and l.data_document_id = $2
           and (l.status = 'confirmed' or (l.status = 'suggested' and l.method = 'code' and l.confidence >= 0.9))`,
        [runId, dataDocumentId],
      );
      return r.rows.map((x) => ({ itemId: x.item_id, variable: x.variable, code: x.code, text: x.item_text, options: x.response_options ?? [], routing: x.routing, routingText: x.routing_text, confirmed: x.status === "confirmed" }));
    });
  } catch {
    return [];
  }
}

/** Question wording and answer labels from the confirmed links of a data file, or null when there are none. */
export async function getLabelOverlay(tenantId: string, runId: string, dataDocumentId: string): Promise<LabelOverlay | null> {
  const items = (await getConfirmedItemsForData(tenantId, runId, dataDocumentId)).filter((i) => i.confirmed);
  if (items.length === 0) return null;
  return buildLabelOverlay(items.map((i) => ({ itemId: i.itemId, variable: i.variable, code: i.code, text: i.text, options: i.options })));
}


/** Raised when a variable is already confirmed for another question of the same data file. */
export class InstrumentLinkTakenError extends Error {}


/**
 * IR-04: the one rule every confirmation path follows (a hand-chosen variable, Confirm on a
 * suggestion, and Confirm on all strong same-code matches). A variable of a data file means one
 * question: it may be confirmed for a question only when no OTHER question of the same data file
 * already has it confirmed. Callers lock the data file's row first (lockDataDocuments), so two
 * confirmations for the same file are decided one after the other and cannot both pass this check.
 * Returns the message naming the question that already has the variable, or null when it is free.
 */
async function variableTakenBy(client: PoolClient, dataDocumentId: string, variable: string, itemId: string): Promise<string | null> {
  const other = await client.query<{ code: string | null; item_text: string }>(
    `select i.code, i.item_text from instrument_links l join instrument_items i on i.id = l.item_id
     where l.data_document_id = $1 and l.variable = $2 and l.status = 'confirmed' and l.item_id <> $3
     order by i.item_order limit 1`,
    [dataDocumentId, variable, itemId],
  );
  const q = other.rows[0];
  return q ? `${variable} is already confirmed for ${q.code ?? `"${q.item_text.slice(0, 60)}"`}. Reject that link first if it is wrong.` : null;
}

/** Locks the data files' rows in id order (the same order everywhere, so two callers cannot deadlock). */
async function lockDataDocuments(client: PoolClient, runId: string, dataDocumentIds: string[]): Promise<void> {
  const ids = [...new Set(dataDocumentIds)].sort();
  if (ids.length === 0) return;
  const r = await client.query("select id from documents where id = any($1::uuid[]) and run_id = $2 order by id for update", [ids, runId]);
  if ((r.rowCount ?? 0) !== ids.length) throw new Error("That data file is not in this project.");
}

/**
 * Sets one link's status (Confirm or Reject on the review table). Confirming goes through the
 * shared rule above with the data file locked; a variable taken by another question is refused with
 * that question named (InstrumentLinkTakenError) and nothing changes. Rejecting, or returning a link
 * to suggested, never conflicts. The link must belong to this project; repeating a status is a no-op.
 */
export async function setInstrumentLinkStatus(tenantId: string, runId: string, linkId: string, status: LinkStatus): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const found = await client.query<{ data_document_id: string }>("select data_document_id from instrument_links where id = $1 and run_id = $2", [linkId, runId]);
    if (!found.rows[0]) throw new Error("That link is not in this project.");
    if (status === "confirmed") {
      await lockDataDocuments(client, runId, [found.rows[0].data_document_id]);
      // Read again after the lock: the link may have changed while this request waited.
      const link = await client.query<{ item_id: string; variable: string; status: LinkStatus }>(
        "select item_id, variable, status from instrument_links where id = $1 and run_id = $2 for update",
        [linkId, runId],
      );
      const l = link.rows[0];
      if (!l) throw new Error("That link is not in this project.");
      if (l.status === "confirmed") return;
      const taken = await variableTakenBy(client, found.rows[0].data_document_id, l.variable, l.item_id);
      if (taken) throw new InstrumentLinkTakenError(taken);
    }
    await client.query("update instrument_links set status = $1 where id = $2 and run_id = $3", [status, linkId, runId]);
  });
}

/**
 * Confirms every suggested link of a questionnaire at or above the confidence given, through the
 * shared rule. A suggestion whose variable is already confirmed for another question, or that loses
 * to a stronger suggestion of the same variable in this batch, stays a suggestion and is returned in
 * `refused` with the reason, so the researcher decides it by hand. The rest are confirmed: one
 * conflict does not hold back every other strong match. Repeating it confirms nothing new.
 */
export async function confirmInstrumentLinks(
  tenantId: string,
  runId: string,
  instrumentId: string,
  minConfidence: number,
): Promise<{ confirmed: number; refused: { variable: string; reason: string }[] }> {
  return withTenant(tenantId, async (client) => {
    const inst = await client.query("select 1 from documents where id = $1 and run_id = $2 and kind = 'instrument'", [instrumentId, runId]);
    if (inst.rowCount !== 1) throw new Error("Questionnaire or guide not found for this run");
    const pending = async () =>
      (
        await client.query<{ id: string; item_id: string; data_document_id: string; variable: string }>(
          `select l.id, l.item_id, l.data_document_id, l.variable
           from instrument_links l join instrument_items i on i.id = l.item_id
           where l.run_id = $1 and i.document_id = $2 and l.status = 'suggested' and l.confidence >= $3
           order by l.confidence desc, i.item_order, l.id`,
          [runId, instrumentId, minConfidence],
        )
      ).rows;
    await lockDataDocuments(client, runId, (await pending()).map((c) => c.data_document_id));
    let confirmed = 0;
    const refused: { variable: string; reason: string }[] = [];
    // Read again under the locks, then decide in order of confidence: an earlier confirmation in
    // this batch counts as taken for the ones after it.
    for (const c of await pending()) {
      const taken = await variableTakenBy(client, c.data_document_id, c.variable, c.item_id);
      if (taken) {
        refused.push({ variable: c.variable, reason: taken });
        continue;
      }
      const r = await client.query("update instrument_links set status = 'confirmed' where id = $1 and status = 'suggested'", [c.id]);
      confirmed += r.rowCount ?? 0;
    }
    return { confirmed, refused };
  });
}

/**
 * Links a questionnaire question to a data file variable the researcher chose (Grant, 2026-10-20:
 * no way to pick a match by hand when matching found none, or the wrong one). The link is stored
 * confirmed, with method "manual" ("Chosen by you"), so matching again keeps it and does not
 * suggest that variable for another question.
 *
 * Checked, in one transaction: the question belongs to this questionnaire in this project; the data
 * file is a raw data file of this project; the variable is in that file's dictionary (read before the
 * transaction, as the dictionary is built from the stored file). The data file's row is locked first
 * (and must exist), so two choices for the same file are made one after the other: a variable already
 * confirmed for a different question is refused with that question named, never linked twice. The
 * same rule (variableTakenBy, under the same lock) governs Confirm on a suggestion and bulk Confirm.
 * Repeating the same choice (a retried request) confirms the same link and adds nothing.
 */
export async function chooseInstrumentLink(
  tenantId: string,
  runId: string,
  instrumentId: string,
  itemId: string,
  dataDocumentId: string,
  variable: string,
): Promise<{ linkId: string }> {
  const dictionary = await loadVariableDictionary(tenantId, runId, dataDocumentId);
  if (!dictionary.variables.some((v) => v.name === variable)) throw new Error(`${variable} is not a variable of this data file.`);
  return withTenant(tenantId, async (client) => {
    const doc = await client.query("select id from documents where id = $1 and run_id = $2 and kind = 'table' and ingestion_type = 'raw'", [dataDocumentId, runId]);
    if (doc.rowCount !== 1) throw new Error("That data file is not in this project.");
    await lockDataDocuments(client, runId, [dataDocumentId]);
    const item = await client.query("select 1 from instrument_items where id = $1 and document_id = $2 and run_id = $3", [itemId, instrumentId, runId]);
    if (item.rowCount !== 1) throw new Error("That question is not in this questionnaire.");
    const taken = await variableTakenBy(client, dataDocumentId, variable, itemId);
    if (taken) throw new InstrumentLinkTakenError(taken);
    const r = await client.query<{ id: string }>(
      `insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status)
       values ($1, $2, $3, $4, $5, 'manual', 1, 'confirmed')
       on conflict (item_id, data_document_id, variable) do update set method = 'manual', confidence = 1, status = 'confirmed'
       returning id`,
      [tenantId, runId, itemId, dataDocumentId, variable],
    );
    return { linkId: r.rows[0].id };
  });
}

/** Records that a read of a questionnaire or guide failed, with the reason shown to the researcher. */
export async function recordInstrumentReadFailure(tenantId: string, runId: string, documentId: string, error: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'instrument_read_failed',$3)", [tenantId, runId, JSON.stringify({ documentId, error: error.slice(0, 500) })]);
  });
}
