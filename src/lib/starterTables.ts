import type { CrosstabRowItem, VariableDictionary, VariableInfo } from "./parseStatsFile";
import { isStringCategory } from "./variableKinds";
import { isTenPointScale, meanGroupFor } from "./meanRow";

// A small, opt-in starting set of tables: the usual demographic splits (gender,
// age, province and so on, and customer groupings such as segment), or columns the researcher
// chooses, against the questions in the file. It only plans;
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
  // Income and household stage (Grant, 30 October 2026: segment "on a segment (age, gender, etc.)", income named),
  // ranked after the demographics above, so a starter set with those keeps them first.
  /\bincome\b|\bLSM\b|socio-?economic/i,
  /life ?stage|household (type|composition|size)|marital/i,
  // Customer and sample groupings (Grant, 2026-10-22: a call-centre tracker split only by Segment
  // got no starter set). Ranked after the demographics, so a file with both splits by those first.
  /segment|cohort|\btier\b|customer (type|group|class)|member type|\bchannel\b|\bbranch\b|\bstore\b|\bsite\b/i,
];

/**
 * Which kind of profile question a variable is, by its name read as words and its label: the index of the first
 * DEMOGRAPHICS pattern it matches (gender 0, age 1, ... customer groupings last), or -1 when it is none. The one
 * recognition of demographic and profile questions: starter tables split by these, and a tracker dashboard's
 * segment is built from them (trackerSegment.segmentQuestionsOf).
 */
export function demographicKindOf(name: string, label: string): number {
  const text = `${nameAsWords(name)} ${label}`;
  return DEMOGRAPHICS.findIndex((re) => re.test(text));
}

const LIMITS = {
  small: { banners: 4, questions: 40 },
  large: { banners: 3, questions: 20 },
};

export type StarterPlan = {
  small: boolean;
  weightVar: string | null;
  banners: { name: string; label: string }[];
  /** True when the banners are the researcher's choice rather than the recognised ones. */
  chosen: boolean;
  /**
   * Every variable that can be a banner (categorical, 2 to 10 answers, at least 90% answering),
   * recognised ones first, for the researcher to choose from when none is recognised or the
   * recognised ones are not the right split.
   */
  candidates: { name: string; label: string; recognised: boolean }[];
  /** The most banners one starter set builds. */
  maxBanners: number;
  items: CrosstabRowItem[];
  /** Questions that qualified, before the cap. */
  eligibleQuestions: number;
  /** How many of the planned questions are 10 or 11 point scales shown with their mean. */
  meanScales: number;
};

export function defaultWeight(dict: VariableDictionary): string | null {
  const weights = dict.variables.filter((v) => v.weightLike);
  return (weights.find((w) => /bench|person/i.test(`${w.name} ${w.label}`)) ?? weights[0])?.name ?? null;
}

// A text column whose answers repeat within a short list ("Segment1", "Yes"/"No") is a category
// too (isStringCategory, the shared rule); a spreadsheet such as csm_Wave1_Baseline.xlsx stores
// every answer that way, and leaving them out left its starter set empty.
function isCategorical(v: VariableInfo): boolean {
  return !v.weightLike && (!v.text || isStringCategory(v)) && !v.inSet && !v.isFlag && v.nDistinct >= 2 && v.nDistinct <= 15;
}

/** A name as words, so "CustomerTier" or "age_group" is read like a label ("Customer Tier", "age group"). */
function nameAsWords(name: string): string {
  return name.replace(/[_.-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function isBannerCandidate(v: VariableInfo): boolean {
  return isCategorical(v) && v.nDistinct <= 10 && v.pctValid >= 90;
}

/**
 * Checks the researcher's chosen banners against the file: each must be a banner candidate, none
 * repeated, at most the set's limit. Returns the problem in words, or null when they are fine.
 */
export function chosenBannersProblem(dict: VariableDictionary, names: string[]): string | null {
  const limit = (dict.variables.length <= STARTER_SMALL_FILE_VARIABLES ? LIMITS.small : LIMITS.large).banners;
  if (names.length === 0) return "Choose at least one column to split by.";
  if (names.length > limit) return `Choose at most ${limit} columns to split by.`;
  if (new Set(names).size !== names.length) return "A column to split by was chosen twice.";
  const byName = new Map(dict.variables.map((v) => [v.name, v]));
  const bad = names.filter((n) => {
    const v = byName.get(n);
    return !v || !isBannerCandidate(v);
  });
  if (bad.length) return `Not a column to split by in this file (it needs 2 to 10 answers and at least 90% answering): ${bad.join(", ")}.`;
  return null;
}

/**
 * Plans the starter set. `chosenBanners`, when given, replaces the recognised banners; it must
 * pass chosenBannersProblem (the server action checks before building).
 */
export function planStarterTables(dict: VariableDictionary, chosenBanners?: string[]): StarterPlan {
  const small = dict.variables.length <= STARTER_SMALL_FILE_VARIABLES;
  const limit = small ? LIMITS.small : LIMITS.large;

  const banners: { name: string; label: string; rank: number }[] = [];
  const candidates: { name: string; label: string; rank: number }[] = [];
  for (const v of dict.variables) {
    if (!isBannerCandidate(v)) continue;
    const rank = demographicKindOf(v.name, v.label);
    candidates.push({ name: v.name, label: v.label, rank });
    if (rank >= 0) banners.push({ name: v.name, label: v.label, rank });
  }
  banners.sort((a, b) => a.rank - b.rank);
  // One banner per kind of demographic, so two gender-like variables do not both take a slot.
  const seenRank = new Set<number>();
  const recognised = banners
    .filter((b) => (seenRank.has(b.rank) ? false : (seenRank.add(b.rank), true)))
    .slice(0, limit.banners);
  const byName = new Map(dict.variables.map((v) => [v.name, v]));
  const chosen = chosenBanners
    ? chosenBanners.flatMap((n) => {
        const v = byName.get(n);
        return v ? [{ name: v.name, label: v.label }] : [];
      })
    : recognised;
  const bannerNames = new Set(chosen.map((b) => b.name));

  const items: CrosstabRowItem[] = [];
  for (const s of dict.sets ?? []) {
    if (s.pctValid < 30) continue;
    items.push({ key: s.key, label: s.label, stem: s.label, vars: s.vars, kind: s.kind ?? "multi" });
  }
  for (const v of dict.variables) {
    if (bannerNames.has(v.name) || !isCategorical(v) || v.pctValid < 30) continue;
    // A 10 or 11 point scale gets its mean above the answers (isTenPointScale), the distribution kept.
    items.push({ key: v.name, label: v.label, vars: [v.name], ...(isTenPointScale(v) ? { groups: [meanGroupFor(v.label || v.name)] } : {}) });
  }

  return {
    small,
    weightVar: defaultWeight(dict),
    banners: chosen.map(({ name, label }) => ({ name, label })),
    chosen: Boolean(chosenBanners),
    // Recognised first (in their order), then the rest in file order.
    candidates: [...candidates]
      .sort((a, b) => (a.rank < 0 ? 1 : 0) - (b.rank < 0 ? 1 : 0) || (a.rank >= 0 && b.rank >= 0 ? a.rank - b.rank : 0))
      .map(({ name, label, rank }) => ({ name, label, recognised: rank >= 0 })),
    maxBanners: limit.banners,
    items: items.slice(0, limit.questions),
    eligibleQuestions: items.length,
    meanScales: items.slice(0, limit.questions).filter((i) => i.groups?.some((g) => g.kind === "mean")).length,
  };
}
