// Driver analysis: which predictors explain an outcome, with the importance split fairly when the
// predictors overlap. Pure functions, no database. Two outcome types:
//   continuous  multiple linear regression, importance as each predictor's share of R-squared
//   binary      logistic regression (for example a top-two box), importance as each predictor's share of
//               McFadden's R-squared
// Raw coefficients are shown but are not the headline, because correlated predictors make them unstable.
// The headline is a Shapley (dominance) share, or Johnson's relative weights when there are too many
// predictors to enumerate every subset. Intervals come from a seeded bootstrap, so a rerun repeats.

import { studentTTwoSidedP } from "./stats";

export type DriverInput = {
  /** Outcome per case. For a binary outcome use 0 and 1. */
  y: number[];
  /** One row per case, one column per predictor. */
  x: number[][];
  names: string[];
  outcome: "continuous" | "binary";
  /** Survey weights, one per case. Omit for equal weights. */
  weights?: number[];
  bootstrap?: number;
  seed?: number;
};

export type DriverRow = {
  name: string;
  /** Share of explained variance, 0 to 1. Shares add to 1. */
  share: number;
  /** Bootstrap 95% interval for the share. */
  shareLow: number | null;
  shareHigh: number | null;
  rank: number;
  rankLow: number | null;
  rankHigh: number | null;
  /** Standardised coefficient (linear) or odds ratio per standard deviation (logistic). */
  effect: number;
  /** Plain correlation with the outcome. */
  correlation: number;
  coefficient: number;
  pValue: number | null;
  vif: number;
};

export type DriverResult = {
  outcome: "continuous" | "binary";
  n: number;
  predictors: number;
  fit: {
    rSquared: number;
    adjRSquared: number | null;
    /** Logistic only. */
    mcFadden: number | null;
    nagelkerke: number | null;
    classificationRate: number | null;
    baseRate: number | null;
  };
  method: "shapley" | "relative_weights" | "standardised_coefficients";
  rows: DriverRow[];
  warnings: string[];
  droppedPredictors: string[];
};

// --- Linear algebra on small matrices -------------------------------------------------------

type Matrix = number[][];

function solve(a: Matrix, b: number[]): number[] | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      if (f === 0) continue;
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

function invert(a: Matrix): Matrix | null {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    const d = m[c][c];
    for (let k = 0; k < 2 * n; k++) m[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = m[r][c];
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) m[r][k] -= f * m[c][k];
    }
  }
  return m.map((row) => row.slice(n));
}

/** Eigen decomposition of a symmetric matrix by Jacobi rotations. Returns values and column vectors. */
function jacobiEigen(sym: Matrix): { values: number[]; vectors: Matrix } {
  const n = sym.length;
  const a = sym.map((r) => [...r]);
  const v: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-22) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-30) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v };
}

// --- Weighted moments -----------------------------------------------------------------------

function weightedCorrelations(x: number[][], y: number[], w: number[]): { rxx: Matrix; rxy: number[]; sdX: number[]; sdY: number; meanX: number[]; meanY: number } {
  const n = y.length;
  const p = x[0]?.length ?? 0;
  const sw = w.reduce((a, b) => a + b, 0);
  const meanX = Array.from({ length: p }, (_, j) => x.reduce((a, row, i) => a + w[i] * row[j], 0) / sw);
  const meanY = y.reduce((a, v, i) => a + w[i] * v, 0) / sw;
  const cov = (aVals: (i: number) => number, bVals: (i: number) => number, ma: number, mb: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += w[i] * (aVals(i) - ma) * (bVals(i) - mb);
    return s / sw;
  };
  const sdX = Array.from({ length: p }, (_, j) => Math.sqrt(cov((i) => x[i][j], (i) => x[i][j], meanX[j], meanX[j])));
  const sdY = Math.sqrt(cov((i) => y[i], (i) => y[i], meanY, meanY));
  const rxx: Matrix = Array.from({ length: p }, () => Array(p).fill(0));
  for (let a = 0; a < p; a++) {
    for (let b = a; b < p; b++) {
      const r = a === b ? 1 : cov((i) => x[i][a], (i) => x[i][b], meanX[a], meanX[b]) / (sdX[a] * sdX[b] || 1);
      rxx[a][b] = r;
      rxx[b][a] = r;
    }
  }
  const rxy = Array.from({ length: p }, (_, j) => cov((i) => x[i][j], (i) => y[i], meanX[j], meanY) / (sdX[j] * sdY || 1));
  return { rxx, rxy, sdX, sdY, meanX, meanY };
}

