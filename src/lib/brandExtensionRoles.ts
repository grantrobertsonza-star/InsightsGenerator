// The brand dashboard extension's constructs (Grant's packs of 30 October 2026, "03 Claude Dashboard Extension
// Guide"): which questions of a brand tracker measure
//   E1 personal needs fit, E2 meaningful differentiation and E3 perceived price justification (one five-point
//      agreement rating per aware brand, a "cannot judge" answer of its own),
//   E4 the brand actually chosen and E5 the brand ideally preferred for the same most recent category event, with
//      their Other name text, and
//   E6 the reasons for a different choice (a multiple-response set, two exclusive flags outside it, an Other text).
// Pure: no database, no model. Recognised from wording, answer labels, multiple-response sets and brand identity;
// a variable name is never enough (a family named like needsfit_bXX without wording or answer labels is "needs
// review", never a mapping). The contract is claude/brand-extension.md.
//
// Every construct is one of:
//   found          the questions, with the evidence that decided it;
//   needs_review   two or more candidates, or evidence that does not settle it: the researcher confirms one
//                  (brandExtensionConfirmations.ts); nothing is calculated until then;
//   not_measured   the file has no such question, with what is missing (never a figure made from a related
//                  question: good value for money stays a pick-any association; relevant_cXX is category
//                  relevance, not needs fit; future first choice and the main brand are not the episode pair).
import type { BrandFrame, RoleVariable } from "./trackerRoles";
import { brandNamed, isYesNo, labelAfterName, stemOf } from "./trackerRoles";

export const RATING_CONSTRUCTS = ["needs_fit", "differentiation", "price_justification"] as const;
export type RatingConstruct = (typeof RATING_CONSTRUCTS)[number];
export const EXTENSION_CONSTRUCTS = [...RATING_CONSTRUCTS, "episode", "reasons"] as const;
export type ExtensionConstruct = (typeof EXTENSION_CONSTRUCTS)[number];

export const CONSTRUCT_TITLE: Record<ExtensionConstruct, string> = {
  needs_fit: "Needs fit",
  differentiation: "Differentiation",
  price_justification: "Price justification",
  episode: "Ideal versus actual choice",
  reasons: "Reasons for a different choice",
};

/** What is missing when a construct is not measured: the measurement, said in the researcher's words. */
const MISSING: Record<ExtensionConstruct, string> = {
  needs_fit: "a five-point agreement rating, per aware brand, that the brand meets the respondent's personal needs in the category",
  differentiation: "a five-point agreement rating, per aware brand, that the brand offers something meaningfully different",
  price_justification: "a five-point agreement rating, per aware brand, that the brand is worth its price compared with alternatives",
  episode: "the brand actually chosen and the brand ideally preferred for the same most recent category event",
  reasons: "the reasons asked when the ideal and actual brands differ",
};

/** A five-point agreement family asked once per brand. */
export type RatingFamily = {
  /** Stable identity of the family: its variables in brand order, joined. */
  key: string;
  /** The question's wording with the brand taken out. */
  wording: string;
  byBrand: { code: string; variable: string }[];
  /** The five substantive answers, lowest (strongly disagree) first, by code. */
  scale: { code: string; label: string }[];
  /** Codes meaning the respondent cannot judge (E1/E2 "Do not know enough to judge", E3 "Not familiar enough with its
   * prices to judge"): never a rating, never missing, reported on the aware base. Read from this question's own labels. */
  cannotJudge: { code: string; label: string }[];
  /** Other written answer codes (neither scale nor cannot judge): counted apart, never in the valid base. */
  otherCodes: { code: string; label: string }[];
};

export type EpisodeQuestions = {
  key: string;
  /** The event both questions refer to, from their wording ("most recent personal bank account opening ..."). */
  event: string;
  actual: { variable: string; label: string };
  ideal: { variable: string; label: string };
  actualOther: string | null;
  idealOther: string | null;
  /** The route flag (choice_episode_eligible): 1 when the respondent had the event; null when the file has none. */
  eligibility: { variable: string; eligibleCode: string } | null;
  /** The file's own derived gap flag, compared with the app's own pairing; null when the file has none. */
  gap: { variable: string; sameCode: string; differentCode: string } | null;
  /** Answer codes by meaning, read from the labels of these two questions only. */
  codes: { other: string | null; noIdeal: string | null; cannotRecallActual: string | null; cannotRecallIdeal: string | null };
  /** The roster: answer code of each tracked brand in these questions (by the brand list's label). */
  brandCodes: { brand: string; code: string }[];
};

