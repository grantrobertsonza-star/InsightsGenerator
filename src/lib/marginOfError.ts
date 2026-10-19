// The calculated check under "Sample size and precision" in a proposal review (Grant, 2026-10-19:
// evaluate sampling on two levels, size and margin of error, and method). Pure code, no model call:
// it finds sentences in the document that state a sample size and a margin of error together, works
// out the margin that sample size supports, and says whether the stated one is consistent.
//
// The formula, for a proportion at its widest (p = 0.5), as surveys conventionally quote it:
//   margin (percentage points) = z * sqrt(deff * p * (1 - p) / n) * 100
//   z = 1.645 (90%), 1.96 (95%), 2.576 (99%); deff = the design effect the document states, else 1.
// Assumptions, said on screen: a 95% level when none is stated; no finite-population correction
// (the population size is rarely stated, and it only narrows the margin for samples that are a large
// share of the population); deff 1 (a simple random sample) when none is stated.
// Limits: only sentences that name one sample size and one margin are checked; a sentence with
// several sizes (total and subgroups) is reported as not checked rather than guessed at.

export const Z_BY_CONFIDENCE: Record<number, number> = { 90: 1.645, 95: 1.96, 99: 2.576 };

/** The margin of error, in percentage points, for a proportion of 0.5. */
export function expectedMarginOfError(n: number, confidence = 95, designEffect = 1): number {
  const z = Z_BY_CONFIDENCE[confidence];
  if (!z || !(n > 0) || !(designEffect > 0)) throw new Error(`Cannot compute a margin of error for n=${n}, ${confidence}%, deff=${designEffect}.`);
  return z * Math.sqrt((designEffect * 0.25) / n) * 100;
}

/** The sample size a margin needs, at the same assumptions (rounded up). */
export function sampleSizeFor(marginPoints: number, confidence = 95, designEffect = 1): number {
  const z = Z_BY_CONFIDENCE[confidence];
  return Math.ceil((designEffect * 0.25 * z * z) / (marginPoints / 100) ** 2);
}

export type PrecisionCheck =
  | {
      kind: "checked";
      quote: string;
      n: number;
      statedMargin: number;
      confidence: number;
      confidenceStated: boolean;
      designEffect: number;
      designEffectStated: boolean;
      expectedMargin: number;
      /** consistent: within rounding; understated: the document claims more precision than n supports; conservative: wider than needed. */
      verdict: "consistent" | "understated" | "conservative";
      neededN: number;
    }
  | { kind: "not_checked"; quote: string; reason: string };

const NUMBER = String.raw`\d{1,3}(?:[ , ]\d{3})+|\d+`;
const MARGIN_RE = new RegExp(String.raw`(?:margin of error|margin of sampling error|sampling error|\bMoE\b)[^.;\n]{0,40}?(?:±|\+/-|\+-|plus or minus)?\s*(\d+(?:[.,]\d+)?)\s*(?:%|per ?cent|percentage points?)|(?:±|\+/-|plus or minus)\s*(\d+(?:[.,]\d+)?)\s*(?:%|per ?cent|percentage points?)`, "gi");
const SIZE_RE = new RegExp(String.raw`\bn\s*=\s*(${NUMBER})\b|\b(?:sample(?: size)?|total) of\s*(${NUMBER})\b|\b(${NUMBER})\s*(?:respondents|interviews|completes|completed interviews|participants|households|adults|people|cases|men|women|customers|users|members|clients|businesses|SMEs|consumers|voters|students|employees|farmers)\b`, "gi");
const CONFIDENCE_RE = /\b(90|95|99)\s*%\s*(?:confidence|level of confidence|confidence level|CI)\b|\bconfidence (?:level )?of\s*(90|95|99)\s*%/i;
const DEFF_RE = /\bdesign effect(?: \(deff\))?(?: of| =|:)?\s*(\d+(?:[.,]\d+)?)|\bdeff\s*(?:of|=|:)?\s*(\d+(?:[.,]\d+)?)/i;

const toNumber = (s: string) => Number(s.replace(/[ , ]/g, ""));
const toDecimal = (s: string) => Number(s.replace(",", "."));

