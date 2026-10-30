// The brand dashboard extension's figures (Grant's packs of 30 October 2026, "03 Claude Dashboard Extension Guide";
// contract claude/brand-extension.md). Three independent rating modules, never averaged into one score:
//   E1 needs fit, E2 differentiation, E3 price justification, each per brand among respondents aware of it:
//     - valid ratings are the scale's five codes (1 to 5) among the aware: the distribution is each code's weighted
//       count / the weighted count of valid ratings x 100; top-two-box is the weighted count of the scale's top two
//       codes (4 or 5) / the weighted count of valid ratings x 100; the mean of the five codes is offered, labelled
//       as the 1 to 5 agreement scale, beside the distribution;
//     - cannot judge (this question's own code, 9: "Do not know enough to judge", "Not familiar enough with its prices
//       to judge") is the weighted count giving it / the weighted count aware x 100: on the aware (asked) base, never
//       on the valid base, never neutral, never missing;
//     - an aware respondent with no answer is "missing", shown apart and never added to the valid base; an answer from
//       a respondent not aware is a route break, counted and shown (never in any base);
//   E4/E5 the brand actually chosen and the brand ideally preferred for the same most recent event:
//     - each answer's identity: a tracked brand by its answer code (mapped to the brand list by label), an Other by its
//       name (trimmed, case-folded, whitespace collapsed; confirmed aliases applied), unresolved when an Other has no
//       name; 98 (no particular ideal) and 99 (cannot recall) are statuses, never brands;
//     - the paired-known base: eligible respondents whose actual and ideal identities are both known. Ideal and actual
//       shares are each identity's weighted count / the weighted paired base x 100, on that identical base;
//     - the gap rate: weighted pairs whose identities differ / the weighted paired base x 100 (the app's own pairing,
//       compared with the file's derived gap flag when there is one);
//     - preference fulfilment for brand b: weighted pairs with ideal b and actual b / weighted pairs with ideal b x 100
//       (fulfilment among b's ideal preferrers, not conversion);
//   E6 reasons, asked only when the ideal and actual brands differ (the file's gap flag selects those asked):
//     - each reason: weighted selections / the weighted gap respondents with a completed answer (at least one reason or
//       one exclusive option selected) x 100; the exclusive "no reason" and "cannot recall" shares on the same base;
//       an unanswered E6 is missing, never "no reason";
//     - by brand: the same, among respondents whose ideal brand is b and whose brands differ.
// Every figure comes from the Cross tab engine through computeCrosstab (nothing saved), with the chosen weight and the
// file's survey design, respondents selected by raw answer codes (engine "between" filters on a code, "in" filters on
// an Other name's own text), never by an answer label. Weighted counts are the engine's unrounded countExact. Bases:
// unweighted n, weighted base, and Kish effective base when the engine gives it for exactly that base.
// Unknown stays unknown: a construct the file lacks is "not_measured"; one in review is "needs_review"; a measured
// figure with no valid base is n/a ("Not available"), never 0%. A file that cannot be read throws with the reason.
import { computeCrosstab, loadCategories, loadVariableDictionaryWithStatus } from "./crosstabs";
import { loadDataSetupWithStatus } from "./dataSetup";
import { effectiveDesignChoice, resolveSurveyDesign } from "./surveyDesign";
import { loadTrackerDashboard } from "./trackerDashboards";
import { loadRoleInput } from "./trackerInput";
import { answersOf, overviewMeasures, selectedCode } from "./trackerFigures";
import { awareBasesFromResult } from "./trackerAssociations";
import { smallBaseLevel } from "./trackerAudience";
import { loadBrandExtensionConfirmations, type StoredConfirmations } from "./brandExtensionConfirmations";
import {
  CONSTRUCT_TITLE,
  RATING_CONSTRUCTS,
  identityKey,
  normaliseBrandName,
  recogniseBrandExtension,
  resolveOther,
  withConfirmations,
  type BrandAlias,
  type BrandExtensionRecognition,
  type BrandIdentity,
  type Detection,
  type EpisodeQuestions,
  type ExtensionConstruct,
  type RatingConstruct,
  type RatingFamily,
  type ReasonQuestions,
} from "./brandExtensionRoles";
import type { CrosstabFilter, CrosstabRequest, CrosstabResult } from "./parseStatsFile";
import type { ResolvedDashboard } from "./trackerDashboard";
import type { RoleVariable, TrackerRecognition } from "./trackerRoles";

export type Base = { n: number | null; weighted: number | null; effective: number | null };
export type Unavailable = { status: "not_measured" | "needs_review" | "mapping_needed"; reason: string };
export type SmallBase = "ok" | "small" | "very_small" | "none";

/** One brand's rating on one construct. Percentages are unrounded; null with `reason` when not available. */
export type BrandRating = {
  code: string;
  label: string;
  variable: string;
  /** Aware (asked) respondents: the awareness question's selected code for this brand. */
  aware: { n: number | null; weighted: number | null };
  /** Valid ratings: the scale's five codes among the aware. */
  valid: Base;
  cannotJudge: { n: number; weighted: number; share: number | null };
  /** Aware respondents with no answer (not asked would be outside the aware base): shown apart. */
  missing: { n: number; weighted: number };
  /** Answer codes neither on the scale nor cannot judge, among the aware: shown apart, never valid. */
  otherCodes: { code: string; n: number; weighted: number }[];
  /** Respondents not aware of the brand who still hold a rating (a route break): never in any base. */
  answeredNotAware: number | null;
  /** Each scale code's share of the valid ratings. */
  distribution: { code: string; label: string; n: number; weighted: number; share: number | null }[];
  topTwo: number | null;
  /** Mean of the 1 to 5 agreement codes among valid ratings. */
  mean: number | null;
  /** 95% interval for top-two-box, weights-only approximation p +/- 1.96 sqrt(p(1-p)/n_eff); null below 30 valid. */
  topTwoInterval: [number, number] | null;
  smallBase: SmallBase;
  reason?: string;
};

export type RatingModule =
  | {
      status: "ok";
      construct: RatingConstruct;
      family: RatingFamily;
      awareness: { group: string; label: string };
      brands: BrandRating[];
      routeBreaks: number;
    }
  | Unavailable;

export type ShareRow = {
  key: string;
  kind: "brand" | "other";
  code: string | null;
  label: string;
  /** Named Other brands inside the aggregated Other row (their resolved names, with each one's counts). */
  members?: { name: string; actual: number; ideal: number }[];
  actual: { n: number; weighted: number; share: number | null };
  ideal: { n: number; weighted: number; share: number | null };
  /** Ideal share minus actual share, in points: a descriptive net share gap, not people who missed their preference. */
  netGap: number | null;
};

export type StatusRow = { key: "no_episode" | "no_particular_ideal" | "cannot_recall" | "unresolved_other" | "missing_answer" | "unexpected_code"; label: string; n: number; weighted: number };

export type Fulfilment = {
  code: string;
  label: string;
  preferrers: { n: number; weighted: number };
  fulfilled: { n: number; weighted: number };
  rate: number | null;
  smallBase: SmallBase;
  /** Where the brand's ideal preferrers actually went, by identity. */
  destinations: { key: string; label: string; n: number; weighted: number; share: number | null }[];
};

