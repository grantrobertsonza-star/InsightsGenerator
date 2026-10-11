import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { getTableGroundingDigest } from "./tableComputation";

/**
 * Report claims are tied to computed findings when the report is extracted. A
 * crosstab committed afterwards could never ground a report extracted earlier.
 * This links the stated quantitative claims that are still ungrounded to the
 * run's strongest computed findings, and clears the verdict of any claim that
 * gains a link so it is rated again against the data.
 *
 * Conservative on purpose: a link needs essentially the same claim, not the
 * same topic. The model only chooses among numbered, code-computed findings; it
 * cannot name an id of its own. Not run for claims the researcher already
 * reviewed (status other than accepted).
 */

const BATCH = 15;
const MAX_CLAIMS = 60;

const TOOL: Anthropic.Tool = {
  name: "record_links",
  description: "Record which computed fact, if any, each claim restates.",
  input_schema: {
    type: "object",
    properties: {
      links: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim_index: { type: "integer" },
            fact_index: { type: "integer", description: "1-based index of the computed fact it restates, or 0 if none." },
          },
          required: ["claim_index", "fact_index"],
        },
      },
    },
    required: ["links"],
  },
};

export async function regroundStatedFindings(tenantId: string, runId: string): Promise<number> {
  const digest = await getTableGroundingDigest(tenantId, runId);
  if (digest.length === 0) return 0;
  const claims = await withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; finding_text: string }>(
      `select id, finding_text from findings
        where run_id = $1 and origin = 'stated' and status = 'accepted'
          and grounded_by_finding_id is null
          and finding_kind in ('fact', 'own_finding')
          and (data_type is null or data_type = 'quantitative')
        order by created_at limit $2`,
      [runId, MAX_CLAIMS],
    );
    return r.rows;
  });
  if (claims.length === 0) return 0;

  const facts = digest.map((g) => `[${g.index}] ${g.text}`).join("\n");
  let linked = 0;
  for (let i = 0; i < claims.length; i += BATCH) {
    const chunk = claims.slice(i, i + BATCH);
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1200,
      system:
        "You link claims from a research report to facts computed from the survey data. Link a claim to a fact only if " +
        "the claim states essentially the same comparison or figure (same measure, same groups, same direction), not merely the " +
        "same topic. When in doubt, use 0. Never link a claim to a fact that points the other way.\n\n" +
        `Computed facts:\n${facts}`,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_links" },
      messages: [{ role: "user", content: chunk.map((c, k) => `[${k}] ${c.finding_text}`).join("\n") }],
    });
    await logApiUsage(tenantId, runId, "reground_claims", response.usage);
    const tu = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const links = tu && Array.isArray((tu.input as { links?: unknown }).links) ? ((tu.input as { links: unknown[] }).links as Record<string, unknown>[]) : [];
    for (const l of links) {
      const ci = typeof l.claim_index === "number" ? l.claim_index : -1;
      const fi = typeof l.fact_index === "number" ? l.fact_index : 0;
      const claim = chunk[ci];
      const fact = digest.find((g) => g.index === fi);
      if (!claim || !fact) continue;
      await withTenant(tenantId, async (client) => {
        await client.query("update findings set grounded_by_finding_id = $2 where id = $1 and grounded_by_finding_id is null", [claim.id, fact.findingId]);
        // Rate it again against the data rather than keep the plausibility-only verdict.
        await client.query("delete from verdicts where finding_id = $1", [claim.id]);
      });
      linked++;
    }
  }
  return linked;
}
