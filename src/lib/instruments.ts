import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { mapWithConcurrency } from "./concurrency";
import { withTenant, withTenantRead } from "./db";
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

function cleanOptions(raw: unknown): ItemOption[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemOption[] = [];
  for (const o of raw) {
    const r = o as { code?: unknown; label?: unknown; goto?: unknown };
    const label = typeof r?.label === "string" ? r.label.trim() : "";
    const code = r?.code === null || r?.code === undefined ? "" : String(r.code).trim();
    const goto = typeof r?.goto === "string" && r.goto.trim() ? r.goto.trim() : null;
    if (label) out.push(goto ? { code, label, goto } : { code, label });
  }
  return out.slice(0, 80);
}

export async function readInstrumentItems(tenantId: string, runId: string, documentId: string): Promise<number> {
  const doc = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ storage_path: string; source_filename: string }>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2 and kind = 'instrument'",
      [documentId, runId],
    );
    return r.rows[0];
  });
  if (!doc) throw new Error("Questionnaire or guide not found for this run");

  const extracted = await extractDocumentText(doc.storage_path, doc.source_filename, documentId);
  const pages = extracted.pages.length > 0 ? extracted.pages : splitText(extracted.fullText);
  const chunks = chunkPages(pages).slice(0, MAX_CHUNKS);
  if (chunks.length === 0) throw new Error("No text could be read from this file. A scanned PDF may need to be converted to text first.");

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
      const tool = response.content.find((b) => b.type === "tool_use");
      if (!tool || tool.type !== "tool_use") return [] as (RawItem & { page: number })[];
      const items = (tool.input as { items?: RawItem[] }).items ?? [];
      return items.map((i) => ({ ...i, page: chunk.page }));
    } catch {
      return [] as (RawItem & { page: number })[];
    }
  });

  // Flatten, tidy and drop repeats at chunk boundaries.
  const seen = new Set<string>();
  const rows: {
    section: string | null;
    code: string | null;
    text: string;
    options: ItemOption[];
    routingText: string | null;
    routing: Routing | null;
    page: number;
  }[] = [];
  for (const chunk of found) {
    for (const i of chunk) {
      const text = typeof i.text === "string" ? i.text.replace(/\s+/g, " ").trim() : "";
      if (!text) continue;
      const code = typeof i.code === "string" && i.code.trim() ? i.code.trim().replace(/[.:)]+$/, "") : null;
      const key = `${(code ?? "").toLowerCase()}|${text.toLowerCase().slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const routingText = typeof i.routing_text === "string" && i.routing_text.trim() ? i.routing_text.trim() : null;
      rows.push({
        section: typeof i.section === "string" && i.section.trim() ? i.section.trim() : null,
        code,
        text,
        options: cleanOptions(i.options),
        routingText,
        routing: parseRouting(routingText),
        page: (i as { page: number }).page,
      });
    }
  }
  if (rows.length === 0) throw new Error("No question items were found in this file.");

  // Jumps printed on answer options ("No: GO TO Q10") skip the items between.
  const derived = deriveGotoRouting(rows.map((r) => ({ code: r.code, routing: r.routing, options: r.options })));
  rows.forEach((r, i) => {
    r.routing = derived[i];
  });

  await withTenant(tenantId, async (client) => {
    await client.query("delete from instrument_items where document_id = $1", [documentId]);
    for (let n = 0; n < rows.length; n++) {
      const r = rows[n];
      await client.query(
        `insert into instrument_items (tenant_id, run_id, document_id, item_order, section, code, item_text, response_options, routing_text, routing, page)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tenantId, runId, documentId, n, r.section, r.code, r.text, JSON.stringify(r.options), r.routingText, r.routing ? JSON.stringify(r.routing) : null, r.page],
      );
    }
  });
  return rows.length;
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
    for (const c of candidates) {
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
          items: 0, withRouting: 0, fromJumps: 0, statedRoutingText: 0, links: { suggested: 0, confirmed: 0, rejected: 0 },
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