export type ReasonQuestions = {
  key: string;
  /** The substantive reasons in the file's order, with their exact labels. */
  options: { variable: string; label: string }[];
  /** The exclusive flags outside the set, each with the code meaning selected (its label is the option itself, "No
   * reason or practical constraint to report", "Cannot recall", rather than "Selected"). */
  none: { variable: string; code: string } | null;
  cannotRecall: { variable: string; code: string } | null;
  otherText: string | null;
  /** The option whose selection asks for the Other text ("Another reason"). */
  anotherReason: string | null;
};

export type Candidate = { key: string; description: string; variables: string[] };
export type Detection<T> =
  | { status: "found"; value: T; evidence: string[]; confirmed?: ConfirmationProvenance }
  | { status: "needs_review"; candidates: Candidate[]; reason: string; values?: Record<string, T> }
  | { status: "not_measured"; reason: string; missing: string };

export type ConfirmationProvenance = { by: string | null; at: string; documentId: string | null };

export type BrandExtensionRecognition = {
  ratings: Record<RatingConstruct, Detection<RatingFamily>>;
  episode: Detection<EpisodeQuestions>;
  reasons: Detection<ReasonQuestions>;
  /** Variables a found or candidate construct uses, so the funnel recogniser does not treat them as unknown stages. */
  claimed: string[];
};

const clean = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ");

// ---- Answer lists ------------------------------------------------------------------------------------------

const STRONGLY_DISAGREE = /^strongly disagree\b/i;
const STRONGLY_AGREE = /^strongly agree\b/i;
const AGREEMENT = /\b(agree|disagree)\b/i;
/** An answer meaning the respondent cannot judge (E1 to E3 code 9): not knowing enough, not familiar enough. */
const CANNOT_JUDGE = /\b(do not|don'?t) know\b|\bnot (familiar|sure)\b|\b(cannot|can'?t|unable to) (judge|say|rate)\b|\benough to judge\b|\bno opinion\b/i;

/** A five-point agreement answer list: five substantive codes whose lowest is "Strongly disagree" and highest
 * "Strongly agree" by code, all agreement wording; cannot-judge answers apart; anything else listed as other. */
export function agreementScale(labels: Record<string, string> | undefined): Pick<RatingFamily, "scale" | "cannotJudge" | "otherCodes"> | null {
  if (!labels) return null;
  const entries = Object.entries(labels)
    .map(([code, label]) => ({ code, label: clean(label) }))
    .filter((e) => Number.isFinite(Number(e.code)) && e.code.trim() !== "")
    .sort((a, b) => Number(a.code) - Number(b.code));
  const cannotJudge = entries.filter((e) => CANNOT_JUDGE.test(e.label) && !AGREEMENT.test(e.label));
  const rest = entries.filter((e) => !cannotJudge.includes(e));
  const scale = rest.filter((e) => AGREEMENT.test(e.label) || /^neither\b/i.test(e.label));
  if (scale.length !== 5 || !STRONGLY_DISAGREE.test(scale[0].label) || !STRONGLY_AGREE.test(scale[4].label)) return null;
  // The five points are consecutive codes in order (1 to 5 here): a gap would make "4 or 5" mean something else.
  if (!scale.every((e, i) => i === 0 || Number(e.code) === Number(scale[i - 1].code) + 1)) return null;
  return { scale, cannotJudge, otherCodes: rest.filter((e) => !scale.includes(e)) };
}

// ---- Construct wording -------------------------------------------------------------------------------------

/** Wording of each rating construct, read from the question with the brand taken out. Needs fit must be about the
 * respondent's own needs ("meets my personal needs"): "alternatives that meet similar needs" in a price question is
 * not needs fit, and category relevance (relevant_cXX, a yes/no list asked once) never reaches here. */
