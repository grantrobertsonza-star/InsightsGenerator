import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { supabaseAdmin } from "./supabaseAdmin";
import { withTenant } from "./db";
import { convertOfficeDocToPdf } from "./convertToPdf";

const BUCKET = "documents";

type PageText = { pageNumber: number; text: string };

type ExtractedDocument = {
  // Full plain text, used for storage and for non-paginated formats.
  fullText: string;
  // Per-page text, only populated for formats where a page genuinely means
  // something (PDF). Empty for Word documents, which have no fixed pages
  // once the text is pulled out of them.
  pages: PageText[];
  // Where a browser-viewable PDF version of this document lives in storage,
  // for the "view source" side panel. Null if nothing viewable is available.
  previewStoragePath: string | null;
};

/** Runs a PDF buffer through unpdf and returns it split into per-page text. */
async function extractPagesFromPdfBuffer(pdfBuffer: Buffer): Promise<Omit<ExtractedDocument, "previewStoragePath">> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const result = await extractPdfText(pdf, { mergePages: false });
  // unpdf returns one text string per page when mergePages is false.
  const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
  const pages = pageTexts.map((text, index) => ({ pageNumber: index + 1, text }));
  return { fullText: pages.map((p) => p.text).join("\n\n"), pages };
}

/**
 * Reads a document's file out of storage and returns its text, split by
 * page where that concept applies (PDF, and Word/PowerPoint once converted).
 * Also ensures a PDF version exists in storage for the preview panel: a
 * native PDF is already viewable as-is; a converted Word or PowerPoint file
 * gets its converted PDF uploaded alongside the original for that purpose.
 */
