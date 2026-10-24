import { withTenantRead } from "./db";
import { stem, words } from "./helpIndex";

/**
 * Technical documents (Grant, 2026-10-24; documents of kind 'technical', migration 0112): a project's
 * methodology, fieldwork, sampling, weighting and analysis documentation, for the Research assistant
 * to search and quote. What a document says is the document's claim about the study; nothing here
 * checks it against the data.
 *
 * A document's stored text is split into numbered passages of about PASSAGE_CHARS characters on
 * paragraph boundaries (a longer paragraph is cut at sentence ends, or hard, at the limit). The text
 * holds no page numbers (extraction joins pages), so a passage is cited as "passage n of m". Search
 * is the same plain word matching as the Knowledge base search (helpIndex.ts): it finds passages that
 * use the question's words, not synonyms.
 */

export const PASSAGE_CHARS = 1500;

export type TechnicalDocument = { id: string; name: string; passages: string[] };

/** A document's text as numbered passages (index 0 is passage 1). */
export function splitPassages(text: string, limit = PASSAGE_CHARS): string[] {
  const pieces: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
    let paragraph = raw.trim();
    while (paragraph.length > limit) {
      const window = paragraph.slice(0, limit);
      const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
      const at = cut > limit / 2 ? cut + 1 : limit;
      pieces.push(paragraph.slice(0, at).trim());
      paragraph = paragraph.slice(at).trim();
    }
    if (paragraph) pieces.push(paragraph);
  }
  const passages: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > limit) {
      passages.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) passages.push(current);
  return passages;
}

/**
 * This project's technical documents whose text was read. An error when they cannot be read (never an
 * empty list in its place); an empty list before migration 0112 (the kind cannot exist yet).
 */
export async function loadTechnicalDocuments(tenantId: string, runId: string): Promise<TechnicalDocument[]> {
  const rows = await withTenantRead(tenantId, async (client) => {
    const r = await client.query<{ id: string; source_filename: string; extracted_text: string | null }>(
      `select id, source_filename, extracted_text from documents
        where run_id = $1 and tenant_id = $2 and kind = 'technical'
        order by uploaded_at, id`,
      [runId, tenantId],
    );
    return r.rows;
  });
  return rows
    .filter((d) => (d.extracted_text ?? "").trim().length > 0)
    .map((d) => ({ id: d.id, name: d.source_filename, passages: splitPassages(d.extracted_text!) }));
}

export type PassageHit = { ref: string; document: string; passage: number; of: number; snippet: string; score: number };

/** A passage's ref, as search gives it and read takes it: "<document id>#<passage number>". */
export const passageRef = (documentId: string, passage: number) => `${documentId}#${passage}`;

/** Up to `limit` passages across the documents that best match the query, best first. */
export function searchPassages(documents: readonly TechnicalDocument[], query: string, limit = 5): PassageHit[] {
  const terms = [...new Set(words(query).map(stem))];
  if (terms.length === 0) return [];
  const hits: PassageHit[] = [];
  for (const doc of documents) {
    doc.passages.forEach((text, i) => {
      const counts = new Map<string, number>();
      for (const w of words(text).map(stem)) counts.set(w, (counts.get(w) ?? 0) + 1);
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const n = counts.get(t) ?? 0;
        if (n > 0) matched++;
        score += Math.min(n, 5);
      }
      if (matched === 0) return;
      // Passages that use more of the question's words come first.
      score *= matched / terms.length;
      hits.push({ ref: passageRef(doc.id, i + 1), document: doc.name, passage: i + 1, of: doc.passages.length, snippet: snippetOf(text, terms), score: Math.round(score * 100) / 100 });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippetOf(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const piece = text.slice(start, start + 300).replace(/\s+/g, " ");
  return `${start > 0 ? "..." : ""}${piece}${start + 300 < text.length ? "..." : ""}`;
}

/** One passage by its ref, or null when the ref names no passage of these documents. */
export function readPassage(documents: readonly TechnicalDocument[], ref: string): { document: string; documentId: string; passage: number; of: number; text: string } | null {
  const m = /^([0-9a-f-]{36})#(\d+)$/i.exec(ref.trim());
  if (!m) return null;
  const doc = documents.find((d) => d.id === m[1]);
  const n = Number(m[2]);
  if (!doc || !Number.isInteger(n) || n < 1 || n > doc.passages.length) return null;
  return { document: doc.name, documentId: doc.id, passage: n, of: doc.passages.length, text: doc.passages[n - 1] };
}