const CONSTRUCT_WORDING: Record<RatingConstruct, RegExp> = {
  needs_fit: /\b(meets?|fits?|suits?)\b[^.]*\b(my|personal|own)\b[^.]*\bneeds\b|\bright for (me|my needs)\b/i,
  differentiation: /\b(meaningfully |genuinely |really |truly )?different\b|\bdifferentiat\w*|\bstands? out\b|\bunique\b|\bdistinctive\b/i,
  price_justification: /\bworth\b[^.]*\b(price|prices|fees?|charges?|premiums?|costs?|money|cover|pay(ing)?)\b|\bjustif(y|ies|ied)\b[^.]*\b(price|cost|fee|premium)s?\b/i,
};
/** Variable-name hints, used only to say that a construct may be present but cannot be read (never to map it). */
const NAME_HINT: Record<RatingConstruct, RegExp> = {
  needs_fit: /^needs?_?fit/i,
  differentiation: /^differen/i,
  price_justification: /^price_?just/i,
};

function ratingFamilies(variables: RoleVariable[], frame: BrandFrame): { family: RatingFamily; constructs: RatingConstruct[]; problems: string[] }[] {
  const families = new Map<string, { wording: string; members: Map<string, RoleVariable>; repeated: boolean }>();
  for (const v of variables) {
    if (!v.numeric || v.text || v.weightLike || v.questionType === "multiple_response" || !v.valueLabels || isYesNo(v)) continue;
    const wording = labelAfterName(v);
    if (!wording || wording === v.name) continue;
    const code = brandNamed(wording, frame);
    if (!code) continue;
    const stem = stemOf(wording, frame.brands.find((b) => b.code === code)!);
    const key = stem.toLowerCase();
    const f = families.get(key) ?? { wording: stem, members: new Map(), repeated: false };
    if (f.members.has(code)) f.repeated = true;
    else f.members.set(code, v);
    families.set(key, f);
  }
  const out: { family: RatingFamily; constructs: RatingConstruct[]; problems: string[] }[] = [];
  const order = new Map(frame.brands.map((b, i) => [b.code, i]));
  for (const f of families.values()) {
    if (f.members.size < Math.max(3, Math.ceil(frame.brands.length * 0.6))) continue;
    const members = [...f.members.entries()].sort((a, b) => order.get(a[0])! - order.get(b[0])!);
    const scales = members.map(([, v]) => agreementScale(v.valueLabels));
    if (scales.some((s) => s === null)) continue; // not a five-point agreement question (a yes/no association, a 0 to 10 scale)
    const constructs = RATING_CONSTRUCTS.filter((c) => CONSTRUCT_WORDING[c].test(f.wording));
    if (constructs.length === 0) continue;
    const problems: string[] = [];
    if (f.repeated) problems.push("the wording names one brand in two variables");
    const lists = new Set(members.map(([, v]) => JSON.stringify(Object.entries(v.valueLabels!).sort())));
    if (lists.size > 1) problems.push("the brands' answer lists differ");
    const s = scales[0]!;
    if (s.otherCodes.length > 0) problems.push(`answer codes that are neither the scale nor "cannot judge": ${s.otherCodes.map((c) => `${c.code} ${c.label}`).join(", ")}`);
    out.push({
      family: { key: members.map(([, v]) => v.name).join(","), wording: f.wording, byBrand: members.map(([code, v]) => ({ code, variable: v.name })), ...s },
      constructs,
      problems,
    });
  }
  return out;
}

function describeRating(f: RatingFamily): string {
  return `"${f.wording}" (${f.byBrand.length} brands: ${f.byBrand[0].variable} ...)`;
}

// ---- Same-episode ideal and actual choice ------------------------------------------------------------------

