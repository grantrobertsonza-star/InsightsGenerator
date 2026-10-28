// Batch 49 (Grant, 27 October 2026): questionnaire 1A and codebook Q1 have the same wording (only a double
// space differs), yet 1A was offered to Q1 at 63% because it was compared with the data file's short label,
// never with the codebook. codebookWordingMatches decides when a questionnaire question is the same
// question as a confirmed codebook entry. Pure; the texts are Grant's.
import { describe, expect, it } from "vitest";
import { codebookWordingMatches, normalisedWording, matchItems, wordingIdentical } from "../instrumentMatch";

const Q1A = "California will be holding a statewide primary election on June 2nd.  Are you planning or not planning to vote in this election, or have you already voted early or by mail?";
const CODEBOOK_Q1 = "California will be holding a statewide primary election on June 2nd. Are you planning or not planning to vote in this election, or have you already voted early or by mail?";

describe("normalisedWording", () => {
  it("ignores formatting only: case, spacing, quote and dash styles, closing punctuation, and a question label", () => {
    expect(normalisedWording(Q1A)).toBe(normalisedWording(CODEBOOK_Q1));
    expect(normalisedWording(`1A. ${CODEBOOK_Q1}`)).toBe(normalisedWording(CODEBOOK_Q1));
    // A bare leading code is a label only when it is the item's own code (B49-F01).
    expect(normalisedWording(`Q1 ${CODEBOOK_Q1}`, "Q1")).toBe(normalisedWording(CODEBOOK_Q1));
    expect(normalisedWording(`Q1 ${CODEBOOK_Q1}`)).not.toBe(normalisedWording(CODEBOOK_Q1));
    expect(normalisedWording("Q 12: “How” satisfied are YOU?")).toBe('"how" satisfied are you');
    expect(normalisedWording('Q 12: "How" satisfied — are YOU?')).toBe('"how" satisfied - are you');
    // Different words stay different.
    expect(normalisedWording(CODEBOOK_Q1.replace("June 2nd", "June 3rd"))).not.toBe(normalisedWording(CODEBOOK_Q1));
  });
});

describe("codebookWordingMatches", () => {
  const entry = { variable: "Q1", itemId: "cb-q1", code: "Q1", text: CODEBOOK_Q1 };
  it("Grant's case: 1A is Q1 through the confirmed codebook entry", () => {
    expect(codebookWordingMatches([{ id: "q-1a", code: "1A", text: Q1A }], [entry])).toEqual([{ itemId: "q-1a", variable: "Q1", basisItemId: "cb-q1", basisCode: "Q1" }]);
    // The repro: against a short data label the same question is only a wording suggestion (63% in Grant's file).
    const plain = matchItems([{ id: "q-1a", code: "1A", text: Q1A }], [{ name: "Q1", label: "Q1. Plan to vote in the June 2nd statewide primary election" }]);
    expect(plain).toEqual([expect.objectContaining({ variable: "Q1", method: "wording" })]);
    expect(plain[0].confidence).toBeLessThan(0.9);
  });
  it("close but not identical wording is not matched this way", () => {
    expect(codebookWordingMatches([{ id: "q", code: "1A", text: Q1A.replace("already voted", "voted") }], [entry])).toEqual([]);
  });
  it("too short to call the same question, or ambiguous on either side: left to the researcher", () => {
    expect(codebookWordingMatches([{ id: "q", code: "Q2", text: "Gender" }], [{ variable: "Q2", itemId: "cb", code: "Q2", text: "Gender" }])).toEqual([]);
    // Two codebook variables with the same wording (a repeated question): which one is unknown.
    expect(codebookWordingMatches([{ id: "q", code: "1A", text: Q1A }], [entry, { ...entry, variable: "Q1_w2", itemId: "cb-w2" }])).toEqual([]);
    // Two questionnaire questions with the same wording.
    expect(codebookWordingMatches([{ id: "a", code: "1A", text: Q1A }, { id: "b", code: "9", text: Q1A }], [entry])).toEqual([]);
    // One codebook variable listed twice is still one variable.
    expect(codebookWordingMatches([{ id: "q", code: "1A", text: Q1A }], [entry, { ...entry, itemId: "cb-dup" }])).toHaveLength(1);
  });
  it("no confirmed codebook entries: nothing", () => {
    expect(codebookWordingMatches([{ id: "q", code: "1A", text: Q1A }], [])).toEqual([]);
  });
});

// B49-F01 (Codex, 28 October 2026): the first rule reduced wording to ASCII letters and digits and dropped any
// leading number, so these different questions were linked and confirmed with no researcher. Codex's pairs.
describe("wording that differs in meaning is never identical (B49-F01)", () => {
  const pairs: [string, string][] = [
    ["Is your monthly household income < 5000 dollars?", "Is your monthly household income > 5000 dollars?"],
    ["Do you earn -500 dollars after costs each month?", "Do you earn +500 dollars after costs each month?"],
    ["How satisfied are you with service in 東京?", "How satisfied are you with service in 大阪?"],
    ["18 years and older should receive this benefit automatically", "21 years and older should receive this benefit automatically"],
  ];
  it.each(pairs)("%s / %s", (questionnaire, codebook) => {
    expect(normalisedWording(questionnaire)).not.toBe(normalisedWording(codebook));
    expect(codebookWordingMatches([{ id: "q", code: "Q9", text: questionnaire }], [{ variable: "V", itemId: "cb", code: "V", text: codebook }])).toEqual([]);
    expect(wordingIdentical({ text: questionnaire, code: "Q9" }, { text: codebook, code: "V" })).toBe(false);
  });
  it("the same pairs written identically still match (the formatting control)", () => {
    for (const [q] of pairs) {
      expect(codebookWordingMatches([{ id: "q", code: "Q9", text: `  ${q.toUpperCase()}  ` }], [{ variable: "V", itemId: "cb", code: "V", text: q }])).toHaveLength(1);
    }
  });
  it("a leading number is kept unless it is a label (closed by . ) : or the item's own code)", () => {
    expect(normalisedWording("18 years and older should receive it")).toBe("18 years and older should receive it");
    expect(normalisedWording("18. Years and older should receive it")).toBe("years and older should receive it");
    expect(normalisedWording("5000 dollars or more a month is enough", "Q5")).toBe("5000 dollars or more a month is enough");
  });
});