export type EpisodeModule =
  | {
      status: "ok";
      questions: EpisodeQuestions;
      episodeBase: { n: number; weighted: number } | null;
      asked: { n: number; weighted: number };
      paired: Base;
      statuses: StatusRow[];
      shares: ShareRow[];
      gap: { n: number; weighted: number; rate: number | null };
      fulfilment: Fulfilment[];
      /** The file's own gap flag against the app's pairing: equal counts, or the difference said. */
      storedGap: { variable: string; agrees: boolean; stored: { n: number; weighted: number }; derived: { n: number; weighted: number }; note: string } | null;
      /** Other names typed exactly as a tracked brand's name: offered for confirmation as an alias, never matched by a guess. */
      aliasSuggestions: { name: string; verbatim: string[]; code: string; label: string }[];
      /** Every Other name read, by resolved identity, with its verbatim spellings. */
      otherNames: { name: string; verbatim: string[]; resolvedTo: string }[];
    }
  | Unavailable;

export type ReasonRow = { variable: string; label: string; n: number; weighted: number; share: number | null };
export type ReasonFigures = {
  eligible: { n: number; weighted: number };
  completed: Base;
  missing: { n: number; weighted: number };
  reasons: ReasonRow[];
  none: ReasonRow | null;
  cannotRecall: ReasonRow | null;
  smallBase: SmallBase;
};
export type ReasonsModule =
  | {
      status: "ok";
      questions: ReasonQuestions;
      gapVariable: string;
      overall: ReasonFigures;
      byBrand: ({ code: string; label: string } & ReasonFigures)[];
      /** Respondents with an exclusive option and another selection (never allowed): counted, kept in the base, said. */
      exclusiveConflicts: number;
      /** The Other reason text against "Another reason": selected, selected with text written, text written without
       * it selected (never allowed). Null when the file has no such text. */
      otherText: { selected: number; selectedWithText: number; textWithoutSelection: number } | null;
    }
  | Unavailable;

export type ExtensionDiagnostics = {
  construct: ExtensionConstruct;
  title: string;
  status: "found" | "needs_review" | "not_measured";
  reason: string | null;
  question: string | null;
  sourceFields: string[];
  valueLabels: { variable: string; labels: { code: string; label: string }[] }[];
  universe: string;
  denominator: string;
  evidence: string[];
  candidates: { key: string; description: string }[];
  confirmed: { by: string | null; at: string } | null;
};

export type BrandExtension = {
  documentId: string;
  weighted: boolean;
  weightVar: string | null;
  /** Whether the file has a weight at all (the page offers weighted only then). */
  weightAvailable: boolean;
  weightNote: string | null;
  audience: { variable: string; label: string; code: string; codeLabel: string } | null;
  brands: { code: string; label: string }[];
  focalBrand: { code: string; label: string } | null;
  recognition: BrandExtensionRecognition;
  diagnostics: ExtensionDiagnostics[];
  confirmations: { scopeKey: string; revision: number | null; storageAvailable: boolean; aliases: BrandAlias[] };
  ratings: Record<RatingConstruct, RatingModule>;
  episode: EpisodeModule;
  reasons: ReasonsModule;
  /** Audience choices offered: single-choice questions asked once with an answer list (by code). */
  audienceOptions: { variable: string; label: string; answers: { code: string; label: string }[] }[];
};

export type ExtensionOptions = { weighted?: boolean | null; audience?: { variable: string; code: string } | null };

const pct = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
const small = (n: number | null): SmallBase => (n === null || n === 0 ? "none" : smallBaseLevel(n));
/** Weighted counts that are differences of engine sums: a residue below this is rounding, not respondents. */
const EPS = 1e-9;
const clampZero = (x: number) => (Math.abs(x) < EPS ? 0 : x);

// ---- Reading a computed table ------------------------------------------------------------------------------

/** Every answer code of one row variable in a computed table: unrounded weighted count and unweighted count. */
export function codeCounts(result: CrosstabResult, variable: string): Map<string, { n: number; weighted: number }> {
  const out = new Map<string, { n: number; weighted: number }>();
  for (const a of answersOf(result, variable).answers) out.set(a.code, { n: a.n ?? 0, weighted: a.weighted ?? 0 });
  return out;
}

/** The Kish effective base and unweighted count of a row variable's valid answers in a computed table. */
function rowBase(result: CrosstabResult, variable: string): { n: number; nEff: number } | null {
  const q = result.questions.find((x) => x.key === variable);
  const b = q?.rows.find((r) => r.isBase && !r.isEffBase)?.total.base;
  return b ? { n: b.n, nEff: b.nEff } : null;
}

/** A NET row's (kind "nets") unrounded weighted count and unweighted count of respondents who selected any option. */
function netCount(result: CrosstabResult, key: string): { n: number; weighted: number; base: { n: number; nEff: number } | null } | null {
  const q = result.questions.find((x) => x.key === key);
  const row = q?.rows.find((r) => !r.isBase && typeof r.label === "string" && r.label.startsWith("NET:"));
  if (!q || !row) return null;
  const base = q.rows.find((r) => r.isBase && !r.isEffBase)?.total.base;
  return { n: row.total.nCell ?? 0, weighted: row.total.countExact ?? row.total.count ?? 0, base: base ? { n: base.n, nEff: base.nEff } : null };
}

// ---- E1 to E3 ----------------------------------------------------------------------------------------------

/**
 * One brand's rating figures from its tables: `aware` (the rating among the aware: every code, cannot judge kept,
 * excludeDk false) and `valid` (the same among the aware restricted to the scale's codes: its effective base).
 * Pure. Codes are read by the family's own answer list, never by a global missing rule.
 */
export function brandRatingFrom(
  family: RatingFamily,
  brand: { code: string; label: string },
  variable: string,
  aware: { n: number | null; weighted: number | null },
  awareTable: CrosstabResult | null,
  validTable: CrosstabResult | null,
  answeredAll: number | null,
  weighted: boolean,
): BrandRating {
  const empty: BrandRating = {
    code: brand.code, label: brand.label, variable, aware,
    valid: { n: 0, weighted: 0, effective: null },
    cannotJudge: { n: 0, weighted: 0, share: null },
    missing: { n: 0, weighted: 0 }, otherCodes: [], answeredNotAware: null,
    distribution: family.scale.map((s) => ({ code: s.code, label: s.label, n: 0, weighted: 0, share: null })),
    topTwo: null, mean: null, topTwoInterval: null, smallBase: "none",
  };
  if (aware.n === null || aware.weighted === null) return { ...empty, reason: "The aware base of this brand could not be told." };
  if (aware.n === 0) return { ...empty, reason: "No respondent is aware of this brand, so it has no rating base." };
  if (!awareTable) return { ...empty, reason: "No figures were calculated." };
  const counts = codeCounts(awareTable, variable);
  const get = (code: string) => counts.get(code) ?? { n: 0, weighted: 0 };
  const scale = family.scale.map((s) => ({ ...s, ...get(s.code) }));
  const validN = scale.reduce((a, s) => a + s.n, 0);
  const validW = scale.reduce((a, s) => a + s.weighted, 0);
  const cj = family.cannotJudge.reduce((a, s) => ({ n: a.n + get(s.code).n, weighted: a.weighted + get(s.code).weighted }), { n: 0, weighted: 0 });
  const known = new Set([...family.scale, ...family.cannotJudge].map((s) => s.code));
  const otherCodes = [...counts.entries()].filter(([c, v]) => !known.has(c) && v.n > 0).map(([code, v]) => ({ code, ...v }));
  const answeredN = [...counts.values()].reduce((a, v) => a + v.n, 0);
  const answeredW = [...counts.values()].reduce((a, v) => a + v.weighted, 0);
  const missing = { n: aware.n - answeredN, weighted: clampZero(aware.weighted - answeredW) };
  const top = scale.slice(-2);
  const topW = top.reduce((a, s) => a + s.weighted, 0);
  const topTwo = pct(topW, validW);
  const mean = validW > 0 ? scale.reduce((a, s) => a + Number(s.code) * s.weighted, 0) / validW : null;
  const eff = validTable ? rowBase(validTable, variable) : null;
  const effective = weighted ? (eff && eff.n === validN ? eff.nEff : null) : validN;
  const interval =
    topTwo !== null && validN >= 30 && effective !== null && effective > 0
      ? ((p) => {
          const half = 1.96 * Math.sqrt((p * (1 - p)) / effective);
          return [Math.max(0, p - half) * 100, Math.min(1, p + half) * 100] as [number, number];
        })(topTwo / 100)
      : null;
  return {
    code: brand.code,
    label: brand.label,
    variable,
    aware,
    valid: { n: validN, weighted: validW, effective },
    cannotJudge: { ...cj, share: pct(cj.weighted, aware.weighted) },
    missing,
    otherCodes,
    answeredNotAware: answeredAll === null ? null : answeredAll - answeredN,
    distribution: scale.map((s) => ({ code: s.code, label: s.label, n: s.n, weighted: s.weighted, share: pct(s.weighted, validW) })),
    topTwo,
    mean,
    topTwoInterval: interval,
    smallBase: small(validN),
    ...(validN === 0 ? { reason: "No aware respondent gave a rating from 1 to 5, so this figure is not available." } : {}),
  };
}

