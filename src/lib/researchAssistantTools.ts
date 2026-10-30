import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { withTenant } from "./db";
import { buildCrosstab, loadCrosstab, loadVariableDictionaryWithStatus } from "./crosstabs";
import { checkTablePlan, searchVariables } from "./crosstabAsk";
import { insightTableText } from "./crosstabInsights";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { defaultWeight } from "./starterTables";
import { isCaseTableFileName, isStatsFileName } from "./statsFileName";
import { marginForSample, sampleSizeForMargin } from "./sampleSize";
import { readHelp, searchHelp } from "./helpIndex";
import { loadTechnicalDocuments, readPassage, searchPassages } from "./technicalDocuments";
import { neutraliseMarkers, wrapUploadedContent } from "./untrustedContent";

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
 *
 * Results that carry uploaded content (technical-document passages and search snippets, data-file
 * names, variable and category labels, table text) are wrapped as delimited data
 * (untrustedContent.ts, SEC3): the app's own notes stay outside the wrapper, so only they read as the
 * app speaking. Calculator and Knowledge base results are the app's own text and are not wrapped.
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
    name: "describe_weighting",
    description:
      "Say how one data file is weighted and designed in this app: its weight variables (kept out of find_variables), which one tables use by default, and the saved survey design (cluster and stratum variables). Use it before saying anything about a file's weighting.",
    input_schema: { type: "object", properties: { data_file_id: { type: "string" } }, required: ["data_file_id"] },
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
];

/** The calculator, for every sample size or margin of error (inside a project and outside one). */
export const SAMPLE_SIZE_TOOL: Anthropic.Tool = {
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
};

/** The Knowledge base and Manual (helpIndex.ts), for questions about how the app works. */
export const HELP_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_help",
    description:
      "Search the app's Knowledge base and Manual for how Insights Elevator works: what a screen does, how a method or statistic is applied, and its stated limits. Returns matching sections with a ref to read.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for, e.g. 'design effect weighting' or 'verdict tiers'." } },
      required: ["query"],
    },
  },
  {
    name: "read_help",
    description: "Read one Knowledge base or Manual section or page by its ref, as search_help or the contents list gives it (e.g. 'knowledge/crosstabs#significance' or 'manual/limits').",
    input_schema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  },
];

export type HelpUsed = { title: string; href: string };

/** This project's technical documents (methodology, fieldwork, sampling, weighting, analysis notes). */
export const TECHNICAL_DOCUMENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_technical_documents",
    description:
      "Search this project's technical documents (methodology, fieldwork, sampling, weighting or analysis documentation the researcher uploaded) for words. Returns matching passages with a ref to read.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for, e.g. 'stratification enumeration area' or 'benchmark weight'." } },
      required: ["query"],
    },
  },
  {
    name: "read_technical_document",
    description: "Read one passage of a technical document by its ref, as search_technical_documents gives it (e.g. '<document id>#12'). Read a passage before quoting it.",
    input_schema: { type: "object", properties: { ref: { type: "string" } }, required: ["ref"] },
  },
];

/**
 * A technical-document passage the reply was based on, listed under it. `documentId` is its identity
 * (Codex B17-F01: two documents can share a file name); `document` is its label as the assistant saw
 * it (technicalDocuments.technicalDocumentLabels), which tells same-named documents apart.
 */
export type DocumentUsed = { documentId: string; document: string; passage: number; of: number };

/**
 * search_technical_documents and read_technical_document, for this project only. A read records the
 * passage, so the reply can say which documents and passages it was based on. A failed read of the
 * documents is an error result, never "no documents".
 */
