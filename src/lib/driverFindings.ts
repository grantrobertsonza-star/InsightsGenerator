import type { DriverReport } from "./drivers";
import { driverRowsAmbiguous } from "./driverPresentation";

export type DriverFindingDraft = { text: string; theme: string; stats: Record<string, unknown> };

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`;

function ordinal(n: number): string {
  const words = ["", "strongest", "second strongest", "third strongest", "fourth strongest", "fifth strongest"];
  return words[n] ?? `number ${n}`;
}

/**
 * Findings from a driver analysis: one for the model as a whole and one for each leading driver, plus one
 * naming the questions that add little. Worded as association, never cause. Each carries cautions in
 * `stats.caveats` (weak fit, an unstable rank, heavy overlap, few cases) so the verdict step can read them.
 * Pure: the caller stores them.
 */
export function driverFindings(report: DriverReport, analysisId: string): DriverFindingDraft[] {
  const r = report.result;
  // Codex AN500-F01: a report saved before predictor codes were recorded can show two drivers under one
  // name. Which question each one is cannot be recovered from the name, so posting is refused rather than
  // guessed; running the analysis again records the codes.
  if (driverRowsAmbiguous(r.rows)) {
    throw new Error(
      "Two drivers in this saved analysis share a name, so the findings could not say which question each one is. Run the analysis again, then add its findings.",
    );
  }
  const binary = r.outcome === "binary";
  const outcome = binary ? `${report.outcomeLabel} (top box)` : report.outcomeLabel;
  const theme = `Drivers of ${report.outcomeLabel}`;
  const out: DriverFindingDraft[] = [];

  const weakFit = binary
    ? (r.fit.classificationRate ?? 0) - (r.fit.baseRate ?? 0) < 0.02 || (r.fit.mcFadden ?? 0) < 0.05
    : r.fit.rSquared < 0.1;
  const fewCases = r.warnings.some((w) => /per predictor/.test(w));
  const common = {
    analysisId,
    outcome: report.outcomeLabel,
    outcomeType: r.outcome,
    n: r.n,
    predictors: r.predictors,
    method: r.method,
  };
  const modelCaveats = [...(weakFit ? ["weak_fit"] : []), ...(fewCases ? ["few_cases_per_predictor"] : [])];

  const fitText = binary
    ? `The ${r.predictors} questions together classify ${pct(r.fit.classificationRate ?? 0)} of cases correctly as in or out of the top box on ${report.outcomeLabel}, against ${pct(r.fit.baseRate ?? 0)} from always guessing the larger group (McFadden pseudo R-squared ${(r.fit.mcFadden ?? 0).toFixed(2)}, n=${r.n}).`
    : `The ${r.predictors} questions together explain ${pct(r.fit.rSquared)} of the variation in ${report.outcomeLabel} (n=${r.n}).`;
  out.push({
    text: `${fitText} ${weakFit ? "That is a weak fit, so a ranking of its drivers should be read with great caution." : "This describes what goes with the outcome in this survey and does not show cause."}`,
    theme,
    stats: { ...common, kind: "driver_model", rSquared: r.fit.rSquared, mcFadden: r.fit.mcFadden, classificationRate: r.fit.classificationRate, baseRate: r.fit.baseRate, caveats: modelCaveats },
  });

  const lead = r.rows.filter((x) => x.rank <= 5 && x.share >= 0.05);
  for (const x of lead.length >= 3 ? lead : r.rows.slice(0, 3)) {
    const unstable = x.rankLow !== null && x.rankHigh !== null && x.rankHigh - x.rankLow >= 2;
    const overlap = x.vif > 5;
    const addsLittle = x.pValue !== null && x.pValue > 0.05;
    const caveats = [...modelCaveats, ...(unstable ? ["unstable_rank"] : []), ...(overlap ? ["high_overlap"] : []), ...(addsLittle ? ["adds_little_once_others_included"] : [])];
    const interval =
      x.shareLow !== null && x.shareHigh !== null
        ? ` (95% bootstrap range ${pct(x.shareLow)} to ${pct(x.shareHigh)}${x.rankLow !== null ? `, rank ${x.rankLow === x.rankHigh ? x.rankLow : `${x.rankLow} to ${x.rankHigh}`}` : ""})`
        : "";
    const direction = x.coefficient > 0 ? "Higher scores on it go with a higher outcome." : x.coefficient < 0 ? "Higher scores on it go with a lower outcome." : "";
    const notes = [
      overlap ? "It overlaps heavily with other questions, so its weight is shared with them." : "",
      unstable ? "Its rank is not stable across resamples." : "",
      addsLittle ? "It adds little once the other questions are included." : "",
    ].filter(Boolean);
    out.push({
      text:
        `${x.name} is the ${ordinal(x.rank)} of ${r.predictors} questions as a driver of ${outcome}, accounting for ${pct(x.share, 1)} of the explained variation${interval}. ${direction} ${notes.join(" ")}`.replace(/\s+/g, " ").trim(),
      theme,
      stats: {
        ...common,
        kind: "driver",
        question: x.name,
        // The predictor's code, so a posted finding identifies the question even where labels repeat.
        variable: x.variable ?? null,
        share: x.share,
        shareLow: x.shareLow,
        shareHigh: x.shareHigh,
        rank: x.rank,
        rankLow: x.rankLow,
        rankHigh: x.rankHigh,
        correlation: x.correlation,
        effect: x.effect,
        pValue: x.pValue,
        vif: x.vif,
        caveats,
      },
    });
  }

  const little = r.rows.filter((x) => x.share < 0.03 && (x.pValue === null || x.pValue > 0.05));
  if (little.length > 0) {
    out.push({
      text: `${little.map((x) => x.name).join(", ")} ${little.length === 1 ? "adds" : "add"} little to ${outcome} once the other questions are in the model (each under 3% of the explained variation). ${little.length === 1 ? "It is" : "They are"} a weak candidate for priority.`,
      theme,
      stats: { ...common, kind: "driver_low", questions: little.map((x) => x.name), variables: little.map((x) => x.variable ?? null), caveats: modelCaveats },
    });
  }
  return out;
}