const ACTUAL_WORDING = /\b(actual|actually)\b[^.]*\b(chose|chosen|choose|selected|picked|bought|purchased|opened|activated|started|took)\b/i;
const IDEAL_WORDING = /\bideal(ly)?\b/i;
const SAME_EVENT = /\b(same|at the time)\b/i;
const EVENT_START = /\b(most recent|last)\b/i;
/** Wording of measures that are never the episode pair: future first choice, the main or current provider, ownership. */
const NOT_EPISODE = /\bfirst choice\b|\bwould (you )?(choose|consider)\b|\bmain\b|\bcurrent(ly)?\b|\bmost used\b|\bown(ed|ership)?\b/i;
const CANNOT_RECALL = /^(cannot|can'?t|do not|don'?t) (recall|remember)\b/i;
const NO_IDEAL = /^no (particular )?(ideal|preferred|preference)\b|^no particular\b/i;
const OTHER = /^other\b/i;

/** The event a question is about: its wording from "most recent" (or "last") to the end of the clause. */
function eventOf(wording: string): string | null {
  const m = EVENT_START.exec(wording);
  if (!m) return null;
  return clean(wording.slice(m.index).split(/[,;(]/)[0]).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, "");
}

/** A single-choice question whose answers are the tracked brands (by label, 60% of the list), with Other and statuses. */
function rosterCodes(v: RoleVariable, frame: BrandFrame): { brand: string; code: string }[] | null {
  if (!v.numeric || !v.valueLabels || v.questionType === "multiple_response" || isYesNo(v)) return null;
  const byLabel = new Map(Object.entries(v.valueLabels).map(([code, label]) => [clean(label).toLowerCase(), code]));
  const hits = frame.brands.map((b) => ({ brand: b.code, code: byLabel.get(b.label.toLowerCase()) })).filter((x): x is { brand: string; code: string } => !!x.code);
  return hits.length >= Math.max(3, Math.ceil(frame.brands.length * 0.6)) ? hits : null;
}

function codeLabelled(v: RoleVariable, re: RegExp): string | null {
  const hits = Object.entries(v.valueLabels ?? {}).filter(([, l]) => re.test(clean(l)));
  return hits.length === 1 ? hits[0][0] : null;
}

function findEpisode(variables: RoleVariable[], frame: BrandFrame | null): Detection<EpisodeQuestions> {
  const missing = MISSING.episode;
  if (!frame) return { status: "not_measured", reason: "No brand list was found in this file, so a brand chosen and a brand preferred cannot be read.", missing };
  const rosters = variables.map((v) => ({ v, roster: rosterCodes(v, frame), wording: labelAfterName(v) })).filter((x) => x.roster && x.wording && x.wording !== x.v.name);
  const actuals = rosters.filter((x) => ACTUAL_WORDING.test(x.wording) && EVENT_START.test(x.wording) && !IDEAL_WORDING.test(x.wording) && !NOT_EPISODE.test(x.wording));
  const ideals = rosters.filter((x) => IDEAL_WORDING.test(x.wording) && SAME_EVENT.test(x.wording) && EVENT_START.test(x.wording) && !NOT_EPISODE.test(x.wording));
  if (actuals.length === 0 && ideals.length === 0)
    return { status: "not_measured", reason: "No pair of questions asking which brand was actually chosen and which was ideally preferred for the same most recent event was found. Future first choice, the main brand and ownership are not this measure.", missing };
  const pairs: { key: string; value: EpisodeQuestions; problems: string[] }[] = [];
  for (const a of actuals) {
    for (const i of ideals) {
      const value = episodeValue(variables, a.v, i.v, a.roster!, i.roster!);
      const problems: string[] = [];
      const ea = eventOf(a.wording);
      const ei = eventOf(i.wording);
      if (!ea || !ei || ea !== ei) problems.push(`the two questions may describe different events ("${ea ?? a.wording}" and "${ei ?? i.wording}")`);
      if (JSON.stringify(a.roster) !== JSON.stringify(i.roster)) problems.push("the brands have different answer codes in the two questions");
      if (!value.codes.cannotRecallActual) problems.push(`no "Cannot recall" answer in ${a.v.name}`);
      if (value.codes.other && !value.actualOther) problems.push(`Other (code ${value.codes.other}) has no name text for the actual brand`);
      if (value.codes.other && !value.idealOther) problems.push(`Other (code ${value.codes.other}) has no name text for the ideal brand`);
      pairs.push({ key: value.key, value, problems });
    }
  }
  const describe = (p: (typeof pairs)[number]) => `${p.value.actual.variable} ("${p.value.actual.label}") with ${p.value.ideal.variable} ("${p.value.ideal.label}")`;
  if (pairs.length === 0) {
    const only = [...actuals, ...ideals].map((x) => x.v.name);
    return { status: "needs_review", candidates: only.map((n) => ({ key: n, description: n, variables: [n] })), reason: `Only one of the pair was found (${only.join(", ")}): the brand actually chosen and the brand ideally preferred must both be asked about the same event.` };
  }
  if (pairs.length === 1 && pairs[0].problems.length === 0) {
    const p = pairs[0];
    return {
      status: "found",
      value: p.value,
      evidence: [
        `${p.value.actual.variable}: "${p.value.actual.label}" asks for the brand actually chosen`,
        `${p.value.ideal.variable}: "${p.value.ideal.label}" asks for the ideal brand at the time of the same event`,
        `same event: "${p.value.event}"`,
        `brand answers by the brand list's labels (${p.value.brandCodes.length} brands)`,
      ],
    };
  }
  return {
    status: "needs_review",
    candidates: pairs.map((p) => ({ key: p.key, description: describe(p) + (p.problems.length ? `: ${p.problems.join("; ")}` : ""), variables: [p.value.actual.variable, p.value.ideal.variable] })),
    reason: pairs.length > 1 ? `${pairs.length} pairs of questions could be the same-episode actual and ideal brand.` : `The pair found needs a check: ${pairs[0].problems.join("; ")}.`,
    values: Object.fromEntries(pairs.map((p) => [p.key, p.value])),
  };
}

