// Batch 60, Codex COD5K-F01: the shared sentence-boundary rule (sentences.ts) and every consumer of it.
// A sentence that ends in a number is a sentence; only a real list marker is not a boundary. Covers
// numeric endings, decimals, amounts, years, numbered lists, abbreviations, and through qualCoding the
// three-turn footer threshold, one-, two- and three-sentence and repeated footers, the actual
// apply-batch payload and the exact reconstructed passages. Also pins the legacy rule, which
// getCodedUnitPassages uses to recognise passages coded before the change.
import { describe, expect, it } from "vitest";
import { splitSentences } from "../sentences";
import {
  buildApplyBatches,
  findRepeatedFooters,
  reconstructCodedUnitText,
  splitIntoUnits,
  stripFooters,
  type TranscriptSegment,
} from "../qualCoding";
import { evidenceSummaryPoints } from "../decisionPresentation";

/** Every split keeps the words verbatim and in order: joining the pieces gives the input back. */
function split(text: string, rule?: Parameters<typeof splitSentences>[1]) {
  const out = splitSentences(text, rule);
  expect(out.join(" ")).toBe(text);
  return out;
}

describe("COD5K-F01 sentence boundaries", () => {
  it.each([
    ["a whole number", "I made a payment of 12. The account stayed blocked.", ["I made a payment of 12.", "The account stayed blocked."]],
    ["a year", "I opened the account in 2019. Then the fees rose.", ["I opened the account in 2019.", "Then the fees rose."]],
    ["a decimal at the end", "The monthly fee was 2.5. Then it went up.", ["The monthly fee was 2.5.", "Then it went up."]],
    ["an amount with a thousands separator", "I paid R1,200. The bank kept it.", ["I paid R1,200.", "The bank kept it."]],
    ["an amount with a currency letter", "It cost R12. Then it cost more.", ["It cost R12.", "Then it cost more."]],
    ["an amount with a currency sign", "It cost $12. Then it cost more.", ["It cost $12.", "Then it cost more."]],
    ["a time", "We met at 10:30. Then we left.", ["We met at 10:30.", "Then we left."]],
    ["a hyphenated number", "That was during COVID-19. Then things changed.", ["That was during COVID-19.", "Then things changed."]],
    ["a bare answer to a question", "How many accounts do you have? 3. Two are at banks.", ["How many accounts do you have?", "3.", "Two are at banks."]],
  ])("a sentence ending in %s ends there", (_label, text, expected) => {
    expect(split(text)).toEqual(expected);
  });

  it("a decimal inside a sentence never splits", () => {
    expect(split("It rose to 28.5% last year and then 3.2 points more. That was hard.")).toEqual([
      "It rose to 28.5% last year and then 3.2 points more.",
      "That was hard.",
    ]);
  });

  it.each([
    ["at the start of the text", "1. Fees are high. 2. The branch is far.", ["1. Fees are high.", "2. The branch is far."]],
    ["after a sentence", "There are reasons. 2. The branch is far.", ["There are reasons.", "2. The branch is far."]],
    ["after a colon", "My reasons: 1. Fees are high. 2. The branch is far.", ["My reasons: 1. Fees are high.", "2. The branch is far."]],
    ["after a heading whose line break was flattened", "My reasons 1. Fees are high. 2. The branch is far.", ["My reasons 1. Fees are high.", "2. The branch is far."]],
    ["inline, one word per item", "Options are 1. Cash 2. Card 3. Mobile money.", ["Options are 1. Cash 2. Card 3. Mobile money."]],
    ["after a bullet at the start", "- 3. The app crashed. It was slow.", ["- 3. The app crashed.", "It was slow."]],
    // A bullet is not itself a boundary (unchanged), so the sentence before it stays with the item.
    ["after a bullet after a sentence", "Things went wrong. - 3. The app crashed.", ["Things went wrong. - 3. The app crashed."]],
  ])("a numbered-list marker %s is not a boundary", (_label, text, expected) => {
    expect(split(text)).toEqual(expected);
  });

  it.each([
    ["Dr.", "I spoke to Dr. Smith about it. He helped.", ["I spoke to Dr. Smith about it.", "He helped."]],
    ["e.g.", "Small things, e.g. Fees and queues. Then more.", ["Small things, e.g. Fees and queues.", "Then more."]],
    ["vs.", "It was cash vs. Card for me. Card won.", ["It was cash vs. Card for me.", "Card won."]],
    ["No. before a number", "It was No. 5 on the list. Then it dropped.", ["It was No. 5 on the list.", "Then it dropped."]],
  ])("the abbreviation %s is not a boundary", (_label, text, expected) => {
    expect(split(text)).toEqual(expected);
  });

  it("'No.' before a word is the answer No and ends its sentence", () => {
    expect(split("No. The bank refused.")).toEqual(["No.", "The bank refused."]);
  });

  it("the legacy rule is unchanged: any number then a full stop, and 'No.', never ended a sentence", () => {
    expect(split("I made a payment of 12. The account stayed blocked.", "legacy-number-full-stop")).toEqual([
      "I made a payment of 12. The account stayed blocked.",
    ]);
    expect(split("No. The bank refused.", "legacy-number-full-stop")).toEqual(["No. The bank refused."]);
    expect(split("Fees are high. Card is better.", "legacy-number-full-stop")).toEqual(["Fees are high.", "Card is better."]);
  });

  it("the evidence summary on Business decisions shows a numeric-ending sentence as its own point", () => {
    expect(evidenceSummaryPoints("Complaints rose in 2024. Branch visits fell.")).toEqual([
      "Complaints rose in 2024.",
      "Branch visits fell.",
    ]);
  });
});

