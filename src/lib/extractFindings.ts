import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import {
  archiveAndReplaceFindings,
  type ArchiveReason,
} from "./findingArchive";
import { logApiUsage } from "./apiUsage";
import { supabaseAdmin } from "./supabaseAdmin";
import { withTenant } from "./db";
import { convertOfficeDocToPdf } from "./convertToPdf";
import {
  getTableGroundingDigest,
  type TableGroundingDigestEntry,
} from "./tableComputation";

const BUCKET = "documents";

type PageText = { pageNumber: number; text: string };

export type ExtractedDocument = {
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
async function extractPagesFromPdfBuffer(
  pdfBuffer: Buffer,
): Promise<Omit<ExtractedDocument, "previewStoragePath">> {
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const result = await extractPdfText(pdf, { mergePages: false });
  // unpdf returns one text string per page when mergePages is false.
  const pageTexts = Array.isArray(result.text) ? result.text : [result.text];
  const pages = pageTexts.map((text, index) => ({
    pageNumber: index + 1,
    text,
  }));
  return { fullText: pages.map((p) => p.text).join("\n\n"), pages };
}

/**
 * Reads a document's file out of storage and returns its text, split by
 * page where that concept applies (PDF, and Word/PowerPoint once converted).
 * Also ensures a PDF version exists in storage for the preview panel: a
 * native PDF is already viewable as-is; a converted Word or PowerPoint file
 * gets its converted PDF uploaded alongside the original for that purpose.
 */
export async function extractDocumentText(
  storagePath: string,
  filename: string,
  documentId: string,
): Promise<ExtractedDocument> {
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(
      `Could not download ${filename} from storage: ${error?.message}`,
    );
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
    // every finding gets a quote that can be checked against it.
    const pdfBuffer = await convertOfficeDocToPdf(buffer, filename);
    const pages = await extractPagesFromPdfBuffer(pdfBuffer);

    const previewStoragePath = `${storagePath}.preview.pdf`;
    const { error: previewUploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(previewStoragePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });
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
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/­/g, "")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalizeForMatch(quote);
  if (normalizedQuote.length === 0) return false;
  return normalizeForMatch(sourceText).includes(normalizedQuote);
}

// How much text goes to Claude in one extraction call. This used to be a
// hard ceiling on the whole document -- anything past it was silently
// never sent at all, which on a 100-page thesis meant the model only ever
// saw the first quarter or so and never reached the results, discussion,
// or conclusion chapters (exactly where a document's own stated_insight
// claims tend to live). It is now a per-chunk budget instead: a document
// that fits in one chunk is extracted exactly as before (same cost, same
// single call), and a longer one is walked chunk by chunk so every page
// actually gets read, see buildChunks below.
const CHUNK_CHARS = 60000;

type DocumentChunk = {
  // 0-based position of this chunk among the document's chunks.
  index: number;
  total: number;
  excerpt: string;
  hasPages: boolean;
};

/**
 * Splits a document's text into one or more chunks, each within
 * CHUNK_CHARS, so a long document gets fully read across several Claude
 * calls instead of being silently truncated after the first one. Page
 * boundaries are respected when pages exist (a page is never split across
 * two chunks, except the rare single page that alone exceeds the budget,
 * which gets its own oversized chunk rather than looping forever trying to
 * fit it). The common case, a document that fits in CHUNK_CHARS outright,
 * returns exactly one chunk containing the whole thing, identical to the
 * single-call behavior this replaces.
 */