// ---- E4/E5 -------------------------------------------------------------------------------------------------

/** One cell of the ideal by actual table: each side's answer code and Other name (null: none, or not an Other). */
export type EpisodeCell = { idealCode: string; idealName: string | null; actualCode: string; actualName: string | null; n: number; weighted: number };

/**
 * The episode figures from the ideal by actual cells. Pure. Every respondent with an actual answer is in exactly one
 * cell; `missingIdeal` holds eligible respondents with an actual answer and no ideal, `missingActual` those eligible
 * with no actual answer, `notEligible` those outside the route (null when the file has no route flag).
 */
export function episodeFigures(
  q: EpisodeQuestions,
  brands: { code: string; label: string }[],
  cells: EpisodeCell[],
  aliases: BrandAlias[],
  extra: { notEligible: { n: number; weighted: number } | null; eligible: { n: number; weighted: number } | null; missingActual: { n: number; weighted: number }; missingIdeal: { n: number; weighted: number } },
): Omit<Extract<EpisodeModule, { status: "ok" }>, "status" | "questions" | "storedGap" | "paired"> & { paired: { n: number; weighted: number } } {
  const brandOfAnswer = new Map(q.brandCodes.map((b) => [b.code, b.brand]));
  const listed = new Set(brands.map((b) => b.code));
  const identity = (code: string, name: string | null, side: "actual" | "ideal"): BrandIdentity | "no_ideal" | "cannot_recall" | "unexpected" => {
    if (side === "ideal" && q.codes.noIdeal !== null && code === q.codes.noIdeal) return "no_ideal";
    if (code === (side === "ideal" ? q.codes.cannotRecallIdeal : q.codes.cannotRecallActual)) return "cannot_recall";
    if (q.codes.other !== null && code === q.codes.other) return resolveOther(name, aliases);
    const b = brandOfAnswer.get(code);
    return b !== undefined ? { kind: "brand", code: b } : "unexpected";
  };
  const status = new Map<StatusRow["key"], { n: number; weighted: number }>();
  const addStatus = (k: StatusRow["key"], n: number, w: number) => {
    const s = status.get(k) ?? { n: 0, weighted: 0 };
    status.set(k, { n: s.n + n, weighted: s.weighted + w });
  };
  const pairs: { ideal: BrandIdentity; actual: BrandIdentity; n: number; weighted: number }[] = [];
  for (const c of cells) {
    if (c.n === 0 && Math.abs(c.weighted) < EPS) continue;
    const ideal = identity(c.idealCode, c.idealName, "ideal");
    const actual = identity(c.actualCode, c.actualName, "actual");
    // One status per respondent, in this order: no particular ideal, cannot recall (either side), an Other with no
    // name (unresolved), an answer code that is none of these (unexpected). Only two known identities pair.
    if (ideal === "no_ideal") addStatus("no_particular_ideal", c.n, c.weighted);
    else if (ideal === "cannot_recall" || actual === "cannot_recall") addStatus("cannot_recall", c.n, c.weighted);
    else if (ideal === "unexpected" || actual === "unexpected" || actual === "no_ideal") addStatus("unexpected_code", c.n, c.weighted);
    else if (ideal.kind === "unresolved" || actual.kind === "unresolved") addStatus("unresolved_other", c.n, c.weighted);
    else pairs.push({ ideal, actual, n: c.n, weighted: c.weighted });
  }
  if (extra.missingActual.n > 0 || extra.missingIdeal.n > 0) addStatus("missing_answer", extra.missingActual.n + extra.missingIdeal.n, extra.missingActual.weighted + extra.missingIdeal.weighted);
  const paired = pairs.reduce((a, p) => ({ n: a.n + p.n, weighted: a.weighted + p.weighted }), { n: 0, weighted: 0 });
  const labelOf = (i: BrandIdentity) => (i.kind === "brand" ? (brands.find((b) => b.code === i.code)?.label ?? `Brand ${i.code}`) : i.kind === "other" ? i.name : "Unresolved");
  // Shares on the identical paired base: each tracked brand in the list's order, then one Other row holding every
  // named Other identity (kept by name inside it).
  const sum = (pred: (p: (typeof pairs)[number]) => boolean) => pairs.filter(pred).reduce((a, p) => ({ n: a.n + p.n, weighted: a.weighted + p.weighted }), { n: 0, weighted: 0 });
  const share = (x: { n: number; weighted: number }) => ({ ...x, share: pct(x.weighted, paired.weighted) });
  const shares: ShareRow[] = brands.map((b) => {
    const actual = share(sum((p) => p.actual.kind === "brand" && p.actual.code === b.code));
    const ideal = share(sum((p) => p.ideal.kind === "brand" && p.ideal.code === b.code));
    return { key: `brand:${b.code}`, kind: "brand", code: b.code, label: b.label, actual, ideal, netGap: actual.share !== null && ideal.share !== null ? ideal.share - actual.share : null };
  });
  // A tracked brand outside the dashboard's brand list (set aside by the researcher) still counts in the base; its
  // pairs are named in an "Other" row only when they are Other names, so the list's brands add up with the rest.
  const otherIds = new Set<string>();
  for (const p of pairs) for (const i of [p.ideal, p.actual]) if (i.kind === "other" || (i.kind === "brand" && !listed.has(i.code))) otherIds.add(identityKey(i));
  if (otherIds.size > 0) {
    const isOther = (i: BrandIdentity) => otherIds.has(identityKey(i));
    const actual = share(sum((p) => isOther(p.actual)));
    const ideal = share(sum((p) => isOther(p.ideal)));
    const members = [...otherIds].sort().map((k) => ({
      name: k.startsWith("other:") ? k.slice(6) : labelOf({ kind: "brand", code: k.slice(6) }),
      actual: sum((p) => identityKey(p.actual) === k).weighted,
      ideal: sum((p) => identityKey(p.ideal) === k).weighted,
    }));
    shares.push({ key: "other", kind: "other", code: null, label: "Other named brands", members, actual, ideal, netGap: actual.share !== null && ideal.share !== null ? ideal.share - actual.share : null });
  }
  const different = sum((p) => identityKey(p.ideal) !== identityKey(p.actual));
  const fulfilment: Fulfilment[] = brands.map((b) => {
    const pref = pairs.filter((p) => p.ideal.kind === "brand" && p.ideal.code === b.code);
    const preferrers = pref.reduce((a, p) => ({ n: a.n + p.n, weighted: a.weighted + p.weighted }), { n: 0, weighted: 0 });
    const fulfilled = pref.filter((p) => p.actual.kind === "brand" && p.actual.code === b.code).reduce((a, p) => ({ n: a.n + p.n, weighted: a.weighted + p.weighted }), { n: 0, weighted: 0 });
    const dest = new Map<string, { key: string; label: string; n: number; weighted: number }>();
    for (const p of pref) {
      const k = identityKey(p.actual);
      const d = dest.get(k) ?? { key: k, label: labelOf(p.actual), n: 0, weighted: 0 };
      dest.set(k, { ...d, n: d.n + p.n, weighted: d.weighted + p.weighted });
    }
    return {
      code: b.code,
      label: b.label,
      preferrers,
      fulfilled,
      rate: pct(fulfilled.weighted, preferrers.weighted),
      smallBase: small(preferrers.n),
      destinations: [...dest.values()].sort((a, z) => z.weighted - a.weighted).map((d) => ({ ...d, share: pct(d.weighted, preferrers.weighted) })),
    };
  });
  const LABEL: Record<StatusRow["key"], string> = {
    no_episode: "No episode in the period",
    no_particular_ideal: "No particular ideal brand",
    cannot_recall: "Cannot recall (actual or ideal)",
    unresolved_other: "Other brand with no name",
    missing_answer: "Asked, no answer",
    unexpected_code: "Answer code not on the list",
  };
  const statuses: StatusRow[] = [];
  if (extra.notEligible) statuses.push({ key: "no_episode", label: LABEL.no_episode, ...extra.notEligible });
  for (const k of ["no_particular_ideal", "cannot_recall", "unresolved_other", "missing_answer", "unexpected_code"] as const) {
    const s = status.get(k);
    if (s && s.n > 0) statuses.push({ key: k, label: LABEL[k], n: s.n, weighted: clampZero(s.weighted) });
  }
  const askedCells = cells.reduce((a, c) => ({ n: a.n + c.n, weighted: a.weighted + c.weighted }), { n: 0, weighted: 0 });
  return {
    episodeBase: extra.eligible,
    asked: { n: askedCells.n + extra.missingIdeal.n, weighted: askedCells.weighted + extra.missingIdeal.weighted },
    paired,
    statuses,
    shares,
    gap: { ...different, rate: pct(different.weighted, paired.weighted) },
    fulfilment,
    aliasSuggestions: [],
    otherNames: [],
  };
}

