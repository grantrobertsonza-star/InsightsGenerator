import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant, withTenantRead } from "./db";
import type { PoolClient } from "pg";
import { extractDocumentText } from "./extractFindings";
import { loadVariableDictionary } from "./crosstabs";
import { codeFamily, codebookWordingMatches, matchItems, wordingIdentical, type ConfirmedCodebookEntry } from "./instrumentMatch";
import { parseRouting, type Routing } from "./routingParse";
import { deriveGotoRouting } from "./gotoRouting";
import { buildLabelOverlay, type LabelOverlay } from "./labelOverlay";
import { isPlainTableFileName } from "./parseTable";

// Questionnaires and interview guides: reading their items out, linking
// questionnaire items to a dataset's variables, and exposing the confirmed
// links to the rest of the app. Everything the model produces here is stored
// as a suggestion for the researcher to check.

export type InstrumentType = "questionnaire" | "interview_guide" | "focus_group_guide" | "codebook";
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
  method: "code" | "stem" | "wording" | "manual" | "codebook";
  confidence: number;
  status: LinkStatus;
  /** Batch 49, method 'codebook' only: the codebook entry's code it was linked through, and whether that
   * entry is still confirmed for the variable (false: the link no longer counts, and says so). */
  basisCode?: string | null;
  basisHolds?: boolean;
  /** B49-F01: why a link through the codebook no longer counts, when it does not: the entry is no longer
   * confirmed for the variable, or the wording is not identical under the current rule. */
  basisLapse?: "withdrawn" | "wording";
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

const CODEBOOK_SYSTEM =
  "You read part of a survey codebook (a data dictionary) and list its variables in the order they appear. " +
  "For each variable return: its variable name exactly as printed (for example Q12, party_reg, B3a_1) as the code; its label or question text as printed as the text; " +
  "its answer codes and their labels as code and label pairs (empty when it has none, for example a weight or an identifier); " +
  "routing_text null; and the section heading it sits under, or null. " +
  "When one entry names several variables (for example 'white, black, latino'), list each variable separately with the same text and options. " +
  "Do not invent variables, codes or labels.";

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

/** How many times a part that overflows the output budget is halved before it counts as failed. */
const MAX_SPLIT_DEPTH = 3;
/** Below this many characters a part is not split further. */
const MIN_SPLIT_CHARS = 1500;

/**
 * A part cut in two at the line nearest its middle (a page marker when there is one near it), so no
 * question is cut mid-line; each half keeps the page it starts on. Null when too short to split.
 */
