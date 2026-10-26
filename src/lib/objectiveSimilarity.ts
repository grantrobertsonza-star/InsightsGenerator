import { objectiveIdentityKey } from "./objectiveLines";

/**
 * Which existing objective a re-read suggestion most likely restates (Grant, 2026-10-22: reading
 * the same proposal again re-worded its objectives, and the exact identity check let the re-worded
 * lines through as new). Used only to show a suggestion beside the objective it probably repeats,
 * so the researcher can keep one or the other. It never merges, hides or drops anything: identity
 * stays objectiveIdentityKey, and two lines this rule calls similar are still two objectives.
 *
 * Rule: token-set Jaccard over the content words of objectiveIdentityKey (common function words
 * removed, a trailing plural "s" dropped from words longer than three letters), similar when the
 * overlap is at least SIMILARITY_THRESHOLD. Deterministic: the best score wins, ties go to the
 * earlier candidate in the list given.
 */
export const SIMILARITY_THRESHOLD = 0.5;

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "does", "for", "from", "how", "in", "into", "is", "it", "its",
  "of", "on", "or", "our", "that", "the", "their", "them", "this", "to", "we", "what", "which", "who", "why", "with",
]);

export function objectiveWords(text: string): Set<string> {
  const words = objectiveIdentityKey(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return new Set(words);
}

export function objectiveSimilarity(a: string, b: string): number {
  const x = objectiveWords(a);
  const y = objectiveWords(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/** The candidate `text` most likely restates, or null when none reaches the threshold. */
export function likelyRestates<T extends { text: string }>(text: string, candidates: T[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = objectiveSimilarity(text, c.text);
    if (score >= SIMILARITY_THRESHOLD && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