function subsetR2(rxx: Matrix, rxy: number[], idx: number[]): number {
  if (idx.length === 0) return 0;
  const a = idx.map((i) => idx.map((j) => rxx[i][j]));
  const b = idx.map((i) => rxy[i]);
  const beta = solve(a, b);
  if (!beta) return 0;
  return Math.max(0, Math.min(1, beta.reduce((s, v, k) => s + v * b[k], 0)));
}

// --- Importance shares ----------------------------------------------------------------------

/** Johnson's relative weights: R-squared split over predictors via orthogonal approximations. */
export function relativeWeights(rxx: Matrix, rxy: number[]): number[] {
  const p = rxx.length;
  const { values, vectors } = jacobiEigen(rxx);
  const sqrt = values.map((v) => Math.sqrt(Math.max(v, 1e-12)));
  // Lambda = V D^(1/2) V'
  const lambda: Matrix = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => vectors[i].reduce((s, vik, k) => s + vik * sqrt[k] * vectors[j][k], 0)),
  );
  const betaStar = solve(lambda, rxy);
  if (!betaStar) return Array(p).fill(0);
  return Array.from({ length: p }, (_, j) => lambda[j].reduce((s, l, k) => s + l * l * betaStar[k] * betaStar[k], 0));
}

/** Shapley split of R-squared: each predictor's average gain over every order in which predictors can enter. */
export function shapleyR2(rxx: Matrix, rxy: number[]): number[] {
  const p = rxx.length;
  const full = 1 << p;
  const r2 = new Float64Array(full);
  for (let mask = 1; mask < full; mask++) {
    const idx: number[] = [];
    for (let j = 0; j < p; j++) if (mask & (1 << j)) idx.push(j);
    r2[mask] = subsetR2(rxx, rxy, idx);
  }
  return shapleyFromValues(r2, p);
}

function shapleyFromValues(value: Float64Array, p: number): number[] {
  const fact: number[] = [1];
  for (let i = 1; i <= p; i++) fact.push(fact[i - 1] * i);
  const out = Array(p).fill(0);
  const full = 1 << p;
  for (let j = 0; j < p; j++) {
    for (let mask = 0; mask < full; mask++) {
      if (mask & (1 << j)) continue;
      let size = 0;
      for (let k = 0; k < p; k++) if (mask & (1 << k)) size++;
      const w = (fact[size] * fact[p - size - 1]) / fact[p];
      out[j] += w * (value[mask | (1 << j)] - value[mask]);
    }
  }
  return out;
}

// --- Linear regression ----------------------------------------------------------------------

export type LinearFit = { coef: number[]; intercept: number; se: number[]; p: number[]; rSquared: number; adjRSquared: number; stdBeta: number[]; n: number };

export function linearFit(x: number[][], y: number[], w: number[]): LinearFit | null {
  const n = y.length;
  const p = x[0]?.length ?? 0;
  if (n <= p + 1) return null;
  const k = p + 1;
  const xtx: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
  const xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...x[i]];
    for (let a = 0; a < k; a++) {
      xty[a] += w[i] * row[a] * y[i];
      for (let b = 0; b < k; b++) xtx[a][b] += w[i] * row[a] * row[b];
    }
  }
  const inv = invert(xtx);
  if (!inv) return null;
  const beta = inv.map((r) => r.reduce((s, v, j) => s + v * xty[j], 0));
  const sw = w.reduce((a, b) => a + b, 0);
  const meanY = y.reduce((a, v, i) => a + w[i] * v, 0) / sw;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const pred = beta[0] + x[i].reduce((s, v, j) => s + v * beta[j + 1], 0);
    sse += w[i] * (y[i] - pred) ** 2;
    sst += w[i] * (y[i] - meanY) ** 2;
  }
  const rSquared = sst > 0 ? 1 - sse / sst : 0;
  const df = n - k;
  // With weights, treat them as frequency-like for the error variance but scale to n so the interval is not inflated.
  const scale = n / sw;
  const sigma2 = (sse * scale) / df;
  const se = inv.map((r, i) => Math.sqrt(Math.max(0, r[i] * sigma2 * (sw / n))));
  const t = beta.map((b, i) => (se[i] > 0 ? b / se[i] : 0));
  const pv = t.map((tv) => studentTTwoSidedP(tv, df));
  const sdX = Array.from({ length: p }, (_, j) => {
    const m = x.reduce((a, row, i) => a + w[i] * row[j], 0) / sw;
    return Math.sqrt(x.reduce((a, row, i) => a + w[i] * (row[j] - m) ** 2, 0) / sw);
  });
  const sdY = Math.sqrt(sst / sw);
  return {
    coef: beta.slice(1),
    intercept: beta[0],
    se: se.slice(1),
    p: pv.slice(1),
    rSquared,
    adjRSquared: 1 - ((1 - rSquared) * (n - 1)) / df,
    stdBeta: beta.slice(1).map((b, j) => (sdY > 0 ? (b * sdX[j]) / sdY : 0)),
    n,
  };
}

