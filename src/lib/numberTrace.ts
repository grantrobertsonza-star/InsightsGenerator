// Numerical traceability for model-written text: the ONE shared validator for every AI-output path
// (pre-insights, synthesized insights, recommendations, the report narrative and its revisions).
//
// A matching numeral is not verification. A figure is "traced" only when its signed value, unit,
// measure and the subject it is stated for agree with a figure in the evidence the text CITES, and
// nothing in its sentence changes the meaning (another period, an invented scale or base, a causal
// or whole-population claim). Where that context cannot be established the result is
// "needs_review", never "traced"; where the evidence contradicts it the result is "unsupported".
// Codex's independent cases (fixtures/number-check/cases.json, 24 cases) are the acceptance set;
// numberCheckFixtures.test.ts runs every one of them against this module.
//
// Per figure, in this order:
//   year (1900-2100, no unit)  traced when the cited evidence covers that year; otherwise
//                              unsupported, and every other figure in the same sentence is too
//                              (a correct value stated for an uncited period)
//   scale ("1-10 scale")       both bounds must match a scale in the evidence
//   base ("base 200", "n=",    must match a base size in the evidence
//     "based on 200 men")
//   count ("3 steps",          a count in the evidence traces; a count derivable from a cited
//     "60 male buyers")        share and base needs review (derived); any other count needs review
//                              (operational or proposed numbers, not research statistics)
//   percentage points          a cited value in points, or the difference of two shares from the
//                              same cited finding (permitted derivation); otherwise unsupported
//   relative % ("20% higher    the relative difference of two cited shares needs review (policy:
//     than") and ratios        derived relative claims); any other value is unsupported
//   ("1.5 times")
//   value (share, score,       same signed value (or the cited value rounded to the output's own
//     mean, plain, currency)   precision: no invented decimals), compatible unit and measure, and
//                              subject words that match the cited figure's clause. A different
//                              value cited for the subject the sentence names is unsupported (a
//                              correct number on the wrong group). Subject words the cited evidence
//                              never mentions, or a unit stated on one side only, need review.
//                              "exactly"/"precisely" on a sample estimate is unsupported.
// Per sentence: causal language ("caused", "proves", "because of", ...) or a whole-population
// generalisation ("all men in the population") alongside a figure is unsupported: a descriptive
// figure does not establish either.
//
// Limits, stated: the subject/measure check is lexical (content words, light stemming, a small
// gender-synonym map), not semantic; a paraphrase with no shared word needs review. Number words are
// read when they carry a unit or sign, or are ten or more. Derived differences are allowed only
// between two shares of one cited finding. These rules cannot detect every misstatement.

export type FigureStatus = "traced" | "needs_review" | "unsupported";
export type FigureFinding = {
  field: string;
  text: string;
  status: Exclude<FigureStatus, "traced">;
  reason: string;
  /** Character span in the checked text (absent on sentence-level findings stored before v3). */
  start?: number;
  end?: number;
};
/** What is stored with a generated output. Null on legacy rows: not checked (no claim either way). */
export type FigureCheck = {
  status: FigureStatus;
  checked: number;
  figures: FigureFinding[];
  checked_at: string;
};
/**
 * What a figure ABSENT from the cited evidence means for this kind of output. For evidence
 * statements (insights, narratives) it is unsupported. For a recommendation it may be a proposed
 * target ("cut churn by 10%"), which text cannot tell apart from a claim, so it needs review.
 * Conflicts (sign, unit, measure, a different value for the same subject) are unsupported either way.
 */
export type AbsentFigures = "unsupported" | "needs_review";

type Unit = "percent" | "points" | "relative" | "ratio" | "currency" | "count" | "base" | "year" | "scale" | "plain";
type Kind = "share" | "score" | "mean" | "plain";
type Figure = {
  text: string;
  start: number;
  end: number;
  value: number;
  decimals: number;
  unit: Unit;
  kind: Kind;
  exact: boolean;
  sentence: number;
  words: Set<string>;
  contrastWords: Set<string>;
  sourceIndex: number;
  /** For a scale: the other bound. */
  scaleTo?: number;
  /** Direction stated in words around the figure ("fell 5%", "rose 5%"), when unambiguous. */
  direction: "up" | "down" | null;
};

