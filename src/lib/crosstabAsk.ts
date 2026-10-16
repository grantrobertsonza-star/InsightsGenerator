import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { loadCategories, loadVariableDictionary } from "./crosstabs";
import type { CrosstabFilter, CrosstabRowItem, VariableDictionary, VariableInfo } from "./parseStatsFile";
import { isLookupEligible, isStringCategory } from "./variableKinds";

/** What a plain-English request turns into. Nothing runs from this: the researcher reads it and decides. */
export type AskPlan = {
  /** One plain sentence saying what was understood. */
  summary: string;
  columns: { name: string; label: string }[];
  rows: CrosstabRowItem[];
  filters: CrosstabFilter[];
  /** Things the model was not sure about, or could not do, for the researcher to settle. */
  unclear: string[];
};

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
  return {
    plan: {
      summary: String(raw.summary ?? ""),
      columns,
      rows,
      filters,
      unclear: arr(raw.unclear).map(String).filter(Boolean),
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