// ---- Loading -----------------------------------------------------------------------------------------------

type Runner = (rows: string[], filters: CrosstabFilter[], extraItems?: CrosstabRequest["rowItems"]) => Promise<CrosstabResult>;

const codeFilter = (variable: string, code: string): CrosstabFilter => ({ variable, op: "between", min: Number(code), max: Number(code) });
const nameFilter = (variable: string, name: string): CrosstabFilter => ({ variable, op: "in", values: [name] });

/** How many Other name pairs the page computes before saying it cannot pair them (each pair is one engine request). */
const MAX_NAME_PAIRS = 120;
const AT_ONCE = 4;

async function inBatches<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += AT_ONCE) out.push(...(await Promise.all(items.slice(i, i + AT_ONCE).map(fn))));
  return out;
}

function awarenessOf(rec: TrackerRecognition, dashboard: ResolvedDashboard): { status: "ok"; awareness: TrackerRecognition["measures"][number] } | Unavailable {
  const { shown, unresolved } = overviewMeasures(rec, dashboard);
  if (unresolved.includes("awareness")) return { status: "mapping_needed", reason: "Two questions could be awareness, and these ratings are asked only of respondents aware of each brand. Choose the awareness question under Customise." };
  const awareness = shown.find((s) => s.stage === "awareness")?.measure;
  if (!awareness) return { status: "mapping_needed", reason: "No question is mapped as awareness, so the base of each brand's ratings (those aware of it) cannot be defined. Choose the awareness question under Customise." };
  return { status: "ok", awareness };
}

async function loadRatings(
  run: Runner,
  family: RatingFamily,
  construct: RatingConstruct,
  dashboard: ResolvedDashboard,
  awareness: TrackerRecognition["measures"][number],
  awareTable: CrosstabResult,
  variables: Map<string, RoleVariable>,
  weighted: boolean,
): Promise<RatingModule> {
  const bases = awareBasesFromResult(awareTable, awareness, dashboard.brands, variables);
  const answeredAll = await run(family.byBrand.map((b) => b.variable), []);
  const scaleCodes = family.scale.map((s) => Number(s.code));
  const lo = Math.min(...scaleCodes);
  const hi = Math.max(...scaleCodes);
  const rows = await inBatches(dashboard.brands, async (brand) => {
    const variable = family.byBrand.find((b) => b.code === brand.code)?.variable;
    const base = bases.find((b) => b.code === brand.code)!;
    if (!variable) return { ...emptyRating(family, brand, ""), reason: `${CONSTRUCT_TITLE[construct]} was not asked about this brand.` };
    const weightedAware = base.variable && base.awareCode !== null ? (codeCounts(awareTable, base.variable).get(base.awareCode)?.weighted ?? 0) : null;
    const aware = { n: base.reason ? null : base.n, weighted: base.reason ? null : weightedAware };
    if (base.reason || !base.n) return brandRatingFrom(family, brand, variable, base.reason ? { n: null, weighted: null } : aware, null, null, null, weighted);
    const awareFilter = codeFilter(base.variable!, base.awareCode!);
    const [awareT, validT] = await Promise.all([run([variable], [awareFilter]), run([variable], [awareFilter, { variable, op: "between", min: lo, max: hi }])]);
    const total = rowBase(answeredAll, variable)?.n ?? null;
    const r = brandRatingFrom(family, brand, variable, aware, awareT, validT, total, weighted);
    return base.reason ? { ...r, reason: base.reason } : r;
  });
  return { status: "ok", construct, family, awareness: { group: awareness.group, label: awareness.label }, brands: rows, routeBreaks: rows.reduce((a, r) => a + (r.answeredNotAware ?? 0), 0) };
}

function emptyRating(family: RatingFamily, brand: { code: string; label: string }, variable: string): BrandRating {
  return brandRatingFrom(family, brand, variable, { n: null, weighted: null }, null, null, null, false);
}

