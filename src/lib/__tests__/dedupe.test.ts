import { describe, it, expect } from "vitest";
import { findDuplicateGroups, findGeneratedDuplicateGroups } from "../dedupe";

// Regression coverage for the false-positive bug this surfaced in
// production: a raw-table banner plan with one row per category (e.g. one
// reading per school) produces a run of code-generated "too little data in
// this group alone" findings whose wording is almost entirely a fixed
// template -- only the category name and the one number differ. Run
// through the plain-text Jaccard similarity check meant for narrative
// restatements, every one of those findings scores well above the
// duplicate threshold against every other one, regardless of which school
// or which variable it's actually about, so the whole batch gets flagged
// as duplicates of each other. The fix routes generated findings through a
// structural check (same source table, same source cells, same wording)
// instead of the wording-similarity check, which stays reserved for
// narrative/model-authored findings.
describe("findDuplicateGroups", () => {
  it("still catches a narrative finding restated near-verbatim elsewhere", () => {
    const findings = [
      { id: "a", finding_text: "Customer satisfaction dropped 12% among first-time buyers this quarter." },
      { id: "b", finding_text: "Customer satisfaction dropped 12 percent among first-time buyers this quarter." },
      { id: "c", finding_text: "Repeat purchase rate held steady across all other segments." },
    ];

    const groups = findDuplicateGroups(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(["a", "b"]);
  });

  it("wrongly flags same-template generated findings as duplicates of each other -- the bug this ticket is about", () => {
    // This is exactly the shape bannerPlanComputation.ts produces for an
    // n=1-per-category banner: same sentence frame, only the category name
    // and the number differ. Documenting (not fixing) this here as the
    // reason findGeneratedDuplicateGroups exists below.
    const findings = Array.from({ length: 10 }, (_, i) => ({
      id: `school-${i}`,
      finding_text: `School "School ${String(i + 1).padStart(2, "0")}" has a single Arsenic_Level reading of ${
        5 + i
      }, too little data in this group alone to test against the others.`,
    }));

    const groups = findDuplicateGroups(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(10);
  });
});

describe("findGeneratedDuplicateGroups", () => {
  it("does not flag distinct per-school generated findings sharing the same sentence template", () => {
    const findings = Array.from({ length: 10 }, (_, i) => ({
      id: `school-${i}`,
      finding_text: `School "School ${String(i + 1).padStart(2, "0")}" has a single Arsenic_Level reading of ${
        5 + i
      }, too little data in this group alone to test against the others.`,
      source_table_id: "table-1",
      source_cells: JSON.stringify({ rowIndices: [i] }),
    }));

    expect(findGeneratedDuplicateGroups(findings)).toEqual([]);
  });

  it("does not flag findings about different variables in different tables, even with near-identical wording", () => {
    const findings = [
      {
        id: "a",
        finding_text: 'School "School 03" has a single Lead_Level reading of 2.1, too little data in this group alone to test against the others.',
        source_table_id: "table-lead",
        source_cells: JSON.stringify({ rowIndices: [2] }),
      },
      {
        id: "b",
        finding_text: 'School "School 07" has a single Nitrate_Level reading of 15.42, too little data in this group alone to test against the others.',
        source_table_id: "table-nitrate",
        source_cells: JSON.stringify({ rowIndices: [6] }),
      },
    ];

    expect(findGeneratedDuplicateGroups(findings)).toEqual([]);
  });

  it("flags a genuine structural repeat: same table, same cells, same finding text", () => {
    const findings = [
      {
        id: "a",
        finding_text: 'School "School 03" has a single Arsenic_Level reading of 5.98, too little data in this group alone to test against the others.',
        source_table_id: "table-1",
        source_cells: JSON.stringify({ rowIndices: [2] }),
      },
      {
        id: "b",
        finding_text: 'School "School 03" has a single Arsenic_Level reading of 5.98, too little data in this group alone to test against the others.',
        source_table_id: "table-1",
        source_cells: JSON.stringify({ rowIndices: [2] }),
      },
    ];

    const groups = findGeneratedDuplicateGroups(findings);

    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual(["a", "b"]);
  });
});
