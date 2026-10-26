// The Add files panel's type rules (uploadPurposes.ts): the order Grant set, the server field each
// type is sent under (unchanged from the old per-type pickers), the suggested type every added file
// starts with (Grant, 2026-10-21), and the extension check that holds Upload back.
import { describe, expect, it } from "vitest";
import { UPLOAD_PURPOSES, csvLooksLikeTables, purposeMismatch, suggestPurposeFor } from "../uploadPurposes";

describe("upload purposes", () => {
  it("lists the types in Grant's order, each sent under the field the server reads", () => {
    expect(UPLOAD_PURPOSES.map((p) => [p.label, p.field])).toEqual([
      ["Brief", "briefFiles"],
      ["Proposal", "proposalFiles"],
      // Context, with briefs and proposals (Grant, 2026-10-24).
      ["Technical document", "technicalFiles"],
      ["Raw data", "rawTableFiles"],
      ["Tables", "tableFiles"],
      ["Statistical output", "outputFiles"],
      ["Qual data", "transcriptFiles"],
      ["Report", "reportFiles"],
      // Three types, three fields (Grant, 2026-10-20): no separate step to say which it is.
      ["Questionnaire", "questionnaireFiles"],
      // Its own type (Grant, 2026-10-26): the data file's variables, labels and codes.
      ["Codebook", "codebookFiles"],
      ["Interview guide", "interviewGuideFiles"],
      ["Focus group guide", "focusGroupGuideFiles"],
    ]);
  });

  const guideOf = (kind: string) => (UPLOAD_PURPOSES.some((p) => p.id === kind) ? { id: kind } : { id: "instrument", instrument: kind });
  const suggested = (name: string, sample?: string) => {
    const s = suggestPurposeFor(name, sample);
    return s.instrument ? { id: s.id, instrument: s.instrument } : { id: s.id };
  };

  it("suggests a type for every file, from its extension and name, in rule order", () => {
    expect(suggested("FinScope SA 2024.SAV")).toEqual({ id: "raw" });
    expect(suggested("panel.dta")).toEqual({ id: "raw" });
    expect(suggested("models.zip")).toEqual({ id: "output" });
    expect(suggested("ConnectMobile_Focus_Group_Guide.docx")).toEqual(guideOf("focus_group_guide"));
    expect(suggested("Discussion guide v2.pdf")).toEqual(guideOf("interview_guide"));
    expect(suggested("Final - FinScope Consumer SA 2024 Questionnaire.pdf")).toEqual(guideOf("questionnaire"));
    expect(suggested("client-brief.docx")).toEqual({ id: "brief" });
    expect(suggested("ToR_Market_Study.pdf")).toEqual({ id: "brief" });
    expect(suggested("Terms of Reference.docx")).toEqual({ id: "brief" });
    expect(suggested("Proposal.docx")).toEqual({ id: "proposal" });
    expect(suggested("Simulated_Mobile_Network_Focus_Group_Transcripts.docx")).toEqual({ id: "transcript" });
    expect(suggested("IDI 04 Thandi.txt")).toEqual({ id: "transcript" });
    expect(suggested("Annual report 2024.pdf")).toEqual({ id: "report" });
    expect(suggested("Board deck.pptx")).toEqual({ id: "report" });
    expect(suggested("Wave 2 Crosstabs.xlsx")).toEqual({ id: "tables" });
    expect(suggested("banner_tables.csv")).toEqual({ id: "tables" });
    expect(suggested("tabulation.xls")).toEqual({ id: "tables" });
    // No hint: a spreadsheet is raw data, a document a report, a text file qualitative data.
    expect(suggested("golden-survey-documented.xlsx")).toEqual({ id: "raw" });
    expect(suggested("notes.docx")).toEqual({ id: "report" });
    expect(suggested("slides.pptx")).toEqual({ id: "report" });
    expect(suggested("notes.txt")).toEqual({ id: "transcript" });
    expect(suggested("README")).toEqual({ id: "report" });
    // A guide named as such is not taken for a transcript; a questionnaire in a spreadsheet is data.
    expect(suggested("Interview guide.docx")).toEqual(guideOf("interview_guide"));
    expect(suggested("questionnaire responses.xlsx")).toEqual({ id: "raw" });
    // Named as a codebook or a form, a spreadsheet is that (Grant, 2026-10-26); a JSON file is a codebook.
    expect(suggested("codebook.xlsx")).toEqual({ id: "codebook" });
    expect(suggested("May26_codebook.xlsx")).toEqual({ id: "codebook" });
    expect(suggested("Data Dictionary.csv")).toEqual({ id: "codebook" });
    expect(suggested("variables.json")).toEqual({ id: "codebook" });
    expect(suggested("household_questionnaire.xlsx")).toEqual(guideOf("questionnaire"));
    expect(suggested("survey_form.xls")).toEqual(guideOf("questionnaire"));
  });

  it("reads a CSV's first lines: totals, bases or many percentages are tables, respondent rows raw data", () => {
    expect(csvLooksLikeTables("Question,Male,Female\nBase,100,100\nYes,45%,30%\nNo,55%,70%")).toBe(true);
    expect(csvLooksLikeTables("Region,North,South\nTotal,200,180")).toBe(true);
    expect(csvLooksLikeTables("RespID,Age,Q1\n0001,34,1\n0002,51,2\n0003,22,1")).toBe(false);
    expect(csvLooksLikeTables("")).toBe(false);
    expect(suggested("export.csv", "Question,Male\nBase,100\nYes,45%")).toEqual({ id: "tables" });
    expect(suggested("export.csv", "RespID,Q1\n1,2")).toEqual({ id: "raw" });
    // A name hint is not overridden by the sample.
    expect(suggested("crosstabs.csv", "RespID,Q1\n1,2")).toEqual({ id: "tables" });
  });

  it("always suggests a type that fits the file's extension, with a reason", () => {
    const names = ["a.sav", "a.dta", "a.zip", "a.csv", "a.xlsx", "a.xls", "a.tsv", "a.txt", "a.md", "a.pdf", "a.docx", "a.pptx", "a.rtf", "a", "brief.txt", "proposal.pdf", "questionnaire.docx", "focus group guide.pdf", "tables.csv", "report.docx", "transcript.rtf", "brief.xlsx", "proposal.csv", "questionnaire.txt"];
    for (const name of names) {
      const s = suggestPurposeFor(name);
      expect(purposeMismatch(name, s.id), name).toBeNull();
      expect(s.reason.length, name).toBeGreaterThan(0);
    }
  });

  it("refuses a file whose extension the chosen type cannot read, and says which it takes", () => {
    expect(purposeMismatch("survey.xlsx", "raw")).toBeNull();
    expect(purposeMismatch("survey.xlsx", "brief")).toBe("Brief takes .pdf, .docx, .txt files, not .xlsx.");
    expect(purposeMismatch("guide.txt", "focus_group_guide")).toBe("Focus group guide takes .pdf, .docx files, not .txt.");
    expect(purposeMismatch("questionnaire.docx", "questionnaire")).toBeNull();
    expect(purposeMismatch("README", "proposal")).toMatch(/not a file with no extension\.$/);
    // Reports and transcripts take any file; the server reads what it can.
    expect(purposeMismatch("deck.pptx", "report")).toBeNull();
    expect(purposeMismatch("interviews.rtf", "transcript")).toBeNull();
  });
});
