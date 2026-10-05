import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { archiveAndReplaceFindings, type ArchiveReason } from "./findingArchive";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { extractDocumentText, quoteAppearsIn } from "./extractFindings";

/**
 * Agent 1's qualitative counterpart to extractFindingsFromDocument. A raw
 * transcript (an interview or focus group, say) doesn't assert findings the
 * way a written report does, there's nothing already stated as a finding,
 * just dialogue. So rather than pulling out sentences the document already
 * asserts, this reads the raw text and runs a coding pass: identify
 * recurring ideas (open coding), then group them into a handful of named
 * themes (axial coding), in the way thematic analysis or content analysis
 * works. Each theme becomes a finding in its own right, tagged with the
 * 'coded' origin so it's never confused with something the source document
 * stated outright or a statistical pattern pulled from a table.
 */
export async function extractThemesFromTranscript(
  tenantId: string,
  runId: string,
  documentId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {}
): Promise<{ id: string; finding_text: string }[]> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } = options;
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

  await withTenant(tenantId, async (client) => {
    await client.query(
      "update documents set extracted_text = $1, preview_storage_path = $2 where id = $3",
      [extracted.fullText, extracted.previewStoragePath, documentId]
    );
  });

  if (extracted.fullText.trim().length < 50) {
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_themes_empty_text', $3)`,
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
    ? "The text is divided into pages marked like \"[[PAGE 3]]\". For every theme, report the page " +
      "number its illustrative quote came from in page_number.\n\n"
    : "";

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    system:
      "You are doing a thematic analysis of a raw qualitative transcript (an interview, a focus group, " +
      "or similar verbatim dialogue), not reading a polished report. Nothing in this text is already " +
      "stated as a finding, so your job is to read it the way a qualitative researcher would: first " +
      "notice the recurring ideas, reactions, and concerns that come up (open coding), then group those " +
      "into a small number of coherent themes (axial coding).\n\n" +
      pageInstruction +
      "For each theme, write:\n" +
      "- theme: a short theme name (two to five words), the same kind of label used elsewhere in this " +
      "app, e.g. \"Trust in customer service\", \"Price sensitivity\".\n" +
      "- finding_text: one or two sentences stating what this theme is and what the transcript shows " +
      "about it, written as a finding (\"Participants repeatedly described...\"), not as a quote.\n" +
      "- illustrative_quote: the single most representative verbatim excerpt from the transcript for " +
      "this theme, copied exactly as it appears, not paraphrased. This is used to let a reader check " +
      "the theme against what was actually said.\n\n" +
      "Only identify themes that are genuinely supported by multiple points in the text, not a single " +
      "passing remark. Aim for roughly four to eight themes, not one per sentence. Do not invent themes " +
      "the transcript does not support.",
    tool_choice: { type: "tool", name: "record_themes" },
    tools: [
      {
        name: "record_themes",
        description: "Records the themes identified in the transcript through thematic coding.",
        input_schema: {
          type: "object",
          properties: {
            themes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  theme: {
                    type: "string",
                    description: "A short theme name.",
                  },
                  finding_text: {
                    type: "string",
                    description: "What this theme is and what the transcript shows about it, stated as a finding.",
                  },
                  illustrative_quote: {
                    type: "string",
                    description: "The single most representative verbatim excerpt for this theme.",
                  },
                  page_number: {
                    type: "integer",
                    description: "The page the illustrative quote came from, only when the text was divided into pages.",
                  },
                },
                required: ["theme", "finding_text", "illustrative_quote"],
              },
            },
          },
          required: ["themes"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the transcript text:\n\n${excerpt}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "extract_themes", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured themes list");
  }

  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Claude's response was cut off before it finished (hit the output limit) while coding themes ` +
        `from "${document.source_filename}". This transcript produced more content than fit in one response. ` +
        `Try again, or let us know so the limit can be raised further.`
    );
  }

  const rawInput = toolUse.input as { themes?: unknown };
  let themes: {
    theme?: unknown;
    finding_text?: unknown;
    illustrative_quote?: unknown;
    page_number?: unknown;
  }[];

  if (Array.isArray(rawInput.themes)) {
    themes = rawInput.themes;
  } else {
    themes = [];
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'extract_themes_bad_response', $3)`,
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

  const validThemes = themes.filter(
    (theme): theme is {
      theme: string;
      finding_text: string;
      illustrative_quote: string;
      page_number?: number;
    } =>
      typeof theme.theme === "string" &&
      theme.theme.trim().length > 0 &&
      typeof theme.finding_text === "string" &&
      theme.finding_text.trim().length > 0 &&
      typeof theme.illustrative_quote === "string" &&
      theme.illustrative_quote.trim().length > 0
  );

  const pageTextByNumber = new Map(extracted.pages.map((p) => [p.pageNumber, p.text]));

  const inserted = await withTenant(tenantId, async (client) => {
    // Re-running the coding pass on the same transcript replaces its
    // previous themes rather than duplicating them, same as report extraction.
    // onlyReplacePending narrows that to findings nobody has reviewed yet,
    // and either way whatever is about to be deleted is snapshotted first,
    // see the matching comment in extractFindings.ts for the full reasoning.
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_document_id",
      documentId,
      onlyPending: onlyReplacePending,
      archiveReason,
    });

    const rows: { id: string; finding_text: string }[] = [];
    for (const theme of validThemes) {
      const pageNumber =
        typeof theme.page_number === "number" && pageTextByNumber.has(theme.page_number)
          ? theme.page_number
          : null;
      const textToCheckAgainst = pageNumber ? pageTextByNumber.get(pageNumber)! : extracted.fullText;
      let quoteVerified = quoteAppearsIn(theme.illustrative_quote, textToCheckAgainst);

      if (!quoteVerified && pageNumber) {
        const neighboringText = [pageTextByNumber.get(pageNumber - 1), pageTextByNumber.get(pageNumber + 1)]
          .filter((t): t is string => Boolean(t))
          .join(" ");
        if (neighboringText.length > 0 && quoteAppearsIn(theme.illustrative_quote, neighboringText)) {
          quoteVerified = true;
        }
      }

      // See the matching comment in extractFindings.ts: status starts at
      // 'pending' (the schema default) now, not 'accepted', so the review
      // workflow sees this as genuinely unreviewed.
      const result = await client.query<{ id: string; finding_text: string }>(
        `insert into findings
           (tenant_id, run_id, origin, finding_text, finding_kind, theme, data_type, source_document_id,
            source_page, source_quote, quote_verified, status)
         values ($1, $2, 'coded', $3, 'own_finding', $4, 'qualitative', $5, $6, $7, $8, 'pending')
         returning id, finding_text`,
        [
          tenantId,
          runId,
          theme.finding_text,
          theme.theme,
          documentId,
          pageNumber,
          theme.illustrative_quote,
          quoteVerified,
        ]
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });

  return inserted;
}
