import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";

// Generous but bounded: a proposal or full report's methodology section is
// usually a page or two, not the whole document, so this is plenty of
// headroom without pulling every uploaded report's full text into one
// call at the size evidence documents can reach.
const MAX_CHARS_PER_DOCUMENT = 20000;
const MAX_DOCUMENTS = 6;

/**
 * Finds and extracts the research methodology as the original researcher
 * already stated it -- in the brief, the proposal, or a full report -- for
 * the Methodology section of the Word report (see docxReport.ts). This is
 * deliberately an extraction, not a generation: Insights Elevator's own
 * pipeline (verify, synthesize, validate) is a separate thing from how the
 * underlying evidence was originally collected, and conflating the two
 * would misrepresent the project's actual research design. If none of the
 * run's documents states a methodology, this returns null rather than
 * inventing one or substituting a description of this app's own process.
 *
 * Reads from documents of kind 'evidence' (the brief/proposal uploaded at
 * intake) and 'report' (a full report uploaded at any point), since a
 * methodology section can live in either -- never 'table' or 'transcript',
 * which are raw data rather than a document that would describe how it was
 * collected.
 */
export async function generateMethodologySummary(tenantId: string, runId: string): Promise<string | null> {
  const documents = await withTenant(tenantId, async (client) => {
    const result = await client.query<{ source_filename: string; extracted_text: string | null; kind: string }>(
      `select source_filename, extracted_text, kind
       from documents
       where run_id = $1 and kind in ('evidence', 'report') and extracted_text is not null
         and length(extracted_text) > 50
       order by kind, uploaded_at
       limit $2`,
      [runId, MAX_DOCUMENTS]
    );
    return result.rows;
  });

  if (documents.length === 0) {
    return null;
  }

  const documentsBlock = documents
    .map((doc) => `--- ${doc.source_filename} ---\n${(doc.extracted_text ?? "").slice(0, MAX_CHARS_PER_DOCUMENT)}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system:
      "You find and extract a stated research methodology from uploaded project documents (a brief, a proposal, " +
      "or a full report). A methodology section describes how the underlying research was actually carried out: " +
      "sampling approach, data collection method, instruments used, number and type of participants or sources, " +
      "and timeframe. You only report what is explicitly stated in the documents given to you. You never infer, " +
      "estimate, or construct a methodology from indirect evidence, and you never describe how this analysis tool " +
      "itself processes documents -- that is a different thing from the original research design. If none of the " +
      "documents states a methodology, call record_methodology with found set to false and leave methodology_text " +
      "empty.",
    tool_choice: { type: "tool", name: "record_methodology" },
    tools: [
      {
        name: "record_methodology",
        description: "Records the research methodology as explicitly stated in the given documents, if any.",
        input_schema: {
          type: "object",
          properties: {
            found: { type: "boolean", description: "Whether any document explicitly states a methodology." },
            methodology_text: {
              type: "string",
              description:
                "The methodology as stated in the source document(s), lightly tidied into readable prose. Empty if found is false.",
            },
          },
          required: ["found"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here are this project's brief, proposal, and/or report documents:\n\n${documentsBlock}`,
      },
    ],
  });

  await logApiUsage(tenantId, runId, "methodology_extractor", response.usage);

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return null;
  }

  const input = toolUse.input as { found?: boolean; methodology_text?: string };
  if (!input.found || !input.methodology_text || !input.methodology_text.trim()) {
    return null;
  }

  const methodology = input.methodology_text.trim();

  await withTenant(tenantId, async (client) => {
    await client.query("update runs set methodology = $1 where id = $2", [methodology, runId]);
  });

  return methodology;
}
