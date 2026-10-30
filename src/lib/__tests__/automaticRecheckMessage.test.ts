// E1R-F01: the sentence the codebook card adds after Read again withdrew automatic confirmations
// (instrumentMatchMessage.automaticRecheckMessage, used by InstrumentCard's recheckNote). A wave that was not
// checked is named with its reason and is never covered by "checked again against every wave".
import { describe, expect, it } from "vitest";
import { automaticRecheckMessage, type DataFileMatch } from "../instrumentMatchMessage";

const matched = (filename: string, autoConfirmed: number): DataFileMatch => ({ dataDocumentId: filename, filename, status: "matched", suggested: 0, autoConfirmed });
const failed = (filename: string, error: string): DataFileMatch => ({ dataDocumentId: filename, filename, status: "failed", error });

describe("automaticRecheckMessage", () => {
  it("nothing withdrawn: no sentence", () => {
    expect(automaticRecheckMessage(undefined)).toBe("");
  });

  it("every wave checked (an ordinary non-fit is part of a completed check)", () => {
    expect(automaticRecheckMessage({ withdrawn: 2, status: "done", reconfirmed: 1, files: [matched("w1.csv", 0), matched("w3.csv", 1)] })).toBe(
      " 2 automatic links whose answer list changed were checked again against every wave they were on (w1.csv, w3.csv): 1 still fits and is confirmed; the rest are suggestions to review.",
    );
  });

  it("one wave failed among successes: names it and its error, keeps the other wave's result, says how to retry", () => {
    expect(
      automaticRecheckMessage({ withdrawn: 2, status: "failed", error: "w1.csv: timeout", reconfirmed: 1, files: [failed("w1.csv", "timeout"), matched("w3.csv", 1)] }),
    ).toBe(
      " 2 automatic links whose answer list changed could not be checked again on every wave. Not checked: w1.csv (timeout); their links stay suggestions until they are checked. Checked again on w3.csv: 1 still fits and is confirmed. To retry, choose that wave under Data file and press Match again.",
    );
  });

  it("every wave failed", () => {
    const note = automaticRecheckMessage({ withdrawn: 2, status: "failed", error: "x", reconfirmed: 0, files: [failed("w1.csv", "a"), failed("w3.csv", "b")] });
    expect(note).toContain("could not be checked again on any wave. Not checked: w1.csv (a); w3.csv (b);");
    expect(note).not.toContain("Checked again on");
    expect(note).toContain("To retry, choose each of those waves under Data file and press Match again.");
  });

  it("a wave the codebook no longer describes is not checked, with its reason and no retry advice", () => {
    const note = automaticRecheckMessage({
      withdrawn: 1, status: "failed", error: "w1.csv: only 1 of 4", reconfirmed: 0,
      files: [{ dataDocumentId: "w1", filename: "w1.csv", status: "few_names", names: 1, coded: 4 }],
    });
    expect(note).toContain("Not checked: w1.csv (only 1 of the codebook's 4 names are its variables, so it was not matched)");
    expect(note).not.toContain("retry");
  });

  it("the whole check could not run", () => {
    expect(automaticRecheckMessage({ withdrawn: 1, status: "failed", error: "database unavailable" })).toBe(
      " 1 automatic link whose answer list changed could not be checked again (database unavailable), so it is a suggestion until you match the codebook again.",
    );
  });
});