const FOOTER2 = "Synthetic interview. All dialogue is fictional.";
const seg = (index: number, text: string): TranscriptSegment => ({ index, speaker: `Person ${index}`, role: "participant", text });

/** Three (or `n`) turns with distinct speech, each followed by `footer`. */
function turnsWith(lastSentence: string, footer: string, n = 3): TranscriptSegment[] {
  const speech = [
    "I waited for help and received no response.",
    "My account was blocked while the payment was processed.",
    lastSentence,
  ];
  return speech.slice(0, n).map((s, i) => seg(i, `${s} ${footer}`));
}

describe("COD5K-F01 footers, apply batches and reconstructed passages", () => {
  it("Codex's control: a numeric-ending last sentence no longer hides the first footer sentence", () => {
    const segments = turnsWith("I made a payment of 12.", FOOTER2);
    expect(findRepeatedFooters(segments.map((s) => s.text))).toContain(FOOTER2);
    const items = buildApplyBatches(segments).flatMap((b) => b.items);
    expect(items.map((i) => i.text)).toEqual([
      "I waited for help and received no response.",
      "My account was blocked while the payment was processed.",
      "I made a payment of 12.",
    ]);
    expect(items.map((i) => i.units)).toEqual([
      ["I waited for help and received no response."],
      ["My account was blocked while the payment was processed."],
      ["I made a payment of 12."],
    ]);
    expect(reconstructCodedUnitText(segments, 2, 1)).toBe("I made a payment of 12.");
    expect(reconstructCodedUnitText(segments, 2, 2)).toBeNull();
  });

  it.each([
    ["a decimal", "The monthly fee was 2.5."],
    ["an amount", "I paid R1,200."],
    ["a year", "I opened the account in 2019."],
    ["an abbreviation inside", "I spoke to Dr. Smith about the fees."],
    ["a numbered list", "My reasons: 1. Fees are high. 2. The branch is far."],
  ])("a last sentence with %s keeps its words and loses the whole footer", (_label, last) => {
    const segments = turnsWith(last, FOOTER2);
    const items = buildApplyBatches(segments).flatMap((b) => b.items);
    expect(items[2].text).toBe(last);
    expect(items.every((i) => !i.text.includes("Synthetic interview") && !i.text.includes("fictional"))).toBe(true);
  });

  it("the numbered list's units are its items, rebuilt exactly", () => {
    const segments = turnsWith("My reasons: 1. Fees are high and rising. 2. The branch is very far away.", FOOTER2);
    expect(buildApplyBatches(segments).flatMap((b) => b.items)[2].units).toEqual([
      "My reasons: 1. Fees are high and rising.",
      "2. The branch is very far away.",
    ]);
    expect(reconstructCodedUnitText(segments, 2, 1)).toBe("My reasons: 1. Fees are high and rising.");
    expect(reconstructCodedUnitText(segments, 2, 2)).toBe("2. The branch is very far away.");
  });

  it("threshold: a footer on only two turns is speech, kept verbatim in the payload", () => {
    const segments = turnsWith("I made a payment of 12.", FOOTER2, 2);
    expect(findRepeatedFooters(segments.map((s) => s.text))).toEqual([]);
    const items = buildApplyBatches(segments).flatMap((b) => b.items);
    expect(items.map((i) => i.text)).toEqual(segments.map((s) => s.text));
  });

  it("threshold: three turns where one ends in a number all count towards the footer", () => {
    // Before the fix only two turns ended "Synthetic interview. All dialogue is fictional." as units.
    const texts = [
      `I made a payment of 12. ${FOOTER2}`,
      `I was charged 30. ${FOOTER2}`,
      `The branch was closed. ${FOOTER2}`,
    ];
    expect(findRepeatedFooters(texts)).toContain(FOOTER2);
  });

  it.each([
    ["one-sentence", "All dialogue in this file is fictional."],
    ["two-sentence", FOOTER2],
    ["three-sentence", "Synthetic interview. All dialogue is fictional. Do not cite."],
  ])("a %s footer after a numeric ending is removed whole", (_label, footer) => {
    const segments = turnsWith("I made a payment of 12.", footer);
    const items = buildApplyBatches(segments).flatMap((b) => b.items);
    expect(items[2].text).toBe("I made a payment of 12.");
    expect(reconstructCodedUnitText(segments, 2, 1)).toBe("I made a payment of 12.");
  });

  it("a footer repeated at the end of a turn is removed every time", () => {
    const footers = findRepeatedFooters(turnsWith("I made a payment of 12.", FOOTER2).map((s) => s.text));
    expect(stripFooters(`I made a payment of 12. ${FOOTER2} ${FOOTER2}`, footers)).toBe("I made a payment of 12.");
  });

  it("splitIntoUnits keeps a numeric-ending sentence as its own unit and the text verbatim", () => {
    const text = "I made a payment of 12 rand at the branch. The account stayed blocked for a week.";
    expect(splitIntoUnits(text)).toEqual([
      "I made a payment of 12 rand at the branch.",
      "The account stayed blocked for a week.",
    ]);
    const numeric = "I made a payment at the branch of 12. The account stayed blocked for a week.";
    expect(splitIntoUnits(numeric)).toEqual([
      "I made a payment at the branch of 12.",
      "The account stayed blocked for a week.",
    ]);
    expect(splitIntoUnits(numeric, "legacy-number-full-stop")).toEqual([numeric]);
  });
});
