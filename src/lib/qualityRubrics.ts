// The shared, pure part of the objective and recommendation quality scorers:
// what a score is, how a total becomes a rating, and how the model's output
// is validated before anything is stored. No model calls and no database
// here, so it can be tested directly.

export type Score = 1 | 3 | 5;
export type QualityRating = "weak" | "workable" | "strong";

export function isScore(value: unknown): value is Score {
  return value === 1 || value === 3 || value === 5;
}

// Objectives: four dimensions, 4 to 20.
export const OBJECTIVE_MAX = 20;
export function objectiveRating(total: number): QualityRating {
  if (total >= 16) return "strong";
  if (total >= 12) return "workable";
  return "weak";
}

// Recommendations: three dimensions in the total, 3 to 15. Impact is not in it.
export const RECOMMENDATION_MAX = 15;
export function recommendationRating(total: number): QualityRating {
  if (total >= 12) return "strong";
  if (total >= 9) return "workable";
  return "weak";
}

export type ObjectiveScore = {
  index: number;
  specific: Score;
  measurable: Score;
  answerable: Score;
  relevant: Score;
  rationale: string;
  suggestion: string;
};

/**
 * Keeps one valid score per item index. A score with a value other than
 * 1, 3 or 5, an index outside the list, or no rationale is dropped, and the
 * first score for an index wins.
 */
export function parseObjectiveScores(
  raw: unknown,
  itemCount: number,
): ObjectiveScore[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: ObjectiveScore[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const index = item?.index;
    const rationale =
      typeof item?.rationale === "string" ? item.rationale.trim() : "";
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= itemCount ||
      seen.has(index) ||
      !isScore(item.specific_score) ||
      !isScore(item.measurable_score) ||
      !isScore(item.answerable_score) ||
      !isScore(item.relevant_score) ||
      !rationale
    )
      continue;
    seen.add(index);
    out.push({
      index,
      specific: item.specific_score,
      measurable: item.measurable_score,
      answerable: item.answerable_score,
      relevant: item.relevant_score,
      rationale,
      suggestion:
        typeof item.suggestion === "string" ? item.suggestion.trim() : "",
    });
  }
  return out;
}

export type RecommendationScore = {
  index: number;
  actionability: Score;
  feasibility: Score;
  evidence: Score;
  impact: Score;
  rationale: string;
};

export function parseRecommendationScores(
  raw: unknown,
  count: number,
): RecommendationScore[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: RecommendationScore[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    const index = item?.index;
    const rationale =
      typeof item?.rationale === "string" ? item.rationale.trim() : "";
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count ||
      seen.has(index) ||
      !isScore(item.actionability_score) ||
      !isScore(item.feasibility_score) ||
      !isScore(item.evidence_score) ||
      !isScore(item.impact_score) ||
      !rationale
    )
      continue;
    seen.add(index);
    out.push({
      index,
      actionability: item.actionability_score,
      feasibility: item.feasibility_score,
      evidence: item.evidence_score,
      impact: item.impact_score,
      rationale,
    });
  }
  return out;
}

/** Whether stored objective rows still describe the current objective items. */
export function objectiveScoresCurrent(
  items: string[],
  stored: { item_order: number; item_text: string }[],
): boolean {
  if (items.length === 0 || stored.length !== items.length) return false;
  const byOrder = new Map(stored.map((s) => [s.item_order, s.item_text]));
  return items.every((text, i) => byOrder.get(i) === text);
}
