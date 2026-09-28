import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { withTenant } from "./db";
import { parseTableDocument } from "./parseTable";
import { twoProportionGap, flagOutlier, pearsonCorrelation } from "./stats";

type RawPattern = {
  pattern_type?: unknown;
  description?: unknown;
  theme?: unknown;
  group1_label?: unknown;
  group1_n?: unknown;
  group1_p?: unknown;
  group2_label?: unknown;
  group2_n?: unknown;
  group2_p?: unknown;
  outlier_label?: unknown;
  outlier_value?: unknown;
  comparison_values?: unknown;
  variable1_name?: unknown;
  variable2_name?: unknown;
  values1?: unknown;
  values2?: unknown;
};

/**
 * Agent 0, per Section 7 of the engineering brief: runs only against raw
 * tables, looking for patterns nobody wrote a sentence about. The model
 * proposes candidate patterns and the exact numbers behind them; the
 * application, never the model, then runs the matching statistical check
 * and only keeps what actually clears it.
 */
export async function generateInsightsFromTable(
  tenantId: string,
  runId: string,
  documentId: string
): Promise<{ kept: number; discarded: number }> {
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

  const table = await parseTableDocument(document.storage_path);

  // Keep the payload bounded rather than risking a silent truncation deep
  // inside the API call.
  const preview = {
    headers: table.headers,
    rowCount: table.rows.length,
    rows: table.rows.slice(0, 500),
  };

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    system:
      "You are the insight generator in Insights Elevator. You run only against raw tables or a " +
      "dataset, never narrative text. Your job is not to check what a report already says; a " +
      "separate step does that. Your job is to look at this data directly and propose patterns " +
      "nobody wrote a sentence about: differences between segments, trends across a variable like " +
      "time or wave, outliers, and relationships between two numeric columns.\n\n" +
      "For every pattern you propose, give the exact numbers behind it, not just a description, " +
      "since a statistical check is run on those numbers before anything is kept:\n" +
      "- segment_difference or trend: group1_label, group1_n, group1_p, group2_label, group2_n, " +
      "group2_p, where p is a proportion between 0 and 1 (e.g. 0.42, not 42).\n" +
      "- outlier: outlier_label, outlier_value, and comparison_values (at least 3 other numeric " +
      "values from the same table to compare it against).\n" +
      "- relationship: variable1_name, variable2_name, and values1/values2, two matched lists of at " +
      "least 3 numeric values from paired rows.\n\n" +
      "Only propose patterns with real decision relevance, not every possible comparison in the " +
      "table. Also assign each pattern a short theme (two to five words), reusing the same theme " +
      "name for patterns that belong together.",
    tool_choice: { type: "tool", name: "record_patterns" },
    tools: [
      {
        name: "record_patterns",
        description: "Records candidate patterns found directly in the table, with the numbers behind each one.",
        input_schema: {
          type: "object",
          properties: {
            patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern_type: {
                    type: "string",
                    enum: ["segment_difference", "trend", "outlier", "relationship"],
                  },
                  description: { type: "string", description: "One-sentence plain description of the pattern." },
                  theme: { type: "string" },
                  group1_label: { type: "string" },
                  group1_n: { type: "number" },
                  group1_p: { type: "number" },
                  group2_label: { type: "string" },
                  group2_n: { type: "number" },
                  group2_p: { type: "number" },
                  outlier_label: { type: "string" },
                  outlier_value: { type: "number" },
                  comparison_values: { type: "array", items: { type: "number" } },
                  variable1_name: { type: "string" },
                  variable2_name: { type: "string" },
                  values1: { type: "array", items: { type: "number" } },
                  values2: { type: "array", items: { type: "number" } },
                },
                required: ["pattern_type", "description", "theme"],
              },
            },
          },
          required: ["patterns"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Here is the table:\n\n${JSON.stringify(preview)}`,
      },
    ],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured pattern list");
  }

  const rawInput = toolUse.input as { patterns?: unknown };
  if (!Array.isArray(rawInput.patterns)) {
    throw new Error(`Expected an array of patterns but got: ${JSON.stringify(rawInput).slice(0, 500)}`);
  }
  const patterns = rawInput.patterns as RawPattern[];

  let kept = 0;
  let discarded = 0;

  await withTenant(tenantId, async (client) => {
    // Re-running generation on the same table replaces its previous
    // generated claims rather than duplicating them.
    await client.query("delete from claims where source_table_id = $1", [documentId]);

    for (const pattern of patterns) {
      const patternType = typeof pattern.pattern_type === "string" ? pattern.pattern_type : null;
      const description = typeof pattern.description === "string" ? pattern.description : null;
      const theme = typeof pattern.theme === "string" ? pattern.theme : null;

      if (!patternType || !description || !theme) {
        discarded++;
        continue;
      }

      let claimText: string | null = null;
      let statResult: Record<string, unknown> | null = null;

      if (patternType === "segment_difference" || patternType === "trend") {
        const { group1_label, group1_n, group1_p, group2_label, group2_n, group2_p } = pattern;
        if (
          typeof group1_n === "number" &&
          typeof group1_p === "number" &&
          typeof group2_n === "number" &&
          typeof group2_p === "number"
        ) {
          const result = twoProportionGap(group1_n, group1_p, group2_n, group2_p);
          if (result.significant) {
            claimText = `${description} (${group1_label ?? "Group 1"}: ${Math.round(group1_p * 1000) / 10}%, n=${group1_n}; ${group2_label ?? "Group 2"}: ${Math.round(group2_p * 1000) / 10}%, n=${group2_n}; gap ${result.gapPercent} pts, z=${result.zScore})`;
            statResult = { ...result, group1_label, group1_n, group1_p, group2_label, group2_n, group2_p };
          }
        }
      } else if (patternType === "outlier") {
        const { outlier_label, outlier_value, comparison_values } = pattern;
        if (typeof outlier_value === "number" && Array.isArray(comparison_values) && comparison_values.every((v) => typeof v === "number")) {
          const result = flagOutlier(outlier_value, comparison_values as number[]);
          if (result.flag) {
            claimText = `${description} (${outlier_label ?? "Value"}: ${outlier_value}. ${result.flag})`;
            statResult = { ...result, outlier_label, outlier_value, comparison_values };
          }
        }
      } else if (patternType === "relationship") {
        const { variable1_name, variable2_name, values1, values2 } = pattern;
        if (
          Array.isArray(values1) &&
          Array.isArray(values2) &&
          values1.length === values2.length &&
          values1.length >= 3 &&
          values1.every((v) => typeof v === "number") &&
          values2.every((v) => typeof v === "number")
        ) {
          const result = pearsonCorrelation(values1 as number[], values2 as number[]);
          if (result.r !== null && Math.abs(result.r) >= 0.3) {
            claimText = `${description} (${variable1_name ?? "Variable 1"} vs ${variable2_name ?? "Variable 2"}: r=${result.r}. ${result.note})`;
            statResult = { ...result, variable1_name, variable2_name };
          }
        }
      }

      if (claimText && statResult) {
        await client.query(
          `insert into claims (tenant_id, run_id, origin, claim_text, theme, pattern_type, stated_stats, source_table_id)
           values ($1, $2, 'generated', $3, $4, $5, $6, $7)`,
          [tenantId, runId, claimText, theme, patternType, JSON.stringify(statResult), documentId]
        );
        kept++;
      } else {
        discarded++;
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail)
           values ($1, $2, 'insight_generator_pattern_discarded', $3)`,
          [tenantId, runId, JSON.stringify(pattern)]
        );
      }
    }
  });

  return { kept, discarded };
}