// ---------------------------------------------------------------- tokens and words

const STOPWORDS = new Set(
  (
    "a an the and or but of in on at to for from by with as is are was were be been being it its this that these those " +
    "than then there their they them we our you your he she his her not no nor so such only just also about around " +
    "approximately roughly nearly almost some more less most least over under up down per cent percent percentage " +
    "point points pts pp rate rates share shares level levels value values figure figures number numbers total " +
    "average avg mean base sample respondents respondent people participants n out into among between within while which " +
    "who whom what when where how why can could may might will would should must has have had do does did " +
    "higher lower increase decrease rise rose fall fell drop dropped grew grow growth decline declined exceed exceeds " +
    "exceeded outpace trail trails lead leads reach reached stand stands sit sits show shows showed indicate indicates " +
    "report reports reported plus minus either way likely times than wave raw each overall all every here now just " +
    "with without very much many few one two three about score scores estimate estimated result results scale instrument " +
    "because since therefore thus hence so"
  ).split(/\s+/),
);
const SYNONYMS: Record<string, string> = {
  men: "male", man: "male", males: "male", male: "male", boys: "male",
  women: "female", woman: "female", females: "female", female: "female", girls: "female",
};
function stem(word: string): string {
  const w = SYNONYMS[word] ?? word;
  if (SYNONYMS[word]) return w;
  let s = w;
  for (const suffix of ["ing", "ed", "es", "s"]) {
    if (s.length > suffix.length + 3 && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s;
}
function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w))
      .map(stem)
      .filter((w) => w.length > 1),
  );
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_NUMBER = new RegExp(
  `\\b(?:(minus|negative|plus)\\s+)?((?:${Object.keys(TENS).join("|")})(?:[-\\s](?:${Object.keys(ONES).filter((k) => ONES[k] > 0 && ONES[k] < 10).join("|")}))?|${Object.keys(ONES).join("|")})(?:\\s+hundred)?\\b`,
  "gi",
);
function wordValue(phrase: string): number {
  const parts = phrase.toLowerCase().split(/[-\s]+/);
  let v = 0;
  for (const p of parts) {
    if (p === "hundred") v = (v || 1) * 100;
    else v += TENS[p] ?? ONES[p] ?? 0;
  }
  return v;
}

// Hyphenated compounds whose number is part of a name, not a negative value ("top-10", "covid-19").
const HYPHEN_COMPOUND = /\b(top|covid|sars|fy|h|q|wave|phase|tier|level|type|class|grade|gen|step|item|question|section|page)$/i;

/** Sentence index of every character: split at . ! ? (not decimal points) and line breaks. */
function sentenceIndex(text: string): number[] {
  const idx: number[] = [];
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    idx.push(n);
    const c = text[i];
    if ((c === "." && !(/\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""))) || c === "!" || c === "?" || c === "\n") n++;
  }
  return idx;
}
/** The clause around a span: split at sentence punctuation, commas, semicolons, colons and brackets,
 * except a full stop or comma between digits (a decimal point, a thousands mark). */
function clauseAround(text: string, start: number, end: number): string {
  const isStop = (i: number) =>
    /[.;:,()[\]\n!?]/.test(text[i]) && !(/[.,]/.test(text[i]) && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? ""));
  let s = start;
  while (s > 0 && !isStop(s - 1)) s--;
  let e = end;
  while (e < text.length && !isStop(e)) e++;
  return text.slice(s, e);
}

// Thousands groups only when each group is exactly three digits ("1,200"), so "200,2026" is two
// numbers and "25,95" is two numbers.
/** A count: the number is followed by a noun ("3 steps", "60 male buyers"), not a function word
 * or a period/scale word. */
function isCountNoun(word: string | undefined): boolean {
  if (!word || word.length < 3) return false;
  return !STOPWORDS.has(word) && !/^(on|in|of|and|or|to|for|from|by|at|wave|waves|year|years|point|scale|instrument|percent|per)$/.test(word);
}

