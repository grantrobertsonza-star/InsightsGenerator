/**
 * Sentence boundaries in plain text, shared by the qualitative coder (qualCoding.ts: the units a
 * participant turn is coded in, the repeated footers removed before coding, and the coded passage
 * rebuilt from stored turns) and the Business decisions screen (which shows the evidence summary as its
 * sentences). No Node-only imports, so it is safe in browser code. Every caller passes text whose
 * whitespace is already collapsed to single spaces, so line breaks are not visible here; the list
 * marker rules below are written for that flattened text.
 *
 * A candidate boundary is a full stop, question or exclamation mark (with any closing quote or
 * bracket), then space, then a capital, digit, quote or bracket. A decimal such as "28.5%" has no space
 * after its point, so it is never a candidate. A candidate is not a boundary when:
 *
 * - the text before it ends in a known abbreviation ("e.g.", "vs.", "Dr."), or in "No." directly before
 *   a number ("No. 5"); "No." before a word is the answer "No" and ends its sentence;
 * - (rule "numeric-endings-v2", COD5K-F01) the full stop belongs to a numbered-list marker such as
 *   "2." in "Fees. 2. Distance.". A number then a full stop is a list marker only when it opens a
 *   sentence position (nothing but an optional bullet or dash since the previous boundary or the start
 *   of the text, and the sentence before it was not a question it answers), directly follows ": ",
 *   "; " or a bullet after a sentence end, or is one of an ascending run 1., 2., 3. ... of at least two such numbers in the text (an
 *   inline list whose line breaks were flattened away). A number with more than three digits (a year),
 *   one written after a letter, digit, comma or point ("R12.", "1,200.", "2.5."), and any other number
 *   ("a payment of 12.") ends its sentence like any word.
 *
 * Before numeric-endings-v2 the rule ("legacy-number-full-stop") treated ANY number then a full stop
 * as a list marker, so "I made a payment of 12. The account stayed blocked." was one sentence and a
 * footer after such a sentence was only partly recognised. The legacy rule is kept, selectable, only
 * so a coded passage stored before the change can be compared with the units the model was actually
 * shown at the time (getCodedUnitPassages); nothing new is split with it.
 *
 * Known limit of the flattened-text rules: a bare number answering something other than a question
 * ("Count them. 3. Then...") is read as a list marker, and "I was 1. Then 2." as an inline list. In
 * both the words are kept, in order; only where one unit ends moves.
 */
export type SentenceRule = "numeric-endings-v2" | "legacy-number-full-stop";

export const CURRENT_SENTENCE_RULE: SentenceRule = "numeric-endings-v2";

const ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|approx|st)\.$/i;
const LEGACY_ABBREVIATIONS = /\b(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|prof|no|approx|st)\.$/i;
/** A number of one to three digits standing on its own just before a full stop. */
const MARKER_NUMBER = /(?<![\p{L}\p{N}.,])(\d{1,3})$/u;
const BULLET_ONLY = /^[-*\u2022\u2013\u2014]?$/;
const AFTER_COLON = /[:;]\s+(?:[-*\u2022\u2013\u2014]\s*)?$/;
/** A bullet or dash after the end of a sentence ("... wrong. - 3. The app ..."). A bullet is not a
 * candidate boundary itself, so the sentence before it and the item stay one piece (as before). */
const AFTER_SENTENCE_BULLET = /[.!?]["')\]]*\s+[-*\u2022\u2013\u2014]\s*$/;
const ENDS_IN_QUESTION = /\?["')\]]*$/;

/**
 * Positions (index of the first digit) of numbers that form an ascending run 1., 2., ... of at least
 * two in the text. Other numbers between members do not break a run; a new "1." starts a new run.
 */
function inlineListMarkers(flat: string): Set<number> {
  const out = new Set<number>();
  let run: number[] = [];
  const close = () => {
    if (run.length >= 2) for (const p of run) out.add(p);
    run = [];
  };
  for (const m of flat.matchAll(/(?<![\p{L}\p{N}.,])(\d{1,3})\.(?=\s)/gu)) {
    const value = Number(m[1]);
    if (value === 1) {
      close();
      run.push(m.index);
    } else if (run.length > 0 && value === run.length + 1) {
      run.push(m.index);
    }
  }
  close();
  return out;
}

export function splitSentences(flat: string, rule: SentenceRule = CURRENT_SENTENCE_RULE): string[] {
  const raw: string[] = [];
  let start = 0;
  const re = /[.!?]+["')\]]*\s+(?=[A-Z0-9"'(\[])/g;
  const inlineMarkers = rule === "numeric-endings-v2" ? inlineListMarkers(flat) : new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat)) !== null) {
    const end = m.index + m[0].length;
    const piece = flat.slice(start, end).trim();
    if (rule === "legacy-number-full-stop") {
      if (LEGACY_ABBREVIATIONS.test(piece) || /\b\d+\.$/.test(piece)) continue;
    } else {
      if (ABBREVIATIONS.test(piece)) continue;
      // "No. 5" is an abbreviation; "No. The bank refused." is an answer and a sentence.
      if (/\bno\.$/i.test(piece) && /^\d/.test(flat.slice(end))) continue;
      if (isListMarker(flat, start, m, raw, inlineMarkers)) continue;
    }
    raw.push(piece);
    start = end;
  }
  const tail = flat.slice(start).trim();
  if (tail) raw.push(tail);
  return raw;
}

function isListMarker(
  flat: string,
  start: number,
  m: RegExpExecArray,
  previous: string[],
  inlineMarkers: Set<number>,
): boolean {
  // Only a single full stop directly followed by space can close a list marker ("2. "), never "2?" or
  // '2." '.
  if (!/^\.\s/.test(m[0])) return false;
  const before = flat.slice(0, m.index);
  const num = MARKER_NUMBER.exec(before);
  if (!num) return false;
  const numberAt = m.index - num[1].length;
  if (inlineMarkers.has(numberAt)) return true;
  const sinceBoundary = flat.slice(start, numberAt);
  if (AFTER_COLON.test(sinceBoundary) || AFTER_SENTENCE_BULLET.test(sinceBoundary)) return true;
  if (BULLET_ONLY.test(sinceBoundary.trim())) {
    // A bare number right after a question is its answer ("How many? 3. Two at banks.").
    const last = previous[previous.length - 1];
    return !(last !== undefined && sinceBoundary.trim() === "" && ENDS_IN_QUESTION.test(last));
  }
  return false;
}
