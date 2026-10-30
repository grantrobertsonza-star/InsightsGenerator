/**
 * How a generated finding was established, worked out from what is already
 * stored on it (origin, pattern_type, stated_stats). Pure, so the verdict step
 * and the Findings list read it the same way.
 *
 * The distinction matters for the verdict. A finding that rests on a test that
 * passed can be rated on its bases. A correlation with no test, a cluster
 * profile, an outlier flagged by a rule of thumb, or a result that says "nothing
 * was significant" must never be described as statistically significant.
 */

export type FindingBasis =
  | "tested_significant" // the app ran a test and it passed
  | "tested_not_significant" // a test was run and it did not pass (or showed no change)
  | "reported_statistics" // statistics read from an uploaded output, not recomputed here
  | "reading" // a direct reading of a table (a share, top-two box, NPS, average) with its interval, not a comparison
  | "null_result" // groups were compared and no reliable difference was found
  | "modelled" // a driver analysis: a share of explained variation from a regression the app ran, with a bootstrap interval
  | "descriptive" // no test was run
  | "heuristic" // flagged by a rule of thumb, not a formal test
  | "stated" // a claim made in a report
  | "coded" // a qualitative theme
  | "unknown";

export const BASIS_LABEL: Record<FindingBasis, string> = {
  tested_significant: "Tested, significant",
  tested_not_significant: "Tested, not significant",
  reported_statistics: "Statistics from uploaded output",
  reading: "Reading, with interval",
  null_result: "Tested, no difference",
  modelled: "Modelled, driver analysis",
  descriptive: "Descriptive, no test",
  heuristic: "Rule of thumb, no test",
  stated: "Stated in a report",
  coded: "Coded theme",
  unknown: "Basis unknown",
};

type Stats = Record<string, unknown> | null | undefined;

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
function caveatsOf(stats: Stats): string[] {
  return stats && Array.isArray(stats.caveats) ? stats.caveats.filter((c): c is string => typeof c === "string") : [];
}

export function findingBasis(f: { origin: string; pattern_type?: string | null; stated_stats?: Stats }): FindingBasis {
  if (f.origin === "stated") return "stated";
  if (f.origin === "coded") return "coded";
  const s = f.stated_stats;
  if (!s || typeof s !== "object") return "unknown";
  const caveats = caveatsOf(s);
  // New whole-table readings (wide findings) are not comparisons; check them before any significance caveat.
  if (f.pattern_type === "level") return "reading";
  if (f.pattern_type === "no_difference") return "null_result";
  if (f.pattern_type === "driver") return "modelled";
  if (caveats.includes("insufficient_n_for_test")) return "descriptive";
  if (caveats.includes("not_significant")) return "tested_not_significant";
  const kind = typeof s.kind === "string" ? s.kind : null;
  const testType = typeof s.testType === "string" ? s.testType : null;

  switch (f.pattern_type) {
    case "segment_difference":
      if (testType?.startsWith("column_")) return "tested_significant"; // crosstabs only make findings from passed tests
      if (s.significant === true) return "tested_significant";
      if (s.significant === false) return "tested_not_significant";
      return "unknown";
    case "banner_comparison":
      return testType === "descriptive_summary" ? "descriptive" : "tested_significant";
    case "relationship": {
      // New scans test r against zero; older findings carry no p and stay descriptive.
      const p = num(s.pValue);
      return p !== null && p < 0.05 ? "tested_significant" : "descriptive";
    }
    case "outlier":
      return "heuristic";
    case "cluster_profile":
      return "descriptive";
    case "model_association":
      return num(s.termsSignificant) === 0 ? "tested_not_significant" : "reported_statistics";
    case "segment_proportions": {
      if (kind === "or_table") return num(s.termsSignificant) === 0 ? "tested_not_significant" : "reported_statistics";
      if (kind === "estimates_with_se") {
        const z = num(s.z);
        return z !== null && Math.abs(z) > 1.96 ? "tested_significant" : "tested_not_significant";
      }
      return "reported_statistics"; // proportion_gap: non-overlapping intervals read from the file
    }
    case "trend":
      return num(s.changed) === 0 ? "tested_not_significant" : "tested_significant";
    default:
      if (kind === "or_table") return num(s.termsSignificant) === 0 ? "tested_not_significant" : "reported_statistics";
      return "unknown";
  }
}