/** Sentences (or lines) of the document, with surrounding whitespace collapsed. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])|\n+/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

/**
 * Every sentence that states a margin of error, checked against the sample size it names. A margin
 * stated with no sample size in the same sentence, or with several, is listed as not checked, with
 * the reason, so a reader sees what was found and why no figure is given for it.
 */
export function findPrecisionChecks(text: string): PrecisionCheck[] {
  const out: PrecisionCheck[] = [];
  for (const sentence of sentences(text)) {
    MARGIN_RE.lastIndex = 0;
    const margins = [...sentence.matchAll(MARGIN_RE)].map((m) => toDecimal(m[1] ?? m[2]));
    if (margins.length === 0) continue;
    const quote = sentence.length > 400 ? `${sentence.slice(0, 397)}...` : sentence;
    if (margins.length > 1) {
      out.push({ kind: "not_checked", quote, reason: "More than one margin of error in the sentence." });
      continue;
    }
    SIZE_RE.lastIndex = 0;
    const sizes = [...new Set([...sentence.matchAll(SIZE_RE)].map((m) => toNumber(m[1] ?? m[2] ?? m[3])))].filter((n) => n >= 10);
    if (sizes.length === 0) {
      out.push({ kind: "not_checked", quote, reason: "No sample size stated in the same sentence." });
      continue;
    }
    if (sizes.length > 1) {
      out.push({ kind: "not_checked", quote, reason: "More than one sample size in the sentence (a total and subgroups, for example)." });
      continue;
    }
    const conf = CONFIDENCE_RE.exec(sentence);
    const confidence = conf ? Number(conf[1] ?? conf[2]) : 95;
    const deffMatch = DEFF_RE.exec(sentence);
    const designEffect = deffMatch ? toDecimal(deffMatch[1] ?? deffMatch[2]) : 1;
    if (!(designEffect > 0)) {
      out.push({ kind: "not_checked", quote, reason: "The design effect stated could not be read as a number above zero." });
      continue;
    }
    const n = sizes[0];
    const statedMargin = margins[0];
    const expectedMargin = expectedMarginOfError(n, confidence, designEffect);
    // Within rounding: a margin quoted to whole points or one decimal is consistent within 0.3
    // points or 8% of the expected value, whichever is larger.
    const tolerance = Math.max(0.3, expectedMargin * 0.08);
    const verdict = Math.abs(statedMargin - expectedMargin) <= tolerance ? "consistent" : statedMargin < expectedMargin ? "understated" : "conservative";
    out.push({
      kind: "checked",
      quote,
      n,
      statedMargin,
      confidence,
      confidenceStated: Boolean(conf),
      designEffect,
      designEffectStated: Boolean(deffMatch),
      expectedMargin: Math.round(expectedMargin * 10) / 10,
      verdict,
      neededN: sampleSizeFor(statedMargin, confidence, designEffect),
    });
  }
  return out;
}

/** One line for the screen and the export. */
export function precisionCheckText(c: PrecisionCheck): string {
  if (c.kind === "not_checked") return `Not checked: ${c.reason}`;
  const assumed = [!c.confidenceStated ? "95% confidence" : null, !c.designEffectStated ? "a simple random sample, design effect 1" : null].filter(Boolean).join(" and ");
  const basis = `n=${c.n.toLocaleString("en-GB")} at ${c.confidence}%${c.designEffectStated ? `, design effect ${c.designEffect}` : ""}`;
  const head =
    c.verdict === "consistent"
      ? `Consistent: ${basis} supports about ±${c.expectedMargin} points, as stated (±${c.statedMargin}).`
      : c.verdict === "understated"
        ? `Claims more precision than the sample supports: ${basis} gives about ±${c.expectedMargin} points, not ±${c.statedMargin}. ±${c.statedMargin} would need about n=${c.neededN.toLocaleString("en-GB")}.`
        : `Wider than needed: ${basis} supports about ±${c.expectedMargin} points; ±${c.statedMargin} is stated (a design effect or finite-population allowance may explain it).`;
  return assumed ? `${head} Assumed, as none is stated: ${assumed}.` : head;
}