/** Subject words of a figure: the content words within a few tokens of it, inside its clause
 * (what the number is stated FOR), not every word of a long sentence. */
function windowWords(clause: string, figureText: string): Set<string> {
  const at = clause.indexOf(figureText);
  if (at < 0) return contentWords(clause);
  const before = clause.slice(0, at).trim().split(/\s+/).slice(-4).join(" ");
  const after = clause.slice(at + figureText.length).trim().split(/\s+/).slice(0, 3).join(" ");
  return contentWords(`${before} ${after}`);
}

const DOWN = /(?<![a-z])(down|declin[a-z]*|decreas[a-z]*|fell|fall[a-z]*|drop[a-z]*|los[st]|shr[ai]nk[a-z]*)(?![a-z])/i;
const UP = /(?<![a-z])(up|ris[a-z]*|rose|increas[a-z]*|grew|grow[a-z]*|gain[a-z]*)(?![a-z])/i;
/** A change direction stated in words, only when one direction is named. */
function directionOf(clause: string): "up" | "down" | null {
  const down = DOWN.test(clause);
  const up = UP.test(clause);
  return down === up ? null : down ? "down" : "up";
}

const DIGITS = /(\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.(\d+))?/g;

/** Every numeric figure in a text with its context. */
function extractFigures(text: string, sourceIndex = -1): Figure[] {
  const sentences = sentenceIndex(text);
  const raw: { start: number; end: number; value: number; decimals: number; signed: boolean }[] = [];

  for (const m of text.matchAll(DIGITS)) {
    let start = m.index ?? 0;
    const end = start + m[0].length;
    const prev = text[start - 1] ?? "";
    const next = text[end] ?? "";
    if (prev === "." && /\d/.test(text[start - 2] ?? "")) continue; // the decimals of a larger number
    // A digit glued to a capital (Q1, H2, 4G) or followed by letters (3rd, 4G) is a name, not a
    // statistic, unless the letters are a unit (20pp, 1.5x).
    if (/[A-QS-Z]/.test(prev) && !/[A-Za-z]/.test(text[start - 2] ?? "")) continue;
    if (/[A-Za-z]/.test(next) && !/^(pp|pts?|x|k|m)\b/i.test(text.slice(end))) continue;
    const whole = m[1].replace(/,/g, "");
    const fraction = m[2] ?? "";
    let value = Number(fraction ? `${whole}.${fraction}` : whole);
    let signed = false;
    if (prev === "−" || prev === "+" || prev === "±") {
      if (prev === "−") value = -value;
      start -= 1;
      signed = true;
    } else if (prev === "-") {
      const before = text[start - 2] ?? "";
      const word = text.slice(Math.max(0, start - 12), start - 1);
      // "14.4-35.6" and "1-5" are ranges; "top-10" is a name; otherwise a leading minus.
      if (!/\d/.test(before) && !HYPHEN_COMPOUND.test(word)) {
        value = -value;
        start -= 1;
        signed = true;
      }
    }
    raw.push({ start, end, value, decimals: fraction.length, signed });
  }
  for (const m of text.matchAll(WORD_NUMBER)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const after = text.slice(end, end + 24).toLowerCase();
    let value = wordValue(m[2] + (/\shundred$/i.test(m[0]) ? " hundred" : ""));
    const sign = (m[1] ?? "").toLowerCase();
    const hasUnit = /^\s*(%|per ?cent|percentage points?|points?)/.test(after);
    if (!(hasUnit || sign || value >= 10)) continue;
    if (sign === "minus" || sign === "negative") value = -value;
    raw.push({ start, end, value, decimals: 0, signed: !!sign });
  }
  raw.sort((a, b) => a.start - b.start);

  const out: Figure[] = [];
  for (const r of raw) {
    const after = text.slice(r.end, r.end + 40).toLowerCase();
    const before = text.slice(Math.max(0, r.start - 24), r.start).toLowerCase();
    const clause = clauseAround(text, r.start, r.end);
    const clauseLower = clause.toLowerCase();
    const prefix = text.slice(Math.max(0, r.start - 1), r.start);
    let unit: Unit = "plain";
    let scaleTo: number | undefined;
    const range = /^\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*(?:-?\s*point)?\s*(scale|instrument)\b/.exec(after);
    if (range) {
      unit = "scale";
      scaleTo = Number(range[1]);
    } else if (/^\s*(%|per ?cent\b)\s*(higher|lower|more|less|greater|smaller|above|below)\s+than\b/.test(after)) unit = "relative";
    else if (/^\s*(%|per ?cent\b)/.test(after)) unit = "percent";
    else if (/^\s*-?\s*(percentage[- ]points?|pp|points?|pts?)\b/.test(after)) unit = "points";
    else if (/^\s*(times|x)\b/.test(after)) unit = "ratio";
    else if (/[R$£€]$/.test(prefix) || /^\s*(rand|dollars?|pounds?|euros?)\b/.test(after)) unit = "currency";
    else if (/\b(base( of| size)?|n\s*=|based on|sample( of| size)?)\s*$/.test(before) || /^\s*(respondents|interviews|completes)\b/.test(after)) unit = "base";
    else if (r.decimals === 0 && Number.isInteger(r.value) && r.value >= 1900 && r.value <= 2100 && !r.signed) unit = "year";
    else if (r.decimals === 0 && isCountNoun(/^\s+([a-z]+)/.exec(after)?.[1])) unit = "count";
    // A number that closes a scale range ("on 1-5 scale": the 5) belongs to the scale.
    if (unit !== "scale" && /(\d)\s*(?:-|–|to)\s*$/.test(before) && /^\s*(?:-?\s*point)?\s*(scale|instrument)\b/.test(after)) unit = "scale";
    const kind: Kind =
      unit === "percent"
        ? "share"
        : /(?<![a-z])(nps|net promoter|index|rating)(?![a-z])/.test(clauseLower) && (unit === "plain" || unit === "points")
          ? "score"
          : /(?<![a-z])(mean|averag[a-z]*|avg)(?![a-z])/.test(clauseLower) && unit === "plain"
            ? "mean"
            : "plain";
    out.push({
      text: text.slice(r.start, r.end),
      start: r.start,
      end: r.end,
      value: r.value,
      decimals: r.decimals,
      unit,
      kind,
      exact: /\b(exactly|precisely)\s*$/.test(before),
      sentence: sentences[r.start] ?? 0,
      // Cited figures keep their whole clause (short in evidence text); a checked figure is judged
      // on the words right around it.
      words: sourceIndex >= 0 ? contentWords(clause.replace(text.slice(r.start, r.end), " ")) : windowWords(clause, text.slice(r.start, r.end)),
      // An aside can name the supported group while the actual sentence subject is another group.
      // Whole-sentence context therefore needs review even when the nearby words match.
      contrastWords: (() => {
        const sentence = text.slice(sentences.indexOf(sentences[r.start]), sentences.lastIndexOf(sentences[r.start]) + 1);
        return /\b(rather than|instead of|as opposed to|unlike)\b/i.test(sentence) ? contentWords(sentence) : new Set<string>();
      })(),
      sourceIndex,
      scaleTo,
      direction: directionOf(clause),
    });
  }
  return out;
}

