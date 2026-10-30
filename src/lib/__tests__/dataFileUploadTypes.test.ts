// Delimited text (.txt) and SAS files on the Add files panel (Grant, 26 October 2026): Raw data and
// Tables take them; a .txt whose first lines read like a data table is suggested as Raw data (or Tables
// when they read like totals), and a .txt of prose stays a transcript.
import { describe, expect, it, vi } from "vitest";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
import { purposeMismatch, suggestPurposeFor, textLooksLikeDataTable } from "../uploadPurposes";
import { isCaseTableFileName, isStatsFileName } from "../statsFileName";
import { isPlainTableFileName } from "../parseTable";

const berkeley = "AD\tAGE\tage_tab\tasian\tblack\r\n37\t26\t1\t0\t0\r\n8\t18\t1\t1\t0\r\n40\t71\t4\t0\t0\r\n12\t5";

describe("data files as .txt and SAS", () => {
  it("Raw data and Tables take .txt, .tsv, .sas7bdat and .xpt", () => {
    for (const name of ["may2026.txt", "survey.tsv", "survey.sas7bdat", "survey.xpt"]) {
      expect(purposeMismatch(name, "raw"), name).toBeNull();
      expect(purposeMismatch(name, "tables"), name).toBeNull();
    }
    expect(purposeMismatch("survey.por", "raw")).toMatch(/takes/);
  });
  it("suggests Raw data for a tab-delimited .txt, Tables for one of percentages, transcript for prose", () => {
    expect(textLooksLikeDataTable(berkeley)).toBe(true);
    expect(suggestPurposeFor("may2026.txt", berkeley).id).toBe("raw");
    expect(suggestPurposeFor("tabs.txt", "Item\tTotal\tMen\nYes\t40%\t45%\nNo\t60%\t55%\n").id).toBe("tables");
    const prose = "Moderator: Welcome, everyone.\nRespondent 1: Thanks, glad to be here, really.\nModerator: Let's start.\n";
    expect(textLooksLikeDataTable(prose)).toBe(false);
    expect(suggestPurposeFor("group1.txt", prose).id).toBe("transcript");
    // Before the sample is read, a .txt is suggested by its name alone, as before.
    expect(suggestPurposeFor("may2026.txt").id).toBe("transcript");
    expect(suggestPurposeFor("survey.sas7bdat").id).toBe("raw");
    expect(suggestPurposeFor("survey.xpt").id).toBe("raw");
  });
  it("names the engine reads: .txt as a plain table, SAS as a statistics file", () => {
    expect(isPlainTableFileName("may2026.txt")).toBe(true);
    expect(isCaseTableFileName("may2026.TXT")).toBe(true);
    expect(isStatsFileName("survey.sas7bdat")).toBe(true);
    expect(isStatsFileName("survey.xpt")).toBe(true);
    expect(isPlainTableFileName("survey.xpt")).toBe(false);
  });
  it("codebooks and spreadsheet questionnaires: suggested from the name, and the right types take them", () => {
    expect(suggestPurposeFor("May26_codebook.xlsx").id).toBe("codebook");
    expect(suggestPurposeFor("Data Dictionary.pdf").id).toBe("codebook");
    expect(suggestPurposeFor("variables.json").id).toBe("codebook");
    expect(suggestPurposeFor("May_2026_Questionnaire.xlsx").id).toBe("questionnaire");
    expect(suggestPurposeFor("survey_form.xlsx").id).toBe("questionnaire");
    expect(suggestPurposeFor("may2026.xlsx").id).toBe("raw");
    for (const ext of [".xlsx", ".xls", ".csv", ".tsv", ".txt", ".json", ".pdf", ".docx"]) expect(purposeMismatch(`cb${ext}`, "codebook"), ext).toBeNull();
    for (const ext of [".xlsx", ".xls", ".csv"]) expect(purposeMismatch(`q${ext}`, "questionnaire"), ext).toBeNull();
    expect(purposeMismatch("q.json", "questionnaire")).toMatch(/takes/);
  });
  it("R and Parquet files go to Raw data; a pickle is refused in the panel with the reason", () => {
    for (const name of ["survey.rds", "survey.RData", "survey.rda", "survey.parquet"]) {
      expect(suggestPurposeFor(name).id, name).toBe("raw");
      expect(purposeMismatch(name, "raw"), name).toBeNull();
      expect(isStatsFileName(name), name).toBe(true);
    }
    expect(purposeMismatch("frame.pkl", "raw")).toMatch(/can run code when they are opened/);
  });
});
