// Describes every variable (column) of a raw, case-level table so a researcher
// can set up cross-tabs on a wide survey without reading 1,800 column names.
// Pure and synchronous: it reads only the table's headers and rows.
//
// Each variable gets a kind (category, flag, scale, number, or text/ID, which
// is held back from the lists), and variables that belong together (a battery
// of 0 to 10 ratings, or a multi-response question stored as many 0/1 flag
// columns) are grouped so they can be picked as one question.

type Row = Record<string, string | number | null>;

export type VariableKind = "category" | "flag" | "scale" | "number" | "text";

export type VariableProfile = {
  name: string;
  kind: VariableKind;
  distinct: number;
  missingPct: number;
  // The role the app would suggest: segment the data by it, or measure it.
  suggestedRole: "across" | "measure" | null;
};

export type VariableGroup = {
  key: string;
  label: string;
  // multi_response: every member is a 0/1 flag. battery: other shared-prefix
  // columns (for example a set of 0 to 10 ratings).
  type: "multi_response" | "battery";
  members: string[];
};

const ID_NAME = /(^|[_\s-])(id|uuid|guid|index|key)$|^id[_\s-]|respondent.?id|^row$/i;
// Survey design and identifier variables (weights, area and place codes,
// IDs) are never outcomes to compare, even though they are numeric.
const DESIGN_OR_CODE_NAME =
  /weight|wgt|\bcode\b|identifier|\bid\b|^ea\b|percentage of the ea\b|sub place|township (id|name)/i;
const MAX_CATEGORIES = 10;
const MAX_SCALE_VALUES = 11;
const MIN_GROUP_SIZE = 3;

export function profileVariables(headers: string[], rows: Row[]): VariableProfile[] {
  const n = rows.length;
  return headers.map((name) => {
    const values: (string | number)[] = [];
    for (const r of rows) {
      const v = r[name];
      if (v !== null && v !== undefined && v !== "") values.push(v);
    }
    const counts = new Map<string, number>();
    for (const v of values) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
    const distinct = counts.size;
    const missingPct = n === 0 ? 0 : Math.round(((n - values.length) / n) * 1000) / 10;
    const base = { name, distinct, missingPct };

    if (values.length < 3 || distinct < 2) {
      return { ...base, kind: "text" as const, suggestedRole: null };
    }
    const numeric = values.every((v) => typeof v === "number");
    // Text with nearly all distinct values is free text or an ID. A numeric
    // column is only treated that way when it is a serial number (whole
    // numbers, all different); a measurement such as spend can be nearly
    // all distinct and is still a measure.
    const serialNumbers =
      numeric && distinct === values.length && (values as number[]).every((v) => Number.isInteger(v));
    if (
      ID_NAME.test(name.trim()) ||
      DESIGN_OR_CODE_NAME.test(name.trim()) ||
      serialNumbers ||
      (!numeric && distinct >= values.length * 0.9)
    ) {
      return { ...base, kind: "text" as const, suggestedRole: null };
    }
    if (numeric) {
      const nums = values as number[];
      const keys = new Set(nums);
      const isFlag = keys.size === 2 && nums.every((v) => v === 0 || v === 1);
      if (isFlag) return { ...base, kind: "flag" as const, suggestedRole: "measure" as const };
      const wholeNumbers = nums.every((v) => Number.isInteger(v));
      if (wholeNumbers && keys.size <= MAX_SCALE_VALUES) {
        return { ...base, kind: "scale" as const, suggestedRole: "measure" as const };
      }
      return { ...base, kind: "number" as const, suggestedRole: "measure" as const };
    }
    if (distinct <= MAX_CATEGORIES) {
      const smallest = Math.min(...counts.values());
      return {
        ...base,
        kind: "category" as const,
        suggestedRole: smallest >= 10 ? ("across" as const) : null,
      };
    }
    return { ...base, kind: "text" as const, suggestedRole: null };
  });
}

/**
 * Groups variables that share the text before their first underscore (at
 * least three of them), such as CallReason_Billing, CallReason_Complaint and
 * CallReason_Other. Variables left over stay on their own.
 */
export function groupVariables(profiles: VariableProfile[]): VariableGroup[] {
  const byKey = new Map<string, VariableProfile[]>();
  for (const p of profiles) {
    if (p.kind === "text") continue;
    const cut = p.name.indexOf("_");
    if (cut < 3) continue;
    const key = p.name.slice(0, cut);
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  const groups: VariableGroup[] = [];
  for (const [key, members] of byKey) {
    if (members.length < MIN_GROUP_SIZE) continue;
    const allFlags = members.every((m) => m.kind === "flag");
    groups.push({
      key,
      label: key,
      type: allFlags ? "multi_response" : "battery",
      members: members.map((m) => m.name),
    });
  }
  return groups;
}
