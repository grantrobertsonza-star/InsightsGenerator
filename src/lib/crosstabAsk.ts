import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { loadCategories, loadVariableDictionary } from "./crosstabs";
import type { CrosstabFilter, CrosstabGroup, CrosstabRowItem, VariableDictionary, VariableInfo } from "./parseStatsFile";
import { loadVariableOverrides, type VariableOverrides } from "./variableOverrides";
import { isLookupEligible, isStringCategory } from "./variableKinds";

/** What a plain-English request turns into. Nothing runs from this: the researcher reads it and decides. */
export type AskPlan = {
  /**
   * One plain sentence saying what will be built, written by code from the checked rows, columns,
   * filters and statistics (describePlan), never the model's own words, so it cannot promise a
   * statistic the table does not show (Grant, 2026-10-22: "Mean of..." over a frequency table).
   */
  summary: string;
  columns: { name: string; label: string }[];
  rows: CrosstabRowItem[];
  filters: CrosstabFilter[];
  /** Things the model was not sure about, or could not do, and how each requested mean is worked out, for the researcher to settle. */
  unclear: string[];
  /** Row keys that get a mean row (a CrosstabGroup of kind "mean" above the answers). */
  means: string[];
  /** Row keys asked for a mean that the engine already shows as an average only, with no distribution. */
  averageOnly: string[];
};

/** The statistics a plain-English request can ask for on a row, besides its answers. */
export const PLAN_STATISTICS = ["mean"] as const;

// The engine's NUMERIC_AS_CATEGORIES_MAX (api/parse-stats-file.py): an unlabelled numeric variable
// with more distinct values than this is tabulated as an average, not as a frequency table.
const ENGINE_NUMERIC_AS_CATEGORIES_MAX = 25;

/**
 * Whether the engine tabulates this row as an average only (its numeric branch, which ignores
 * groups): a numeric variable set as discrete or continuous, or (not set as categorical) an
 * unlabelled numeric one with many distinct values. Mirrors the branch condition in the engine's
 * crosstab; crosstabAskMeanEngine.test.ts checks both sides agree.
 */
export function tabulatedAsAverage(v: Pick<VariableInfo, "numeric" | "labelled" | "nDistinct">, override: VariableOverrides[string] | undefined): boolean {
  if (!v.numeric) return false;
  if (override?.type === "categorical") return false;
  if (override?.type === "discrete" || override?.type === "continuous") return true;
  return !v.labelled && v.nDistinct > ENGINE_NUMERIC_AS_CATEGORIES_MAX;
}

/**
 * The qualification a requested mean row carries in its own label when the engine does not judge
 * the answers an ordered scale. The engine adds it (UNORDERED_MEAN_NOTE in api/parse-stats-file.py,
 * same words); this copy is what the plan's Check item quotes.
 */
export const UNORDERED_MEAN_NOTE = "mean of the answer codes, which may not be in order";

/**
 * The mean row the engine computes for a row (kind "mean": the weighted mean of the numeric answer
 * codes over the table's valid cases, leaving out declared missing values and don't know, refused
 * and not applicable answers). Placed above the answers, so the distribution stays below it.
 * qualifyCodes asks the engine to say so in the label when the codes may not be a scale; whether
 * they are is the engine's one ordered-scale rule (_is_ordered_scale), not decided here.
 */
export function meanGroupFor(label: string): CrosstabGroup {
  return { label, cats: [], kind: "mean", place: "above", qualifyCodes: true };
}