export type CodeVerdict = { tier: "robust" | "use_with_caution" | "not_supported"; rationale: string };

/** The verdict a finding earns from its basis and any base-size cautions. No model involved. */
export function codeVerdict(basis: FindingBasis, cautions: string[], caveats: string[]): CodeVerdict {
  const cautionText = cautions.length > 0 ? ` ${cautions.join(" ")}` : "";
  switch (basis) {
    case "tested_not_significant":
      return {
        tier: "not_supported",
        rationale:
          `A test was run on this and it did not reach significance (or showed no change beyond sampling error), so ` +
          `the apparent difference is not a reliable pattern.${cautionText}`,
      };
    case "reading":
      return {
        tier: cautions.length > 0 ? "use_with_caution" : "robust",
        rationale: `A direct reading of the table (a share, score or average) with its interval. It describes this sample; it does not compare groups or show a difference.${cautionText}`,
      };
    case "modelled":
      if (caveats.includes("weak_fit"))
        return {
          tier: "not_supported",
          rationale:
            "The questions together explain too little of the outcome for their ranking to mean much. A weight on a model that fits poorly is not a reliable driver.",
        };
      return {
        tier: caveats.length > 0 || cautions.length > 0 ? "use_with_caution" : "robust",
        rationale:
          `A share of the explained variation from a regression the app ran, with a bootstrap interval. It shows what goes with the outcome in this survey, not what causes it, and a weight depends on which other questions are in the model.${cautions.length > 0 ? ` ${cautions.join(" ")}` : ""}${caveats.length > 0 ? ` Cautions: ${caveats.map((c) => c.replace(/_/g, " ")).join(", ")}.` : ""}`,
      };
    case "null_result":
      return {
        tier: "use_with_caution",
        rationale:
          `Groups were compared and no reliable difference was found. That is a result in itself, but a lack of significance is not proof the groups are alike, especially where a group base is small.${cautionText}`,
      };
    case "descriptive":
      return {
        tier: caveats.includes("insufficient_n_for_test") ? "not_supported" : "use_with_caution",
        rationale: caveats.includes("insufficient_n_for_test")
          ? "This is a single-group reading, not a tested comparison: there was not enough data within the group to test it against anything, so it is descriptive only."
          : `This is a description of the data (a correlation, a profile or a summary). No significance test was run, so it does not show a real difference.${cautionText}`,
      };
    case "heuristic":
      return {
        tier: "use_with_caution",
        rationale: `Flagged by a rule of thumb (a value far from the others), not a formal test. Worth checking, not evidence of a real effect.${cautionText}`,
      };
    case "reported_statistics":
      return {
        tier: cautions.length > 0 ? "use_with_caution" : "robust",
        rationale: `Based on statistics reported in the uploaded output. The app read them and did not recompute them.${cautionText}`,
      };
    case "tested_significant": {
      const uncorrected = caveats.includes("uncorrected_multiple_comparisons") ? " No correction for multiple comparisons was applied." : "";
      return {
        tier: cautions.length > 0 ? "use_with_caution" : "robust",
        rationale:
          cautions.length > 0
            ? `Statistically significant as computed by the pipeline.${uncorrected} ${cautions.join(" ")}`.trim()
            : `Statistically significant as computed by the pipeline's own arithmetic, with no base-size caution.${uncorrected}`,
      };
    }
    default:
      return {
        tier: "use_with_caution",
        rationale: `How this finding was established could not be determined from what is stored, so it is not rated as tested.${cautionText}`,
      };
  }
}

// ANA-BRAND-001: every caveat tag this function explicitly recognises and turns into its own
// sentence above. Used only to decide what counts as "already covered" below - the actual text
// for each of these stays in the branches above, not here.
const _PROVENANCE_NOTES_HANDLED = new Set([
  "fdr_controlled_within_table",
  "fdr_controlled_within_row",
  "bonferroni_controlled_within_row",
  "uncorrected_multiple_comparisons",
  "survey_design_modelled",
  "survey_design_not_modelled",
  "weighted_effective_base",
]);