async function loadEpisode(
  run: Runner,
  categories: (variable: string) => Promise<{ label: string; n: number }[]>,
  q: EpisodeQuestions,
  brands: { code: string; label: string }[],
  aliases: BrandAlias[],
  filtered: boolean,
): Promise<EpisodeModule> {
  // Marginals: who was asked (actual answered), the route flag, the stored gap flag.
  const marginalVars = [q.actual.variable, q.ideal.variable, ...(q.eligibility ? [q.eligibility.variable] : []), ...(q.gap ? [q.gap.variable] : [])];
  const marg = await run(marginalVars, []);
  const actualCodes = [...codeCounts(marg, q.actual.variable).entries()].filter(([, v]) => v.n > 0);
  const asked = actualCodes.reduce((a, [, v]) => ({ n: a.n + v.n, weighted: a.weighted + v.weighted }), { n: 0, weighted: 0 });
  let eligible: { n: number; weighted: number } | null = null;
  let notEligible: { n: number; weighted: number } | null = null;
  if (q.eligibility) {
    const e = codeCounts(marg, q.eligibility.variable);
    eligible = e.get(q.eligibility.eligibleCode) ?? { n: 0, weighted: 0 };
    notEligible = [...e.entries()].filter(([c]) => c !== q.eligibility!.eligibleCode).reduce((a, [, v]) => ({ n: a.n + v.n, weighted: a.weighted + v.weighted }), { n: 0, weighted: 0 });
  }
  const missingActual = eligible ? { n: Math.max(0, eligible.n - asked.n), weighted: clampZero(Math.max(0, eligible.weighted - asked.weighted)) } : { n: 0, weighted: 0 };

  // A: the ideal answer among respondents with each actual answer code.
  const A = new Map<string, CrosstabResult>();
  await inBatches(actualCodes, async ([code]) => A.set(code, await run([q.ideal.variable], [codeFilter(q.actual.variable, code)])));
  for (const [code, v] of actualCodes) {
    const got = A.get(code)!.total?.n;
    if (got !== undefined && got !== v.n) throw new Error(`Respondents with ${q.actual.variable} = ${code} could not be selected by their code (${got} selected, ${v.n} expected).`);
  }
  const other = q.codes.other;
  const namesOf = async (variable: string | null) => (variable ? (await categories(variable)).filter((c) => c.n > 0 && c.label.trim() !== "").map((c) => c.label) : []);
  const [actualNames, idealNames] = await Promise.all([namesOf(other ? q.actualOther : null), namesOf(other ? q.idealOther : null)]);
  // B: the actual answer among respondents with each ideal Other name; C: the ideal answer among each actual Other
  // name; D: both Other names (computed only for names that have an Other on the other side).
  const B = new Map<string, CrosstabResult>();
  const C = new Map<string, CrosstabResult>();
  await inBatches(idealNames, async (m) => B.set(m, await run([q.actual.variable], [nameFilter(q.idealOther!, m)])));
  await inBatches(actualNames, async (nm) => C.set(nm, await run([q.ideal.variable], [nameFilter(q.actualOther!, nm)])));
  const at = (t: CrosstabResult | undefined, variable: string, code: string | null) => (t && code !== null ? (codeCounts(t, variable).get(code) ?? { n: 0, weighted: 0 }) : { n: 0, weighted: 0 });
  const pairsNeeded = actualNames.filter((n) => at(C.get(n), q.ideal.variable, other).n > 0).flatMap((n) => idealNames.filter((m) => at(B.get(m), q.actual.variable, other).n > 0).map((m) => [n, m] as const));
  if (pairsNeeded.length > MAX_NAME_PAIRS)
    return { status: "needs_review", reason: `${pairsNeeded.length} pairs of different Other brand names would need to be compared one by one; confirm aliases for the most common names first, or ask for this to be raised.` };
  const D = new Map<string, CrosstabResult>();
  await inBatches(pairsNeeded, async ([n, m]) => D.set(`${n}\u0000${m}`, await run([q.actual.variable], [nameFilter(q.actualOther!, n), nameFilter(q.idealOther!, m)])));

  // Each name's respondents must be found by its own text: otherwise a named Other would read as unnamed.
  if (other !== null) {
    const namedActual = actualNames.reduce((a, n) => a + (C.get(n)?.total?.n ?? 0), 0);
    const namedIdeal = idealNames.reduce((a, m) => a + (B.get(m)?.total?.n ?? 0), 0);
    const actualOtherCount = q.actualOther ? (await categories(q.actualOther)).reduce((a, c) => a + (c.label.trim() ? c.n : 0), 0) : 0;
    const idealOtherCount = q.idealOther ? (await categories(q.idealOther)).reduce((a, c) => a + (c.label.trim() ? c.n : 0), 0) : 0;
    if (!filtered && q.actualOther && namedActual !== actualOtherCount) throw new Error(`Other actual brand names could not all be matched by their text (${namedActual} of ${actualOtherCount}).`);
    if (!filtered && q.idealOther && namedIdeal !== idealOtherCount) throw new Error(`Other ideal brand names could not all be matched by their text (${namedIdeal} of ${idealOtherCount}).`);
  }

  const cells: EpisodeCell[] = [];
  const minus = (x: { n: number; weighted: number }, ys: { n: number; weighted: number }[]) => ys.reduce((a, y) => ({ n: a.n - y.n, weighted: a.weighted - y.weighted }), x);
  const push = (idealCode: string, idealName: string | null, actualCode: string, actualName: string | null, v: { n: number; weighted: number }) => {
    if (v.n < 0 || v.weighted < -1e-6) throw new Error("The ideal by actual table did not add up (a negative remainder); the figures are not shown.");
    if (v.n > 0 || Math.abs(v.weighted) > EPS) cells.push({ idealCode, idealName, actualCode, actualName, n: v.n, weighted: clampZero(v.weighted) });
  };
  let missingIdeal = { n: 0, weighted: 0 };
  for (const [a, av] of actualCodes) {
    const t = A.get(a)!;
    const idealCounts = [...codeCounts(t, q.ideal.variable).entries()];
    const answered = idealCounts.reduce((s, [, v]) => ({ n: s.n + v.n, weighted: s.weighted + v.weighted }), { n: 0, weighted: 0 });
    missingIdeal = { n: missingIdeal.n + av.n - answered.n, weighted: missingIdeal.weighted + av.weighted - answered.weighted };
    for (const [c, v] of idealCounts) {
      const actualIsOther = a === other;
      const idealIsOther = c === other;
      if (!actualIsOther && !idealIsOther) push(c, null, a, null, v);
      else if (!actualIsOther && idealIsOther) {
        const named = idealNames.map((m) => ({ m, v: at(B.get(m), q.actual.variable, a) }));
        named.forEach(({ m, v: x }) => push(c, m, a, null, x));
        push(c, null, a, null, minus(v, named.map((x) => x.v)));
      } else if (actualIsOther && !idealIsOther) {
        const named = actualNames.map((nm) => ({ nm, v: at(C.get(nm), q.ideal.variable, c) }));
        named.forEach(({ nm, v: x }) => push(c, null, a, nm, x));
        push(c, null, a, null, minus(v, named.map((x) => x.v)));
      } else {
        // Both Other: named by named from D; a named ideal with an unnamed actual, and the reverse; both unnamed.
        let rest = v;
        for (const nm of actualNames) {
          const cn = at(C.get(nm), q.ideal.variable, c);
          let restN = cn;
          for (const m of idealNames) {
            const d = at(D.get(`${nm}\u0000${m}`), q.actual.variable, other);
            push(c, m, a, nm, d);
            restN = minus(restN, [d]);
          }
          push(c, null, a, nm, restN);
          rest = minus(rest, [cn]);
        }
        for (const m of idealNames) {
          const bm = at(B.get(m), q.actual.variable, other);
          const withNamedActual = actualNames.map((nm) => at(D.get(`${nm}\u0000${m}`), q.actual.variable, other));
          push(c, m, a, null, minus(bm, withNamedActual));
          rest = minus(rest, [minus(bm, withNamedActual)]);
        }
        push(c, null, a, null, rest);
      }
    }
  }
  const figures = episodeFigures(q, brands, cells, aliases, { notEligible, eligible, missingActual, missingIdeal: { n: missingIdeal.n, weighted: clampZero(missingIdeal.weighted) } });

  // The paired base's effective base: the file's gap flag's valid answers are the same respondents when the counts
  // agree (the engine gives the Kish base for that base only).
  let storedGap: Extract<EpisodeModule, { status: "ok" }>["storedGap"] = null;
  let effective: number | null = null;
  if (q.gap) {
    const g = codeCounts(marg, q.gap.variable);
    const diff = g.get(q.gap.differentCode) ?? { n: 0, weighted: 0 };
    const same = g.get(q.gap.sameCode) ?? { n: 0, weighted: 0 };
    const total = { n: diff.n + same.n, weighted: diff.weighted + same.weighted };
    const agrees = total.n === figures.paired.n && diff.n === figures.gap.n && Math.abs(diff.weighted - figures.gap.weighted) < 1e-6 && Math.abs(total.weighted - figures.paired.weighted) < 1e-6;
    storedGap = {
      variable: q.gap.variable,
      agrees,
      stored: diff,
      derived: { n: figures.gap.n, weighted: figures.gap.weighted },
      note: agrees
        ? `The file's own gap flag (${q.gap.variable}) gives the same pairs and the same differences.`
        : `The file's own gap flag (${q.gap.variable}) gives ${total.n} pairs with ${diff.n} different; the app's pairing gives ${figures.paired.n} with ${figures.gap.n} different (confirmed aliases, or a different reading of Other names). The figures here use the app's pairing; the reasons use the file's flag, which decided who was asked.`,
    };
    const b = rowBase(marg, q.gap.variable);
    effective = agrees && b && b.n === figures.paired.n ? b.nEff : null;
  }
  // Other names typed as a tracked brand's name: offered as aliases (never applied without a confirmation).
  const brandByName = new Map(brands.map((b) => [normaliseBrandName(b.label), b] as const));
  const verbatim = new Map<string, Set<string>>();
  for (const nm of [...actualNames, ...idealNames]) {
    const k = normaliseBrandName(nm);
    verbatim.set(k, (verbatim.get(k) ?? new Set()).add(nm));
  }
  const aliasSuggestions = [...verbatim.entries()]
    .filter(([k]) => brandByName.has(k) && !aliases.some((a) => a.name === k))
    .map(([k, v]) => ({ name: k, verbatim: [...v], code: brandByName.get(k)!.code, label: brandByName.get(k)!.label }));
  const otherNames = [...verbatim.entries()].map(([k, v]) => {
    const r = resolveOther(k, aliases);
    return { name: k, verbatim: [...v], resolvedTo: r.kind === "brand" ? (brands.find((b) => b.code === r.code)?.label ?? r.code) : r.kind === "other" ? r.name : "unresolved" };
  });
  return {
    status: "ok",
    questions: q,
    ...figures,
    paired: { ...figures.paired, effective },
    storedGap,
    aliasSuggestions,
    otherNames,
  };
}

