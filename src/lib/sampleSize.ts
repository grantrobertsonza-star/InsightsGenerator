/**
 * Sample size and margin of error for a proportion (Grant, 2026-10-22: the Research assistant should
 * answer "what sample do I need for a 5% margin of error?" with a calculation, not a remembered
 * figure). Pure arithmetic, so the assistant quotes numbers the code worked out.
 *
 * Method (Cochran, 1977, ch. 4; the standard survey textbook formula):
 *   n0 = z^2 * p * (1 - p) / e^2, the simple random sample for margin e at confidence z, worst case
 *     p = 0.5 unless an expected share is given;
 *   with a known population N, the finite population correction n = n0 / (1 + (n0 - 1) / N);
 *   times the design effect (1 for a simple random sample; clustering or unequal weights raise it);
 *   rounded up; divided by the expected response rate for the number to approach.
 * And the reverse, the margin for a given n: e = z * sqrt(deff * p * (1 - p) / n), times
 *   sqrt((N - n) / (N - 1)) when N is known.
 * Limits: a proportion from a probability sample. A quota or opt-in panel has no sampling margin in
 * the strict sense; the figure then describes the precision a random sample of that size would have.
 */

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
  if (!(e > 0 && e < 0.5)) throw new Error("The margin of error must be above 0 and below 50 percentage points.");
  const n0 = (z * z * p * (1 - p)) / (e * e);
  const steps = [`Simple random sample: ${z.toFixed(3)}² × ${p} × ${(1 - p).toFixed(2)} ÷ ${e}² = ${n0.toFixed(1)}`];
  let n = n0;
  if (N !== null) {
    n = n0 / (1 + (n0 - 1) / N);
    steps.push(`Population of ${N.toLocaleString("en-US")}: ${n0.toFixed(1)} ÷ (1 + (${n0.toFixed(1)} − 1) ÷ ${N}) = ${n.toFixed(1)}`);
  }
  if (deff !== 1) {
    steps.push(`Design effect ${deff}: ${n.toFixed(1)} × ${deff} = ${(n * deff).toFixed(1)}`);
    n *= deff;
  }
  const completes = Math.ceil(n - 1e-9);
  steps.push(`Rounded up: ${completes} completed interviews`);
  const approach = rr !== null ? Math.ceil(completes / (rr / 100) - 1e-9) : null;
  if (approach !== null && rr !== null) steps.push(`At a ${rr}% response rate: ${completes} ÷ ${rr / 100} = ${approach} people to approach`);
  return {
    completes,
    approach,
    simpleRandom: Math.ceil(n0 - 1e-9),
    steps,
    assumptions: [
      `${confidence}% confidence, a proportion with an expected share of ${(p * 100).toFixed(0)}%${input.expectedSharePct === undefined ? " (the most conservative choice)" : ""}`,
      deff === 1 ? "a simple random sample (design effect 1)" : `a design effect of ${deff}`,
      N === null ? "a large population (no finite population correction)" : `a population of ${N.toLocaleString("en-US")}`,
      "the margin applies to the whole sample; each subgroup reported separately needs its own size",
    ],
  };
}

export type MarginInput = Omit<SampleSizeInput, "marginPct" | "responseRatePct"> & { sampleSize: number };

/** The margin of error, in percentage points, of a share from a sample of the given size. */
export function marginForSample(input: MarginInput): { marginPct: number; steps: string[]; assumptions: string[] } {
  const { confidence, z, p, deff, N } = check(input);
  const n = input.sampleSize;
  if (!(Number.isInteger(n) && n >= 2)) throw new Error("The sample size must be a whole number of at least 2.");
  if (N !== null && n > N) throw new Error("The sample cannot be larger than the population.");
  let e = z * Math.sqrt((deff * p * (1 - p)) / n);
  const steps = [`${z.toFixed(3)} × √(${deff} × ${p} × ${(1 - p).toFixed(2)} ÷ ${n}) = ${(e * 100).toFixed(2)} points`];
  if (N !== null) {
    const fpc = Math.sqrt((N - n) / (N - 1));
    steps.push(`Population of ${N.toLocaleString("en-US")}: × √((${N} − ${n}) ÷ (${N} − 1)) = ${(e * fpc * 100).toFixed(2)} points`);
    e *= fpc;
  }
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
