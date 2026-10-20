/**
 * Sentence boundaries in plain text, shared by the qualitative coder (qualCoding.ts, which splits
 * participant turns into units) and the Business decisions screen (which shows the evidence summary
 * as its sentences). No Node-only imports, so it is safe in browser code.
 *
 * A boundary is a full stop, question or exclamation mark (with any closing quote or bracket),
 * then space, then a capital, digit, quote or bracket. Not a boundary: a known abbreviation
 * ("e.g.", "vs."), or a bare number such as "3." in a numbered list. A decimal such as "28.5%"
 * has no space after its point, so it never splits.
 */
const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|no|approx|st)\.$/i;

export function splitSentences(flat: string): string[] {
  const raw: string[] = [];
  let start = 0;
  const re = /[.!?]+["')\]]*\s+(?=[A-Z0-9"'(\[])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const end = m.index + m[0].length;
    const piece = flat.slice(start, end).trim();
    // Not a boundary: an abbreviation, or a number such as "3. " inside a list of one word.
    if (ABBREVIATIONS.test(piece.replace(/\s+$/, "")) || /\b\d+\.$/.test(piece)) continue;
    raw.push(piece);
    start = end;
  }
  const tail = flat.slice(start).trim();
  if (tail) raw.push(tail);
  return raw;
}