async function extractDocumentText(
  storagePath: string,
  filename: string,
  documentId: string
): Promise<ExtractedDocument> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not download ${filename} from storage: ${error?.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const lowerName = filename.toLowerCase();

  if (lowerName.endsWith(".pdf")) {
    const pages = await extractPagesFromPdfBuffer(buffer);
    return { ...pages, previewStoragePath: storagePath };
  }

  if (lowerName.endsWith(".docx") || lowerName.endsWith(".pptx")) {
    // Word and PowerPoint both go through the same route: convert to PDF
    // with LibreOffice, then read it exactly like a native PDF upload, so
    // each Word page (or PowerPoint slide) gets a real page number and
    // every claim gets a quote that can be checked against it.
    const pdfBuffer = await convertOfficeDocToPdf(buffer, filename);
    const pages = await extractPagesFromPdfBuffer(pdfBuffer);

    const previewStoragePath = `${storagePath}.preview.pdf`;
    const { error: previewUploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(previewStoragePath, pdfBuffer, { contentType: "application/pdf", upsert: true });
    if (previewUploadError) {
      // A missing preview shouldn't block extraction itself; the side panel
      // will just say no preview is available for this document.
      return { ...pages, previewStoragePath: null };
    }

    return { ...pages, previewStoragePath };
  }

  // Fall back to treating it as plain text (e.g. .txt, .csv used as a report).
  const text = buffer.toString("utf-8");
  return { fullText: text, pages: [], previewStoragePath: null };
}

/**
 * Loose match used to check whether a claimed quote really appears in the
 * source text. Normalizes away things that are extraction artifacts, not
 * real differences: curly quotes vs straight ones, en/em dashes, ligatures,
 * non-breaking spaces, and words hyphenated across a line break.
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\u00AD/g, "")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalizeForMatch(quote);
  if (normalizedQuote.length === 0) return false;
  return normalizeForMatch(sourceText).includes(normalizedQuote);
}

/**
 * Agent 1's first half, per the engineering brief: pulls the discrete,
 * checkable claims a report actually makes out of its raw text, before the
 * red-teamer verifies any of them. This is the "stated" origin path,
 * separate from the insight generator's "generated" path, which mines
 * tables directly rather than reading prose.
 *
 * Each claim is asked to carry the exact sentence it came from (and, for a
 * PDF, the page it came from), so the claim can be checked against the
 * source rather than just trusted.
 */
export async function extractClaimsFromDocument(
  tenantId: string,
  runId: string,
  documentId: string
): Promise<{ id: string; claim_text: string }[]> {
  const document = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ storage_path: string; source_filename: string }>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2",
      [documentId, runId]
    );
    return result.rows[0];
  });

  if (!document) {
    throw new Error("Document not found for this run");
  }

  const extracted = await extractDocumentText(document.storage_path, document.source_filename, documentId);
  const hasPages = extracted.pages.length > 0;

  // Store the extracted text, and the location of a browser-viewable PDF
  // version (the "view source" panel reads this), so this only has to run
  // once per document.
  await withTenant(tenantId, async (client) => {
    await client.query(
      "update documents set extracted_text = $1, preview_storage_path = $2 where id = $3",
      [extracted.fullText, extracted.previewStoragePath, documentId]
    );
  });

  // If almost nothing came out of the file, calling Claude is pointless and
  // the resulting error is confusing. Record why and stop here instead.
  if (extracted.fullText.trim().length < 50) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_claims_empty_text', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({ documentId, filename: document.source_filename, textLength: extracted.fullText.length }),
        ]
      );
    });
    throw new Error(
      `Almost no readable text came out of "${document.source_filename}" (${extracted.fullText.length} characters). ` +
        `The file may be image-based, empty, or in a format this reader cannot parse properly.`
    );
  }

  // Keep the model honest about length: send a generous but bounded excerpt
  // rather than risking a silent truncation deep inside the API call. When
  // pages are known, tag each one so the model can report where a claim
  // came from instead of guessing.
  const MAX_CHARS = 60000;
  let excerpt: string;
  if (hasPages) {
    const tagged: string[] = [];
    let used = 0;
    for (const page of extracted.pages) {
      const block = `\n\n[[PAGE ${page.pageNumber}]]\n${page.text}`;
      if (used + block.length > MAX_CHARS) break;
      tagged.push(block);
      used += block.length;
    }
    excerpt = tagged.join("");
  } else {
    excerpt = extracted.fullText.slice(0, MAX_CHARS);
  }

  const pageInstruction = hasPages
    ? "The text is divided into pages marked like \"[[PAGE 3]]\". For every claim, report the page " +
      "number it came from in page_number.\n\n"
    : "";

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system:
      "You extract discrete, checkable factual or statistical claims from a market research report. " +
      "A claim is one specific assertion a reader could independently verify or dispute, such as a " +
      "reported percentage, a comparison between groups, a trend over time, or a causal statement. " +
      "Do not extract vague or purely descriptive sentences. Do not invent claims the text does not make.\n\n" +
      pageInstruction +
      "For every claim, also give the exact sentence (verbatim, copied not paraphrased) in the source " +
      "text that the claim is drawn from, in source_quote. This is used to check the claim against the " +
      "document, so it must be copied exactly as it appears, not summarized.\n\n" +
      "Classify every claim you extract as exactly one of:\n" +
      "- own_finding: a specific data point or statistical result from the report's own primary " +
      "research or analysis (its own sample, its own survey, its own tables).\n" +
      "- external_citation: a fact, statistic, or benchmark the report states but attributes to " +
      "someone else's research, cited for context or comparison rather than produced by this study.\n" +
      "- insight: a higher-order interpretive or comparative statement the report draws from its own " +
      "findings, such as ranking which factor matters most, or explaining why a pattern occurs.\n\n" +
      "Also assign each claim a short theme (two to five words, e.g. \"Structural readiness\", " +
      "\"Demographic gaps in DFS use\", \"Segment profiles\"). Use the SAME theme name, worded " +
      "identically, for every claim that belongs together, so claims can be grouped by it. Aim for " +
      "roughly four to eight themes total, not one per claim.",
    tool_choice: { type: "tool", name: "record_claims" },
    tools: [
      {
        name: "record_claims",
        description: "Records the list of discrete claims found in the report text.",
        input_schema: {
          type: "object",
          properties: {
            claims: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  claim_text: {
                    type: "string",
                    description: "The claim, in the report's own words as closely as possible.",
                  },
                  claim_kind: {
                    type: "string",
                    enum: ["own_finding", "external_citation", "insight"],
                    description: "Which of the three categories this claim falls into.",
                  },
                  theme: {
                    type: "string",
                    description: "A short theme name, reused identically across claims in the same theme.",
                  },
                  source_quote: {
                    type: "string",
                    description: "The exact verbatim sentence in the source text this claim is drawn from.",
                  },
                  page_number: {
                    type: "integer",
                    description: "The page this claim came from, only when the text was divided into pages.",
                  },
                },
                required: ["claim_text", "claim_kind", "theme", "source_quote"],
              },
            },
          },
          required: ["claims"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the report text:\n\n${excerpt}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured claims list");
  }

  if (response.stop_reason === "max_tokens") {
    // The response was cut off mid-generation, so whatever is in toolUse.input
    // is an incomplete, unusable fragment rather than a real (if short) answer.
    // This happens on long, claim-dense documents; raising max_tokens further
    // or extracting in smaller sections are the two ways out of it.
    throw new Error(
      `Claude's response was cut off before it finished (hit the output limit) while extracting claims ` +
        `from "${document.source_filename}". This document produced more claims than fit in one response. ` +
        `Try again, or let us know so the limit can be raised further.`
    );
  }

  const rawInput = toolUse.input as { claims?: unknown };
  let claims: {
    claim_text?: unknown;
    claim_kind?: unknown;
    theme?: unknown;
    source_quote?: unknown;
    page_number?: unknown;
  }[];

  if (Array.isArray(rawInput.claims)) {
    claims = rawInput.claims;
  } else {
    // Rather than crashing the whole run when the model returns nothing
    // usable, record it for diagnosis and treat it as "no claims found".
    claims = [];
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_claims_bad_response', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            documentId,
            filename: document.source_filename,
            textLength: extracted.fullText.length,
            stopReason: response.stop_reason,
            rawInput: JSON.stringify(rawInput).slice(0, 1000),
          }),
        ]
      );
    });
  }

  const validKinds = new Set(["own_finding", "external_citation", "insight"]);

  // Claude occasionally proposes something with no real text attached, or an
  // unrecognized classification; per the extraction rules, that should be
  // dropped rather than stored.
  const validClaims = claims.filter(
    (claim): claim is {
      claim_text: string;
      claim_kind: string;
      theme: string;
      source_quote: string;
      page_number?: number;
    } =>
      typeof claim.claim_text === "string" &&
      claim.claim_text.trim().length > 0 &&
      typeof claim.claim_kind === "string" &&
      validKinds.has(claim.claim_kind) &&
      typeof claim.theme === "string" &&
      claim.theme.trim().length > 0 &&
      typeof claim.source_quote === "string" &&
      claim.source_quote.trim().length > 0
  );

  // Build a lookup so a claim's quote can be checked against the specific
  // page it says it came from, falling back to the whole document text.
  const pageTextByNumber = new Map(extracted.pages.map((p) => [p.pageNumber, p.text]));

  const inserted = await withTenant(tenantId, async (client) => {
    // Re-running extraction on the same document replaces its previous
    // claims rather than duplicating them.
    await client.query("delete from claims where source_document_id = $1", [documentId]);

    const rows: { id: string; claim_text: string }[] = [];
    for (const claim of validClaims) {
      const pageNumber =
        typeof claim.page_number === "number" && pageTextByNumber.has(claim.page_number)
          ? claim.page_number
          : null;
      const textToCheckAgainst = pageNumber ? pageTextByNumber.get(pageNumber)! : extracted.fullText;
      let quoteVerified = quoteAppearsIn(claim.source_quote, textToCheckAgainst);

      // A quoted sentence can start near the bottom of one page and finish
      // on the next, or Claude can be off by one page in its own count.
      // Before concluding a quote really isn't there, also check the pages
      // either side of the one it was attributed to.
      if (!quoteVerified && pageNumber) {
        const neighboringText = [pageTextByNumber.get(pageNumber - 1), pageTextByNumber.get(pageNumber + 1)]
          .filter((t): t is string => Boolean(t))
          .join(" ");
        if (neighboringText.length > 0 && quoteAppearsIn(claim.source_quote, neighboringText)) {
          quoteVerified = true;
        }
      }

      const result = await client.query<{ id: string; claim_text: string }>(
        `insert into claims
           (tenant_id, run_id, origin, claim_text, claim_kind, theme, source_document_id,
            source_page, source_quote, quote_verified)
         values ($1, $2, 'stated', $3, $4, $5, $6, $7, $8, $9)
         returning id, claim_text`,
        [
          tenantId,
          runId,
          claim.claim_text,
          claim.claim_kind,
          claim.theme,
          documentId,
          pageNumber,
          claim.source_quote,
          quoteVerified,
        ]
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });

  return inserted;
}