// ---------------------------------------------------------------- matching

const roundTo = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
/** Same signed value, or the cited value rounded at the output's own precision. Never extra decimals. */
function sameValue(source: Figure, out: Figure): boolean {
  if (out.decimals > source.decimals) return close(source.value, out.value);
  return close(roundTo(source.value, out.decimals), out.value);
}
const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

const VALUE_UNITS = new Set<Unit>(["percent", "points", "plain", "currency"]);

/** A hard conflict between an output figure and a cited figure with the same value, or null. */
function conflict(out: Figure, src: Figure): string | null {
  if (out.unit === "currency" || src.unit === "currency") {
    if (out.unit !== src.unit) return `${out.text} is ${out.unit === "currency" ? "money" : "not money"} here but not in the evidence`;
    return null;
  }
  if (out.unit === "percent" && (src.kind === "score" || src.kind === "mean")) return `${out.text} is a share here but ${src.kind === "score" ? "a net score" : "an average"} in the evidence`;
  if (src.unit === "percent" && (out.kind === "score" || out.kind === "mean")) return `${out.text} is ${out.kind === "score" ? "a net score" : "an average"} here but a share in the evidence`;
  if (out.unit === "points" && src.unit === "percent") return `${out.text} is in points here but a percentage in the evidence`;
  if (out.direction && src.direction && out.direction !== src.direction)
    return `${out.text} is described as ${out.direction === "up" ? "a rise" : "a fall"} here but ${src.direction === "up" ? "a rise" : "a fall"} in the evidence`;
  return null;
}