/** Plain-language notes on how a generated finding was made, for a badge tooltip. Reads only what is stored on the finding. */
export function provenanceNotes(f: { origin: string; pattern_type?: string | null; stated_stats?: Stats }): string[] {
  if (f.origin !== "generated" || !f.stated_stats) return [];
  const caveats = caveatsOf(f.stated_stats);
  const notes: string[] = [];
  const basis = findingBasis(f);
  if (basis === "modelled") {
    notes.push("Modelled from the survey data by driver analysis. It shows association, not cause, and a question's weight depends on which other questions are in the model.");
    return notes;
  }
  if (basis === "reported_statistics") notes.push("Statistics were read from an uploaded output and were not recomputed here.");
  if (caveats.includes("fdr_controlled_within_table")) {
    const rowLevel = caveats.includes("fdr_controlled_within_row") || caveats.includes("bonferroni_controlled_within_row");
    notes.push(
      rowLevel
        ? "False discovery rate controlled across the whole table, after a separate correction within the row. The p shown is unadjusted; inclusion rests on q."
        : "False discovery rate controlled across the whole table. The p shown is unadjusted; inclusion rests on q.",
    );
  } else if (caveats.includes("fdr_controlled_within_row")) notes.push("False discovery rate controlled within the row only, not across rows.");
  else if (caveats.includes("bonferroni_controlled_within_row")) notes.push("Bonferroni controlled within the row only, not across rows.");
  else if (caveats.includes("uncorrected_multiple_comparisons")) notes.push("Not corrected for the number of comparisons made.");
  if (caveats.includes("survey_design_modelled")) notes.push("Survey design modelled in the variance.");
  else if (caveats.includes("survey_design_not_modelled")) notes.push("Assumes simple random sampling; the survey design is not modelled.");
  if (caveats.includes("weighted_effective_base")) notes.push("Weighted, with an effective base.");
  // ANA-NPS-003: two more design-related caveats a finding can carry alongside
  // survey_design_modelled - a design that WAS applied but only to some cases (or none,
  // see api/parse-stats-file.py's degenerate-design guard), and an auto-detected design the
  // heuristic couldn't resolve between several candidates. Each gets its own sentence rather
  // than falling through to the generic fallback below, since both materially qualify how much
  // the "survey design modelled" note above can be trusted.
  if (caveats.includes("survey_design_missing_for_some_cases")) {
    notes.push("Some or all cases were missing the design (cluster/strata) information, so the design-based correction may understate uncertainty for part of the sample.");
  }
  if (caveats.includes("survey_design_candidates_ambiguous")) {
    notes.push("More than one variable looked like a design (PSU/strata) candidate; none was applied automatically, so this reading may not reflect the intended survey design.");
  }
  // ANA-BRAND-001: stage_ratio_population_comparability_unverified used to be silently dropped
  // here - this consumer only ever recognised a fixed caveat whitelist, so a tag outside it (this
  // one, or any future one) vanished between the finding's own stated_stats and this tooltip, with
  // no sign anything had been qualified at all. Every caveat now either gets its own sentence
  // above or, for anything this function doesn't specifically know about (_PROVENANCE_NOTES_HANDLED
  // doesn't include it), a readable fallback below - never silence.
  if (caveats.includes("stage_ratio_population_comparability_unverified")) {
    notes.push("Stage-to-stage ratio: the two stages are not established as measuring an equivalent population.");
  }
  if (caveats.includes("brand_groups_overlap")) {
    notes.push("Brand groups come from a multiple-response question: a respondent in more than one brand's group is counted in each, so the groups overlap and do not sum to the total.");
  }
  for (const c of caveats) {
    if (_PROVENANCE_NOTES_HANDLED.has(c) || c === "stage_ratio_population_comparability_unverified" || c === "brand_groups_overlap" || c === "descriptive_reading") continue;
    notes.push(`Additional caveat recorded: ${c.replace(/_/g, " ")}.`);
  }
  notes.push("Found by scanning the data, not tied to an objective.");
  return notes;
}
