// Shared caveat vocabulary. Originally a copy of InsightsReview.tsx's own
// CAVEAT_LABELS map, pulled out here so the Insights Review badge chips and
// the DOCX/PPTX export routes read the same label for the same tag - the
// same reason surveyDesign.ts was pulled out of its two former callers.
//
// findingBasis.ts's provenanceNotes() is deliberately NOT folded into this
// module: it builds full qualifying sentences with its own handling-exclusion
// set (_PROVENANCE_NOTES_HANDLED) and branching logic (e.g. its FDR note
// depends on whether a row-level correction was ALSO applied), not a flat
// tag -> label lookup. Treating it as "the same map, just differently
// formatted" and forcing it onto this module would either lose that
// branching or require re-deriving it here, for no reader-facing benefit -
// its tooltip text is unaffected by this change and stays exactly as before.
export const CAVEAT_LABELS: Record<string, string> = {
  sampling_assumed_random: "Random sampling assumed",
  base_size_small: "Small base",
  base_size_borderline: "Borderline base",
  base_size_unknown: "Base size unknown",
  std_unknown: "Spread unknown",
  uncorrected_multiple_comparisons: "Multiple comparisons",
  fdr_controlled_within_table: "False discovery controlled (table)",
  fdr_controlled_within_row: "False discovery controlled (row)",
  bonferroni_controlled_within_row: "Bonferroni corrected (row)",
  weighted_effective_base: "Weighted, effective base",
  survey_design_not_modelled: "Survey design not modelled",
  survey_design_modelled: "Survey design modelled (Taylor series)",
  post_hoc_after_significant_anova: "Post-hoc (after significant ANOVA)",
  insufficient_n_for_test: "Too little data to test",
  stage_ratio_population_comparability_unverified: "Stage ratio: equivalent population not established",
  // Brand Health with a brand set as the brand source (Grant, 29 October 2026): a respondent in two brands'
  // groups is counted in both, so the brand groups overlap and do not sum to the total.
  brand_groups_overlap: "Brand groups overlap (a respondent can be in more than one)",
  survey_design_missing_for_some_cases: "Design info missing for some cases",
  survey_design_candidates_ambiguous: "Design candidates ambiguous",
  // EF-FND-F03 (batch 62, tableFindingPublication.ts): a kept, researcher-annotated table finding whose
  // table has since been computed again with different figures, or without this comparison at all.
  superseded_by_recomputation: "Superseded: the table now gives different figures",
  not_reproduced_on_recomputation: "Not reproduced when the table was computed again",
};

export function caveatLabel(caveat: string): string {
  return CAVEAT_LABELS[caveat] ?? caveat.replace(/_/g, " ");
}

// FND-001/REP-OUT-001 (second counter-review): the caveat vocabulary above
// is the FULL set a finding can carry, including internal bookkeeping tags
// (descriptive_reading, weighted_effective_base, base_size_* ) that are
// meaningful inside the app's own review screens but read as noise in a
// client-facing export. This allow-list is the only set of tags the DOCX/
// PPTX export routes are permitted to surface next to an insight or
// recommendation - everything else in CAVEAT_LABELS stays in-app-only.
// Deliberately narrow: survey-design limitations (the three ANA-NPS-003
// tags) and the one stage-ratio comparability tag (ANA-BRAND-001) are the
// cases the counter-review named by name; nothing else is assumed
// export-worthy without the same explicit naming.
export const EXPORT_CAVEAT_ALLOWLIST: ReadonlySet<string> = new Set([
  "survey_design_not_modelled",
  "survey_design_missing_for_some_cases",
  "survey_design_candidates_ambiguous",
  "stage_ratio_population_comparability_unverified",
  // Named by the project owner (29 October 2026): the overlap of brand groups is stated wherever the figures go.
  "brand_groups_overlap",
]);

/**
 * Reduces a raw list of finding-level caveat tags (as aggregated, live, at
 * export time, from every still-eligible contributing finding of a
 * synthesized insight or recommendation) to the short, human-readable,
 * de-duplicated set actually worth printing in an exported document.
 * Returns [] (never undefined) so a caller can render "nothing to show"
 * without a null check, and so an insight/recommendation with no
 * export-worthy caveat renders with no extra line at all.
 */
export function exportCaveatLabels(tags: readonly string[] | null | undefined): string[] {
  if (!tags || tags.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    if (!EXPORT_CAVEAT_ALLOWLIST.has(tag)) continue;
    const label = caveatLabel(tag);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