/** The plain sentence a plan shows, from what will actually be built. */
export function describePlan(plan: Pick<AskPlan, "rows" | "columns" | "filters" | "means" | "averageOnly">, filterCount = plan.filters.length): string {
  const named = (r: CrosstabRowItem) => (r.label && r.label !== r.key ? `${r.label} (${r.key})` : r.key);
  const rows = plan.rows.map((r) =>
    plan.averageOnly.includes(r.key) ? `the average of ${named(r)}` : plan.means.includes(r.key) ? `the mean and answers of ${named(r)}` : `the answers of ${named(r)}`,
  );
  const what = rows.length ? rows.join("; ") : "the columns on their own";
  const by = plan.columns.length ? `by ${plan.columns.map((c) => c.label || c.name).join(" and ")}` : "for everyone, no column split";
  const who = filterCount === 0 ? "" : filterCount === 1 ? ", for the people who meet 1 filter" : `, for the people who meet all ${filterCount} filters`;
  const sentence = `A table of ${what}, ${by}${who}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

const MAX_TURNS = 10;
const STOP = new Set(["a", "an", "the", "of", "for", "and", "or", "by", "vs", "versus", "with", "in", "on", "to", "from", "who", "are", "is", "that", "people", "aged", "age", "years", "year", "want", "like", "i", "table", "crosstab", "cross", "tabulation", "show", "me", "between", "than", "at", "least", "most"]);
const SYNONYMS: Record<string, string[]> = {
  gender: ["sex", "gender"],
  sex: ["sex", "gender"],
  income: ["income", "earn", "salary", "wage"],
  province: ["province", "region"],
  age: ["age"],
  bank: ["bank", "banked"],
};

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .flatMap((t) => SYNONYMS[t] ?? [t]);
}

function kindOf(v: VariableInfo): string {
  if (v.numeric && !v.labelled && v.nDistinct > 10) return "number (use a range filter)";
  if (isStringCategory(v)) return `categorical, ${v.nDistinct} answers`;
  return v.labelled ? `categorical, ${v.nDistinct} answers` : v.numeric ? `number, ${v.nDistinct} values` : "text";
}

/** Keyword search over variable names and labels, plus multiple-response sets. */
function search(dict: VariableDictionary, query: string): string {
  const toks = tokens(query);
  if (toks.length === 0) return "Give at least one meaningful word to search for.";
  const score = (name: string, label: string) => {
    const hay = `${name} ${label}`.toLowerCase();
    let s = 0;
    for (const t of toks) {
      if (new RegExp(`\\b${t}`).test(hay)) s += 2;
      else if (hay.includes(t)) s += 1;
    }
    return s;
  };
  const vars = dict.variables
    // OBJ-REV-006: string categories are searchable; free text and weights are not.
    .filter(isLookupEligible)
    .map((v) => ({ v, s: score(v.name, v.label) + (v.labelled ? 0.25 : 0) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);
  const sets = (dict.sets ?? [])
    .map((st) => ({ st, s: score(st.key, st.label) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);
  if (vars.length === 0 && sets.length === 0) return "No variables matched. Try other words from the question wording.";
  return [
    ...vars.map(({ v }) => `variable ${v.name}: ${v.label} [${kindOf(v)}]`),
    ...sets.map(({ st }) => `set ${st.key}: ${st.label} [multiple response, ${st.vars.length} options]`),
  ].join("\n");
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_variables",
    description: "Search the data file's variables and multiple-response sets by words in their name or label. Returns up to 16 matches with their type.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Words to look for, e.g. 'monthly income' or 'gender'." } }, required: ["query"] },
  },
  {
    name: "get_categories",
    description: "List the exact answer labels of a categorical variable. Always call this before using a variable in a filter by answers, so the labels match exactly.",
    input_schema: { type: "object", properties: { variable: { type: "string" } }, required: ["variable"] },
  },
  {
    name: "submit_plan",
    description: "Submit the finished table setup. Call once, when you are done searching.",
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One plain sentence saying what table this is." },
        rows: { type: "array", items: { type: "string" }, description: "Variable names or set keys to describe, down the side of the table." },
        columns: { type: "array", items: { type: "string" }, description: "Variable names to split by, across the top. Empty for a table of everyone." },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              variable: { type: "string" },
              op: { type: "string", enum: ["in", "notIn", "between"] },
              values: { type: "array", items: { type: "string" }, description: "Exact answer labels, for in / notIn." },
              min: { type: "number" },
              max: { type: "number" },
            },
            required: ["variable", "op"],
          },
        },
        statistics: {
          type: "array",
          description: "Only when the request asks for a mean, an average or a mean score of a row: one entry per such row. The answers are always shown too.",
          items: {
            type: "object",
            properties: {
              row: { type: "string", description: "A variable name from rows." },
              statistic: { type: "string", enum: [...PLAN_STATISTICS] },
            },
            required: ["row", "statistic"],
          },
        },
        unclear: { type: "array", items: { type: "string" }, description: "Anything you were unsure about, assumed, or could not do." },
      },
      required: ["summary", "rows", "columns", "filters", "unclear"],
    },
  },
];

const SYSTEM =
  "You turn a researcher's plain-English request into the setup of a survey cross tabulation. You do not compute anything.\n" +
  "- Rows are the questions to describe (down the side). Columns are the groups to compare (across the top).\n" +
  "- 'A by B' or 'A vs B': A is the rows and B is the columns. Say so in the summary.\n" +
  "- A condition such as 'aged 24 to 36', 'women only' or 'in Gauteng' is a filter, not a row or column.\n" +
  "- For a plain number such as age in years, use a 'between' filter with min and max (both ends included). If there is only an age-group variable, use its answers with 'in', but only if the groups line up exactly with the request; otherwise choose the closest and put the mismatch in 'unclear'.\n" +
  "- For a labelled variable use 'in' or 'notIn' with the exact labels from get_categories.\n" +
  "- Use search_variables to find variables. Never invent a variable name or an answer label. If you cannot find something, leave it out and say so in 'unclear'.\n" +
  "- Do not choose a weight, a test or a correction; the researcher sets those.\n" +
  "- If the request asks for a mean, an average or a mean score, list that row under 'statistics' with statistic 'mean'. Never describe a statistic in the summary that you did not list there.\n" +
  "- If the request is vague, give your best setup and list the assumptions in 'unclear'. Finish by calling submit_plan.";

/** Checks a submitted plan against the data file. Returns the plan, or a list of problems for the model to fix. */
async function validate(
  tenantId: string,
  runId: string,
  documentId: string,
  dict: VariableDictionary,
  raw: Record<string, unknown>,
): Promise<{ plan: AskPlan } | { errors: string[] }> {
  const errors: string[] = [];
  const byName = new Map(dict.variables.map((v) => [v.name, v]));
  const setByKey = new Map((dict.sets ?? []).map((s) => [s.key, s]));
  const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);

  const columns: AskPlan["columns"] = [];
  for (const c of arr(raw.columns).map(String)) {
    const v = byName.get(c);
    if (!v) errors.push(`Column "${c}" is not a variable in the file.`);
    else columns.push({ name: v.name, label: v.label });
  }
  const rows: CrosstabRowItem[] = [];
  for (const r of arr(raw.rows).map(String)) {
    const st = setByKey.get(r);
    const v = byName.get(r);
    if (st) rows.push({ key: st.key, label: st.label, stem: st.label, vars: st.vars, kind: st.kind ?? "multi" });
    else if (v) rows.push({ key: v.name, label: v.label, vars: [v.name] });
    else errors.push(`Row "${r}" is not a variable or set in the file.`);
  }
  if (rows.length === 0 && columns.length === 0) errors.push("The plan has no rows and no columns.");

  // Statistics (Grant, 2026-10-22): a mean row above a row's answers. Checked here, at the server
  // boundary: a supported statistic, on a row of this plan. A row that cannot have a mean of codes
  // (text answers, or a set of questions) keeps its answers and the plan says why; a row the engine
  // shows as an average only gets no group.
  const means: string[] = [];
  const averageOnly: string[] = [];
  const notes: string[] = [];
  let overrides: VariableOverrides | null = null;
  for (const st of arr(raw.statistics) as Record<string, unknown>[]) {
    const rowKey = String(st?.row ?? "");
    const statistic = String(st?.statistic ?? "");
    if (!(PLAN_STATISTICS as readonly string[]).includes(statistic)) {
      errors.push(`Statistic "${statistic}" for "${rowKey}" is not supported. Use "mean", or leave it out.`);
      continue;
    }
    const item = rows.find((r) => r.key === rowKey);
    if (!item) {
      errors.push(`Statistic row "${rowKey}" is not one of the plan's rows.`);
      continue;
    }
    if (means.includes(item.key) || averageOnly.includes(item.key)) continue;
    const v = item.vars.length === 1 && !item.kind ? byName.get(item.vars[0]) : undefined;
    if (!v) {
      notes.push(`No mean for ${item.label}: it is a set of questions (multiple-response, grid or battery), so it has no single answer code to average. The table shows its answers.`);
      continue;
    }
    if (!v.numeric) {
      notes.push(`No mean for ${v.label || v.name}: its answers are text, so there are no answer codes to average. The table shows its answers.`);
      continue;
    }
    overrides ??= await loadVariableOverrides(tenantId, runId, documentId);
    if (tabulatedAsAverage(v, overrides[v.name])) {
      averageOnly.push(item.key);
      notes.push(`${v.label || v.name} is shown as an average (it is set as a number, or has many numeric values), so the table gives its average over the people who answered, with the table's weight, and no list of answers.`);
      continue;
    }
    item.groups = [...(item.groups ?? []), meanGroupFor(item.label || item.key)];
    means.push(item.key);
    notes.push(
      `The mean of ${v.label || v.name} is the mean of its numeric answer codes over the people who answered, with the table's weight; declared missing values and don't know, refused and not applicable answers are left out.` +
        ` If its answers are not an ordered scale (such as regions or brands), the mean row is labelled "${UNORDERED_MEAN_NOTE}", and it is only a score if the codes run from low to high.`,
    );
  }

  const filters: CrosstabFilter[] = [];
  for (const f of arr(raw.filters) as Record<string, unknown>[]) {
    const name = String(f.variable ?? "");
    const v = byName.get(name);
    const op = String(f.op ?? "in");
    if (!v) {
      errors.push(`Filter variable "${name}" is not in the file.`);
      continue;
    }
    if (op === "between") {
      const min = typeof f.min === "number" ? f.min : null;
      const max = typeof f.max === "number" ? f.max : null;
      if (!v.numeric) errors.push(`Filter "${name}" is not numeric, so a range does not apply. Use its answers with op "in".`);
      else if (min === null && max === null) errors.push(`Filter "${name}" needs a min, a max, or both.`);
      else filters.push({ variable: name, op: "between", min, max });
    } else if (op === "in" || op === "notIn") {
      const values = arr(f.values).map(String);
      if (values.length === 0) {
        errors.push(`Filter "${name}" needs at least one answer label.`);
        continue;
      }
      const labels = new Set((await loadCategories(tenantId, runId, documentId, name)).categories.map((c) => c.label));
      const bad = values.filter((x) => !labels.has(x));
      if (bad.length) errors.push(`Filter "${name}": no such answer ${bad.map((b) => `"${b}"`).join(", ")}. Valid answers: ${[...labels].slice(0, 40).join(" | ")}.`);
      else filters.push({ variable: name, op, values });
    } else {
      errors.push(`Filter "${name}": unknown op "${op}".`);
    }
  }
  if (errors.length) return { errors };
  const plan = { columns, rows, filters, means, averageOnly };
  return {
    plan: {
      ...plan,
      summary: describePlan(plan),
      unclear: [...arr(raw.unclear).map(String).filter(Boolean), ...notes],
    },
  };
}

