// The same statistical checks used throughout the pipeline, implemented
// once here so every agent step calls real arithmetic rather than asking
// the model to compute it inside a prompt.

const Z_SCORES = { 90: 1.645, 95: 1.96, 99: 2.576 } as const;

export function marginOfError(n: number, p: number, confidence: 90 | 95 | 99 = 95) {
  if (n <= 0) throw new Error("sample_size must be positive");
  const z = Z_SCORES[confidence];
  const moe = z * Math.sqrt((p * (1 - p)) / n);
  return { marginOfErrorPercent: Math.round(moe * 1000) / 10, z, confidence };
}

export function designEffect(weights: number[]) {
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  const variance = weights.reduce((a, w) => a + (w - mean) ** 2, 0) / weights.length;
  const cv = Math.sqrt(variance) / mean;
  return { designEffect: Math.round((1 + cv ** 2) * 100) / 100 };
}

export function checkBaseSize(n: number, segmentName: string) {
  // No formal ESOMAR/MRS/Insights Association numeric floor exists; n=30 and
  // n=100 are informal conventions only. Never surface this as a standards
  // violation, only as a caution.
  if (n < 30) return { flag: `${segmentName} has a base size of ${n}, below the informal n=30 caution threshold.` };
  if (n < 100) return { flag: `${segmentName} has a base size of ${n}, below the informal n=100 convention for sub-group reporting.` };
  return { flag: null as string | null };
}

export function twoProportionGap(n1: number, p1: number, n2: number, p2: number, confidence: 90 | 95 | 99 = 95) {
  const z = Z_SCORES[confidence];
  const pPool = (p1 * n1 + p2 * n2) / (n1 + n2);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
  if (se === 0) return { gapPercent: Math.round((p1 - p2) * 1000) / 10, zScore: null as number | null, significant: false };
  const zObs = (p1 - p2) / se;
  return {
    gapPercent: Math.round((p1 - p2) * 1000) / 10,
    zScore: Math.round(zObs * 100) / 100,
    significant: Math.abs(zObs) >= z,
  };
}

export function flagOutlier(value: number, comparisonValues: number[]) {
  if (comparisonValues.length < 3) return { flag: null as string | null };
  const mean = comparisonValues.reduce((a, b) => a + b, 0) / comparisonValues.length;
  const variance = comparisonValues.reduce((a, v) => a + (v - mean) ** 2, 0) / comparisonValues.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return { flag: null as string | null };
  const z = (value - mean) / sd;
  return Math.abs(z) >= 2
    ? { flag: `Value ${value} is ${Math.round(z * 10) / 10} SD from the comparison mean of ${Math.round(mean * 10) / 10}. Descriptive heuristic, not a formal outlier test.` }
    : { flag: null as string | null };
}

export function pearsonCorrelation(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n !== ys.length || n < 3) throw new Error("need matched lists of at least 3 pairs");
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const cov = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const sdX = Math.sqrt(xs.reduce((a, x) => a + (x - meanX) ** 2, 0));
  const sdY = Math.sqrt(ys.reduce((a, y) => a + (y - meanY) ** 2, 0));
  if (sdX === 0 || sdY === 0) return { r: null as number | null };
  return { r: Math.round((cov / (sdX * sdY)) * 100) / 100, note: "descriptive association only; not evidence of causation" };
}
