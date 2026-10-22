import type Anthropic from "@anthropic-ai/sdk";
import { withTenant } from "./db";
import { buildCrosstab, loadCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { checkTablePlan, searchVariables } from "./crosstabAsk";
import { insightTableText } from "./crosstabInsights";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { defaultWeight } from "./starterTables";
import { isCaseTableFileName, isStatsFileName } from "./statsFileName";
import { marginForSample, sampleSizeForMargin } from "./sampleSize";

/**
 * The Research assistant's tools (Grant, 2026-10-22: the assistant as the project's expert). Every
 * figure it gives about the project's data comes from a table these tools build through the same
 * checked path as SemanticTabs (checkTablePlan) and the Python engine (buildCrosstab); every sample
 * size or margin of error comes from sampleSize.ts. The model plans and explains; it does not
 * compute.
 *
 * Tables are saved as drafts with source "assistant": listed under All tables with a Research
 * assistant badge, so each quoted figure can be opened, committed or deleted like any other draft.
 * A tool that cannot do what was asked returns an error result the model must pass on; nothing is
 * filled in.
 */

/** At most this many tables per message, so a loose question cannot fill the table set. */
export const MAX_TABLES_PER_MESSAGE = 4;

export const DATA_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_data_files",
    description: "List this project's data files that tables can be built from, with their ids.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "find_variables",
    description: "Search one data file's variables and multiple-response sets by words in their name or label. Returns up to 16 matches with their type.",
    input_schema: {
      type: "object",
      properties: { data_file_id: { type: "string" }, query: { type: "string", description: "Words to look for, e.g. 'satisfaction' or 'region'." } },
      required: ["data_file_id", "query"],
    },
  },
  {
    name: "build_table",
    description:
      "Build a cross table from one data file and get its figures back, with bases and significance marks. The table is saved as a draft the researcher can open. Use variable names exactly as find_variables gives them.",
    input_schema: {
      type: "object",
      properties: {
        data_file_id: { type: "string" },
        rows: { type: "array", items: { type: "string" }, description: "Variable names or set keys to describe, down the side." },
        columns: { type: "array", items: { type: "string" }, description: "Variable names to compare groups by, across the top. Empty for everyone." },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variable: { type: "string" },
              op: { type: "string", enum: ["in", "notIn", "between"] },
              values: { type: "array", items: { type: "string" } },
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["variable", "op"],
          },
        },
        statistics: {
          type: "array",
          description: "A mean of a row, when asked for: one entry per row.",
          items: { type: "object", properties: { row: { type: "string" }, statistic: { type: "string", enum: ["mean"] } }, required: ["row", "statistic"] },
        },
        weighted: { type: "boolean", description: "Use the file's weight (default true). Set false only when the researcher asks for unweighted figures." },
      },
      required: ["data_file_id", "rows", "columns"],
    },
  },
  {
    name: "sample_size",
    description:
      "Work out the sample size needed for a margin of error, or the margin of error of a sample size, for a proportion. Use this for every such number; never estimate one.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["sample_for_margin", "margin_for_sample"] },
        margin_pct: { type: "number", description: "Margin of error wanted, in percentage points (sample_for_margin)." },
        sample_size: { type: "number", description: "Number of completed interviews (margin_for_sample)." },
        confidence_pct: { type: "number", enum: [90, 95, 99], description: "Default 95." },
        expected_share_pct: { type: "number", description: "Expected share in percent; leave out for the conservative 50." },
        population: { type: "number", description: "Population size, only when known and not very large." },
        design_effect: { type: "number", description: "1 for a simple random sample (default); higher for clustered or weighted samples." },
        response_rate_pct: { type: "number", description: "Expected response rate, to give the number to approach (sample_for_margin)." },
      },
      required: ["mode"],
    },
  },
];

export type BuiltTable = { tableId: string; label: string; dataFile: string };

type DataFile = { id: string; name: string };

async function dataFiles(tenantId: string, runId: string): Promise<DataFile[]> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string; source_filename: string; ingestion_type: string | null }>(
      "select id, source_filename, ingestion_type from documents where run_id = $1 and kind = 'table' order by source_filename",
      [runId],
    );
    return r.rows
      .filter((d) => isStatsFileName(d.source_filename) || (d.ingestion_type === "raw" && isCaseTableFileName(d.source_filename)))
      .map((d) => ({ id: d.id, name: d.source_filename }));
  });
}

const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);

/**
 * Runs one tool call. Returns the text for the model, whether it failed, and any table it built.
 * `tablesSoFar` enforces MAX_TABLES_PER_MESSAGE.
 */