/**
 * Reasons among the respondents `filters` select (asked: the gap flag). A completed answer is at least one reason or
 * one exclusive option selected; its count is the union of the three sets, by inclusion and exclusion over engine
 * tables (the substantive reasons' NET, each exclusive flag by its own code, and their overlaps). Respondents in two
 * or more of the sets (an exclusive option with anything else, never allowed) are counted as conflicts.
 */
async function reasonFigures(run: Runner, r: ReasonQuestions, filters: CrosstabFilter[], variables: Map<string, RoleVariable>, eligible: { n: number; weighted: number }): Promise<ReasonFigures & { conflicts: number }> {
  const opts = r.options.map((o) => o.variable);
  const flags = [r.none, r.cannotRecall].filter((f): f is { variable: string; code: string } => !!f);
  const anyReason: CrosstabRequest["rowItems"] = [{ key: "__any", label: "Any reason", vars: [], kind: "nets", nets: [{ label: "Any reason", vars: opts }] }];
  const t = await run([...opts, ...flags.map((f) => f.variable)], filters, anyReason);
  const zero = { n: 0, weighted: 0 };
  const R = netCount(t, "__any") ?? zero;
  const flagCount = (table: CrosstabResult, f: { variable: string; code: string } | null) => (f ? (codeCounts(table, f.variable).get(f.code) ?? zero) : zero);
  const N = flagCount(t, r.none);
  const D = flagCount(t, r.cannotRecall);
  let RN = zero, RD = zero, ND = zero, RND = zero;
  if (r.none && N.n > 0) {
    const tn = await run(r.cannotRecall ? [r.cannotRecall.variable] : [opts[0]], [...filters, codeFilter(r.none.variable, r.none.code)], anyReason);
    RN = netCount(tn, "__any") ?? zero;
    ND = flagCount(tn, r.cannotRecall);
  }
  if (r.cannotRecall && D.n > 0) RD = netCount(await run([opts[0]], [...filters, codeFilter(r.cannotRecall.variable, r.cannotRecall.code)], anyReason), "__any") ?? zero;
  if (r.none && r.cannotRecall && ND.n > 0) RND = netCount(await run([opts[0]], [...filters, codeFilter(r.none.variable, r.none.code), codeFilter(r.cannotRecall.variable, r.cannotRecall.code)], anyReason), "__any") ?? zero;
  const cn = R.n + N.n + D.n - RN.n - RD.n - ND.n + RND.n;
  const cw = clampZero(R.weighted + N.weighted + D.weighted - RN.weighted - RD.weighted - ND.weighted + RND.weighted);
  const row = (variable: string, label: string, code: string | null): ReasonRow => {
    const counts = codeCounts(t, variable);
    const sel = code ?? selectedCode(variables.get(variable) ?? {}, [...counts.keys()]);
    const v = sel !== null ? (counts.get(sel) ?? zero) : zero;
    return { variable, label, n: v.n, weighted: v.weighted, share: sel === null ? null : pct(v.weighted, cw) };
  };
  return {
    eligible,
    completed: { n: cn, weighted: cw, effective: null },
    missing: { n: eligible.n - cn, weighted: clampZero(eligible.weighted - cw) },
    reasons: r.options.map((o) => row(o.variable, o.label, null)),
    none: r.none ? row(r.none.variable, "No reason or practical constraint to report", r.none.code) : null,
    cannotRecall: r.cannotRecall ? row(r.cannotRecall.variable, "Cannot recall", r.cannotRecall.code) : null,
    smallBase: small(cn),
    conflicts: RN.n + RD.n + ND.n - 2 * RND.n,
  };
}

