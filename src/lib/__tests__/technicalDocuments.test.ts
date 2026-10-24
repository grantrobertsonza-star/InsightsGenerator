// Technical documents (Grant, 2026-10-24): how a document's text becomes numbered passages, how a
// search ranks them, and which refs a read accepts (technicalDocuments.ts). The assistant's use of
// them, against a real database, is in researchAssistantTools.db.test.ts; upload in
// technicalDocumentUpload.db.test.ts.
import { describe, expect, it } from "vitest";
import { PASSAGE_CHARS, readPassage, searchPassages, splitPassages, type TechnicalDocument } from "../technicalDocuments";
import { suggestPurposeFor } from "../uploadPurposes";
import { sourceGroup, sourceTypeLabel } from "../importSources";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("splitPassages", () => {
  it("groups paragraphs into passages up to the limit, in order, losing no text", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => `Paragraph ${i + 1}. ${"word ".repeat(60).trim()}.`);
    const passages = splitPassages(paragraphs.join("\n\n"));
    expect(passages.length).toBeGreaterThan(1);
    for (const p of passages) expect(p.length).toBeLessThanOrEqual(PASSAGE_CHARS);
    expect(passages.join("\n\n").replace(/\s+/g, " ")).toBe(paragraphs.join(" ").replace(/\s+/g, " "));
  });
  it("cuts a long paragraph at a sentence end, or hard when it has none", () => {
    const sentences = Array.from({ length: 40 }, (_, i) => `Sentence ${i} about sampling and weighting.`).join(" ");
    const cut = splitPassages(sentences, 300);
    expect(cut.length).toBeGreaterThan(1);
    for (const p of cut.slice(0, -1)) expect(p.endsWith(".")).toBe(true);
    const hard = splitPassages("x".repeat(700), 300);
    expect(hard.map((p) => p.length)).toEqual([300, 300, 100]);
  });
  it("gives nothing for empty or blank text, and normalises Windows line ends", () => {
    expect(splitPassages("")).toEqual([]);
    expect(splitPassages(" \n\n \n")).toEqual([]);
    expect(splitPassages("One.\r\n\r\nTwo.")).toEqual(["One.\n\nTwo."]);
  });
});

const docs: TechnicalDocument[] = [
  { id: A, name: "Technical report.pdf", passages: ["Fieldwork ran from March to June.", "The sample was stratified by province and metro, with enumeration areas as clusters.", "Benchmark weights calibrate to population estimates."] },
  { id: B, name: "Weighting note.docx", passages: ["Weights were trimmed at the 99th percentile; weighting used raking."] },
];

describe("searchPassages", () => {
  it("ranks passages that use more of the question's words first, and finds word forms by stem", () => {
    const hits = searchPassages(docs, "stratified clusters enumeration");
    expect(hits[0]).toMatchObject({ ref: `${A}#2`, document: "Technical report.pdf", passage: 2, of: 3 });
    // "weighting" finds "Weights" and "weighting" in both documents.
    expect(searchPassages(docs, "weighting").map((h) => h.ref).sort()).toEqual([`${A}#3`, `${B}#1`].sort());
  });
  it("gives nothing for no meaningful words or no match", () => {
    expect(searchPassages(docs, "the and of")).toEqual([]);
    expect(searchPassages(docs, "questionnaire translation")).toEqual([]);
  });
});

describe("readPassage", () => {
  it("reads a passage by its ref, and refuses refs outside these documents or out of range", () => {
    expect(readPassage(docs, `${A}#3`)).toMatchObject({ document: "Technical report.pdf", passage: 3, of: 3, text: "Benchmark weights calibrate to population estimates." });
    for (const ref of [`${A}#0`, `${A}#4`, `${A}#1.5`, `33333333-3333-4333-8333-333333333333#1`, "not a ref", `${A}`]) expect(readPassage(docs, ref)).toBeNull();
  });
});

describe("the upload type", () => {
  it("is suggested from the file name for technical, methodology, fieldwork, sampling and weighting documents, before the report rule", () => {
    for (const name of ["FinScope SA 2024 Technical Report.pdf", "Methodology.docx", "Fieldwork report.docx", "Sampling and weighting.pdf", "survey_design_notes.txt"]) {
      expect(suggestPurposeFor(name).id, name).toBe("technical");
    }
    expect(suggestPurposeFor("Final Report.pdf").id).toBe("report");
    expect(suggestPurposeFor("Technical tables.xlsx").id).not.toBe("technical");
  });
  it("is listed as a Technical document, with the context files", () => {
    expect(sourceTypeLabel("technical", null)).toBe("Technical document");
    expect(sourceGroup("technical")).toBe("context");
  });
});