export async function runAssistantTool(
  tenantId: string,
  runId: string,
  name: string,
  input: Record<string, unknown>,
  tablesSoFar: number,
): Promise<{ content: string; isError: boolean; table?: BuiltTable }> {
  try {
    if (name === "sample_size") return { content: sampleSizeText(input), isError: false };
    const files = await dataFiles(tenantId, runId);
    if (name === "list_data_files") {
      return { content: files.length ? files.map((f) => `${f.id}: ${f.name}`).join("\n") : "This project has no data files that tables can be built from.", isError: false };
    }
    // Ownership: only a data file of this project.
    const file = files.find((f) => f.id === String(input.data_file_id ?? ""));
    if (!file) return { content: `"${String(input.data_file_id ?? "")}" is not one of this project's data files. Use list_data_files.`, isError: true };
    const dictStatus = await loadVariableDictionaryWithStatus(tenantId, runId, file.id);
    if (!dictStatus.ok) return { content: `The variables of ${file.name} could not be read: ${dictStatus.error}`, isError: true };
    const dict = dictStatus.dictionary;
    if (name === "find_variables") return { content: searchVariables(dict, String(input.query ?? "")), isError: false };
    if (name !== "build_table") return { content: `Unknown tool "${name}".`, isError: true };

    if (tablesSoFar >= MAX_TABLES_PER_MESSAGE) {
      return { content: `At most ${MAX_TABLES_PER_MESSAGE} tables can be built for one message. Answer from the tables already built, or say what else would be needed.`, isError: true };
    }
    const checked = await checkTablePlan(tenantId, runId, file.id, dict, { ...input, summary: "", unclear: [] });
    if ("errors" in checked) return { content: `Fix these and call build_table again:\n${checked.errors.join("\n")}`, isError: true };
    const plan = checked.plan;
    // The file's saved survey design, as Objectives evidence uses it (objectiveEvidence.ts): a failed
    // read stops the table rather than computing as if there were no design.
    const setupStatus = await loadDataSetupWithStatus(tenantId, file.id);
    if (!setupStatus.ok) return { content: `The survey design set-up of ${file.name} could not be read, so no table was built: ${setupStatus.error}`, isError: true };
    const design = resolveSurveyDesign(dict, effectiveDesignChoice(setupStatus.setup.design, undefined));
    const weightVar = input.weighted === false ? null : defaultWeight(dict);
    const built = await buildCrosstab(tenantId, runId, file.id, {
      columnVars: plan.columns.map((c) => c.name),
      rowItems: plan.rows,
      weightVar,
      filters: plan.filters,
      source: "assistant",
      design: design.design ?? undefined,
    });
    const { label, result } = await loadCrosstab(tenantId, runId, built.tableId);
    if (!result) return { content: "The table was built but could not be read back.", isError: true };
    const text = insightTableText(result);
    const notes = [
      `Table "${label}" (id ${built.tableId}) from ${file.name}, saved as a draft under Cross tabs, All tables.`,
      weightVar ? `Weighted by ${weightVar}.` : "Unweighted.",
      design.design ? "A survey design was used for the tests." : "No survey design: tests assume a simple random sample.",
      ...plan.unclear,
      ...(built.skipped ?? []).map((s) => `Left out: ${s.variable} (${s.reason}).`),
      text.questionsShown < text.questionsTotal ? `Only the first ${text.questionsShown} of ${text.questionsTotal} questions are shown below.` : "",
    ].filter(Boolean);
    return { content: `${notes.join("\n")}\n\n${text.text}`, isError: false, table: { tableId: built.tableId, label, dataFile: file.name } };
  } catch (error) {
    return { content: `This could not be done: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

function sampleSizeText(input: Record<string, unknown>): string {
  const common = {
    confidencePct: num(input.confidence_pct),
    expectedSharePct: num(input.expected_share_pct),
    population: num(input.population) ?? null,
    designEffect: num(input.design_effect),
  };
  if (input.mode === "margin_for_sample") {
    const r = marginForSample({ ...common, sampleSize: num(input.sample_size) ?? NaN });
    return [`Margin of error: plus or minus ${r.marginPct} percentage points.`, "Working:", ...r.steps, "Assumes:", ...r.assumptions].join("\n");
  }
  const r = sampleSizeForMargin({ ...common, marginPct: num(input.margin_pct) ?? NaN, responseRatePct: num(input.response_rate_pct) ?? null });
  return [
    `Completed interviews needed: ${r.completes}.${r.approach !== null ? ` People to approach: ${r.approach}.` : ""}`,
    "Working:",
    ...r.steps,
    "Assumes:",
    ...r.assumptions,
    "Method: Cochran (1977), Sampling Techniques, 3rd ed., chapter 4.",
  ].join("\n");
}