function episodeValue(variables: RoleVariable[], actual: RoleVariable, ideal: RoleVariable, roster: { brand: string; code: string }[], _idealRoster: { brand: string; code: string }[]): EpisodeQuestions {
  const texts = variables.filter((v) => !v.numeric || v.text || v.questionType === "text");
  const otherText = (side: RegExp) => {
    const hits = texts.filter((v) => /\bother\b/i.test(v.label) && /\b(name|brand)\b/i.test(v.label) && side.test(v.label));
    return hits.length === 1 ? hits[0].name : null;
  };
  const yesNo = variables.filter((v) => v.numeric && Object.keys(v.valueLabels ?? {}).length === 2);
  const eligibility = yesNo.filter((v) => /\bepisode\b/i.test(labelAfterName(v)) && /\b(available|eligible|route|had)\b/i.test(labelAfterName(v)));
  const eligibleCode = (v: RoleVariable) => Object.entries(v.valueLabels ?? {}).find(([, l]) => !/^no\b|\bnot\b/i.test(clean(l)))?.[0] ?? null;
  const gapCodes = (v: RoleVariable) => {
    const same = Object.entries(v.valueLabels ?? {}).find(([, l]) => /^same\b/i.test(clean(l)))?.[0] ?? null;
    const different = Object.entries(v.valueLabels ?? {}).find(([, l]) => /^different\b/i.test(clean(l)))?.[0] ?? null;
    return same && different ? { variable: v.name, sameCode: same, differentCode: different } : null;
  };
  // The derived gap flag: a 0/1 question about the ideal and actual brands differing whose answers say "Same" and
  // "Different" (a "cannot recall why they differed" flag has neither).
  const gaps = yesNo.filter((v) => /\bideal and actual\b/i.test(labelAfterName(v)) && /\bdiffer/i.test(labelAfterName(v)) && gapCodes(v) !== null);
  const e = eligibility.length === 1 ? eligibleCode(eligibility[0]) : null;
  return {
    key: `${actual.name},${ideal.name}`,
    event: eventOf(labelAfterName(actual)) ?? "",
    actual: { variable: actual.name, label: labelAfterName(actual) },
    ideal: { variable: ideal.name, label: labelAfterName(ideal) },
    actualOther: otherText(/\bactual\b/i),
    idealOther: otherText(/\bideal\b/i),
    eligibility: eligibility.length === 1 && e ? { variable: eligibility[0].name, eligibleCode: e } : null,
    gap: gaps.length === 1 ? gapCodes(gaps[0]) : null,
    codes: {
      other: codeLabelled(actual, OTHER) ?? codeLabelled(ideal, OTHER),
      noIdeal: codeLabelled(ideal, NO_IDEAL),
      cannotRecallActual: codeLabelled(actual, CANNOT_RECALL),
      cannotRecallIdeal: codeLabelled(ideal, CANNOT_RECALL),
    },
    brandCodes: roster,
  };
}