function buildChunks(extracted: ExtractedDocument): DocumentChunk[] {
  const hasPages = extracted.pages.length > 0;

  if (hasPages) {
    const chunkTexts: string[] = [];
    let current = "";
    for (const page of extracted.pages) {
      const block = `\n\n[[PAGE ${page.pageNumber}]]\n${page.text}`;
      if (current.length > 0 && current.length + block.length > CHUNK_CHARS) {
        chunkTexts.push(current);
        current = block;
      } else {
        current += block;
      }
    }
    if (current.length > 0) chunkTexts.push(current);
    return chunkTexts.map((excerpt, index) => ({
      index,
      total: chunkTexts.length,
      excerpt,
      hasPages: true,
    }));
  }

  // No page structure (the plain-text fallback for .txt/.csv): slice
  // straight by character budget instead.
  const text = extracted.fullText;
  if (text.length <= CHUNK_CHARS) {
    return [{ index: 0, total: 1, excerpt: text, hasPages: false }];
  }
  const chunkTexts: string[] = [];
  for (let offset = 0; offset < text.length; offset += CHUNK_CHARS) {
    chunkTexts.push(text.slice(offset, offset + CHUNK_CHARS));
  }
  return chunkTexts.map((excerpt, index) => ({
    index,
    total: chunkTexts.length,
    excerpt,
    hasPages: false,
  }));
}

const VALID_FINDING_KINDS = new Set([
  "fact",
  "own_finding",
  "external_citation",
  "hypothesis",
  "methodology",
  "recommendation",
  "stated_insight",
]);

const VALID_DATA_TYPES = new Set(["qualitative", "quantitative"]);

type RawFinding = {
  finding_text?: unknown;
  finding_kind?: unknown;
  theme?: unknown;
  data_type?: unknown;
  source_quote?: unknown;
  page_number?: unknown;
  supporting_indices?: unknown;
  grounded_pattern_index?: unknown;
  mean_without_spread?: unknown;
};

type ValidatedFinding = {
  finding_text: string;
  finding_kind: string;
  theme: string;
  data_type: "qualitative" | "quantitative" | undefined;
  source_quote: string;
  page_number?: number;
  supporting_indices?: unknown;
  // Which of the supplied cross-document computed facts (see
  // getTableGroundingDigest) this finding claims to restate, by that fact's
  // 1-based position in the digest the model was shown -- never a raw
  // finding id, so it can only ever resolve to a fact this run actually
  // computed, never one the model invents.
  grounded_pattern_index: number | undefined;
  // Position in the raw (pre-filter) findings array this chunk's model
  // response returned. supporting_indices values point at these raw
  // positions (within the SAME chunk; a stated_insight can only cite
  // findings the model could actually see alongside it), so they have to
  // be resolved before any finding gets dropped by the validity filter.
  rawIndex: number;
  // Caveat tags this finding earns purely from how it was extracted, not
  // from any later computation (see 0041_extraction_caveats.sql). Right
  // now the only one is "std_unknown", when mean_without_spread came back
  // true from the model.
  extractionCaveats: string[];
};

/**
 * Runs one chunk of a document's text through the extraction call: builds
 * the prompt, validates the model's response, and inserts the surviving
 * findings for this chunk. A stated_insight's supporting_indices are
 * resolved to real finding ids against this chunk's own insertions only,
 * right here, rather than waiting on the rest of the document: the model
 * never saw other chunks, so it cannot have cited anything in them.
 */