export async function runTechnicalDocumentTool(tenantId: string, runId: string, name: string, input: Record<string, unknown>): Promise<{ content: string; isError: boolean; document?: DocumentUsed }> {
  let documents;
  try {
    documents = await loadTechnicalDocuments(tenantId, runId);
  } catch (error) {
    return { content: `This project's technical documents could not be read: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
  if (documents.length === 0) {
    return { content: "This project has no technical documents with readable text. Say so, and that the researcher can add one under Import data as a Technical document.", isError: false };
  }
  if (name === "search_technical_documents") {
    const hits = searchPassages(documents, String(input.query ?? ""));
    if (hits.length === 0) return { content: `No passage of ${neutraliseMarkers(documents.map((d) => d.label).join(", "))} uses those words. Try other words, or say the technical documents do not cover it.`, isError: false };
    return {
      content: hits.map((h) => `${h.ref} | ${neutraliseMarkers(h.document)}, passage ${h.passage} of ${h.of}\n${wrapUploadedContent(`${h.document}, passage ${h.passage} of ${h.of} (search snippet)`, h.snippet)}`).join("\n\n"),
      isError: false,
    };
  }
  if (name === "read_technical_document") {
    const passage = readPassage(documents, String(input.ref ?? ""));
    if (!passage) return { content: `"${String(input.ref ?? "")}" is not a passage of this project's technical documents. Use search_technical_documents to find one.`, isError: true };
    return {
      content: `${neutraliseMarkers(passage.document)}, passage ${passage.passage} of ${passage.of}\n\n${wrapUploadedContent(`${passage.document}, passage ${passage.passage} of ${passage.of}`, passage.text)}`,
      isError: false,
      document: { documentId: passage.documentId, document: passage.document, passage: passage.passage, of: passage.of },
    };
  }
  return { content: `Unknown tool "${name}".`, isError: true };
}

/** search_help and read_help. A read records the page, so the reply can link what it was based on. */
export function runHelpTool(name: string, input: Record<string, unknown>): { content: string; isError: boolean; help?: HelpUsed } {
  if (name === "search_help") {
    const hits = searchHelp(String(input.query ?? ""));
    if (hits.length === 0) return { content: "Nothing in the Knowledge base or Manual matches those words. Try other words, or say the guides do not cover it.", isError: false };
    return { content: hits.map((h) => `${h.ref} | ${h.title}: ${h.heading}\n${h.snippet}`).join("\n\n"), isError: false };
  }
  if (name === "read_help") {
    const page = readHelp(String(input.ref ?? ""));
    if (!page) return { content: `"${String(input.ref ?? "")}" is not a Knowledge base or Manual ref. Use search_help to find one.`, isError: true };
    return { content: `${page.title} (${page.href})\n\n${page.text}`, isError: false, help: { title: page.title, href: page.href } };
  }
  return { content: `Unknown tool "${name}".`, isError: true };
}

/** The sample_size tool, shared by the project assistant and the one outside a project. */
export function runSampleSizeTool(input: Record<string, unknown>): { content: string; isError: boolean } {
  try {
    return { content: sampleSizeText(input), isError: false };
  } catch (error) {
    return { content: `This could not be worked out: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

/** A table the assistant built; `readBack` is false when the draft was saved but its figures could not be read. */
/** The draft an earlier send of this request built with exactly this table request, if any. */
async function draftBuiltForRequest(tenantId: string, runId: string, documentId: string, req: { id: string; key: string }): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const r = await client.query<{ id: string }>(
      `select id from document_tables
       where run_id = $1 and document_id = $2 and tenant_id = $3
         and crosstab->'assistantRequest'->>'id' = $4 and crosstab->'assistantRequest'->>'key' = $5
       order by table_index limit 1`,
      [runId, documentId, tenantId, req.id, req.key],
    );
    return r.rows[0]?.id ?? null;
  });
}

export type BuiltTable = { tableId: string; label: string; dataFile: string; readBack: boolean };

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
  /** The researcher's question this call answers (migration 0108); tables built for it are reused if it is asked again. */
  requestId: string | null = null,
): Promise<{ content: string; isError: boolean; table?: BuiltTable; help?: HelpUsed; document?: DocumentUsed }> {
  try {
    if (name === "sample_size") return runSampleSizeTool(input);
    if (name === "search_help" || name === "read_help") return runHelpTool(name, input);
    if (name === "search_technical_documents" || name === "read_technical_document") return runTechnicalDocumentTool(tenantId, runId, name, input);
    const files = await dataFiles(tenantId, runId);
    if (name === "list_data_files") {
      return {
        content: files.length ? wrapUploadedContent("this project's data files (id: file name)", files.map((f) => `${f.id}: ${f.name}`).join("\n")) : "This project has no data files that tables can be built from.",
        isError: false,
      };
    }
    // Ownership: only a data file of this project.
    const file = files.find((f) => f.id === String(input.data_file_id ?? ""));
    if (!file) return { content: `"${String(input.data_file_id ?? "")}" is not one of this project's data files. Use list_data_files.`, isError: true };
    const dictStatus = await loadVariableDictionaryWithStatus(tenantId, runId, file.id);
    if (!dictStatus.ok) return { content: `The variables of ${file.name} could not be read: ${dictStatus.error}`, isError: true };
    const dict = dictStatus.dictionary;
    if (name === "find_variables") return { content: wrapUploadedContent(`variables of ${file.name}`, searchVariables(dict, String(input.query ?? ""))), isError: false };
    if (name === "describe_weighting") {
      // Weight variables are hidden from find_variables (they are never rows or columns), which once
      // let the assistant tell a researcher a weighted file had none. This says what is there.
      const weights = dict.variables.filter((v) => v.weightLike);
      const chosen = defaultWeight(dict);
      const setup = await loadDataSetupWithStatus(tenantId, file.id);
      const lines = [
        weights.length === 0
          ? `${file.name} has no variable recognised as a weight (by a name or label such as weight, wgt or wt), so its tables are unweighted unless one is chosen in Cross tabs.`
          : `Weight variables in ${file.name}: ${weights.map((w) => `${w.name}${w.label && w.label !== w.name ? ` (${w.label})` : ""}`).join(", ")}. Tables use ${chosen} by default; a researcher can choose another in Cross tabs.`,
      ];
      if (!setup.ok) {
        lines.push(`The saved survey design could not be read: ${setup.error}.`);
      } else {
        const resolved = resolveSurveyDesign(dict, effectiveDesignChoice(setup.setup.design, undefined));
        const how = resolved.source === "explicit" ? "chosen by the researcher" : "found from the variable names";
        lines.push(
          resolved.design
            ? `Survey design used for standard errors in Cross tabs (${how}): cluster ${resolved.design.psu ?? "none (each case its own unit)"}, stratum ${resolved.design.strata ?? "none"}.`
            : resolved.source === "explicit"
              ? "The researcher chose no survey design (weights only): standard errors use the effective base and do not model clusters or strata."
              : `No survey design is set or found${resolved.ambiguous.psu.length || resolved.ambiguous.strata.length ? ` (candidates that could not be told apart: ${[...resolved.ambiguous.psu, ...resolved.ambiguous.strata].join(", ")})` : ""}: standard errors use the effective base and do not model clusters or strata.`,
        );
      }
      lines.push("Analytics (driver analysis and regression) uses the weight only, never the survey design.");
      return { content: wrapUploadedContent(`weighting and design of ${file.name}`, lines.join("\n")), isError: false };
    }
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
    const request = {
      columnVars: plan.columns.map((c) => c.name),
      rowItems: plan.rows,
      weightVar,
      filters: plan.filters,
      source: "assistant" as const,
      design: design.design ?? undefined,
    };
    // A table already built for this question by an earlier send that failed before storing its
    // answer (Codex B7-F01 follow-up) is reused rather than built a second time. The key is the
    // exact request, so a different table for the same question is still built.
    const assistantRequest = requestId ? { id: requestId, key: createHash("sha256").update(JSON.stringify({ file: file.id, ...request })).digest("hex") } : null;
    const earlier = assistantRequest ? await draftBuiltForRequest(tenantId, runId, file.id, assistantRequest) : null;
    const built = earlier
      ? { tableId: earlier, questions: 0, skipped: [] as { variable: string; reason: string }[], reused: true }
      : { ...(await buildCrosstab(tenantId, runId, file.id, request, assistantRequest ? { assistantRequest } : {})), reused: false };
    // The draft exists from here on (buildCrosstab saved it), so every return below carries it: it
    // counts towards the cap and is listed under the reply even when its figures cannot be read back
    // (Codex B5-F04).
    const unread = (reason: string) => ({
      content: `The table was built and saved as a draft (id ${built.tableId}, under Cross tabs, All tables), but its figures could not be read back: ${neutraliseMarkers(reason)}. Do not build it again; tell the researcher to open it there.`,
      isError: true,
      table: { tableId: built.tableId, label: `Table ${built.tableId}`, dataFile: file.name, readBack: false },
    });
    let label: string;
    let result: Awaited<ReturnType<typeof loadCrosstab>>["result"];
    try {
      ({ label, result } = await loadCrosstab(tenantId, runId, built.tableId));
    } catch (error) {
      return unread(error instanceof Error ? error.message : String(error));
    }
    if (!result) return unread("it has no saved result");
    const text = insightTableText(result);
    const notes = [
      `Table "${label}" (id ${built.tableId}) from ${file.name}, saved as a draft under Cross tabs, All tables.${built.reused ? " It was built for this question by an earlier attempt and is reused, not built again." : ""}`,
      weightVar ? `Weighted by ${weightVar}.` : "Unweighted.",
      design.design ? "A survey design was used for the tests." : "No survey design: tests assume a simple random sample.",
      ...plan.unclear,
      ...(built.skipped ?? []).map((s) => `Left out: ${s.variable} (${s.reason}).`),
      text.questionsShown < text.questionsTotal ? `Only the first ${text.questionsShown} of ${text.questionsTotal} questions are shown below.` : "",
    ].filter(Boolean);
    // The notes name the file, the table and its variables (uploaded text), so they cannot carry a marker either.
    return { content: `${neutraliseMarkers(notes.join("\n"))}\n\n${wrapUploadedContent(`table "${label}" from ${file.name}`, text.text)}`, isError: false, table: { tableId: built.tableId, label, dataFile: file.name, readBack: true } };
  } catch (error) {
    return { content: `This could not be done: ${error instanceof Error ? error.message : String(error)}`, isError: true };
  }
}

/**
 * The calculator's options, checked before any default applies (Codex B5-F02): an option that was
 * given must be a finite number, so "99" as text or a non-number design effect is refused rather
 * than quietly replaced by the default (95%, design effect 1). Only an absent option (or null, which
 * a model sends for "not given") takes its default. The ranges are checked by sampleSize.ts.
 */
const SAMPLE_OPTIONS = ["margin_pct", "sample_size", "confidence_pct", "expected_share_pct", "population", "design_effect", "response_rate_pct"] as const;

function sampleSizeOptions(input: Record<string, unknown>): Record<(typeof SAMPLE_OPTIONS)[number], number | undefined> {
  const mode = input.mode;
  if (mode !== "sample_for_margin" && mode !== "margin_for_sample") {
    throw new Error(`mode must be "sample_for_margin" or "margin_for_sample", not ${JSON.stringify(mode ?? null)}.`);
  }
  const out = {} as Record<(typeof SAMPLE_OPTIONS)[number], number | undefined>;
  for (const key of SAMPLE_OPTIONS) {
    const v = input[key];
    if (v === undefined || v === null) {
      out[key] = undefined;
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${key} must be a number, not ${JSON.stringify(v)}. Send it as a number, or leave it out for the default.`);
    out[key] = v;
  }
  const required = mode === "margin_for_sample" ? "sample_size" : "margin_pct";
  if (out[required] === undefined) throw new Error(`${required} is needed for ${mode}.`);
  return out;
}

function sampleSizeText(input: Record<string, unknown>): string {
  const o = sampleSizeOptions(input);
  const common = {
    confidencePct: o.confidence_pct,
    expectedSharePct: o.expected_share_pct,
    population: o.population ?? null,
    designEffect: o.design_effect,
  };
  if (input.mode === "margin_for_sample") {
    const r = marginForSample({ ...common, sampleSize: o.sample_size! });
    return [`Margin of error: plus or minus ${r.marginPct} percentage points.`, "Working:", ...r.steps, "Assumes:", ...r.assumptions].join("\n");
  }
  const r = sampleSizeForMargin({ ...common, marginPct: o.margin_pct!, responseRatePct: o.response_rate_pct ?? null });
  return [
    `Completed interviews needed: ${r.completes}.${r.approach !== null ? ` People to approach: ${r.approach}.` : ""}`,
    "Working:",
    ...r.steps,
    "Assumes:",
    ...r.assumptions,
    "Method: Cochran (1977), Sampling Techniques, 3rd ed., chapter 4; design effect (Kish, 1965) applied to the variance before the population correction.",
  ].join("\n");
}
