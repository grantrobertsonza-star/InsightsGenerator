import type { CrosstabRowItem, VariableDictionary, VariableInfo } from "./parseStatsFile";

// A small, opt-in starting set of tables: the usual demographic splits (gender,
// age, province and so on) against the questions in the file. It only plans;
// building and committing are separate steps, so nothing reaches Findings
// until a person commits. Kept pure so it can be tested without a database.

/** At or under this many variables the starter set is offered prominently and is larger. */
export const STARTER_SMALL_FILE_VARIABLES = 100;

const DEMOGRAPHICS: RegExp[] = [
  /\b(gender|sex)\b/i,
  /\bage\b|age ?group|agegrp|age band/i,
  /province|region/i,
  /urban|rural|settlement|geotype|area type/i,
  /population group|\brace\b|ethnic/i,
  /education|highest (level|grade)/i,
  /employment|work status/i,
];

const LIMITS = {
  small: { banners: 4, questions: 40 },
  large: { banners: 3, questions: 20 },
};

export type StarterPlan = {
  small: boolean;
  weightVar: string | null;
  banners: { name: string; label: string }[];
  items: CrosstabRowItem[];
  /** Questions that qualified, before the cap. */
  eligibleQuestions: number;
};

export function defaultWeight(dict: VariableDictionary): string | null {
  const weights = dict.variables.filter((v) => v.weightLike);
  return (weights.find((w) => /bench|person/i.test(`${w.name} ${w.label}`)) ?? weights[0])?.name ?? null;
}

function isCategorical(v: VariableInfo): boolean {
  return !v.weightLike && !v.text && !v.inSet && !v.isFlag && v.nDistinct >= 2 && v.nDistinct <= 15;
}

export function planStarterTables(dict: VariableDictionary): StarterPlan {
  const small = dict.variables.length <= STARTER_SMALL_FILE_VARIABLES;
  const limit = small ? LIMITS.small : LIMITS.large;

  const banners: { name: string; label: string; rank: number }[] = [];
  for (const v of dict.variables) {
    if (!isCategorical(v) || v.nDistinct > 10 || v.pctValid < 90) continue;
    const text = `${v.name} ${v.label}`;
    const rank = DEMOGRAPHICS.findIndex((re) => re.test(text));
    if (rank >= 0) banners.push({ name: v.name, label: v.label, rank });
  }
  banners.sort((a, b) => a.rank - b.rank);
  // One banner per kind of demographic, so two gender-like variables do not both take a slot.
  const seenRank = new Set<number>();
  const chosen = banners
    .filter((b) => (seenRank.has(b.rank) ? false : (seenRank.add(b.rank), true)))
    .slice(0, limit.banners);
  const bannerNames = new Set(chosen.map((b) => b.name));

  const items: CrosstabRowItem[] = [];
  for (const s of dict.sets ?? []) {
    if (s.pctValid < 30) continue;
    items.push({ key: s.key, label: s.label, stem: s.label, vars: s.vars, kind: s.kind ?? "multi" });
  }
  for (const v of dict.variables) {
    if (bannerNames.has(v.name) || !isCategorical(v) || v.pctValid < 30) continue;
    items.push({ key: v.name, label: v.label, vars: [v.name] });
  }

  return {
    small,
    weightVar: defaultWeight(dict),
    banners: chosen.map(({ name, label }) => ({ name, label })),
    items: items.slice(0, limit.questions),
    eligibleQuestions: items.length,
  };
}
