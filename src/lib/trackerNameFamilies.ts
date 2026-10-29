// D2 (Grant, 29 October 2026): "it will 90% be standard raw files": SPSS, Excel, text, R, Python, often with no
// answer lists and no codebook. In such a file a tracker's brands are only in the variables' names or labels
// ("Aware_PlatoCoffee", "awareness: Kora Coffee"), so the labelled brand list D1 looks for (findBrandFrame in
// trackerRoles.ts) does not exist. This finds the brand list the way a researcher reading the file would: the
// list of items that recurs across many questions asked once per item.
//   - A family is a set of variables whose names are the same except at one "_"-separated position, the slot
//     (Aware_PlatoCoffee, Aware_MuggBean, ... is the family "Aware_*"). The slot's value is the item's code:
//     the variable's identity, kept as written; its label is the varying part of the variables' labels
//     ("awareness: Kora Coffee" gives "Kora Coffee" for awareness_b1), else the code's words ("Plato Coffee").
//   - The brand list is the item list shared by the most families (at least three families, each with at least
//     three of its items, and at least 80% of a family's items in the list). A list of answers asked of every
//     brand (buying situations, attributes) recurs in fewer families than the brands it is asked about.
//   - A code with no meaning of its own (b1, 3, m10) is accepted only when the labels give each code one name,
//     the same in every family: without that, Q1_1 ... Q3_5 would read as a list of brands "1" to "5".
//   - Items that are not brands ("none of these brands", "Other", "Don't know") are set aside by their words.
// Variables that describe the survey design rather than an answer (module selection, response status,
// selection probability, inverse selection weight) are left out.
// Pure: no reads. Used by recogniseTracker only when no labelled brand list is found; the researcher confirms
// the list (the "focal-brand" and "non-brand-codes" questions) as for a labelled one.
import type { RoleVariable } from "./trackerRoles";

export type NameFamily = {
  /** The names with the slot as "*" ("Aware_*", "moment_m1_*"). */
  template: string;
  /** Position of the slot among the name's "_"-separated parts. */
  slot: number;
  members: { variable: string; code: string }[];
};

export type NameBrandFrame = {
  brands: { code: string; label: string }[];
  nonBrand: { code: string; label: string }[];
  /** Families whose items are the brands: one variable per brand. */
  families: NameFamily[];
  /** Each item code's label, as read. */
  labels: Map<string, string>;
};

