import { describe, expect, it } from "vitest";
import { waveCopyMessage } from "../waveCopyMessage";

describe("Copy here: what the researcher is told", () => {
  const w = "Wave 1 (w1.csv)";
  it("a wave with no tables says so, as a problem, and stays on the builder", () => {
    expect(waveCopyMessage({ tables: 0, built: 0, alreadyCopied: 0, skipped: [] }, w)).toEqual({ text: "Wave 1 (w1.csv) has no saved tables to copy.", tone: "error", showTables: false });
  });
  it("copies say where they are listed, and the list is shown", () => {
    expect(waveCopyMessage({ tables: 2, built: 2, alreadyCopied: 0, skipped: [] }, w)).toEqual({ text: "Copied 2 tables from Wave 1 (w1.csv) as drafts, listed under All tables.", tone: "success", showTables: true });
  });
  it("tables already copied are named, not counted as new", () => {
    expect(waveCopyMessage({ tables: 1, built: 0, alreadyCopied: 1, skipped: [] }, w)).toMatchObject({ text: "1 table was already copied here, so it was not copied again.", tone: "success", showTables: true });
  });
  it("every table refused: a problem, each with its reason", () => {
    expect(waveCopyMessage({ tables: 1, built: 0, alreadyCopied: 0, skipped: [{ label: "Q1 by Region", reason: "region is not in this file" }] }, w)).toEqual({ text: "1 could not be rebuilt here: Q1 by Region (region is not in this file)", tone: "error", showTables: false });
  });
});