// ---- Reasons for a different choice ------------------------------------------------------------------------

/** A label's question part before a colon ("Choice gap reason: Fees ..." gives "Choice gap reason"). */
const prefixOf = (label: string) => (label.includes(":") ? clean(label.slice(0, label.indexOf(":"))) : null);
const REASON_PREFIX = /\b(reasons?|why)\b/i;
const GAP_CONTEXT = /\bgap\b|\bideal\b|\bdiffer|\bdifferent choice\b|\bprevented\b/i;

function findReasons(variables: RoleVariable[], episode: Detection<EpisodeQuestions>): Detection<ReasonQuestions> {
  const missing = MISSING.reasons;
  const sets = new Map<string, RoleVariable[]>();
  for (const v of variables) {
    const key = v.group ?? (v.questionId ? `q:${v.questionId}` : null);
    if (!key || !(v.questionType === "multiple_response" || isYesNo(v))) continue;
    sets.set(key, [...(sets.get(key) ?? []), v]);
  }
  const found: { key: string; value: ReasonQuestions }[] = [];
  for (const [key, members] of sets) {
    const prefixes = new Set(members.map((m) => prefixOf(labelAfterName(m))));
    if (prefixes.size !== 1) continue;
    const prefix = [...prefixes][0];
    if (!prefix || !REASON_PREFIX.test(prefix) || !GAP_CONTEXT.test(prefix) || members.length < 3) continue;
    const options = members.map((m) => ({ variable: m.name, label: clean(labelAfterName(m).slice(labelAfterName(m).indexOf(":") + 1)) }));
    const flags = variables.filter((v) => v.numeric && isYesNo(v) && !members.includes(v));
    const context = (v: RoleVariable) => /\b(gap|episode|ideal and actual|differ\w*)\b/i.test(labelAfterName(v));
    const none = flags.filter((v) => context(v) && /^no (reason|constraint|practical)\b/i.test(labelAfterName(v)));
    const dk = flags.filter((v) => context(v) && CANNOT_RECALL.test(labelAfterName(v)));
    const texts = variables.filter((v) => (!v.numeric || v.text || v.questionType === "text") && /\bother reason\b/i.test(v.label) && context(v));
    const another = options.filter((o) => /^(another|other) reason\b/i.test(o.label));
    found.push({
      key,
      value: {
        key,
        options,
        none: none.length === 1 ? flagOf(none[0]) : null,
        cannotRecall: dk.length === 1 ? flagOf(dk[0]) : null,
        otherText: texts.length === 1 ? texts[0].name : null,
        anotherReason: another.length === 1 ? another[0].variable : null,
      },
    });
  }
  if (found.length === 0) {
    const note = episode.status === "found" ? "" : " (and the same-episode pair is not measured either)";
    return { status: "not_measured", reason: `No multiple-response list of reasons asked when the ideal and actual brands differ was found${note}.`, missing };
  }
  if (found.length > 1)
    return {
      status: "needs_review",
      candidates: found.map((f) => ({ key: f.key, description: `${f.key}: ${f.value.options.length} options`, variables: f.value.options.map((o) => o.variable) })),
      reason: `${found.length} lists could be the reasons for a different choice.`,
      values: Object.fromEntries(found.map((f) => [f.key, f.value])),
    };
  const r = found[0].value;
  return {
    status: "found",
    value: r,
    evidence: [
      `multiple-response set ${r.key}: ${r.options.length} options asked about the difference between the ideal and actual brands`,
      r.none ? `exclusive "no reason" flag ${r.none.variable} (code ${r.none.code}) outside the set` : "no exclusive \"no reason\" flag",
      r.cannotRecall ? `exclusive "cannot recall" flag ${r.cannotRecall.variable} (code ${r.cannotRecall.code}) outside the set` : "no exclusive \"cannot recall\" flag",
      "asked only when the ideal and actual brands differ: checked against the data when the figures are calculated",
    ],
  };
}