const NOT_BRAND = /^(other|others|none|none of (the|these)|no brand|no attributes|don'?t know|do not know|dk|not sure|nothing|refused|na|n\/a)\b/i;
export const DESIGN_VARIABLE = /\b(module selected|selection probability|response status|inverse selection weight|selection weight)\b/i;
const CODE_ONLY = /^[a-z]{0,3}\d{1,3}$/i;

/** A name's words: "AgentEmpathy_Courtesy_0to10" is "Agent Empathy Courtesy 0 to 10". */
export function nameWords(name: string): string {
  return name
    .replace(/(\d)to(\d)/gi, "$1 to $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_.]+/g, " ")
    .replace(/([a-z]{3,})(\d{1,2})\b/gi, "$1 $2") // continue5, csat5: a word and its scale size
    .replace(/\bM(a?)c ([A-Z])/g, "M$1c$2") // McCafe, MacDonald: one word
    .replace(/\s+/g, " ")
    .trim();
}

/** The wording a variable carries: its label when it has one, else its name's words. */
export function wordingOf(v: { name: string; label: string }): string {
  return v.label && v.label.trim() !== v.name ? v.label : nameWords(v.name);
}

/**
 * True when a file's per-brand questions number their brands (b01 ... b10, 1 ... 10) without naming them
 * anywhere: the brands can then only be named from a codebook or a labels file, never guessed.
 */
export function numberedBrandsWithoutNames(variables: RoleVariable[]): boolean {
  const usable = variables.filter((v) => !DESIGN_VARIABLE.test(v.label));
  const byName = new Map(usable.map((v) => [v.name, v]));
  const coded = nameFamilies(usable).filter((f) => f.members.every((m) => CODE_ONLY.test(m.code)) && !varyingLabels(f, byName));
  const lists = new Map<string, number>();
  for (const f of coded) {
    const key = f.members.map((m) => m.code).sort().join("|");
    lists.set(key, (lists.get(key) ?? 0) + 1);
  }
  return [...lists.values()].some((n) => n >= 3);
}

export function nameFamilies(variables: RoleVariable[]): NameFamily[] {
  const byTemplate = new Map<string, NameFamily>();
  for (const v of variables) {
    const parts = v.name.split("_");
    if (parts.length < 2) continue;
    parts.forEach((code, slot) => {
      if (!code) return;
      const template = parts.map((p, i) => (i === slot ? "*" : p)).join("_");
      const f = byTemplate.get(template) ?? { template, slot, members: [] };
      f.members.push({ variable: v.name, code });
      byTemplate.set(template, f);
    });
  }
  return [...byTemplate.values()].filter((f) => f.members.length >= 3);
}

/** The part of each member's label that differs between members ("awareness: Kora Coffee" -> "Kora Coffee"). */
function varyingLabels(family: NameFamily, byName: Map<string, RoleVariable>): Map<string, string> | null {
  const split = family.members.map((m) => {
    const v = byName.get(m.variable)!;
    return v.label && v.label.trim() !== v.name ? v.label.split(/\s*:\s*|\s+[-–]\s+/).map((s) => s.trim()) : null;
  });
  if (split.some((s) => !s) || new Set(split.map((s) => s!.length)).size !== 1) return null;
  const n = split[0]!.length;
  const varying = [...Array(n).keys()].filter((i) => new Set(split.map((s) => s![i].toLowerCase())).size > 1);
  if (varying.length !== 1) return null;
  return new Map(family.members.map((m, i) => [m.code, split[i]![varying[0]]]));
}

/**
 * `isQuestionWording` tells a question's wording ("aware", "consider") from a name: a file whose brands are
 * numbered (consider_b01 ... consider_b10) without their names has families the other way round too
 * (aware_b01, consider_b01, ... is the family "*_b01"), whose items are the questions. Such a list is never
 * taken for the brands.
 */
export function brandFrameFromNames(variables: RoleVariable[], isQuestionWording: (text: string) => boolean = () => false): NameBrandFrame | null {
  const usable = variables.filter((v) => !DESIGN_VARIABLE.test(v.label));
  const byName = new Map(usable.map((v) => [v.name, v]));
  const families = nameFamilies(usable);
  // Each item code's label, from every family that names it; a code given two names is not a name.
  const named = new Map<string, Set<string>>();
  for (const f of families) {
    const labels = varyingLabels(f, byName);
    if (!labels) continue;
    for (const [code, label] of labels) named.set(code, (named.get(code) ?? new Set()).add(label));
  }
  const labelOf = (code: string): string | null => {
    const n = named.get(code);
    if (n && n.size === 1) return [...n][0];
    if (CODE_ONLY.test(code)) return null;
    return nameWords(code);
  };
  const itemsOf = (f: NameFamily) => f.members.map((m) => m.code);
  const isBrandish = (code: string) => {
    const l = labelOf(code);
    return l !== null && !NOT_BRAND.test(l) && !NOT_BRAND.test(code);
  };
  // Candidate lists: each family's items that could be names.
  let best: { list: string[]; families: NameFamily[] } | null = null;
  for (const f of families) {
    const list = itemsOf(f).filter(isBrandish);
    if (list.length < 3) continue;
    if (list.filter((c) => isQuestionWording(labelOf(c) ?? c)).length >= 2) continue;
    const set = new Set(list);
    const covering = families.filter((g) => {
      const items = itemsOf(g).filter((c) => !NOT_BRAND.test(c) && !NOT_BRAND.test(labelOf(c) ?? ""));
      const inList = items.filter((c) => set.has(c)).length;
      return inList >= 3 && inList >= items.length * 0.8;
    });
    if (covering.length < 3) continue;
    if (!best || covering.length > best.families.length || (covering.length === best.families.length && list.length > best.list.length)) best = { list, families: covering };
  }
  if (!best) return null;
  const brandSet = new Set(best.list);
  // Brand order as the file gives it (the first family listing them all, else the longest).
  const order = [...best.families].sort((a, b) => b.members.length - a.members.length)[0];
  const ordered = [...itemsOf(order).filter((c) => brandSet.has(c)), ...best.list.filter((c) => !itemsOf(order).includes(c))];
  const nonBrand = new Map<string, string>();
  for (const f of best.families) for (const c of itemsOf(f)) if (!brandSet.has(c) && !nonBrand.has(c)) nonBrand.set(c, labelOf(c) ?? nameWords(c));
  const labels = new Map<string, string>();
  for (const c of [...ordered, ...nonBrand.keys()]) labels.set(c, labelOf(c) ?? nameWords(c));
  return {
    brands: ordered.map((code) => ({ code, label: labels.get(code)! })),
    nonBrand: [...nonBrand].map(([code, label]) => ({ code, label })),
    families: best.families,
    labels,
  };
}
