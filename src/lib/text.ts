// research_objective and decision_statement are kept in sync (via runSync.ts)
// as either a single piece of text, or, once more than one candidate is
// accepted, a "1. ...\n2. ..." numbered block. Splitting that block back
// into its own items lets any screen that displays it (the run page's
// summary, the project list's preview line) render or summarize each item
// on its own instead of as one dense numbered paragraph.
export function parseNumberedItems(text: string | null): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\.\s*/, ""));
}

/**
 * A defensive cap applied after generation, on top of the word-count
 * instructions already given in a prompt. A model doesn't reliably hold to
 * a stated limit on its own, so this guarantees a narrative-level field
 * actually fits the slide design it's written for, regardless of how
 * closely the model followed the prompt.
 *
 * Sentence-aware: looks for the last sentence boundary (. ! ?) that still
 * lands inside the word budget, and cuts there instead of mid-sentence --
 * a paragraph that ends cleanly one sentence short of the budget reads far
 * better on a slide than one truncated mid-clause with a trailing ellipsis.
 * Only falls back to a hard word-count cut (with an ellipsis) when the text
 * has no sentence boundary within a reasonable share of the budget, which
 * would otherwise mean returning a fragment too short to carry the point.
 */
export function capWords(text: string, maxWords: number): string {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return trimmed;

  const sentenceEndings: { index: number; wordCount: number }[] = [];
  const sentenceEndRegex = /[.!?](?:\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceEndRegex.exec(trimmed)) !== null) {
    const upTo = trimmed.slice(0, match.index + 1);
    sentenceEndings.push({
      index: match.index + 1,
      wordCount: upTo.trim().split(/\s+/).filter(Boolean).length,
    });
  }

  // Prefer the latest sentence boundary that fits the budget and still
  // keeps at least 60% of it, so a cap that lands one sentence short
  // doesn't collapse to a single throwaway clause.
  const bestBoundary = [...sentenceEndings]
    .reverse()
    .find((s) => s.wordCount <= maxWords && s.wordCount >= maxWords * 0.6);

  if (bestBoundary) {
    return trimmed.slice(0, bestBoundary.index).trim();
  }

  return `${words.slice(0, maxWords).join(" ")}…`;
}
