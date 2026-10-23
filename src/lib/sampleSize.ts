/**
 * Sample size and margin of error for a proportion (Grant, 2026-10-22: the Research assistant should
 * answer "what sample do I need for a 5% margin of error?" with a calculation, not a remembered
 * figure). Pure arithmetic, so the assistant quotes numbers the code worked out.
 *
 * Method (Cochran, 1977, ch. 4; Kish, 1965, for the design effect). One model for both directions,
 * so the sample size for a margin gives that margin back (Codex B5-F01):
 *   the margin of a share from n interviews: e = z * sqrt(deff * p * (1 - p) / n), times the finite
 *     population factor sqrt((N - n) / (N - 1)) when the population N is known;
 *   the sample size is that formula solved for n: with n0 = z^2 * deff * p * (1 - p) / e^2 (the
 *     design effect inside the variance, p = 0.5 unless an expected share is given),
 *     n = n0 / (1 + (n0 - 1) / N), which is exactly n0 * N / (N + n0 - 1), and never more than N;
 *   rounded up, which is the smallest whole sample whose margin is at most e, and never below two
 *     (MIN_SAMPLE), the smallest sample the margin direction accepts (Codex RR-F04);
 *   divided by the expected response rate for the number to approach, refused when that is more
 *     people than the population holds.
 * Earlier the design effect was applied after the finite population correction, which overstated
 * the sample and could exceed the population.
 * Limits: a proportion from a probability sample. A quota or opt-in panel has no sampling margin in
 * the strict sense; the figure then describes the precision a random sample of that size would have.
 */

/** The smallest sample both directions accept (RR-F04). */
export const MIN_SAMPLE = 2;

/** Two-sided z values for the supported confidence levels. */
const Z: Record<number, number> = { 90: 1.6448536269514722, 95: 1.959963984540054, 99: 2.5758293035489004 };

export type SampleSizeInput = {
  /** Margin of error wanted, in percentage points (e.g. 5 for plus or minus 5%). */
  marginPct: number;
  /** Confidence level in percent: 90, 95 or 99. */
  confidencePct?: number;
  /** Expected share in percent; 50 (the default) gives the largest, safest sample. */
  expectedSharePct?: number;
  /** Size of the population sampled from, when known and not very large. */
  population?: number | null;
  /** Design effect: 1 for a simple random sample; e.g. 1.5 to 2 for clustered samples. */
  designEffect?: number;
  /** Expected response rate in percent, to give the number of people to approach. */
  responseRatePct?: number | null;
};

export type SampleSizeResult = {
  completes: number;
  approach: number | null;
  simpleRandom: number;
  steps: string[];
  assumptions: string[];
};

function check(input: { confidencePct?: number; expectedSharePct?: number; population?: number | null; designEffect?: number; responseRatePct?: number | null }) {
  const confidence = input.confidencePct ?? 95;
  const z = Z[confidence];
  if (!z) throw new Error("Confidence must be 90, 95 or 99 percent.");
  const p = (input.expectedSharePct ?? 50) / 100;
  if (!(p > 0 && p < 1)) throw new Error("The expected share must be between 0 and 100 percent, not including either.");
  const deff = input.designEffect ?? 1;
  if (!(Number.isFinite(deff) && deff >= 1 && deff <= 10)) throw new Error("The design effect must be between 1 and 10.");
  const N = input.population ?? null;
  if (N !== null && !(Number.isInteger(N) && N >= 2)) throw new Error("The population must be a whole number of at least 2.");
  const rr = input.responseRatePct ?? null;
  if (rr !== null && !(rr > 0 && rr <= 100)) throw new Error("The response rate must be above 0 and at most 100 percent.");
  return { confidence, z, p, deff, N, rr };
}

