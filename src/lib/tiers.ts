/**
 * Shared tier types used across quality scoring, synthesis, narrative and
 * deck generation. These used to be redeclared independently in
 * storyNarrative.ts, deckSlides.ts, objectiveValidator.ts,
 * insightQualityScorer.ts and synthesizedInsightQualityScorer.ts -- harmless
 * while every copy stayed in sync by hand, but nothing enforced that, and a
 * future change to either tier's set of values would need to be caught in
 * five places at once. One shared definition instead.
 *
 * ConfidenceTier judges a synthesized insight's evidentiary strength (how
 * many corroborating pre-insights and distinct source themes feed it), kept
 * separate from verdict_tier (robust/use_with_caution/not_supported), which
 * judges whether the underlying finding itself is well-supported evidence.
 * QualityTier judges whether an insight built on a finding is a genuine,
 * non-obvious, actionable insight rather than a restated observation (see
 * insightQualityScorer.ts and synthesizedInsightQualityScorer.ts). Both are
 * nullable because not every insight has been scored yet when these types
 * are used to describe a row read back from the database.
 */
export type ConfidenceTier = "strong" | "moderate" | "exploratory" | null;
export type QualityTier = "finding" | "partial" | "qualified" | null;