// --- Logistic regression --------------------------------------------------------------------

export type LogisticFit = {
  coef: number[];
  intercept: number;
  se: number[];
  p: number[];
  logLik: number;
  nullLogLik: number;
  mcFadden: number;
  nagelkerke: number;
  classificationRate: number;
  baseRate: number;
  converged: boolean;
  separated: boolean;
};

function normalTwoSidedP(z: number): number {
  const a = Math.abs(z);
  // Abramowitz and Stegun 7.1.26 for erfc.
  const t = 1 / (1 + 0.3275911 * (a / Math.SQRT2));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.min(1, poly * Math.exp(-(a * a) / 2));
}

export function logisticFit(x: number[][], y: number[], w: number[]): LogisticFit | null {
  const n = y.length;
  const p = x[0]?.length ?? 0;
  const k = p + 1;
  const sw = w.reduce((a, b) => a + b, 0);
  const wy = y.reduce((a, v, i) => a + w[i] * v, 0);
  const base = wy / sw;
  if (base <= 0 || base >= 1 || n <= k) return null;
  let beta = Array(k).fill(0);
  beta[0] = Math.log(base / (1 - base));
  let converged = false;
  let separated = false;
  const ridge = 1e-8;
  let ll = -Infinity;
  for (let iter = 0; iter < 60; iter++) {
    const h: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
    const g = Array(k).fill(0);
    let newLl = 0;
    for (let i = 0; i < n; i++) {
      const row = [1, ...x[i]];
      const eta = row.reduce((s, v, j) => s + v * beta[j], 0);
      const mu = 1 / (1 + Math.exp(-eta));
      const clipped = Math.min(Math.max(mu, 1e-12), 1 - 1e-12);
      newLl += w[i] * (y[i] * Math.log(clipped) + (1 - y[i]) * Math.log(1 - clipped));
      const v = Math.max(mu * (1 - mu), 1e-10);
      if (mu < 1e-6 || mu > 1 - 1e-6) separated = true;
      for (let a = 0; a < k; a++) {
        g[a] += w[i] * row[a] * (y[i] - mu);
        for (let b = 0; b < k; b++) h[a][b] += w[i] * v * row[a] * row[b];
      }
    }
    for (let a = 0; a < k; a++) h[a][a] += ridge;
    const step = solve(h, g);
    if (!step) return null;
    beta = beta.map((b, j) => b + step[j]);
    if (Math.abs(newLl - ll) < 1e-9 && Math.max(...step.map(Math.abs)) < 1e-7) {
      converged = true;
      ll = newLl;
      break;
    }
    ll = newLl;
  }
  // Final information matrix for standard errors.
  const h: Matrix = Array.from({ length: k }, () => Array(k).fill(0));
  let correct = 0;
  let finalLl = 0;
  for (let i = 0; i < n; i++) {
    const row = [1, ...x[i]];
    const eta = row.reduce((s, v, j) => s + v * beta[j], 0);
    const mu = 1 / (1 + Math.exp(-eta));
    const clipped = Math.min(Math.max(mu, 1e-12), 1 - 1e-12);
    finalLl += w[i] * (y[i] * Math.log(clipped) + (1 - y[i]) * Math.log(1 - clipped));
    const v = Math.max(mu * (1 - mu), 1e-10);
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) h[a][b] += w[i] * v * row[a] * row[b];
    if ((mu >= 0.5 ? 1 : 0) === y[i]) correct += w[i];
  }
  // ANA-DRV-001: h above is the observed Fisher information computed directly from the given
  // weights - correct when those weights are FREQUENCY weights (replication counts), where more
  // total weight really is more independent information. A survey weight is not that: it
  // corrects for differential sampling probability, and multiplying every respondent's weight by
  // the same constant must not manufacture extra apparent precision out of the same n
  // respondents (the actual fixture: scaling every weight by 10 left the coefficients unchanged,
  // as it should, but dropped the standard error from 0.283588 to 0.089678 and the p-value from
  // 0.02374 to about 8.7e-13 - false confidence from nothing but a weighting convention). Scaling
  // the information matrix back to the actual case count n, rather than leaving it in terms of
  // the weighted total sw, is the same correction the OLS fit just above already applies via its
  // own `scale = n / sw`; it removes the spurious sensitivity to the overall weight scale. This
  // is not a full design-based sandwich or cluster covariance (see the caveat the exported report
  // carries on this), but it is the minimum needed so uniformly rescaling the weights cannot
  // change what the model calls significant, which the raw frequency-weighted information matrix
  // could not promise.
  const hScaled = h.map((row) => row.map((v) => v * (n / sw)));
  const inv = invert(hScaled);
  const se = inv ? inv.map((r, i) => Math.sqrt(Math.max(0, r[i]))) : Array(k).fill(NaN);
  const nullLogLik = wy * Math.log(base) + (sw - wy) * Math.log(1 - base);
  const mcFadden = nullLogLik !== 0 ? 1 - finalLl / nullLogLik : 0;
  const coxSnell = 1 - Math.exp((2 * (nullLogLik - finalLl)) / sw);
  const maxCs = 1 - Math.exp((2 * nullLogLik) / sw);
  return {
    coef: beta.slice(1),
    intercept: beta[0],
    se: se.slice(1),
    p: beta.slice(1).map((b, j) => (Number.isFinite(se[j + 1]) && se[j + 1] > 0 ? normalTwoSidedP(b / se[j + 1]) : 1)),
    logLik: finalLl,
    nullLogLik,
    mcFadden: Math.max(0, mcFadden),
    nagelkerke: maxCs > 0 ? Math.max(0, coxSnell / maxCs) : 0,
    classificationRate: correct / sw,
    baseRate: Math.max(base, 1 - base),
    converged,
    separated,
  };
}