type Result = { status: FigureStatus; reason: string };

function judgeFigure(out: Figure, all: Figure[], sources: string[], absent: AbsentFigures, citedWords: Set<string>): Result {
  const cited = all.filter((s) => s.sourceIndex >= 0);
  const pairsIn = (pred: (f: Figure) => boolean) =>
    sources.flatMap((_, i) => {
      const fs = cited.filter((f) => f.sourceIndex === i && pred(f));
      return fs.flatMap((a) => fs.filter((b) => b !== a).map((b) => [a, b] as const));
    });

  switch (out.unit) {
    case "year":
      return cited.some((s) => s.unit === "year" && s.value === out.value)
        ? { status: "traced", reason: "" }
        : { status: "unsupported", reason: `${out.text} is a period the cited evidence does not cover` };
    case "scale": {
      const match = cited.find((s) => s.unit === "scale" && close(s.value, out.value) && (out.scaleTo === undefined || close(s.scaleTo ?? NaN, out.scaleTo)));
      return match
        ? { status: "traced", reason: "" }
        : { status: "unsupported", reason: `the ${out.text}${out.scaleTo !== undefined ? `-${out.scaleTo}` : ""} scale is not the scale in the cited evidence` };
    }
    case "base":
      return cited.some((s) => s.unit === "base" && close(s.value, out.value))
        ? { status: "traced", reason: "" }
        : { status: "unsupported", reason: `${out.text} is given as a base size, but no cited base is ${out.text}` };
    case "count": {
      if (cited.some((s) => (s.unit === "count" || s.unit === "base") && close(s.value, out.value) && overlap(out.words, s.words) > 0))
        return { status: "traced", reason: "" };
      const derivable = sources.some((_, i) => {
        const fs = cited.filter((f) => f.sourceIndex === i);
        return fs.some((p) => p.unit === "percent" && fs.some((b) => b.unit === "base" && close(roundTo((p.value * b.value) / 100, 0), out.value)));
      });
      return derivable
        ? { status: "needs_review", reason: `${out.text} is a count derived from a cited share and base; its population or weighting is not stated in the evidence` }
        : { status: "needs_review", reason: `${out.text} is a count the cited evidence does not contain (an operational or proposed number, or a claim to check)` };
    }
    case "relative": {
      const derived = pairsIn((f) => f.unit === "percent").some(([a, b]) => b.value !== 0 && close(roundTo(((a.value - b.value) / b.value) * 100, out.decimals), out.value));
      return derived
        ? { status: "needs_review", reason: `${out.text}% is a relative difference derived from cited shares; derived relative claims need approval` }
        : { status: "unsupported", reason: `${out.text}% is not the relative difference of any two cited shares` };
    }
    case "ratio": {
      const derived = pairsIn((f) => f.unit === "percent" || f.kind === "mean" || f.unit === "plain").some(
        ([a, b]) => b.value !== 0 && close(roundTo(a.value / b.value, out.decimals), out.value),
      );
      return derived
        ? { status: "needs_review", reason: `${out.text} times is a ratio derived from cited figures; derived ratios need approval` }
        : { status: "unsupported", reason: `${out.text} times is not a ratio of any two cited figures` };
    }
    case "points": {
      // A value stated in points (an NPS or score) first; otherwise a difference of two shares.
      const direct = cited.filter((s) => VALUE_UNITS.has(s.unit) && s.unit !== "percent" && sameValue(s, out));
      if (direct.length === 0) {
        const diff = pairsIn((f) => f.unit === "percent").some(([a, b]) => close(roundTo(Math.abs(a.value - b.value), out.decimals), Math.abs(out.value)));
        if (diff) return { status: "traced", reason: "" };
        const asPercent = cited.find((s) => s.unit === "percent" && sameValue(s, out));
        if (asPercent) return { status: "unsupported", reason: `${out.text} is in points here but a percentage in the evidence` };
        return { status: absent, reason: `${out.text} points is neither a cited value nor the difference of two cited shares` };
      }
      break;
    }
    default:
      break;
  }

  // Value path: share, score, mean, plain number, money.
  const sameAbs = cited.filter((s) => VALUE_UNITS.has(s.unit) && (sameValue(s, out) || sameValue({ ...s, value: -s.value }, out)));
  const same = sameAbs.filter((s) => sameValue(s, out));
  if (same.length === 0) {
    if (sameAbs.length > 0) return { status: "unsupported", reason: `${out.text} has the opposite sign in the cited evidence (${sameAbs[0].text})` };
    return {
      status: absent,
      reason:
        absent === "unsupported"
          ? `${out.text} does not appear in the cited evidence`
          : `${out.text} does not appear in the cited evidence (a proposed target, or a claim to check)`,
    };
  }
  const compatible = same.filter((s) => conflict(out, s) === null);
  if (compatible.length === 0) return { status: "unsupported", reason: conflict(out, same[0])! };
  if (out.exact) return { status: "unsupported", reason: `${out.text} is stated as exact, but the evidence is a sample estimate` };

  const best = Math.max(...compatible.map((s) => overlap(out.words, s.words)));
  // A correct value on the wrong subject: another cited figure (a different value, compatible unit)
  // is about MORE of what this sentence names than any occurrence of this value is.
  const own = all.filter((f) => f.sourceIndex < 0);
  const rival = cited.find(
    (s) =>
      VALUE_UNITS.has(s.unit) &&
      !sameValue(s, out) &&
      !own.some((o) => o !== out && sameValue(s, o)) &&
      conflict(out, s) === null &&
      overlap(out.words, s.words) > best,
  );
  if (rival) return { status: "unsupported", reason: `the cited evidence gives ${rival.text}${rival.unit === "percent" ? "%" : ""} for what this sentence describes, not ${out.text}` };
  if (out.words.size === 0) return { status: "needs_review", reason: `${out.text} appears in the evidence, but the sentence does not say what it refers to` };
  if (best === 0) return { status: "needs_review", reason: `${out.text} appears in the evidence, but what it refers to could not be matched` };
  const unknown = [...out.words].filter((w) => !citedWords.has(w));
  if (unknown.length > 0) return { status: "needs_review", reason: `${out.text} is stated for "${unknown.join(", ")}", which the cited evidence does not mention` };
  const sentenceUnknown = [...out.contrastWords].filter((w) => !citedWords.has(w));
  if (sentenceUnknown.length > 0) return { status: "needs_review", reason: `${out.text} matches a cited value, but the full sentence introduces unverified context: ${sentenceUnknown.join(", ")}` };
  const exactCtx = compatible.filter((s) => overlap(out.words, s.words) === best);
  if (exactCtx.every((s) => (s.unit === "plain") !== (out.unit === "plain") && s.kind !== "score" && out.kind !== "score"))
    return { status: "needs_review", reason: `${out.text} appears in the evidence, but its unit is stated on one side only` };
  return { status: "traced", reason: "" };
}

