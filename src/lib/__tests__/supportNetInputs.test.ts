// Codex GT100-F03 (golden-thread 100-case review, 2026-10-21): the variables a saved calculation
// depends on, read from its saved request the way the engine reads it. A custom NET row is saved
// with `vars: []` and its members under `nets[].vars`; before this repair those members were left
// out, so a correction to one of them left the table's dependent insights current.
import { describe, expect, it } from "vitest";
import { correctionsFor, tableVariablesFromSavedRequest } from "../supportStatusShared";

// The shape CrosstabWorkspace saves for custom NETs.
const netRow = (members: string[][]) => ({
  key: "nets-1",
  label: "Nets",
  vars: [],
  kind: "nets",
  nets: members.map((vars, i) => ({ label: `Net ${i + 1}`, vars })),
});

describe("tableVariablesFromSavedRequest (GT100-F03)", () => {
  it("NET-only request: the NET members are its dependencies", () => {
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [netRow([["A", "B"]])] })).toEqual(["A", "B"]);
  });

  it("mixed ordinary and NET rows, banner, filters, legacy layer, weight and design; deduped, stable order", () => {
    const saved = {
      columnVars: ["REGION"],
      rowItems: [{ key: "Q1", vars: ["Q1"] }, netRow([["A", "B"], ["B", "C"]]), { key: "bat", kind: "battery", vars: ["S1", "S2"] }],
      filters: [{ variable: "AGE", op: "between", min: 18 }, { variable: "Q1", op: "in", values: ["Yes"] }],
      layer: { variable: "WAVE", category: "2" },
      weightVar: "W",
      design: { psu: "PSU", strata: "STRATUM" },
    };
    expect(tableVariablesFromSavedRequest(saved)).toEqual(["REGION", "Q1", "A", "B", "C", "S1", "S2", "AGE", "WAVE", "W", "PSU", "STRATUM"]);
  });

  it("an unrelated variable stays outside the dependencies (control)", () => {
    const vars = tableVariablesFromSavedRequest({ columnVars: [], rowItems: [netRow([["A", "B"]])] });
    const corrections = { A: { type: "categorical" }, UNRELATED: { type: "continuous" } };
    expect(correctionsFor(corrections, vars)).toEqual({ A: { type: "categorical" } });
    expect(correctionsFor({ UNRELATED: { type: "continuous" } }, vars)).toEqual({});
  });

  it("a multiple-response banner set is not resolvable from the request: null, compared file-wide", () => {
    expect(tableVariablesFromSavedRequest({ columnVars: ["set:Q5"], rowItems: [{ key: "Q1", vars: ["Q1"] }] })).toBeNull();
  });

  it("unrecognised or legacy shapes are null (cautious), never an empty dependency list", () => {
    expect(tableVariablesFromSavedRequest(null)).toBeNull();
    expect(tableVariablesFromSavedRequest({})).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: "Q1", rowItems: "Q2" })).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [{ key: "x", vars: "A" }] })).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [{ key: "n", vars: [], kind: "nets", nets: "A" }] })).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [{ key: "n", vars: [], kind: "nets", nets: [{ label: "x" }] }] })).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [{ key: "n", vars: [], kind: "nets", nets: [{ vars: [1] }] }] })).toBeNull();
    expect(tableVariablesFromSavedRequest({ columnVars: [], rowItems: [null] })).toBeNull();
  });

  it("an ordinary request is read as before", () => {
    expect(tableVariablesFromSavedRequest({ columnVars: ["G"], rowItems: [{ key: "Q", vars: ["Q"] }], weightVar: null })).toEqual(["G", "Q"]);
  });
});