function shapleyMcFadden(x: number[][], y: number[], w: number[]): number[] | null {
  const p = x[0].length;
  const full = 1 << p;
  const value = new Float64Array(full);
  for (let mask = 1; mask < full; mask++) {
    const cols: number[] = [];
    for (let j = 0; j < p; j++) if (mask & (1 << j)) cols.push(j);
    const sub = x.map((row) => cols.map((c) => row[c]));
    const fit = logisticFit(sub, y, w);
    value[mask] = fit ? fit.mcFadden : 0;
  }
  return shapleyFromValues(value, p);
}

// --- Orchestration --------------------------------------------------------------------------

const MAX_SHAPLEY_LINEAR = 12;
const MAX_SHAPLEY_LOGISTIC = 8;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalise(raw: number[]): number[] {
  const clipped = raw.map((v) => Math.max(0, v));
  const total = clipped.reduce((a, b) => a + b, 0);
  return total > 0 ? clipped.map((v) => v / total) : clipped.map(() => 1 / clipped.length);
}

function sharesFor(
  x: number[][],
  y: number[],
  w: number[],
  outcome: "continuous" | "binary",
): { shares: number[]; method: DriverResult["method"] } | null {
  const p = x[0].length;
  if (outcome === "continuous") {
    const { rxx, rxy } = weightedCorrelations(x, y, w);
    if (p <= MAX_SHAPLEY_LINEAR) return { shares: normalise(shapleyR2(rxx, rxy)), method: "shapley" };
    return { shares: normalise(relativeWeights(rxx, rxy)), method: "relative_weights" };
  }
  if (p <= MAX_SHAPLEY_LOGISTIC) {
    const s = shapleyMcFadden(x, y, w);
    if (s) return { shares: normalise(s), method: "shapley" };
  }
  const fit = logisticFit(x, y, w);
  if (!fit) return null;
  const { sdX } = weightedCorrelations(x, y, w);
  return { shares: normalise(fit.coef.map((b, j) => Math.abs(b * sdX[j]))), method: "standardised_coefficients" };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function driverAnalysis(input: DriverInput): DriverResult | { error: string } {
  const warnings: string[] = [];
  const { outcome } = input;
  // Complete cases only. The caller reports how many were lost; here the count is kept in the result.
  const keep: number[] = [];
  for (let i = 0; i < input.y.length; i++) {
    const row = input.x[i];
    if (Number.isFinite(input.y[i]) && row.every((v) => Number.isFinite(v))) keep.push(i);
  }
  let y = keep.map((i) => input.y[i]);
  let x = keep.map((i) => input.x[i]);
  const w = keep.map((i) => (input.weights ? Math.max(0, input.weights[i] ?? 1) : 1));
  const lost = input.y.length - keep.length;
  if (lost > 0) warnings.push(`${lost} of ${input.y.length} cases had a missing value and were left out (complete cases only).`);

  // Drop predictors with no variation.
  const dropped: string[] = [];
  const live: number[] = [];
  for (let j = 0; j < input.names.length; j++) {
    const col = x.map((r) => r[j]);
    if (new Set(col).size > 1) live.push(j);
    else dropped.push(input.names[j]);
  }
  if (dropped.length > 0) warnings.push(`Left out because every case gave the same answer: ${dropped.join(", ")}.`);
  const names = live.map((j) => input.names[j]);
  x = x.map((r) => live.map((j) => r[j]));
  const n = y.length;
  const p = names.length;
  if (p < 2) return { error: "At least two predictors with some variation are needed." };
  if (n < p + 10) return { error: `Too few complete cases (${n}) for ${p} predictors.` };
  if (outcome === "binary") {
    const ones = y.filter((v) => v === 1).length;
    if (ones === 0 || ones === n) return { error: "The outcome is the same for every case, so there is nothing to explain." };
    const events = Math.min(ones, n - ones);
    if (events < 10 * p) warnings.push(`Only ${events} cases in the smaller outcome group for ${p} predictors. About 10 per predictor is the usual minimum, so treat the weights as rough.`);
  } else {
    // ANA-DRV-002: a constant (or near-constant) continuous outcome has no variance for any
    // predictor to explain, but without this check it still reached linearFit/sharesFor, which
    // returned a "successful" fit - R-squared of 0, a numerical-noise residual coefficient with
    // its own (spurious) significance, and a driver ranking split by that noise rather than
    // flagged as not estimable. Checked on the actual fitting weights, not a plain unweighted
    // variance, since a weighted mean/variance is what the regression itself uses; zero weighted
    // variance (every case answered literally the same, or only the zero-weighted cases differ)
    // is rejected the same way a constant binary outcome already is above.
    const sw = w.reduce((a, b) => a + b, 0);
    const wMean = sw > 0 ? y.reduce((a, v, i) => a + w[i] * v, 0) / sw : 0;
    const wVar = sw > 0 ? y.reduce((a, v, i) => a + w[i] * (v - wMean) ** 2, 0) / sw : 0;
    const scale = 1 + Math.abs(wMean);
    if (!(wVar > 1e-12 * scale * scale)) {
      return { error: "The outcome is the same (or effectively the same) for every case, so there is nothing to explain." };
    }
    if (n < 10 * p) warnings.push(`${n} cases for ${p} predictors is under 10 per predictor, so the weights may be unstable.`);
  }

  const cor = weightedCorrelations(x, y, w);
  const inv = invert(cor.rxx);
  const vif = inv ? inv.map((r, i) => r[i]) : Array(p).fill(Infinity);
  for (let a = 0; a < p; a++) {
    for (let b = a + 1; b < p; b++) {
      if (Math.abs(cor.rxx[a][b]) >= 0.85) warnings.push(`${names[a]} and ${names[b]} correlate at ${cor.rxx[a][b].toFixed(2)}, so they largely measure the same thing. Their separate weights are hard to tell apart.`);
    }
  }
  const highVif = names.filter((_, j) => vif[j] > 5);
  if (highVif.length > 0) warnings.push(`High overlap with the other predictors (VIF above 5): ${highVif.join(", ")}. Read their weights together rather than one by one.`);
  if (!inv) warnings.push("Some predictors are exact combinations of others, so the fit is unreliable.");

  const base = sharesFor(x, y, w, outcome);
  if (!base) return { error: "The model could not be fitted. A predictor may perfectly separate the outcome." };

  let rSquared = 0;
  let adj: number | null = null;
  let mc: number | null = null;
  let nag: number | null = null;
  let classification: number | null = null;
  let baseRate: number | null = null;
  let coefficient: number[];
  let pValue: number[];
  let effect: number[];
  if (outcome === "continuous") {
    const fit = linearFit(x, y, w);
    if (!fit) return { error: "The regression could not be fitted." };
    rSquared = fit.rSquared;
    adj = fit.adjRSquared;
    coefficient = fit.coef;
    pValue = fit.p;
    effect = fit.stdBeta;
  } else {
    const fit = logisticFit(x, y, w);
    if (!fit) return { error: "The logistic model could not be fitted." };
    if (!fit.converged) warnings.push("The logistic model did not fully converge. Treat the weights as approximate.");
    if (fit.separated) warnings.push("Some cases are predicted almost perfectly, which can inflate coefficients. Check for a predictor that nearly decides the outcome.");
    rSquared = fit.mcFadden;
    mc = fit.mcFadden;
    nag = fit.nagelkerke;
    classification = fit.classificationRate;
    baseRate = fit.baseRate;
    coefficient = fit.coef;
    pValue = fit.p;
    effect = fit.coef.map((b, j) => Math.exp(b * cor.sdX[j]));
    if (fit.classificationRate - fit.baseRate < 0.02) warnings.push("The model classifies barely better than always guessing the larger group, so these drivers explain little of the outcome.");
  }
  if (base.method === "standardised_coefficients") warnings.push(`With ${p} predictors a full split of the fit is too slow, so the weights are the size of each standardised coefficient. They are less reliable when predictors overlap.`);
  if (base.method === "relative_weights") warnings.push(`With ${p} predictors the weights use Johnson's relative-weights method instead of enumerating every subset.`);

  // Bootstrap.
  const B = Math.max(0, Math.min(input.bootstrap ?? 200, outcome === "binary" && base.method === "shapley" ? 60 : 300));
  let lows: (number | null)[] = Array(p).fill(null);
  let highs: (number | null)[] = Array(p).fill(null);
  let rankLows: (number | null)[] = Array(p).fill(null);
  let rankHighs: (number | null)[] = Array(p).fill(null);
  if (B >= 20) {
    const rng = mulberry32(input.seed ?? 20261010);
    const draws: number[][] = Array.from({ length: p }, () => []);
    const rankDraws: number[][] = Array.from({ length: p }, () => []);
    for (let b = 0; b < B; b++) {
      const yb: number[] = [];
      const xb: number[][] = [];
      const wb: number[] = [];
      for (let i = 0; i < n; i++) {
        const k = Math.floor(rng() * n);
        yb.push(y[k]);
        xb.push(x[k]);
        wb.push(w[k]);
      }
      const s = sharesFor(xb, yb, wb, outcome);
      if (!s) continue;
      const order = s.shares.map((v, j) => ({ v, j })).sort((a, c) => c.v - a.v);
      order.forEach((o, r) => rankDraws[o.j].push(r + 1));
      s.shares.forEach((v, j) => draws[j].push(v));
    }
    lows = draws.map((d) => (d.length >= 20 ? percentile([...d].sort((a, b) => a - b), 0.025) : null));
    highs = draws.map((d) => (d.length >= 20 ? percentile([...d].sort((a, b) => a - b), 0.975) : null));
    rankLows = rankDraws.map((d) => (d.length >= 20 ? percentile([...d].sort((a, b) => a - b), 0.025) : null));
    rankHighs = rankDraws.map((d) => (d.length >= 20 ? percentile([...d].sort((a, b) => a - b), 0.975) : null));
  }

  const order = base.shares.map((v, j) => ({ v, j })).sort((a, b) => b.v - a.v);
  const rankOf = new Map(order.map((o, r) => [o.j, r + 1]));
  const rows: DriverRow[] = names
    .map((name, j) => ({
      name,
      share: base.shares[j],
      shareLow: lows[j],
      shareHigh: highs[j],
      rank: rankOf.get(j) as number,
      rankLow: rankLows[j] === null ? null : Math.round(rankLows[j] as number),
      rankHigh: rankHighs[j] === null ? null : Math.round(rankHighs[j] as number),
      effect: effect[j],
      correlation: cor.rxy[j],
      coefficient: coefficient[j],
      pValue: Number.isFinite(pValue[j]) ? pValue[j] : null,
      vif: vif[j],
    }))
    .sort((a, b) => a.rank - b.rank);

  if (outcome === "continuous" && rSquared < 0.1) warnings.push("These predictors explain under 10% of the variation in the outcome. The ranking says little about what drives it.");

  return {
    outcome,
    n,
    predictors: p,
    fit: { rSquared, adjRSquared: adj, mcFadden: mc, nagelkerke: nag, classificationRate: classification, baseRate },
    method: base.method,
    rows,
    warnings,
    droppedPredictors: dropped,
  };
}

/** Turns a rating into a 0/1 top-box outcome: 1 when the value is at or above `min`. Missing stays missing. */
export function topBox(values: (number | null)[], min: number): number[] {
  return values.map((v) => (v === null || !Number.isFinite(v) ? NaN : v >= min ? 1 : 0));
}