const CAUSAL = /\b(caus(e|ed|es|ing)|proves?|proved|proven|because of|due to|results? in|resulted in|leads? to|led to)\b/i;
const UNIVERSAL = /\b(all|every|everyone|everybody)\b[^.!?]*\b(population|always)\b|\b(the whole|the entire) population\b/i;

export type ExplainedFigure = { text: string; start: number; end: number; status: FigureStatus; reason: string };

/** Every figure in `text` with its outcome (traced ones included), plus sentence-level findings. */
export function explainFigures(
  text: string,
  sources: string[],
  absent: AbsentFigures = "unsupported",
): { figures: ExplainedFigure[]; sentences: ExplainedFigure[] } {
  const own = extractFigures(text, -1);
  const cited = sources.flatMap((s, i) => extractFigures(s, i));
  const citedWords = new Set(sources.flatMap((s) => [...contentWords(s)]));
  const all = [...cited, ...own];
  const results = own.map((f) => ({ figure: f, ...judgeFigure(f, all, sources, absent, citedWords) }));
  // A figure stated for an uncited period: every figure in that sentence is unsupported.
  const badYears = new Set(results.filter((r) => r.figure.unit === "year" && r.status === "unsupported").map((r) => r.figure.sentence));
  for (const r of results) {
    if (r.figure.unit !== "year" && badYears.has(r.figure.sentence) && r.status !== "unsupported") {
      r.status = "unsupported";
      r.reason = `${r.figure.text} is stated for a period the cited evidence does not cover`;
    }
  }
  const sentences: ExplainedFigure[] = [];
  const sentenceIds = new Set(own.map((f) => f.sentence));
  const idx = sentenceIndex(text);
  for (const sid of sentenceIds) {
    const start = idx.indexOf(sid);
    const end = idx.lastIndexOf(sid) + 1;
    const sentence = text.slice(start, end);
    const causal = CAUSAL.exec(sentence);
    if (causal) {
      sentences.push({ text: causal[0], start: start + causal.index, end: start + causal.index + causal[0].length, status: "unsupported", reason: `"${causal[0]}" claims a cause; a descriptive figure does not establish one` });
    }
    const universal = UNIVERSAL.exec(sentence);
    if (universal) {
      sentences.push({ text: universal[0], start: start + universal.index, end: start + universal.index + universal[0].length, status: "unsupported", reason: "a sample estimate is stated as true of a whole population" });
    }
  }
  return {
    figures: results.map((r) => ({ text: r.figure.text, start: r.figure.start, end: r.figure.end, status: r.status, reason: r.reason })),
    sentences,
  };
}