export async function planCrosstabFromText(tenantId: string, runId: string, documentId: string, text: string): Promise<AskPlan> {
  const request = text.trim().slice(0, 600);
  if (request.length < 5) throw new Error("Describe the table you want, for example: income by gender for people aged 24 to 36.");
  const dict = await loadVariableDictionary(tenantId, runId, documentId);
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Request: ${request}` }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    await logApiUsage(tenantId, runId, "crosstab_ask", response.usage);
    messages.push({ role: "assistant", content: response.content });
    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) {
      messages.push({ role: "user", content: "Call submit_plan with your best setup." });
      continue;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      if (call.name === "search_variables") {
        results.push({ type: "tool_result", tool_use_id: call.id, content: search(dict, String(input.query ?? "")) });
      } else if (call.name === "get_categories") {
        try {
          const list = await loadCategories(tenantId, runId, documentId, String(input.variable ?? ""));
          const shown = list.categories.slice(0, 60).map((c) => c.label).join(" | ");
          results.push({ type: "tool_result", tool_use_id: call.id, content: `${list.label}: ${shown}${list.categories.length > 60 ? ` ... (${list.categories.length} answers in all)` : ""}` });
        } catch (e) {
          results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: e instanceof Error ? e.message : "Could not read the categories." });
        }
      } else if (call.name === "submit_plan") {
        const checked = await validate(tenantId, runId, documentId, dict, input);
        if ("plan" in checked) return checked.plan;
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: `Fix these and submit again:\n${checked.errors.join("\n")}` });
      } else {
        results.push({ type: "tool_result", tool_use_id: call.id, is_error: true, content: "Unknown tool." });
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Could not settle on a table from that request. Try naming the variables more directly.");
}