/** An exclusive 0/1 flag's selected code: the one answer not labelled as not selected ("Not selected", "No"). */
function flagOf(v: RoleVariable): { variable: string; code: string } | null {
  const selected = Object.entries(v.valueLabels ?? {}).filter(([, l]) => !/^(not selected|not mentioned|unselected|no)$/i.test(clean(l)));
  return selected.length === 1 ? { variable: v.name, code: selected[0][0] } : null;
}

// ---- Recognition -------------------------------------------------------------------------------------------

export function recogniseBrandExtension(variables: RoleVariable[], frame: BrandFrame | null): BrandExtensionRecognition {
  const usable = variables.filter((v) => !v.weightLike);
  const families = frame ? ratingFamilies(usable, frame) : [];
  const ratings = {} as Record<RatingConstruct, Detection<RatingFamily>>;
  for (const c of RATING_CONSTRUCTS) {
    const mine = families.filter((f) => f.constructs.includes(c));
    if (mine.length === 1 && mine[0].constructs.length === 1 && mine[0].problems.length === 0) {
      const f = mine[0].family;
      ratings[c] = {
        status: "found",
        value: f,
        evidence: [
          `"${f.wording}" asked about ${f.byBrand.length} brands, one variable each (brand named in the wording)`,
          `five-point agreement answers: ${f.scale.map((s) => `${s.code} ${s.label}`).join(", ")}`,
          f.cannotJudge.length ? `cannot judge kept apart: ${f.cannotJudge.map((s) => `${s.code} ${s.label}`).join(", ")}` : "no cannot-judge answer",
          "asked only among respondents aware of each brand: checked against the data when the figures are calculated",
        ],
      };
    } else if (mine.length > 0) {
      const reasons = mine.map((m) => (m.constructs.length > 1 ? `${describeRating(m.family)} reads as ${m.constructs.map((x) => CONSTRUCT_TITLE[x].toLowerCase()).join(" and ")}` : m.problems.length ? `${describeRating(m.family)}: ${m.problems.join("; ")}` : describeRating(m.family)));
      ratings[c] = {
        status: "needs_review",
        candidates: mine.map((m) => ({ key: m.family.key, description: describeRating(m.family), variables: m.family.byBrand.map((b) => b.variable) })),
        reason: mine.length > 1 ? `${mine.length} questions could be ${CONSTRUCT_TITLE[c].toLowerCase()}: ${reasons.join("; ")}.` : `The question found needs a check: ${reasons.join("; ")}.`,
        values: Object.fromEntries(mine.map((m) => [m.family.key, m.family])),
      };
    } else {
      const hinted = usable.filter((v) => NAME_HINT[c].test(v.name));
      ratings[c] = hinted.length >= 3
        ? {
            status: "needs_review",
            candidates: [],
            reason: `${hinted.length} variables are named like ${CONSTRUCT_TITLE[c].toLowerCase()} (${hinted.slice(0, 3).map((v) => v.name).join(", ")} ...), but their wording or answer labels do not show a five-point agreement rating per brand. Add the codebook or questionnaire so the question can be read; a name alone is not used.`,
          }
        : { status: "not_measured", reason: frame ? `No ${CONSTRUCT_TITLE[c].toLowerCase()} rating was found in this file.` : "No brand list was found in this file.", missing: MISSING[c] };
    }
  }
  const episode = findEpisode(usable, frame);
  const reasons = findReasons(usable, episode);
  const claimed = new Set<string>();
  const claim = (d: Detection<unknown>, vars: (v: never) => string[]) => {
    if (d.status === "found") vars(d.value as never).forEach((x) => claimed.add(x));
    if (d.status === "needs_review") d.candidates.forEach((cand) => cand.variables.forEach((x) => claimed.add(x)));
  };
  for (const c of RATING_CONSTRUCTS) claim(ratings[c], (f: RatingFamily) => f.byBrand.map((b) => b.variable));
  claim(episode, (e: EpisodeQuestions) => [e.actual.variable, e.ideal.variable]);
  claim(reasons, (r: ReasonQuestions) => [...r.options.map((o) => o.variable), ...(r.none ? [r.none.variable] : []), ...(r.cannotRecall ? [r.cannotRecall.variable] : [])]);
  return { ratings, episode, reasons, claimed: [...claimed] };
}

