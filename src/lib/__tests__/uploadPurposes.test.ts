// The Add files panel's type rules (uploadPurposes.ts): the order Grant set, the server field each
// type is sent under (unchanged from the old per-type pickers), suggestions only where the extension
// settles the answer, and the extension check that holds Upload back.
import { describe, expect, it } from "vitest";
import { UPLOAD_PURPOSES, purposeMismatch, suggestPurpose } from "../uploadPurposes";

describe("upload purposes", () => {
  it("lists the types in Grant's order, each sent under the field the server reads", () => {
    expect(UPLOAD_PURPOSES.map((p) => [p.label, p.field])).toEqual([
      ["Brief", "briefFiles"],
      ["Proposal", "proposalFiles"],
      ["Raw data", "rawTableFiles"],
      ["Tables", "tableFiles"],
      ["Statistical output", "outputFiles"],
      ["Qual data", "transcriptFiles"],
      ["Report", "reportFiles"],
      ["Questionnaire or guide", "instrumentFiles"],
    ]);
  });

  it("suggests a type only where the extension leaves one answer", () => {
    expect(suggestPurpose("FinScope SA 2024.SAV")).toBe("raw");
    expect(suggestPurpose("panel.dta")).toBe("raw");
    expect(suggestPurpose("models.zip")).toBe("output");
    // A PDF can be a report, a questionnaire, a brief or a proposal; a spreadsheet raw data or tables.
    for (const name of ["questionnaire.pdf", "brief.docx", "survey.xlsx", "data.csv", "notes", "deck.pptx"]) expect(suggestPurpose(name)).toBeNull();
  });

  it("refuses a file whose extension the chosen type cannot read, and says which it takes", () => {
    expect(purposeMismatch("survey.xlsx", "raw")).toBeNull();
    expect(purposeMismatch("survey.xlsx", "brief")).toBe("Brief takes .pdf, .docx, .txt files, not .xlsx.");
    expect(purposeMismatch("guide.txt", "instrument")).toBe("Questionnaire or guide takes .pdf, .docx files, not .txt.");
    expect(purposeMismatch("README", "proposal")).toMatch(/not a file with no extension\.$/);
    // Reports and transcripts take any file; the server reads what it can.
    expect(purposeMismatch("deck.pptx", "report")).toBeNull();
    expect(purposeMismatch("interviews.rtf", "transcript")).toBeNull();
  });
});