/** Checks every figure of one text against the sources it cites (non-traced results only). */
export function checkFigures(
  field: string,
  text: string,
  sources: string[],
  absent: AbsentFigures = "unsupported",
): { checked: number; figures: FigureFinding[] } {
  const { figures, sentences } = explainFigures(text, sources, absent);
  const flagged = [...figures, ...sentences].filter((f): f is ExplainedFigure & { status: Exclude<FigureStatus, "traced"> } => f.status !== "traced");
  return {
    checked: figures.length,
    figures: flagged.map((f) => ({ field, text: f.text, status: f.status, reason: f.reason, start: f.start, end: f.end })),
  };
}

/** Checks several fields, each against its own cited sources, into one stored record. */
export function figureCheck(
  fields: { field: string; text: string; sources: string[] }[],
  options: { absent?: AbsentFigures; now?: Date } = {},
): FigureCheck {
  const now = options.now ?? new Date();
  let checked = 0;
  const figures: FigureFinding[] = [];
  for (const f of fields) {
    const r = checkFigures(f.field, f.text, f.sources, options.absent);
    checked += r.checked;
    figures.push(...r.figures);
  }
  const status: FigureStatus = figures.some((f) => f.status === "unsupported")
    ? "unsupported"
    : figures.some((f) => f.status === "needs_review")
      ? "needs_review"
      : "traced";
  return { status, checked, figures, checked_at: now.toISOString() };
}

/** Plain summary for screens and exports; null when everything traced (or nothing was checked). */
export function figureCheckNote(check: FigureCheck | null | undefined): string | null {
  if (!check || check.status === "traced") return null;
  const listed = check.figures.map((f) => `${f.text} (${f.reason})`).join("; ");
  return check.status === "unsupported" ? `Figures not supported by the cited evidence: ${listed}.` : `Figures need review: ${listed}.`;
}