async function extractFindingsFromChunk(
  tenantId: string,
  runId: string,
  documentId: string,
  document: { source_filename: string },
  extracted: ExtractedDocument,
  chunk: DocumentChunk,
  groundingDigest: TableGroundingDigestEntry[] = [],
): Promise<{ id: string; finding_text: string }[]> {
  const pageInstruction = chunk.hasPages
    ? 'The text is divided into pages marked like "[[PAGE 3]]". For every finding, report the page ' +
      "number it came from in page_number.\n\n"
    : "";

  const excerptContext =
    chunk.total > 1
      ? `This is an excerpt, part ${chunk.index + 1} of ${chunk.total}, of a longer document. Only extract ` +
        "findings that are actually present in this excerpt; do not guess at what earlier or later parts " +
        "of the document might say. A stated_insight's supporting_indices can only point at other findings " +
        "in this SAME excerpt, since those are the only ones you can see right now.\n\n"
      : "";

  // Cross-document grounding: real, code-computed facts from table
  // documents elsewhere in this same run (see tableComputation.ts), shown
  // here so a report's own prose claim can be tied to one if it genuinely
  // restates it. The model never sees or invents a finding id -- only this
  // digest's own 1-based numbering, which is resolved back to a real
  // finding id in code after the response comes back (see
  // extractFindingsFromChunk's insertion step below), so a stray or
  // fabricated number simply fails to resolve rather than linking to the
  // wrong fact.
  const groundingBlock =
    groundingDigest.length > 0
      ? "The following facts were computed directly from table data elsewhere in this same research run, " +
        "verified against real numbers, not written by a model:\n" +
        groundingDigest.map((g) => `[${g.index}] ${g.text}`).join("\n") +
        "\n\nIf, and only if, one of the findings you extract from THIS document's own text states " +
        "essentially the same claim as one of these computed facts (not merely the same general topic), " +
        "set grounded_pattern_index to that fact's number so the two can be linked. Leave it unset for " +
        "every other finding, including one that is only related or in the same theme.\n\n"
      : "";

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system:
      "You extract discrete, checkable factual or statistical findings from a market research report. " +
      "A finding is one specific assertion a reader could independently verify or dispute, such as a " +
      "reported percentage, a comparison between groups, a trend over time, or a causal statement. " +
      "Do not extract vague or purely descriptive sentences. Do not invent findings the text does not make.\n\n" +
      excerptContext +
      pageInstruction +
      groundingBlock +
      "For every finding, also give the exact sentence (verbatim, copied not paraphrased) in the source " +
      "text that the finding is drawn from, in source_quote. This is used to check the finding against the " +
      "document, so it must be copied exactly as it appears, not summarized.\n\n" +
      "Classify every finding you extract as exactly one of:\n" +
      "- fact: a specific data point or measurement stated on its own (a percentage, a count, a raw " +
      "statistic), without the report drawing a conclusion from it yet.\n" +
      "- own_finding: a conclusion or pattern the report draws from its own primary research (its own " +
      "sample, its own survey, its own tables), stated as an established result of its analysis.\n" +
      "- external_citation: a fact, statistic, or benchmark the report states but attributes to " +
      "someone else's research, cited for context or comparison rather than produced by this study.\n" +
      "- hypothesis: a tentative explanation the report offers for why something is happening, signaled " +
      'by hedging language such as "may suggest", "could indicate", or "possibly reflects", ' +
      "not stated as a settled result.\n" +
      "- methodology: a statement about how the data was collected, sampled, measured, or analyzed " +
      "(sample size, method, instrument, a stated limitation), rather than a result itself.\n" +
      "- recommendation: an explicit action or decision the report itself calls for.\n" +
      "- stated_insight: a higher-order interpretive or comparative statement the report presents as " +
      "an insight, such as ranking which factor matters most, tying several findings together, or " +
      "declaring what a pattern means for the audience. Extract this as its own category specifically " +
      "so it can be checked later against the findings that are supposed to support it, not because " +
      "it should be trusted as correct just for being labeled this way.\n\n" +
      "Every finding in your answer has a position in the findings array you return (0, 1, 2, ...). For " +
      "every stated_insight only, also give supporting_indices: the positions of the OTHER findings in " +
      "this same list that the report itself cites, references, or visibly leans on to make this " +
      "insight (for example, the specific facts or own_findings it ties together into the claim). Base " +
      "this only on what the report's own text actually connects, not on topical similarity; an insight " +
      "with no visible support in the text it gives should get an empty array, not a guess. Omit this " +
      "field, or leave it empty, for every finding that is not a stated_insight.\n\n" +
      'Also assign each finding a short theme (two to five words, e.g. "Structural readiness", ' +
      '"Demographic gaps in DFS use", "Segment profiles"). Use the SAME theme name, worded ' +
      "identically, for every finding that belongs together, so findings can be grouped by it. Aim for " +
      "roughly four to eight themes total, not one per finding.\n\n" +
      "Also classify each finding's data_type as either:\n" +
      "- quantitative: a number, statistic, percentage, count, or measurement.\n" +
      "- qualitative: a verbatim or paraphrased participant response, an open-ended comment, a theme " +
      "from interviews or focus groups, or any non-numeric observation.\n" +
      "A single report can state both kinds of findings; classify each finding by its own evidence, not " +
      "by the report as a whole.\n\n" +
      "If, and only if, a finding states a mean or average value, also set mean_without_spread to true " +
      "when the source text gives that mean with no standard deviation, standard error, confidence " +
      "interval, or range anywhere alongside it, and false when it does give one of those, or when the " +
      "finding isn't about a mean at all. This flags a real, common gap (a report states \"average " +
      'satisfaction was 7.2" with no sense of how spread out the underlying scores were), not a ' +
      "judgment about whether the finding is otherwise trustworthy.",
    tool_choice: { type: "tool", name: "record_findings" },
    tools: [
      {
        name: "record_findings",
        description:
          "Records the list of discrete findings found in the report text.",
        input_schema: {
          type: "object",
          properties: {
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  finding_text: {
                    type: "string",
                    description:
                      "The finding, in the report's own words as closely as possible.",
                  },
                  finding_kind: {
                    type: "string",
                    enum: [
                      "fact",
                      "own_finding",
                      "external_citation",
                      "hypothesis",
                      "methodology",
                      "recommendation",
                      "stated_insight",
                    ],
                    description:
                      "Which of the seven categories this finding falls into.",
                  },
                  theme: {
                    type: "string",
                    description:
                      "A short theme name, reused identically across findings in the same theme.",
                  },
                  data_type: {
                    type: "string",
                    enum: ["qualitative", "quantitative"],
                    description:
                      "Whether this finding's evidence is a number/statistic or a qualitative observation.",
                  },
                  source_quote: {
                    type: "string",
                    description:
                      "The exact verbatim sentence in the source text this finding is drawn from.",
                  },
                  page_number: {
                    type: "integer",
                    description:
                      "The page this finding came from, only when the text was divided into pages.",
                  },
                  supporting_indices: {
                    type: "array",
                    items: { type: "integer" },
                    description:
                      "stated_insight only: positions (in this same findings array) of the other findings " +
                      "the report itself cites or leans on for this insight. Omit or leave empty otherwise.",
                  },
                  grounded_pattern_index: {
                    type: "integer",
                    description:
                      "Only when a supplied cross-document computed fact states essentially the same claim " +
                      "as this finding: that fact's number from the numbered list given above. Omit otherwise.",
                  },
                  mean_without_spread: {
                    type: "boolean",
                    description:
                      "True only when this finding states a mean/average with no standard deviation, " +
                      "standard error, confidence interval, or range given alongside it. False for a " +
                      "finding that isn't about a mean, or that does give a spread measure.",
                  },
                },
                required: [
                  "finding_text",
                  "finding_kind",
                  "theme",
                  "data_type",
                  "source_quote",
                ],
              },
            },
          },
          required: ["findings"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the report text:\n\n${chunk.excerpt}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "extract_findings", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      chunk.total > 1
        ? `Claude did not return a structured findings list for part ${chunk.index + 1} of ${chunk.total} of "${document.source_filename}".`
        : "Claude did not return a structured findings list",
    );
  }

  if (response.stop_reason === "max_tokens") {
    // The response was cut off mid-generation, so whatever is in toolUse.input
    // is an incomplete, unusable fragment rather than a real (if short) answer.
    // This happens on long, finding-dense documents; raising max_tokens further
    // or extracting in smaller sections are the two ways out of it (a document
    // this dense per CHUNK_CHARS is also a candidate for a smaller chunk size).
    throw new Error(
      `Claude's response was cut off before it finished (hit the output limit) while extracting findings ` +
        `from "${document.source_filename}"${chunk.total > 1 ? ` (part ${chunk.index + 1} of ${chunk.total})` : ""}. ` +
        `This portion produced more findings than fit in one response. Try again, or let us know so the ` +
        `limit can be raised further.`,
    );
  }

  const rawInput = toolUse.input as { findings?: unknown };
  let findings: RawFinding[];

  if (Array.isArray(rawInput.findings)) {
    findings = rawInput.findings;
  } else {
    // Rather than crashing the whole run when the model returns nothing
    // usable, record it for diagnosis and treat it as "no findings found".
    findings = [];
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_findings_bad_response', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            documentId,
            filename: document.source_filename,
            chunk: chunk.index,
            totalChunks: chunk.total,
            textLength: chunk.excerpt.length,
            stopReason: response.stop_reason,
            rawInput: JSON.stringify(rawInput).slice(0, 1000),
          }),
        ],
      );
    });
  }

  // Claude occasionally proposes something with no real text attached, or an
  // unrecognized classification; per the extraction rules, that should be
  // dropped rather than stored.
  const validFindings: ValidatedFinding[] = findings
    .map((finding, rawIndex) => ({
      ...finding,
      rawIndex,
      grounded_pattern_index:
        typeof finding.grounded_pattern_index === "number"
          ? finding.grounded_pattern_index
          : undefined,
      extractionCaveats:
        finding.mean_without_spread === true ? ["std_unknown"] : [],
    }))
    .filter(
      (finding): finding is ValidatedFinding =>
        typeof finding.finding_text === "string" &&
        finding.finding_text.trim().length > 0 &&
        typeof finding.finding_kind === "string" &&
        VALID_FINDING_KINDS.has(finding.finding_kind) &&
        typeof finding.theme === "string" &&
        finding.theme.trim().length > 0 &&
        (finding.data_type === undefined ||
          (typeof finding.data_type === "string" &&
            VALID_DATA_TYPES.has(finding.data_type))) &&
        typeof finding.source_quote === "string" &&
        finding.source_quote.trim().length > 0,
    );

  // Build a lookup so a finding's quote can be checked against the specific
  // page it says it came from, falling back to the whole document text.
  // This uses the full document's pages (not just this chunk's), since a
  // quote always has to be checked against the real source regardless of
  // which chunk reported it.
  const pageTextByNumber = new Map(
    extracted.pages.map((p) => [p.pageNumber, p.text]),
  );

  const inserted = await withTenant(tenantId, async (client) => {
    const rows: { id: string; finding_text: string }[] = [];
    // rawIndex -> inserted id, scoped to this chunk: a stated_insight's
    // supporting_indices (positions in this chunk's own pre-filter list)
    // can only be resolved against findings this same chunk just inserted.
    const idByRawIndex = new Map<number, string>();
    // Deferred until every finding in this chunk is inserted: a
    // stated_insight can cite a finding that appears later in the list than
    // it does, so its id would not exist yet if resolved inline.
    const pendingSupport: { insightId: string; rawIndices: number[] }[] = [];

    for (const finding of validFindings) {
      const pageNumber =
        typeof finding.page_number === "number" &&
        pageTextByNumber.has(finding.page_number)
          ? finding.page_number
          : null;
      const textToCheckAgainst = pageNumber
        ? pageTextByNumber.get(pageNumber)!
        : extracted.fullText;
      let quoteVerified = quoteAppearsIn(
        finding.source_quote,
        textToCheckAgainst,
      );

      // A quoted sentence can start near the bottom of one page and finish
      // on the next, or Claude can be off by one page in its own count.
      // Before concluding a quote really isn't there, also check the pages
      // either side of the one it was attributed to.
      if (!quoteVerified && pageNumber) {
        const neighboringText = [
          pageTextByNumber.get(pageNumber - 1),
          pageTextByNumber.get(pageNumber + 1),
        ]
          .filter((t): t is string => Boolean(t))
          .join(" ");
        if (
          neighboringText.length > 0 &&
          quoteAppearsIn(finding.source_quote, neighboringText)
        ) {
          quoteVerified = true;
        }
      }

      // Resolved deterministically against the digest this chunk was shown,
      // never trusted as a raw id: grounded_pattern_index is just the
      // 1-based position in that list, so a number outside the digest's
      // range (a stray guess, or a digest that arrived empty) simply fails
      // to find an entry here and the finding is stored ungrounded, exactly
      // as if the model had left the field unset.
      const groundedByFindingId =
        typeof finding.grounded_pattern_index === "number"
          ? (groundingDigest.find(
              (g) => g.index === finding.grounded_pattern_index,
            )?.findingId ?? null)
          : null;

      // status starts at 'accepted', not the schema's 'pending' default:
      // with a run routinely surfacing well over a hundred findings,
      // nobody actually works through them one by one before the rest of
      // the pipeline (synthesis, recommendations) can run. A researcher
      // reviews by exception instead -- rejecting the ones that are wrong
      // -- so "Regenerate rejected" replaces only what's been rejected,
      // leaving accepted findings (and everything built on them) alone.
      const result = await client.query<{ id: string; finding_text: string }>(
        `insert into findings
           (tenant_id, run_id, origin, finding_text, finding_kind, theme, data_type, source_document_id,
            source_page, source_quote, quote_verified, status, grounded_by_finding_id, extraction_caveats)
         values ($1, $2, 'stated', $3, $4, $5, $6, $7, $8, $9, $10, 'accepted', $11, $12)
         returning id, finding_text`,
        [
          tenantId,
          runId,
          finding.finding_text,
          finding.finding_kind,
          finding.theme,
          finding.data_type ?? null,
          documentId,
          pageNumber,
          finding.source_quote,
          quoteVerified,
          groundedByFindingId,
          JSON.stringify(finding.extractionCaveats),
        ],
      );
      const row = result.rows[0];
      rows.push(row);
      idByRawIndex.set(finding.rawIndex, row.id);

      if (
        finding.finding_kind === "stated_insight" &&
        Array.isArray(finding.supporting_indices)
      ) {
        const rawIndices = finding.supporting_indices.filter(
          (value): value is number =>
            typeof value === "number" &&
            Number.isInteger(value) &&
            value !== finding.rawIndex,
        );
        if (rawIndices.length > 0) {
          pendingSupport.push({ insightId: row.id, rawIndices });
        }
      }
    }

    // Resolve every stated_insight's cited support now that every finding
    // from this chunk has a real id, dropping any index that didn't survive
    // validation (an invalid finding the model also returned) or doesn't
    // exist in this chunk.
    for (const { insightId, rawIndices } of pendingSupport) {
      const supportIds = rawIndices
        .map((rawIndex) => idByRawIndex.get(rawIndex))
        .filter((id): id is string => Boolean(id));
      if (supportIds.length === 0) continue;
      await client.query(
        `update findings set cited_support_finding_ids = $1 where id = $2`,
        [JSON.stringify(supportIds), insightId],
      );
    }

    return rows;
  });

  return inserted;
}