function splitPart(chunk: { text: string; page: number }): { text: string; page: number }[] | null {
  const t = chunk.text;
  if (t.length < MIN_SPLIT_CHARS) return null;
  const mid = Math.floor(t.length / 2);
  const markers = [...t.matchAll(/\n\[page (\d+)\]\n/g)].map((m) => ({ at: m.index ?? 0, page: Number(m[1]) }));
  const nearMarker = markers.filter((m) => m.at > 0 && Math.abs(m.at - mid) < t.length / 4).sort((a, b) => Math.abs(a.at - mid) - Math.abs(b.at - mid))[0];
  let at = nearMarker?.at ?? t.lastIndexOf("\n", mid);
  if (at <= 0) at = t.indexOf("\n", mid);
  if (at <= 0 || at >= t.length - 1) return null;
  const before = markers.filter((m) => m.at <= at).pop();
  return [
    { text: t.slice(0, at), page: chunk.page },
    { text: t.slice(at), page: nearMarker?.page ?? before?.page ?? chunk.page },
  ];
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
 * RR-03: raised when a read finishes, or fails, after its claim lapsed and a newer read has claimed
 * the same document. Its results are discarded, so they cannot overwrite the newer read's, and it is not
 * recorded as a failure (a read is still under way, or has already finished, under the newer claim).
 */
export class InstrumentReadSupersededError extends InstrumentReadInFlightError {}

/**
 * IR-05: the paid read of a questionnaire or guide runs once at a time per document, across every
 * session and server instance, not only once per page. The claim is taken in one short transaction
 * that first locks the document's row (FOR UPDATE, and the row must exist in this project), so two
 * requests decide one after the other; the second sees the first's claim and is refused before any
 * model call. The claim itself is an 'instrument_read_started' trace row (no migration needed): it
 * stands until an 'instrument_read_finished' or 'instrument_read_released' row naming that claim's id
 * (detail.claimId), or until INSTRUMENT_READ_CLAIM_MINUTES pass, after which a read that crashed
 * without releasing can be retried. RR-03: a terminal row ends only its own claim, so a read that
 * outlived its claim cannot end the claim of the read that took over; and that late read writes
 * nothing (see the ownership check in readClaimedInstrument). A terminal row without a claimId (written
 * before this rule) ends nothing; the claim it belonged to lapses on time. The trace row is only the
 * record; the serialisation comes from the row lock.
 */
async function claimInstrumentRead(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<{ claimId: string; storage_path: string; source_filename: string; instrument_type: string | null }> {
  return withTenant(tenantId, async (client) => {
    const doc = await client.query<{ storage_path: string; source_filename: string; content_sha256: string | null; instrument_type: string | null }>(
      "select storage_path, source_filename, content_sha256, instrument_type from documents where id = $1 and run_id = $2 and kind = 'instrument' for update",
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
    return { claimId: claim.rows[0].id, storage_path: doc.rows[0].storage_path, source_filename: doc.rows[0].source_filename, instrument_type: doc.rows[0].instrument_type };
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
         where t.run_id = c.run_id and t.detail->>'documentId' = $2 and t.detail->>'claimId' = c.id::text
           and t.event in ('instrument_read_finished', 'instrument_read_released'))
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

/** True when a read of this document was claimed after `claimId`, so that claim no longer owns it (RR-03). */
async function claimSuperseded(client: PoolClient, runId: string, documentId: string, claimId: string): Promise<boolean> {
  const newer = await client.query(
    "select 1 from trace where run_id = $1 and event = 'instrument_read_started' and detail->>'documentId' = $2 and id > $3::bigint limit 1",
    [runId, documentId, claimId],
  );
  return (newer.rowCount ?? 0) > 0;
}

export async function readInstrumentItems(tenantId: string, runId: string, documentId: string): Promise<InstrumentReadResult> {
  const doc = await claimInstrumentRead(tenantId, runId, documentId);
  try {
    return await readClaimedInstrument(tenantId, runId, documentId, doc);
  } catch (e) {
    // Best effort: if even this write fails, the claim lapses after INSTRUMENT_READ_CLAIM_MINUTES.
    await releaseInstrumentRead(tenantId, runId, documentId, doc.claimId).catch(() => {});
    if (e instanceof InstrumentReadInFlightError) throw e;
    // RR-03: a read that failed after a newer read took over is not the document's read any more, so
    // its failure is not recorded on the card (it would show as the outcome while the newer read
    // runs). If ownership cannot be checked, the failure is reported as it is.
    const superseded = await withTenantRead(tenantId, (client) => claimSuperseded(client, runId, documentId, doc.claimId)).catch(() => false);
    if (superseded) {
      throw new InstrumentReadSupersededError(
        "This read failed after a newer read of the file had taken over. The newer read continues; nothing from this read was saved.",
        { cause: e },
      );
    }
    throw e;
  }
}

async function readClaimedInstrument(
  tenantId: string,
  runId: string,
  documentId: string,
  doc: { claimId: string; storage_path: string; source_filename: string; instrument_type: string | null },
): Promise<InstrumentReadResult> {
  // Codebooks and questionnaires come in tables too (Grant, 2026-10-26). A codebook table or JSON file
  // is read by the engine without the model; a spreadsheet questionnaire is read without it when it is
  // an XLSForm, and otherwise its sheets' text goes to the same model read as a Word or PDF file.
  const spreadsheet = isPlainTableFileName(doc.source_filename);
  let read: ReadRows;
  if (doc.instrument_type === "codebook" && (spreadsheet || /\.json$/i.test(doc.source_filename))) {
    read = await readCodebookTable(doc);
  } else if (spreadsheet) {
    const { runStatsTool } = await import("./parseStatsFile");
    const sheet = await runStatsTool<{ items?: EngineItem[]; text?: string }>("instrument_sheet", doc.storage_path, doc.source_filename, {});
    read = sheet.items ? rowsFromEngineItems(sheet.items) : await readItemsWithModel(tenantId, runId, documentId, doc, sheet.text ?? "");
  } else {
    read = await readItemsWithModel(tenantId, runId, documentId, doc);
  }
  const { rows } = read;
  if (rows.length === 0) throw new Error(doc.instrument_type === "codebook" ? "No variables were found in this codebook." : "No question items were found in this file.");
  // An invalid item or a truncated option list means something the model actually reported
  // was lost or cut short, not that the document legitimately has no more to give - the same
  // "better a stale item than a silently destroyed confirmed link" reasoning the chunk-level
  // failure already gets, so it folds into the same `complete` flag the deletion below relies on.
  const truncatedOptionItems = read.truncatedOptionItems + (read.unreadOptionItems ?? 0);
  const complete = read.failedChunks === 0 && read.invalidItems === 0 && truncatedOptionItems === 0;
  const failedChunks = read.failedChunks;
  const invalidItems = read.invalidItems;
  return storeInstrumentRows(tenantId, runId, documentId, doc, rows, { complete, failedChunks, invalidItems, truncatedOptionItems });
}

type ReadRow = {
  section: string | null;
  code: string | null;
  text: string;
  options: ItemOption[];
  routingText: string | null;
  routing: Routing | null;
  page: number | null;
  /** IMP-012: this row's own options list was truncated - see the write loop below, which
   * uses it to avoid overwriting an existing, previously-complete item with this partial one. */
  truncated: boolean;
};
/** unreadOptionItems: engine-read items whose answer list was written but could not be read (IS-F04). */
type ReadRows = { rows: ReadRow[]; failedChunks: number; invalidItems: number; truncatedOptionItems: number; unreadOptionItems?: number };

/**
 * A codebook laid out as a table (CSV, text or Excel), read by the engine without the model
 * (codebook_items in api/parse-stats-file.py): each variable becomes an item whose code is the
 * variable name, so it links to the data file's variable of that name. Its text is the codebook's
 * label (or the name when it has none); its options are the answer codes and labels.
 */
type EngineItem = {
  variable: string;
  label: string;
  options: { code: string; label: string }[];
  section: string | null;
  routing?: string | null;
  /** The answer list as written when the engine could not read it ("=Yes", "1=Yes 2=No"); IS-F04. */
  unreadValues?: string | null;
};

/** Engine-read items as rows: the code is the variable name, so each links to the data column of that name. */
function rowsFromEngineItems(items: EngineItem[]): ReadRows {
  let truncatedOptionItems = 0;
  let unreadOptionItems = 0;
  const rows: ReadRow[] = items.map((it) => {
    const { options, truncated: cut } = cleanOptions(it.options);
    if (cut) truncatedOptionItems += 1;
    // An answer list the engine could not read leaves the item's options incomplete, as a cut list does:
    // the read is not complete, and the item does not replace an earlier complete reading of it.
    const unread = typeof it.unreadValues === "string" && it.unreadValues.length > 0;
    if (unread && !cut) unreadOptionItems += 1;
    const truncated = cut || unread;
    return {
      section: it.section,
      code: it.variable,
      text: it.label?.trim() || it.variable,
      options,
      // An XLSForm "relevant" expression is kept as written; it is not in the skip-instruction
      // language parseRouting reads, so no routing is derived from it.
      routingText: it.routing ?? null,
      routing: null,
      page: null,
      truncated,
    };
  });
  return { rows, failedChunks: 0, invalidItems: 0, truncatedOptionItems, unreadOptionItems };
}

/**
 * A codebook laid out as a table (CSV, text, Excel) or written as JSON, read by the engine without the
 * model (codebook_items in api/parse-stats-file.py): each variable becomes an item whose code is the
 * variable name, its text the codebook's label (the name when it has none), its options the answer
 * codes and labels.
 */
async function readCodebookTable(doc: { storage_path: string; source_filename: string }): Promise<ReadRows> {
  const { runStatsTool } = await import("./parseStatsFile");
  const result = await runStatsTool<{ items: EngineItem[] }>("codebook", doc.storage_path, doc.source_filename, {});
  return rowsFromEngineItems(result.items);
}

async function readItemsWithModel(
  tenantId: string,
  runId: string,
  documentId: string,
  doc: { storage_path: string; source_filename: string; instrument_type: string | null },
  /** Text already read from the file (a spreadsheet's sheets); otherwise the document is read here. */
  givenText?: string,
): Promise<ReadRows> {
  const extracted = givenText !== undefined ? { pages: [], fullText: givenText } : await extractDocumentText(doc.storage_path, doc.source_filename, documentId);
  const pages = extracted.pages.length > 0 ? extracted.pages : splitText(extracted.fullText);
  const allChunks = chunkPages(pages);
  const chunks = allChunks.slice(0, MAX_CHUNKS);
  if (chunks.length === 0) throw new Error("No text could be read from this file. A scanned PDF may need to be converted to text first.");

  // IMP-012: a document with more than MAX_CHUNKS chunks used to have the extra ones simply
  // never requested, with nothing distinguishing that from a shorter document that was read
  // in full - the same silent-truncation shape as a chunk whose model call actually failed,
  // so it is counted the same way here, not as a separate, unreported kind of gap.
  let failedChunks = Math.max(0, allChunks.length - MAX_CHUNKS);
  // Why parts failed, for the message when none could be read (a read where every part failed used to
  // say "No question items were found in this file", the same as a file with no questions).
  const failures: string[] = [];
  const readPart = async (chunk: { text: string; page: number }, depth: number): Promise<(RawItem & { page: number })[]> => {
    try {
      const response = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8000,
        system: doc.instrument_type === "codebook" ? CODEBOOK_SYSTEM : SYSTEM,
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
      // true content past that point was never generated at all. So it is never used as it is.
      // A questionnaire dense with answer lists (a ballot of 61 candidates, say) can need more
      // output than the budget for one part, so the part is read again in two halves, down to
      // MAX_SPLIT_DEPTH; only a half that still overflows is counted as failed.
      if (response.stop_reason === "max_tokens") {
        const halves = depth < MAX_SPLIT_DEPTH ? splitPart(chunk) : null;
        if (halves) return (await Promise.all(halves.map((h) => readPart(h, depth + 1)))).flat();
        failedChunks += 1;
        failures.push("a part of the file had more questions and answers than one read can return");
        return [];
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
        failures.push("the reader returned no usable answer for a part of the file");
        return [];
      }
      const items = (tool.input as { items: RawItem[] }).items;
      return items.map((i) => ({ ...i, page: chunk.page }));
    } catch (e) {
      failedChunks += 1;
      failures.push(e instanceof Error ? e.message : String(e));
      return [];
    }
  };
  const found = await mapWithConcurrency(chunks, 3, (chunk) => readPart(chunk, 0));
  if (found.every((f) => f.length === 0) && failedChunks > 0) {
    const reasons = Array.from(new Set(failures)).slice(0, 2).join("; ");
    throw new Error(`None of this file could be read: ${failedChunks} of its parts failed (${reasons}). Nothing was saved; use Read to try again.`);
  }
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
  const rows: ReadRow[] = [];
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
  return { rows, failedChunks, invalidItems, truncatedOptionItems };
}

/** Writes a read's items, keeping the identity (and so the links) of every item that is still there. */
async function storeInstrumentRows(
  tenantId: string,
  runId: string,
  documentId: string,
  doc: { claimId: string },
  rows: ReadRow[],
  { complete, failedChunks, invalidItems, truncatedOptionItems }: { complete: boolean; failedChunks: number; invalidItems: number; truncatedOptionItems: number },
): Promise<InstrumentReadResult> {
  // Jumps printed on answer options ("No: GO TO Q10") skip the items between.
  const derived = deriveGotoRouting(rows.map((r) => ({ code: r.code, routing: r.routing, options: r.options })));
  rows.forEach((r, i) => {
    r.routing = derived[i];
  });

  const itemKey = (code: string | null, text: string) => `${(code ?? "").toLowerCase()}|${text.toLowerCase().slice(0, 80)}`;

  const count = await withTenant(tenantId, async (client) => {
    // RR-03: the results are written only while this read still owns the document. The same row lock
    // the claim is taken under serialises this check with a newer claim: either the newer read claimed
    // first (seen here, so nothing is written), or it claims after this commit and its own results
    // replace these. The lock query must find the row, so a document deleted meanwhile is refused.
    const owner = await client.query("select id from documents where id = $1 and run_id = $2 for update", [documentId, runId]);
    if (owner.rowCount !== 1) throw new Error("Questionnaire or guide not found for this run");
    if (await claimSuperseded(client, runId, documentId, doc.claimId)) {
      throw new InstrumentReadSupersededError(
        "This read took too long and a newer read of the file has taken over. Its results are kept instead; nothing from this read was saved.",
      );
    }
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

/**
 * Suggests links between an instrument's items and a data file's variables. Confirmed and rejected links
 * are kept.
 *
 * Batch 49 (Grant, 27 October 2026): for a questionnaire, a question worded identically to a codebook
 * entry the researcher has confirmed for a variable of this data file (codebookWordingMatches) is linked
 * to that variable through the codebook: method 'codebook', confirmed, with the codebook entry as its
 * basis. It counts as confirmed only while that entry stays confirmed for the variable
 * (getConfirmedItemsForData). A link the researcher already confirmed or rejected is never overwritten;
 * only a suggestion is upgraded. Before migration 0125 nothing is linked this way and
 * `codebookUnavailable` says so.
 */
export async function suggestInstrumentLinks(
  tenantId: string,
  runId: string,
  instrumentId: string,
  dataDocumentId: string,
): Promise<{ suggested: number; fromCodebook: number; codebookUnavailable: boolean }> {
  const dictionary = await loadVariableDictionary(tenantId, runId, dataDocumentId);
  let suggestedNew = 0;
  let fromCodebook = 0;
  let codebookUnavailable = false;
  await withTenant(tenantId, async (client) => {
    // IS-F03: both files are locked and checked as active files of this project before anything is
    // deleted or written, and the questions are read here, from this project only, under the lock.
    const { instrumentType } = await lockLinkDocuments(client, tenantId, runId, instrumentId, [dataDocumentId]);
    const items = (
      await client.query<{ id: string; code: string | null; item_text: string }>(
        "select id, code, item_text from instrument_items where document_id = $1 and run_id = $2 order by item_order",
        [instrumentId, runId],
      )
    ).rows.map((i) => ({ id: i.id, code: i.code, text: i.item_text }));
    const candidates = matchItems(items, dictionary.variables.map((v) => ({ name: v.name, label: v.label })));
    await client.query(
      `delete from instrument_links where status = 'suggested' and data_document_id = $2
         and item_id in (select id from instrument_items where document_id = $1)`,
      [instrumentId, dataDocumentId],
    );
    // A variable the researcher has already confirmed for a question of THIS document (by hand or by
    // confirming a suggestion) is not suggested again for a different question of it: matching again
    // must not put a second claim on a decision already made (Grant, 2026-10-20, with manual
    // matching). A confirmation from another document (a codebook beside a questionnaire) is that
    // document's own decision and does not stop this one being suggested (LBL-01, 2026-10-26).
    const taken = new Map(
      (
        await client.query<{ variable: string; item_id: string }>(
          `select l.variable, l.item_id from instrument_links l join instrument_items i on i.id = l.item_id
           where l.data_document_id = $1 and l.status = 'confirmed' and i.document_id = $2`,
          [dataDocumentId, instrumentId],
        )
      ).rows.map((r) => [r.variable, r.item_id]),
    );
    if (instrumentType !== "codebook") {
      if (!(await codebookLinksAvailable(client))) {
        codebookUnavailable = true;
      } else {
        const entries = (
          await client.query<{ variable: string; item_id: string; code: string | null; item_text: string }>(
            `select l.variable, i.id as item_id, i.code, i.item_text
               from instrument_links l join instrument_items i on i.id = l.item_id join documents d on d.id = i.document_id
              where l.run_id = $1 and l.data_document_id = $2 and l.status = 'confirmed' and d.instrument_type = 'codebook' and d.id <> $3
                and ${LINK_ENDS_ACTIVE("l")}`,
            [runId, dataDocumentId, instrumentId],
          )
        ).rows.map((r): ConfirmedCodebookEntry => ({ variable: r.variable, itemId: r.item_id, code: r.code, text: r.item_text }));
        const matches = codebookWordingMatches(items, entries);
        // B49-F01: a link through the codebook made by the first wording rule that the current rule does not
        // support goes back to an ordinary suggestion for the researcher to check. Only links the matcher
        // made (method 'codebook') are touched; a link the researcher chose, confirmed or rejected is not.
        const supported = new Set(matches.map((m) => `${m.itemId}|${m.variable}`));
        const made = await client.query<{ id: string; item_id: string; variable: string }>(
          `select l.id, l.item_id, l.variable from instrument_links l join instrument_items i on i.id = l.item_id
            where i.document_id = $1 and l.data_document_id = $2 and l.method = 'codebook' and l.status = 'confirmed'`,
          [instrumentId, dataDocumentId],
        );
        for (const l of made.rows) {
          if (supported.has(`${l.item_id}|${l.variable}`)) continue;
          await client.query("update instrument_links set method = 'wording', confidence = 0.85, status = 'suggested', basis_item_id = null where id = $1 and method = 'codebook'", [l.id]);
          if (taken.get(l.variable) === l.item_id) taken.delete(l.variable);
        }
        for (const m of matches) {
          if (taken.has(m.variable) && taken.get(m.variable) !== m.itemId) continue;
          // Upgrades a suggestion for the same pair; a link the researcher confirmed or rejected stays as it is.
          const r = await client.query(
            `insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status, basis_item_id)
             values ($1,$2,$3,$4,$5,'codebook',1,'confirmed',$6)
             on conflict (item_id, data_document_id, variable) do update
               set method = 'codebook', confidence = 1, status = 'confirmed', basis_item_id = excluded.basis_item_id
               where instrument_links.status = 'suggested'`,
            [tenantId, runId, m.itemId, dataDocumentId, m.variable, m.basisItemId],
          );
          if (r.rowCount) {
            fromCodebook += 1;
            taken.set(m.variable, m.itemId);
          }
        }
      }
    }
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
    const target = await client.query("update documents set instrument_for = $1 where id = $2 and run_id = $3 and tenant_id = $4 and kind = 'instrument'", [dataDocumentId, instrumentId, runId, tenantId]);
    if (target.rowCount !== 1) throw new Error("That questionnaire or codebook is not in this project. Nothing was changed.");
  });
  return { suggested: suggestedNew, fromCodebook, codebookUnavailable };
}

/**
 * Which data file a questionnaire or codebook should be matched to when nobody has said (Grant,
 * 27 October 2026: "how does the system know which data file to link them to?"). The file it was
 * matched to before, while it is still a raw data file of the project; else the only raw data file;
 * else the file whose variables match the most of its questions, when that lead is clear. Several
 * waves of one tracker usually share a questionnaire and match it equally, and a file whose variables
 * cannot be read cannot be compared: both are "choose", with every file's count, never a guess.
 * Read only; matching is suggestInstrumentLinks.
 */
export type MatchTargetChoice =
  | { kind: "chosen"; dataDocumentId: string; reason: "before" | "only" | "best"; matched: number | null }
  | { kind: "choose"; candidates: { dataDocumentId: string; filename: string; matched: number | null; error?: string }[] }
  | { kind: "none" };

/** A lead counts as clear when it is at least this many questions and this share ahead of the next file. */
const CLEAR_LEAD_ITEMS = 3;
const CLEAR_LEAD_RATIO = 1.25;

export async function chooseMatchTarget(tenantId: string, runId: string, instrumentId: string): Promise<MatchTargetChoice> {
  const { files, before } = await withTenantRead(tenantId, async (client) => {
    const doc = await client.query<{ instrument_for: string | null }>(
      "select instrument_for from documents where id = $1 and run_id = $2 and kind = 'instrument' and removed_at is null",
      [instrumentId, runId],
    );
    if (doc.rows.length === 0) throw new Error("That questionnaire or codebook is not in this project.");
    const raw = await client.query<{ id: string; source_filename: string }>(
      "select id, source_filename from documents where run_id = $1 and kind = 'table' and ingestion_type = 'raw' order by uploaded_at, id",
      [runId],
    );
    return { files: raw.rows, before: doc.rows[0].instrument_for };
  });
  if (files.length === 0) return { kind: "none" };
  if (before && files.some((f) => f.id === before)) return { kind: "chosen", dataDocumentId: before, reason: "before", matched: null };
  if (files.length === 1) return { kind: "chosen", dataDocumentId: files[0].id, reason: "only", matched: null };
  const items = (await getInstrumentItems(tenantId, instrumentId)).map((i) => ({ id: i.id, code: i.code, text: i.text }));
  const scored = await mapWithConcurrency(files, 2, async (f) => {
    try {
      const dictionary = await loadVariableDictionary(tenantId, runId, f.id);
      const matched = new Set(matchItems(items, dictionary.variables.map((v) => ({ name: v.name, label: v.label }))).map((c) => c.itemId)).size;
      return { dataDocumentId: f.id, filename: f.source_filename, matched };
    } catch (e) {
      return { dataDocumentId: f.id, filename: f.source_filename, matched: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const known = scored.filter((s): s is typeof s & { matched: number } => s.matched !== null).sort((a, b) => b.matched - a.matched);
  const [best, second] = known;
  const clear =
    known.length === scored.length &&
    best !== undefined &&
    best.matched > 0 &&
    (second === undefined || (best.matched - second.matched >= CLEAR_LEAD_ITEMS && best.matched >= second.matched * CLEAR_LEAD_RATIO));
  if (clear) return { kind: "chosen", dataDocumentId: best.dataDocumentId, reason: "best", matched: best.matched };
  return { kind: "choose", candidates: scored };
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

/**
 * Batch 49: SQL true when link `alias` is not a link through the codebook, or its codebook entry (the
 * basis) is still confirmed for the same variable of the same data file. A deleted basis (set null) is
 * not confirmed. Only for databases with migration 0125 (codebookLinksAvailable).
 */
export const CODEBOOK_BASIS_HOLDS = (alias: string) =>
  `(${alias}.method <> 'codebook' or exists (select 1 from instrument_links b where b.item_id = ${alias}.basis_item_id and b.data_document_id = ${alias}.data_document_id and b.variable = ${alias}.variable and b.status = 'confirmed' and ${LINK_ENDS_ACTIVE("b")}))`;

/**
 * IS-F03 (Codex import stress review, 27 October 2026): a link counts only while both its ends are
 * active files of the link's own project: the question's questionnaire or codebook (and the question
 * itself) and the data file, neither in the bin. A codebook from another project, or one removed to
 * the bin, could be matched and confirmed for the active file through a stale or crafted request, and
 * its meanings then changed bases (Codex: base 4 became 2). The one rule for every reader of link
 * meanings (getConfirmedItemsForData, and a codebook link's basis); the writes refuse such a link
 * under lockLinkDocuments. Removing a file to the bin moves its links with it (documentBin), so a
 * restored pair counts again with no further step.
 */
export const LINK_ENDS_ACTIVE = (l: string) =>
  `(exists (select 1 from instrument_items si join documents sd on sd.id = si.document_id
             where si.id = ${l}.item_id and si.run_id = ${l}.run_id and sd.run_id = ${l}.run_id and sd.kind = 'instrument' and sd.removed_at is null)
    and exists (select 1 from documents dd where dd.id = ${l}.data_document_id and dd.run_id = ${l}.run_id and dd.kind = 'table' and dd.removed_at is null))`;

/**
 * IS-F03: locks, in id order (the same order everywhere, so two callers cannot deadlock), the
 * questionnaire or codebook and the data files a link write touches, and checks under the lock that
 * each is an active file of this project: the instrument a questionnaire or codebook, each data file a
 * raw data file, none in the bin. A file removed meanwhile (removal moves it to the bin under the same
 * row lock) or from another project is refused and nothing is written. Returns the instrument's type.
 */
async function lockLinkDocuments(
  client: PoolClient,
  tenantId: string,
  runId: string,
  instrumentId: string | null,
  dataDocumentIds: string[],
): Promise<{ instrumentType: string | null }> {
  const data = [...new Set(dataDocumentIds)];
  const ids = [...new Set([...(instrumentId ? [instrumentId] : []), ...data])].sort();
  const r = await client.query<{ id: string; kind: string; ingestion_type: string | null; instrument_type: string | null }>(
    `select id, kind, ingestion_type, instrument_type from documents
      where id = any($1::uuid[]) and run_id = $2 and tenant_id = $3 and removed_at is null
      order by id for update`,
    [ids, runId, tenantId],
  );
  const found = new Map(r.rows.map((x) => [x.id, x]));
  if (instrumentId && found.get(instrumentId)?.kind !== "instrument") {
    throw new Error("That questionnaire or codebook is not in this project: it may have been removed to the bin. Nothing was changed.");
  }
  for (const id of data) {
    const d = found.get(id);
    if (d?.kind !== "table" || d.ingestion_type !== "raw") throw new Error("That data file is not in this project: it may have been removed to the bin. Nothing was changed.");
  }
  return { instrumentType: instrumentId ? (found.get(instrumentId)!.instrument_type ?? null) : null };
}

/** Whether migration 0125 (links through the codebook) is applied; checked, never assumed. */
async function codebookLinksAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    `select exists (select 1 from information_schema.columns where table_name = 'instrument_links' and column_name = 'basis_item_id') as ok`,
  );
  return r.rows[0]?.ok === true;
}

/** A link through the codebook counts while its entry is still confirmed for the variable and the wording is
 * still identical under the current rule (wordingIdentical); otherwise it says which no longer holds. */
function codebookBasis(x: { basis_code: string | null; basis_holds: boolean | null; basis_text: string | null; item_code: string | null; item_text: string }): Pick<InstrumentLink, "basisCode" | "basisHolds" | "basisLapse"> {
  if (x.basis_holds !== true) return { basisCode: x.basis_code, basisHolds: false, basisLapse: "withdrawn" };
  if (x.basis_text === null || !wordingIdentical({ text: x.item_text, code: x.item_code }, { text: x.basis_text, code: x.basis_code })) {
    return { basisCode: x.basis_code, basisHolds: false, basisLapse: "wording" };
  }
  return { basisCode: x.basis_code, basisHolds: true };
}

export async function getInstrumentLinks(tenantId: string, instrumentId: string): Promise<InstrumentLink[]> {
  return withTenantRead(tenantId, async (client) => {
    const withBasis = await codebookLinksAvailable(client);
    const r = await client.query<{
      id: string; item_id: string; data_document_id: string; variable: string;
      method: InstrumentLink["method"]; confidence: string; status: LinkStatus; basis_code: string | null; basis_holds: boolean | null;
      item_code: string | null; item_text: string; basis_text: string | null;
    }>(
      `select l.id, l.item_id, l.data_document_id, l.variable, l.method, l.confidence, l.status,
              i.code as item_code, i.item_text,
              ${withBasis ? `(select bi.code from instrument_items bi where bi.id = l.basis_item_id) as basis_code, (select bi.item_text from instrument_items bi where bi.id = l.basis_item_id) as basis_text, ${CODEBOOK_BASIS_HOLDS("l")} as basis_holds` : "null::text as basis_code, null::text as basis_text, null::boolean as basis_holds"}
       from instrument_links l join instrument_items i on i.id = l.item_id
       where i.document_id = $1 order by i.item_order, l.confidence desc`,
      [instrumentId],
    );
    return r.rows.map((x) => ({
      id: x.id, itemId: x.item_id, dataDocumentId: x.data_document_id, variable: x.variable,
      method: x.method, confidence: Number(x.confidence), status: x.status,
      ...(x.method === "codebook" ? codebookBasis(x) : {}),
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
  /** The data files it has suggested or confirmed links to (several waves can share one questionnaire), oldest upload first. */
  linkedDataDocumentIds: string[];
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
          linkedDataDocumentIds: [],
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
      // Linked means a suggested or confirmed link exists for that file, not that it is the default target.
      const linkedFiles = await client.query<{ document_id: string; data_document_id: string }>(
        `select i.document_id, l.data_document_id
         from instrument_links l join instrument_items i on i.id = l.item_id join documents d on d.id = l.data_document_id
         where l.run_id = $1 and l.status in ('suggested', 'confirmed')
         group by i.document_id, l.data_document_id, d.uploaded_at order by d.uploaded_at, l.data_document_id`,
        [runId],
      );
      for (const r of linkedFiles.rows) out.get(r.document_id)?.linkedDataDocumentIds.push(r.data_document_id);
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
  /** The codebook or questionnaire the item comes from, so labels can follow LABEL_SOURCE_ORDER. */
  documentId: string;
  instrumentType: string | null;
};
export async function getConfirmedItemsForData(tenantId: string, runId: string, dataDocumentId: string): Promise<ConfirmedItem[]> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      // Batch 49: a link made through the codebook (method 'codebook') stands only while the codebook
      // entry it relied on is still confirmed for the same variable of this data file; otherwise it is
      // not used, neither as a meaning nor as a gate (CODEBOOK_BASIS_HOLDS). Before migration 0125 there
      // are no such links and the column is absent, so the condition is left out.
      const withBasis = await codebookLinksAvailable(client);
      const basisHolds = withBasis ? `and ${CODEBOOK_BASIS_HOLDS("l")}` : "";
      // Ordered so every reader that takes the first item per variable or code takes it from the
      // strongest source: confirmed before suggested, then a codebook before a questionnaire
      // (labelSourceRank), then the earlier document, then the question's order in it.
      const r = await client.query<{ variable: string; item_id: string; code: string | null; item_text: string; response_options: ItemOption[]; routing: Routing | null; routing_text: string | null; status: string; document_id: string; instrument_type: string | null; method: string; basis_code: string | null; basis_text: string | null }>(
        `select l.variable, i.id as item_id, i.code, i.item_text, i.response_options, i.routing, i.routing_text, l.status,
                i.document_id, d.instrument_type, l.method,
                ${withBasis ? "(select bi.code from instrument_items bi where bi.id = l.basis_item_id) as basis_code, (select bi.item_text from instrument_items bi where bi.id = l.basis_item_id) as basis_text" : "null::text as basis_code, null::text as basis_text"}
         from instrument_links l join instrument_items i on i.id = l.item_id join documents d on d.id = i.document_id
         where l.run_id = $1 and l.data_document_id = $2
           and (l.status = 'confirmed' or (l.status = 'suggested' and l.method = 'code' and l.confidence >= 0.9))
           and ${LINK_ENDS_ACTIVE("l")}
           ${basisHolds}
         order by (l.status = 'confirmed') desc, case d.instrument_type when 'codebook' then 0 when 'questionnaire' then 1 else 2 end,
                  d.uploaded_at, d.id, i.item_order, l.variable`,
        [runId, dataDocumentId],
      );
      // B49-F01: a link through the codebook counts only while the wording is still identical under the
      // current rule, so one made by the first rule for different questions is not used ("< 5000" vs "> 5000").
      return r.rows
        .filter((x) => x.method !== "codebook" || (x.basis_text !== null && wordingIdentical({ text: x.item_text, code: x.code }, { text: x.basis_text, code: x.basis_code })))
        .map((x) => ({ itemId: x.item_id, variable: x.variable, code: x.code, text: x.item_text, options: x.response_options ?? [], routing: x.routing, routingText: x.routing_text, confirmed: x.status === "confirmed", documentId: x.document_id, instrumentType: x.instrument_type }));
    });
  } catch (e) {
    // GTR-01: an undefined table or column alone does not show that this database has no
    // questionnaire links. Only a database where the questionnaire feature was never installed (both
    // tables of migration 0060 absent, positively checked) supports "the file's own labels stand".
    // When either table exists, a missing column (for example routing_text renamed away) or a missing
    // dependent object is schema drift over links that may well be confirmed, so it refuses like any
    // other failed read; no compatibility query drops routing while keeping labels.
    if (isMissingInstrumentSchema(e) && (await questionnaireSchemaAbsent(tenantId))) return [];
    // GT100-F01: anything else (a permission, connection or query failure, or schema drift) means
    // the confirmed meaning may exist but could not be read. Returning [] here used to look exactly
    // like "no confirmed links", so a table was computed with the file's own labels and missing
    // codes: a confirmed "Don't know" became a valid answer and changed bases and percentages.
    throw new InstrumentMeaningUnavailableError(INSTRUMENT_MEANING_UNAVAILABLE, { cause: e });
  }
}

/**
 * GTR-01: true only when neither questionnaire table exists (a database before migration 0060).
 * A failed check is not an answer, so it refuses rather than treating the schema as absent.
 */
async function questionnaireSchemaAbsent(tenantId: string): Promise<boolean> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ absent: boolean }>(
        "select to_regclass('instrument_links') is null and to_regclass('instrument_items') is null as absent",
      );
      return r.rows[0]?.absent === true;
    });
  } catch (e) {
    throw new InstrumentMeaningUnavailableError(INSTRUMENT_MEANING_UNAVAILABLE, { cause: e });
  }
}

/**
 * GT100-F01: the one failure for "the confirmed questionnaire links of this data file could not be
 * read". Confirmed links define answer labels, which codes mean Don't know, and stated routing, so
 * every calculation that would use them refuses instead of proceeding without them. Nothing is
 * written and no confirmed link is changed; trying again reads them afresh.
 */
export class InstrumentMeaningUnavailableError extends Error {}
export const INSTRUMENT_MEANING_UNAVAILABLE =
  "The confirmed questionnaire labels could not be read, so this was not calculated: answer meanings and Don't know codes would be wrong. Try again.";

/** undefined_table (42P01) or undefined_column (42703): possibly an old schema, confirmed by questionnaireSchemaAbsent. */
function isMissingInstrumentSchema(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "42703";
}

/** Question wording and answer labels from the confirmed links of a data file, or null when there are none. */
export async function getLabelOverlay(tenantId: string, runId: string, dataDocumentId: string): Promise<LabelOverlay | null> {
  const items = (await getConfirmedItemsForData(tenantId, runId, dataDocumentId)).filter((i) => i.confirmed);
  if (items.length === 0) return null;
  return buildLabelOverlay(items.map((i) => ({ itemId: i.itemId, variable: i.variable, code: i.code, text: i.text, options: i.options, source: { documentId: i.documentId, instrumentType: i.instrumentType } })));
}


/** Raised when a variable is already confirmed for another question of the same document and data file. */
export class InstrumentLinkTakenError extends Error {}


/**
 * IR-04: the one rule every confirmation path follows (a hand-chosen variable, Confirm on a
 * suggestion, and Confirm on all strong same-code matches). Within one document, a variable of a
 * data file means one question: it may be confirmed for a question only when no OTHER question of
 * the same document already has it confirmed for that data file. Different documents decide
 * separately (LBL-01, 2026-10-26): a codebook entry and a questionnaire question both describe a
 * variable, and refusing the second document's confirmation would leave either its wording or the
 * codebook's labels unusable. Which document's labels apply is decided when the labels are built
 * (labelOverlay.ts, codebook before questionnaire), not here. Callers lock the data file's row first (lockLinkDocuments), so two
 * confirmations for the same file are decided one after the other and cannot both pass this check.
 * Returns the message naming the question that already has the variable, or null when it is free.
 */
async function variableTakenBy(client: PoolClient, dataDocumentId: string, variable: string, itemId: string): Promise<string | null> {
  const other = await client.query<{ code: string | null; item_text: string }>(
    `select i.code, i.item_text from instrument_links l join instrument_items i on i.id = l.item_id
     where l.data_document_id = $1 and l.variable = $2 and l.status = 'confirmed' and l.item_id <> $3
       and i.document_id = (select document_id from instrument_items where id = $3)
     order by i.item_order limit 1`,
    [dataDocumentId, variable, itemId],
  );
  const q = other.rows[0];
  return q ? `${variable} is already confirmed for ${q.code ?? `"${q.item_text.slice(0, 60)}"`}. Reject that link first if it is wrong.` : null;
}

/**
 * Sets one link's status (Confirm or Reject on the review table). Confirming goes through the
 * shared rule above with the data file locked; a variable taken by another question is refused with
 * that question named (InstrumentLinkTakenError) and nothing changes. Rejecting, or returning a link
 * to suggested, never conflicts. The link must belong to this project; repeating a status is a no-op.
 */
export async function setInstrumentLinkStatus(tenantId: string, runId: string, linkId: string, status: LinkStatus): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const found = await client.query<{ data_document_id: string; instrument_id: string | null }>(
      `select l.data_document_id, (select i.document_id from instrument_items i where i.id = l.item_id and i.run_id = l.run_id) as instrument_id
         from instrument_links l where l.id = $1 and l.run_id = $2`,
      [linkId, runId],
    );
    if (!found.rows[0]) throw new Error("That link is not in this project.");
    if (status === "confirmed") {
      // IS-F03: confirming needs both ends active in this project, checked under their locks: a
      // question from another project's codebook, or one in the bin, is never confirmed for this file.
      if (!found.rows[0].instrument_id) throw new Error("That link's question is not in this project: its codebook or questionnaire may have been removed. Nothing was changed.");
      await lockLinkDocuments(client, tenantId, runId, found.rows[0].instrument_id, [found.rows[0].data_document_id]);
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
    const pending = async () =>
      (
        await client.query<{ id: string; item_id: string; data_document_id: string; variable: string }>(
          `select l.id, l.item_id, l.data_document_id, l.variable
           from instrument_links l join instrument_items i on i.id = l.item_id
           where l.run_id = $1 and i.run_id = $1 and i.document_id = $2 and l.status = 'suggested' and l.confidence >= $3
           order by l.confidence desc, i.item_order, l.id`,
          [runId, instrumentId, minConfidence],
        )
      ).rows;
    // IS-F03: the questionnaire and every data file are locked and checked as active files of this
    // project before any link is confirmed; one removed meanwhile refuses the whole batch.
    await lockLinkDocuments(client, tenantId, runId, instrumentId, (await pending()).map((c) => c.data_document_id));
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
    await lockLinkDocuments(client, tenantId, runId, instrumentId, [dataDocumentId]);
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

/**
 * "Link all" in the manual picker: links a question to every variable of its multiple-response
 * family (codeFamily, the matcher's own rule: the question's code, a separator, a suffix), each
 * confirmed as chosen by the researcher, in one transaction under the data file's lock. A member
 * already confirmed for another question is left alone and returned in `refused` with that
 * question named, as bulk Confirm does; a member the researcher rejected for this question stays
 * rejected (choosing all is not a decision about one they turned down). `variable` is the member
 * the researcher picked: it must belong to the family, so a stale or crafted request cannot link a
 * different set. Repeating it confirms nothing new.
 */
export async function chooseInstrumentLinkFamily(
  tenantId: string,
  runId: string,
  instrumentId: string,
  itemId: string,
  dataDocumentId: string,
  variable: string,
): Promise<{ linked: number; refused: { variable: string; reason: string }[]; family: string[] }> {
  const dictionary = await loadVariableDictionary(tenantId, runId, dataDocumentId);
  const names = dictionary.variables.map((v) => v.name);
  return withTenant(tenantId, async (client) => {
    await lockLinkDocuments(client, tenantId, runId, instrumentId, [dataDocumentId]);
    const item = await client.query<{ code: string | null }>("select code from instrument_items where id = $1 and document_id = $2 and run_id = $3", [itemId, instrumentId, runId]);
    if (item.rowCount !== 1) throw new Error("That question is not in this questionnaire.");
    const family = codeFamily(item.rows[0].code, names);
    if (!family.includes(variable)) throw new Error(`${variable} is not one of a set of variables named after this question's code.`);
    const rejected = new Set(
      (
        await client.query<{ variable: string }>(
          "select variable from instrument_links where item_id = $1 and data_document_id = $2 and status = 'rejected'",
          [itemId, dataDocumentId],
        )
      ).rows.map((r) => r.variable),
    );
    let linked = 0;
    const refused: { variable: string; reason: string }[] = [];
    for (const name of family) {
      if (rejected.has(name)) continue;
      const taken = await variableTakenBy(client, dataDocumentId, name, itemId);
      if (taken) {
        refused.push({ variable: name, reason: taken });
        continue;
      }
      const r = await client.query(
        `insert into instrument_links (tenant_id, run_id, item_id, data_document_id, variable, method, confidence, status)
         values ($1, $2, $3, $4, $5, 'manual', 1, 'confirmed')
         on conflict (item_id, data_document_id, variable) do update set method = 'manual', confidence = 1, status = 'confirmed'
           where instrument_links.status <> 'confirmed'`,
        [tenantId, runId, itemId, dataDocumentId, name],
      );
      linked += r.rowCount ?? 0;
    }
    return { linked, refused, family };
  });
}

/** Records that a read of a questionnaire or guide failed, with the reason shown to the researcher. */
export async function recordInstrumentReadFailure(tenantId: string, runId: string, documentId: string, error: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query("insert into trace(tenant_id,run_id,event,detail) values($1,$2,'instrument_read_failed',$3)", [tenantId, runId, JSON.stringify({ documentId, error: error.slice(0, 500) })]);
  });
}