// ---- Confirmations -----------------------------------------------------------------------------------------

/** The researcher's saved choice for a construct: one candidate's key, or that the file does not measure it. */
export type ConstructConfirmation = { choice: string | "not_measured"; by: string | null; at: string; documentId: string | null; evidence?: string };

/**
 * A recognition with the researcher's confirmations applied: a "needs review" construct whose saved choice is one of
 * this file's candidates becomes "found" with the confirmation's provenance; a saved "not measured" makes it not
 * measured, said as the researcher's decision. A saved choice that is not among this file's candidates (another
 * wave's questions) leaves the construct in review, said. A construct found without doubt is never overruled by an
 * older confirmation.
 */
export function withConfirmations(rec: BrandExtensionRecognition, confirmations: Partial<Record<ExtensionConstruct, ConstructConfirmation>>): BrandExtensionRecognition {
  const apply = <T,>(c: ExtensionConstruct, d: Detection<T>): Detection<T> => {
    const conf = confirmations[c];
    if (!conf || d.status !== "needs_review") return d;
    const provenance = { by: conf.by, at: conf.at, documentId: conf.documentId };
    if (conf.choice === "not_measured") return { status: "not_measured", reason: `The researcher confirmed that this file does not measure ${CONSTRUCT_TITLE[c].toLowerCase()}${conf.by ? ` (${conf.by}, ${conf.at.slice(0, 10)})` : ""}.`, missing: MISSING[c] };
    const value = d.values?.[conf.choice];
    if (!value) return { ...d, reason: `${d.reason} The saved choice (${conf.choice}) is not one of this file's questions.` };
    const cand = d.candidates.find((x) => x.key === conf.choice);
    return { status: "found", value, evidence: [`confirmed by the researcher: ${cand?.description ?? conf.choice}`], confirmed: provenance };
  };
  const ratings = Object.fromEntries(RATING_CONSTRUCTS.map((c) => [c, apply(c, rec.ratings[c])])) as BrandExtensionRecognition["ratings"];
  return { ...rec, ratings, episode: apply("episode", rec.episode), reasons: apply("reasons", rec.reasons) };
}

// ---- Other brand names -------------------------------------------------------------------------------------

/** An Other brand name for comparison: trimmed, case-folded and with repeated whitespace collapsed. The verbatim
 * name is kept for display; this key is its identity. "" when there is no name. */
export function normaliseBrandName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

/** A confirmed alias: an Other name (normalised) that is a tracked brand (by its code) or another Other name. */
export type BrandAlias = { name: string; brandCode: string | null; otherName: string | null; by: string | null; at: string };

/** A respondent's brand identity in the episode: a tracked brand by code, a named Other by its resolved name, or
 * unresolved (an Other code without a name). */
export type BrandIdentity = { kind: "brand"; code: string } | { kind: "other"; name: string } | { kind: "unresolved" };

export const identityKey = (i: BrandIdentity) => (i.kind === "brand" ? `brand:${i.code}` : i.kind === "other" ? `other:${i.name}` : "unresolved");

/**
 * The identity of an Other answer from its name text: a confirmed alias first (to a tracked brand, or to another
 * Other name), else the normalised name itself. Two Other answers are the same brand only when these identities
 * match; a name with no text is unresolved. A typed tracked-brand name without a confirmed alias stays an Other
 * name (and is offered for confirmation, brandExtension.ts), never matched by a guess.
 */
export function resolveOther(name: string | null | undefined, aliases: BrandAlias[]): BrandIdentity {
  const n = normaliseBrandName(name);
  if (!n) return { kind: "unresolved" };
  const alias = aliases.find((a) => a.name === n);
  if (alias?.brandCode) return { kind: "brand", code: alias.brandCode };
  if (alias?.otherName) return { kind: "other", name: normaliseBrandName(alias.otherName) };
  return { kind: "other", name: n };
}