/**
 * Agent 1's first half, per the engineering brief: pulls the discrete,
 * checkable findings a report actually makes out of its raw text, before the
 * red-teamer verifies any of them. This is the "stated" origin path,
 * separate from the insight generator's "generated" path, which mines
 * tables directly rather than reading prose.
 *
 * Each finding is asked to carry the exact sentence it came from (and, for a
 * PDF, the page it came from), so the finding can be checked against the
 * source rather than just trusted.
 *
 * The document's text is walked in one or more chunks (see buildChunks): a
 * document that fits within CHUNK_CHARS is extracted in exactly one call,
 * same as always, and a longer one (a full report, a thesis) is processed
 * chunk by chunk so every page actually gets read instead of silently
 * stopping after the first ~60,000 characters. Findings are archived and
 * replaced once for the whole document before any chunk is processed, not
 * per chunk, so a later chunk's insertions are never mistaken for stale
 * findings and wiped out by an earlier chunk's own cleanup.
 */
export async function extractFindingsFromDocument(
  tenantId: string,
  runId: string,
  documentId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {},
): Promise<{ id: string; finding_text: string }[]> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } =
    options;
  const document = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      storage_path: string;
      source_filename: string;
    }>(
      "select storage_path, source_filename from documents where id = $1 and run_id = $2",
      [documentId, runId],
    );
    return result.rows[0];
  });

  if (!document) {
    throw new Error("Document not found for this run");
  }

  const extracted = await extractDocumentText(
    document.storage_path,
    document.source_filename,
    documentId,
  );

  // Store the extracted text, and the location of a browser-viewable PDF
  // version (the "view source" panel reads this), so this only has to run
  // once per document.
  await withTenant(tenantId, async (client) => {
    await client.query(
      "update documents set extracted_text = $1, preview_storage_path = $2 where id = $3",
      [extracted.fullText, extracted.previewStoragePath, documentId],
    );
  });

  // If almost nothing came out of the file, calling Claude is pointless and
  // the resulting error is confusing. Record why and stop here instead.
  if (extracted.fullText.trim().length < 50) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_findings_empty_text', $3)`,
        [
          tenantId,
          runId,
          JSON.stringify({
            documentId,
            filename: document.source_filename,
            textLength: extracted.fullText.length,
          }),
        ],
      );
    });
    throw new Error(
      `Almost no readable text came out of "${document.source_filename}" (${extracted.fullText.length} characters). ` +
        `The file may be image-based, empty, or in a format this reader cannot parse properly.`,
    );
  }

  const chunks = buildChunks(extracted);

  // Cross-document grounding context: real, code-computed facts from table
  // documents elsewhere in this same run, fetched once up front rather than
  // per chunk, since every chunk of this one document is grounded against
  // the same run-wide set of computed facts. An empty result (no table
  // documents in this run, or none that produced a kept pattern) simply
  // means no grounding block is shown to the model at all.
  const groundingDigest = await getTableGroundingDigest(tenantId, runId);

  // Wipe and archive this document's previous findings exactly once, before
  // any chunk's new findings are inserted. Doing this per chunk instead
  // would mean chunk 2's own cleanup archives and deletes the rows chunk 1
  // just inserted a moment earlier, since both chunks write findings
  // against the same documentId.
  await withTenant(tenantId, async (client) => {
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_document_id",
      documentId,
      onlyRejected: onlyReplacePending,
      archiveReason,
    });
  });

  const allRows: { id: string; finding_text: string }[] = [];
  const chunkErrors: string[] = [];

  for (const chunk of chunks) {
    try {
      const rows = await extractFindingsFromChunk(
        tenantId,
        runId,
        documentId,
        document,
        extracted,
        chunk,
        groundingDigest,
      );
      allRows.push(...rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      chunkErrors.push(message);
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_findings_chunk_error', $3)`,
          [
            tenantId,
            runId,
            JSON.stringify({
              documentId,
              filename: document.source_filename,
              chunk: chunk.index,
              totalChunks: chunk.total,
              message,
            }),
          ],
        );
      }).catch(() => {});
    }
  }

  // A single-chunk document (the common case) behaves exactly as before: if
  // its one chunk failed, this throws with that same chunk's own message
  // rather than a wrapped multi-part one.
  if (allRows.length === 0 && chunkErrors.length > 0) {
    if (chunks.length === 1) {
      throw new Error(chunkErrors[0]);
    }
    throw new Error(
      `Extraction failed on every part of "${document.source_filename}" (${chunks.length} parts). First error: ${chunkErrors[0]}`,
    );
  }

  return allRows;
}