async function loadReasons(run: Runner, categories: (variable: string) => Promise<{ label: string; n: number }[]>, r: ReasonQuestions, episode: EpisodeModule, brands: { code: string; label: string }[], variables: Map<string, RoleVariable>): Promise<ReasonsModule> {
  if (episode.status !== "ok") return { status: "not_measured", reason: "The reasons are read among respondents whose ideal and actual brands differ, and the same-episode pair is not available." };
  const gap = episode.questions.gap;
  if (!gap) return { status: "needs_review", reason: "The file has no flag saying who was asked the reasons (ideal and actual brands differ), so their base cannot be selected." };
  const gapFilter = codeFilter(gap.variable, gap.differentCode);
  const marg = await run([gap.variable], []);
  const eligible = codeCounts(marg, gap.variable).get(gap.differentCode) ?? { n: 0, weighted: 0 };
  const overall = await reasonFigures(run, r, [gapFilter], variables, eligible);
  // By brand: respondents whose ideal is brand b (its answer code), with a known actual and a gap (the flag implies both).
  const answerCode = new Map(episode.questions.brandCodes.map((b) => [b.brand, b.code]));
  const byBrand = await inBatches(brands, async (b) => {
    const code = answerCode.get(b.code);
    if (!code) return { code: b.code, label: b.label, ...emptyReasons(r) };
    const filters = [gapFilter, codeFilter(episode.questions.ideal.variable, code)];
    const m = await run([gap.variable], filters);
    const el = codeCounts(m, gap.variable).get(gap.differentCode) ?? { n: 0, weighted: 0 };
    const { conflicts: _bc, ...figures } = await reasonFigures(run, r, filters, variables, el);
    void _bc;
    return { code: b.code, label: b.label, ...figures };
  });
  // An exclusive option with another selection is never allowed: counted (reasonFigures), said, kept in the base.
  const exclusiveConflicts = overall.conflicts;
  let otherText: Extract<ReasonsModule, { status: "ok" }>["otherText"] = null;
  if (r.otherText && r.anotherReason) {
    const sel = selectedCode(variables.get(r.anotherReason) ?? {}, ["0", "1"]);
    const texts = (await categories(r.otherText)).filter((c) => c.n > 0 && c.label.trim() !== "").map((c) => c.label);
    if (sel !== null) {
      // Respondents with the Other reason text written are selected by the text itself ("in" its written values).
      const count = async (filters: CrosstabFilter[]) => (await run([r.anotherReason!], filters)).total?.n ?? 0;
      const selectedFilter = codeFilter(r.anotherReason, sel);
      const selected = await count([gapFilter, selectedFilter]);
      const selectedWithText = texts.length ? await count([gapFilter, selectedFilter, { variable: r.otherText, op: "in", values: texts }]) : 0;
      const anyWithText = texts.length ? await count([{ variable: r.otherText, op: "in", values: texts }]) : 0;
      otherText = { selected, selectedWithText, textWithoutSelection: anyWithText - selectedWithText };
    }
  }
  const { conflicts: _oc, ...overallOut } = overall;
  void _oc;
  return { status: "ok", questions: r, gapVariable: gap.variable, overall: overallOut, byBrand, exclusiveConflicts, otherText };
}

function emptyReasons(r: ReasonQuestions): ReasonFigures {
  return {
    eligible: { n: 0, weighted: 0 },
    completed: { n: 0, weighted: 0, effective: null },
    missing: { n: 0, weighted: 0 },
    reasons: r.options.map((o) => ({ variable: o.variable, label: o.label, n: 0, weighted: 0, share: null })),
    none: null,
    cannotRecall: null,
    smallBase: "none",
  };
}

function unavailableOf<T>(d: Detection<T>): Unavailable | null {
  if (d.status === "not_measured") return { status: "not_measured", reason: `Not measured: ${d.reason} Missing: ${d.missing}.` };
  if (d.status === "needs_review") return { status: "needs_review", reason: d.reason };
  return null;
}

/** The selector's details for each construct: question, fields, answer labels, universe and denominator. */
export function diagnosticsOf(rec: BrandExtensionRecognition, variables: Map<string, RoleVariable>, awarenessLabel: string | null): ExtensionDiagnostics[] {
  const labels = (names: string[]) =>
    names.map((variable) => ({ variable, labels: Object.entries(variables.get(variable)?.valueLabels ?? {}).map(([code, label]) => ({ code, label })).sort((a, b) => Number(a.code) - Number(b.code)) }));
  const base = <T,>(construct: ExtensionConstruct, d: Detection<T>) => ({
    construct,
    title: CONSTRUCT_TITLE[construct],
    status: d.status,
    reason: d.status === "found" ? null : d.reason,
    evidence: d.status === "found" ? d.evidence : [],
    candidates: d.status === "needs_review" ? d.candidates.map((c) => ({ key: c.key, description: c.description })) : [],
    confirmed: d.status === "found" && d.confirmed ? { by: d.confirmed.by, at: d.confirmed.at } : null,
  });
  const out: ExtensionDiagnostics[] = RATING_CONSTRUCTS.map((c) => {
    const d = rec.ratings[c];
    const f = d.status === "found" ? d.value : null;
    return {
      ...base(c, d),
      question: f ? f.wording : null,
      sourceFields: f ? f.byBrand.map((b) => b.variable) : [],
      valueLabels: f ? labels([f.byBrand[0].variable]) : [],
      universe: `Respondents aware of each brand${awarenessLabel ? ` ("${awarenessLabel}", by its selected code)` : ""}; blank when not aware (not asked).`,
      denominator: "Distribution, top-two-box and mean: aware respondents with a rating from 1 to 5. Cannot judge: all aware (asked) respondents.",
    };
  });
  const e = rec.episode;
  const ev = e.status === "found" ? e.value : null;
  out.push({
    ...base("episode", e),
    question: ev ? `${ev.actual.label} / ${ev.ideal.label}` : null,
    sourceFields: ev ? [ev.actual.variable, ev.actualOther, ev.ideal.variable, ev.idealOther, ev.eligibility?.variable ?? null, ev.gap?.variable ?? null].filter((x): x is string => !!x) : [],
    valueLabels: ev ? labels([ev.actual.variable, ev.ideal.variable]) : [],
    universe: ev ? `Respondents with the event (${ev.event})${ev.eligibility ? `: ${ev.eligibility.variable} = ${ev.eligibility.eligibleCode}` : ""}.` : "Respondents with the most recent category event.",
    denominator: "Shares and gap: respondents whose actual and ideal brands are both known (paired). Fulfilment: those whose ideal is the brand, with a known actual.",
  });
  const r = rec.reasons;
  const rv = r.status === "found" ? r.value : null;
  out.push({
    ...base("reasons", r),
    question: rv ? "Reasons for a different ideal and actual choice" : null,
    sourceFields: rv ? [...rv.options.map((o) => o.variable), rv.none?.variable, rv.cannotRecall?.variable, rv.otherText].filter((x): x is string => !!x) : [],
    valueLabels: rv ? rv.options.map((o) => ({ variable: o.variable, labels: [{ code: "1", label: o.label }] })) : [],
    universe: "Respondents whose ideal and actual brands differ (the file's gap flag).",
    denominator: "Each reason: gap respondents with a completed answer (a reason, or an exclusive option). Multiple answers: shares may add to more than 100%.",
  });
  return out;
}

/**
 * The extension's figures for one data file, with the dashboard's weighting (or `options.weighted`) and an optional
 * audience (one answer code of a question asked once). Throws with the reason when the file cannot be read; never
 * returns empty figures for a failure.
 */
