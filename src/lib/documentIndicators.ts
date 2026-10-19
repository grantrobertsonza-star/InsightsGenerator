// Size indicators for a brief, proposal or report on the Import screen (Grant, 2026-10-19: "what
// quality indicators can we add for proposal? number of pages? number of words"). Pure rules, no
// database or storage, so they are tested directly; documentIndicatorActions.ts gathers the inputs.
//   words: whitespace-separated tokens of the text the app read from the file (after conversion to
//     PDF for Word and PowerPoint). Close to, but not always the same as, Word's own count: a
//     hyphenated line break or a table cell boundary can split or join a word.
//   pages: the page count of the PDF the app reads (the file itself, or its PDF copy); unknown when
//     there is no PDF copy, e.g. a plain-text file or a conversion that failed.
//   review coverage (briefs and proposals only): a Research quality review reads up to
//     KIND_LIMITS.maxCharsPerDocument characters of each document and records anything past that as
//     not assessed (researchQualityReview.ts prepareReview). Counted here on the same stored text the
//     review starts from, so it is approximate: the review re-reads the file when it starts.
import { KIND_LIMITS } from "./researchQualityTypes";

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export type ReviewCoverage = { kind: "whole"; chars: number; limit: number } | { kind: "partial"; chars: number; limit: number; assessedPct: number };

export function reviewCoverage(chars: number, limit: number = KIND_LIMITS.maxCharsPerDocument): ReviewCoverage {
  if (chars <= limit) return { kind: "whole", chars, limit };
  // Rounded down, so "about 99%" never hides that some text is left out.
  return { kind: "partial", chars, limit, assessedPct: Math.floor((limit / chars) * 100) };
}

export function reviewCoverageText(c: ReviewCoverage): string {
  const n = (v: number) => v.toLocaleString("en-GB");
  return c.kind === "whole"
    ? `A quality review reads all of it (${n(c.chars)} characters; the limit is ${n(c.limit)}).`
    : `Longer than a quality review reads: about the first ${c.assessedPct}% (${n(c.limit)} of ${n(c.chars)} characters) is assessed, and the rest is recorded as not assessed.`;
}
