// The one rule for whether a report finding's recorded quote appears in its source text. Used when a
// report is read (extractFindings: does the model's quote really appear?) and when support is
// checked (supportStatus, GT100-F02: does a kept finding's quote still appear in the text the
// report was last read as?), so the two can never match quotes differently. Client-safe: no
// database or server-only imports.

/**
 * Loose match used to check whether a claimed quote really appears in the
 * source text. Normalizes away things that are extraction artifacts, not
 * real differences: curly quotes vs straight ones, en/em dashes, ligatures,
 * non-breaking spaces, and words hyphenated across a line break.
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/­/g, "")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/-\s*\n\s*/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

export function quoteAppearsIn(quote: string, sourceText: string): boolean {
  const normalizedQuote = normalizeForMatch(quote);
  if (normalizedQuote.length === 0) return false;
  return normalizeForMatch(sourceText).includes(normalizedQuote);
}

/**
 * Below this many characters a read produced no usable text (an image-only PDF, a failed
 * conversion): extraction refuses to call the model, and a quote check against it would say every
 * quote had vanished, so it is treated as "could not check" instead.
 */
export const MIN_READABLE_SOURCE_CHARS = 50;

/**
 * Whether each quote is grounded in `sourceText`, normalising the text once for many quotes:
 *  - "present": it appears (quoteAppearsIn's rule);
 *  - "missing": the text is readable and the quote is not in it;
 *  - "unreadable": there is no stored text, or too little to judge (or the quote is empty), so
 *    nothing is claimed either way.
 */
export function quoteGroundingChecker(sourceText: string | null): (quote: string) => "present" | "missing" | "unreadable" {
  if (sourceText === null || sourceText.trim().length < MIN_READABLE_SOURCE_CHARS) return () => "unreadable";
  const normalizedSource = normalizeForMatch(sourceText);
  return (quote) => {
    const normalizedQuote = normalizeForMatch(quote);
    if (normalizedQuote.length === 0) return "unreadable";
    return normalizedSource.includes(normalizedQuote) ? "present" : "missing";
  };
}