export async function loadBrandExtension(tenantId: string, runId: string, documentId: string, options: ExtensionOptions = {}): Promise<BrandExtension> {
  const [view, input] = await Promise.all([loadTrackerDashboard(tenantId, runId, documentId), loadRoleInput(tenantId, runId, documentId)]);
  const dashboard = view.dashboard;
  const variables = new Map(input.variables.map((v) => [v.name, v]));
  const stored: StoredConfirmations = await loadBrandExtensionConfirmations(tenantId, runId);
  const recognition = withConfirmations(view.recognition.brandExtension ?? recogniseBrandExtension([], null), stored.constructs);
  const wantWeighted = options.weighted ?? dashboard.weighted;
  const weightVar = wantWeighted ? dashboard.weightVar : null;
  const weightNote = wantWeighted && !dashboard.weightVar ? "This file has no weight variable: results are unweighted." : weightVar ? `Weighted by ${weightVar} (relative weights, not population calibration).` : "Unweighted.";
  // The audience, checked against this file: a single-choice question asked once, one of its answer codes.
  const audienceOptions = input.variables
    .filter((v) => v.numeric && !v.weightLike && v.valueLabels && Object.keys(v.valueLabels).length >= 2 && Object.keys(v.valueLabels).length <= 12 && v.questionType !== "multiple_response" && !/^(0|1)$/.test(Object.keys(v.valueLabels).join("|").replace(/\|/g, "")))
    .filter((v) => !view.recognition.measures.some((m) => m.byBrand.some((b) => b.variable === v.name)) && !recognition.claimed.includes(v.name))
    .filter((v) => Object.keys(v.valueLabels!).every((c) => Number.isFinite(Number(c))))
    .map((v) => ({ variable: v.name, label: v.label, answers: Object.entries(v.valueLabels!).map(([code, label]) => ({ code, label })).sort((a, b) => Number(a.code) - Number(b.code)) }));
  let audience: BrandExtension["audience"] = null;
  if (options.audience) {
    const opt = audienceOptions.find((o) => o.variable === options.audience!.variable);
    const ans = opt?.answers.find((a) => a.code === options.audience!.code);
    if (!opt || !ans) throw new Error("That audience is not a question and answer of this file.");
    audience = { variable: opt.variable, label: opt.label, code: ans.code, codeLabel: ans.label };
  }
  const audienceFilters: CrosstabFilter[] = audience ? [codeFilter(audience.variable, audience.code)] : [];

  const [dict, setup] = await Promise.all([loadVariableDictionaryWithStatus(tenantId, runId, documentId), loadDataSetupWithStatus(tenantId, documentId)]);
  if (!dict.ok) throw new Error(`The data file's variables could not be read: ${dict.error}`);
  if (!setup.ok) throw new Error(`The data file's set-up could not be read: ${setup.error}`);
  const design = resolveSurveyDesign(dict.dictionary, effectiveDesignChoice(setup.setup.design, undefined)).design ?? undefined;
  const labelOf = new Map(dict.dictionary.variables.map((v) => [v.name, v.label]));
  // Computed, not saved (computeCrosstab): opening the page adds no table to the file. Every answer code is kept
  // (excludeDk false): which codes count is decided by each question's own answer list above, never globally.
  // A filter nobody meets (two Other names never given together, an audience with no one in a brand's base) is an
  // empty table: every count zero, which the readers turn into "Not available" where it is a denominator. Only the
  // engine's own "No cases satisfy the filter" is read so; any other failure stops the page with its reason.
  const EMPTY = { version: 2, weightVar, weightLabel: null, questions: [], total: { n: 0, w: 0, nEff: 0 } } as unknown as CrosstabResult;
  const run: Runner = async (rows, filters, extraItems = []) =>
    (
      await computeCrosstab(tenantId, runId, documentId, {
        columnVars: [],
        rowItems: [...rows.map((v) => ({ key: v, label: labelOf.get(v) || v, vars: [v] })), ...extraItems],
        weightVar,
        design,
        excludeDk: false,
        filters: [...audienceFilters, ...filters],
      }).catch((e: unknown) => {
        if (e instanceof Error && /No cases satisfy the filter/.test(e.message)) return { result: EMPTY };
        throw e;
      })
    ).result;
  const categories = async (variable: string) => (await loadCategories(tenantId, runId, documentId, variable)).categories;

  const aw = awarenessOf(view.recognition, dashboard);
  const anyRating = RATING_CONSTRUCTS.some((c) => recognition.ratings[c].status === "found");
  let awareTable: CrosstabResult | null = null;
  if (aw.status === "ok" && anyRating) {
    const brandCodes = new Set(dashboard.brands.map((b) => b.code));
    const awareVars = aw.awareness.byBrand.filter((b) => brandCodes.has(b.code)).map((b) => b.variable);
    if (awareVars.length) awareTable = await run(awareVars, []);
  }
  const ratings = {} as Record<RatingConstruct, RatingModule>;
  for (const c of RATING_CONSTRUCTS) {
    const d = recognition.ratings[c];
    const un = unavailableOf(d);
    if (un) ratings[c] = un;
    else if (aw.status !== "ok") ratings[c] = aw;
    else if (!awareTable) ratings[c] = { status: "mapping_needed", reason: "No awareness variable is asked about the listed brands, so the aware base cannot be defined." };
    else ratings[c] = await loadRatings(run, (d as Extract<typeof d, { status: "found" }>).value, c, dashboard, aw.awareness, awareTable, variables, weightVar !== null);
  }
  const brands = dashboard.brands;
  const episode: EpisodeModule = unavailableOf(recognition.episode) ?? (await loadEpisode(run, categories, (recognition.episode as Extract<Detection<EpisodeQuestions>, { status: "found" }>).value, brands, stored.aliases, audienceFilters.length > 0));
  const reasons: ReasonsModule = unavailableOf(recognition.reasons) ?? (await loadReasons(run, categories, (recognition.reasons as Extract<Detection<ReasonQuestions>, { status: "found" }>).value, episode, brands, variables));
  return {
    documentId,
    weighted: weightVar !== null,
    weightVar,
    weightAvailable: dashboard.weightVar !== null,
    weightNote,
    audience,
    brands,
    focalBrand: dashboard.focalBrand ? { code: dashboard.focalBrand.code, label: dashboard.focalBrand.label } : null,
    recognition,
    diagnostics: diagnosticsOf(recognition, variables, aw.status === "ok" ? aw.awareness.label : null),
    confirmations: { scopeKey: stored.scopeKey, revision: stored.revision, storageAvailable: stored.storageAvailable, aliases: stored.aliases },
    ratings,
    episode,
    reasons,
    audienceOptions,
  };
}

/** One wave's top-two-box per brand and construct, or why that wave has none. */
export type TrendWave = {
  documentId: string;
  wave: string;
  values: Record<RatingConstruct, { code: string; topTwo: number | null; n: number; smallBase: SmallBase }[] | null>;
  /** The same wording and answer codes as the wave being viewed (else the wave's figure is not joined to the trend). */
  comparable: Record<RatingConstruct, boolean>;
  error?: string;
};

/**
 * Top-two-box per brand and construct for every wave of the project, in wave order. Waves are independent samples:
 * the trend is descriptive (no paired test). A wave is joined to the trend for a construct only when its question has
 * the same wording and the same answer codes as the wave being viewed; otherwise it is listed as not comparable. A wave
 * that cannot be read is listed with its error, never left out silently.
 */
export async function loadBrandExtensionTrend(tenantId: string, runId: string, documentId: string, options: ExtensionOptions = {}): Promise<{ waves: TrendWave[] }> {
  const { loadProjectWaves } = await import("./waveFiles");
  const waves = (await loadProjectWaves(tenantId, runId)).included;
  const here = await loadBrandExtension(tenantId, runId, documentId, options);
  const signature = (m: RatingModule) => (m.status === "ok" ? JSON.stringify([m.family.wording, m.family.scale.map((s) => s.code), m.family.cannotJudge.map((s) => s.code)]) : null);
  const out: TrendWave[] = [];
  for (const w of waves) {
    try {
      const ext = w.documentId === documentId ? here : await loadBrandExtension(tenantId, runId, w.documentId, { weighted: options.weighted ?? here.weighted, audience: null });
      const values = {} as TrendWave["values"];
      const comparable = {} as TrendWave["comparable"];
      for (const c of RATING_CONSTRUCTS) {
        const m = ext.ratings[c];
        comparable[c] = m.status === "ok" && signature(m) === signature(here.ratings[c]);
        values[c] = m.status === "ok" ? m.brands.map((b) => ({ code: b.code, topTwo: b.topTwo, n: b.valid.n ?? 0, smallBase: b.smallBase })) : null;
      }
      out.push({ documentId: w.documentId, wave: w.wave, values, comparable });
    } catch (e) {
      out.push({ documentId: w.documentId, wave: w.wave, values: { needs_fit: null, differentiation: null, price_justification: null }, comparable: { needs_fit: false, differentiation: false, price_justification: false }, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { waves: out };
}
