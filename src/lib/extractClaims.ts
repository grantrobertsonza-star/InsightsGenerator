import { extractText as extractPdfText, getDocumentProxy } from "unpdf";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { supabaseAdmin } from "./supabaseAdmin";
import { withTenant } from "./db";

const BUCKET = "documents";

/**
 * Reads a document's file out of storage and returns its plain text.
 * Only PDF is handled for now; anything else is assumed to already be text.
 */
async function extractText(storagePath: string, filename: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`Could not download ${filename} from storage: ${error?.message}`);
  }

  const buffer = Buffer.from(await data.arrayBuffer());

  if (filename.toLowerCase().endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }

  return buffer.toString("utf-8");
}

/**
 * Agent 1's first half, per the engineering brief: pulls the discrete,
 * checkable claims a report actually makes out of its raw text, before the
 * red-teamer verifies any of them. This is the "stated" origin path,
 * separate from the insight generator's "generated" path, which mines
 * tables directly rather than reading prose.
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

  const text = await extractText(document.storage_path, document.source_filename);

  // Store the extracted text so this only has to run once per document.
  await withTenant(tenantId, async (client) => {
    await client.query("update documents set extracted_text = $1 where id = $2", [text, documentId]);
  });

  // Keep the model honest about length: send a generous but bounded excerpt
  // rather than risking a silent truncation deep inside the API call.
  const excerpt = text.slice(0, 60000);

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You extract discrete, checkable factual or statistical claims from a market research report. " +
      "A claim is one specific assertion a reader could independently verify or dispute, such as a " +
      "reported percentage, a comparison between groups, a trend over time, or a causal statement. " +
      "Do not extract vague or purely descriptive sentences. Do not invent claims the text does not make.",
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
                },
                required: ["claim_text"],
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

  const rawInput = toolUse.input as { claims?: unknown };
  if (!Array.isArray(rawInput.claims)) {
    throw new Error(
      `Expected an array of claims but got: ${JSON.stringify(rawInput).slice(0, 500)}`
    );
  }
  const claims = rawInput.claims as { claim_text?: unknown }[];

  // Claude occasionally proposes something with no real text attached;
  // per the extraction rules, that should be dropped rather than stored.
  const validClaims = claims.filter(
    (claim): claim is { claim_text: string } =>
      typeof claim.claim_text === "string" && claim.claim_text.trim().length > 0
  );

  const inserted = await withTenant(tenantId, async (client) => {
    const rows: { id: string; claim_text: string }[] = [];
    for (const claim of validClaims) {
      const result = await client.query<{ id: string; claim_text: string }>(
        `insert into claims (tenant_id, run_id, origin, claim_text, source_document_id)
         values ($1, $2, 'stated', $3, $4)
         returning id, claim_text`,
        [tenantId, runId, claim.claim_text, documentId]
      );
      rows.push(result.rows[0]);
    }
    return rows;
  });

  return inserted;
}