export function sampleSizeForMargin(input: SampleSizeInput): SampleSizeResult {
  const { confidence, z, p, deff, N, rr } = check(input);
  const e = input.marginPct / 100;
  if (!(Number.isFinite(e) && e > 0 && e < 0.5)) throw new Error("The margin of error must be above 0 and below 50 percentage points.");
  const srs = (z * z * p * (1 - p)) / (e * e);
  const n0 = srs * deff;
  const steps = [
    deff === 1
      ? `Simple random sample: ${z.toFixed(3)}² × ${p} × ${(1 - p).toFixed(2)} ÷ ${e}² = ${n0.toFixed(1)}`
      : `With design effect ${deff}: ${z.toFixed(3)}² × ${deff} × ${p} × ${(1 - p).toFixed(2)} ÷ ${e}² = ${n0.toFixed(1)}`,
  ];
  let n = n0;
  if (N !== null) {
    n = (n0 * N) / (N + n0 - 1);
    steps.push(`Population of ${N.toLocaleString("en-US")}: ${n0.toFixed(1)} ÷ (1 + (${n0.toFixed(1)} − 1) ÷ ${N}) = ${n.toFixed(1)}`);
  }
  const rounded = Math.min(Math.ceil(n - 1e-9), N ?? Infinity);
  // RR-F04: two interviews is the smallest sample either direction accepts (a margin needs a
  // variance, which one interview does not give), so a very wide margin or a very small expected
  // share that works out below two is raised to two. Two still meets the margin asked for, since a
  // larger sample only narrows it, and the reverse calculation accepts every result given here.
  const completes = Math.max(rounded, MIN_SAMPLE);
  steps.push(`Rounded up: ${rounded} completed ${rounded === 1 ? "interview" : "interviews"}`);
  if (completes > rounded) steps.push(`Raised to ${MIN_SAMPLE}, the smallest sample a margin of error can be worked out from`);
  let approach: number | null = null;
  if (rr !== null) {
    approach = Math.ceil(completes / (rr / 100) - 1e-9);
    if (N !== null && approach > N) {
      throw new Error(
        `At a ${rr}% response rate, ${completes} completed interviews would need ${approach} people approached, more than the population of ${N.toLocaleString("en-US")}. Even a census would not reach this margin at that response rate; accept a wider margin or plan for a higher response rate.`,
      );
    }
    steps.push(`At a ${rr}% response rate: ${completes} ÷ ${rr / 100} = ${approach} people to approach`);
  }
  return {
    completes,
    approach,
    simpleRandom: Math.ceil(srs - 1e-9),
    steps,
    assumptions: [
      `${confidence}% confidence, a proportion with an expected share of ${(p * 100).toFixed(0)}%${input.expectedSharePct === undefined ? " (the most conservative choice)" : ""}`,
      deff === 1 ? "a simple random sample (design effect 1)" : `a design effect of ${deff}, applied to the variance before the population correction`,
      N === null ? "a large population (no finite population correction)" : `a population of ${N.toLocaleString("en-US")}`,
      "the margin applies to the whole sample; each subgroup reported separately needs its own size",
    ],
  };
}

export type MarginInput = Omit<SampleSizeInput, "marginPct" | "responseRatePct"> & { sampleSize: number };

/** The margin of error as a fraction (unrounded): the model sampleSizeForMargin solves. */
export function marginFraction(input: MarginInput): number {
  const { z, p, deff, N } = check(input);
  const n = input.sampleSize;
  if (!(Number.isInteger(n) && n >= MIN_SAMPLE)) throw new Error(`The sample size must be a whole number of at least ${MIN_SAMPLE}.`);
  if (N !== null && n > N) throw new Error("The sample cannot be larger than the population.");
  const e = z * Math.sqrt((deff * p * (1 - p)) / n);
  return N !== null ? e * Math.sqrt((N - n) / (N - 1)) : e;
}

/** The margin of error, in percentage points, of a share from a sample of the given size. */
export function marginForSample(input: MarginInput): { marginPct: number; steps: string[]; assumptions: string[] } {
  const { confidence, z, p, deff, N } = check(input);
  const e = marginFraction(input);
  const n = input.sampleSize;
  const simple = z * Math.sqrt((deff * p * (1 - p)) / n);
  const steps = [`${z.toFixed(3)} × √(${deff} × ${p} × ${(1 - p).toFixed(2)} ÷ ${n}) = ${(simple * 100).toFixed(2)} points`];
  if (N !== null) steps.push(`Population of ${N.toLocaleString("en-US")}: × √((${N} − ${n}) ÷ (${N} − 1)) = ${(e * 100).toFixed(2)} points`);
  return {
    marginPct: Math.round(e * 10000) / 100,
    steps,
    assumptions: [
      `${confidence}% confidence, an expected share of ${(p * 100).toFixed(0)}%`,
      deff === 1 ? "a simple random sample (design effect 1)" : `a design effect of ${deff}`,
      N === null ? "a large population" : `a population of ${N.toLocaleString("en-US")}`,
    ],
  };
}
