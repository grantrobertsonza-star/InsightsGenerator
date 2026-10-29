import { describe, expect, it } from "vitest";
import { rebaseSetupEdit } from "../dataSetupRebase";
import { DEFAULT_DATA_SETUP, type DataSetup } from "../dataSetupShared";

const base: DataSetup = { ...DEFAULT_DATA_SETUP };
const accepted: DataSetup = { ...base, accepted: true };

describe("a set-up edit that met a concurrent save", () => {
  it("the repro: a wave label typed while the first-view acceptance saved is kept, and the acceptance too", () => {
    expect(rebaseSetupEdit(base, { ...base, wave: "Wave 2" }, accepted)).toEqual({ ...accepted, wave: "Wave 2" });
  });
  it("the same field changed elsewhere stays a conflict", () => {
    expect(rebaseSetupEdit(base, { ...base, wave: "Wave 2" }, { ...accepted, wave: "Wave 3" })).toBeNull();
  });
  it("a structure change is never accepted by a concurrent acceptance: it asks for acceptance again", () => {
    const r = rebaseSetupEdit(base, { ...base, layout: "columns_are_cases" as DataSetup["layout"] }, accepted);
    expect(r).toMatchObject({ layout: "columns_are_cases", accepted: false });
  });
  it("an explicit accept or undo that met another change of acceptance is a conflict", () => {
    expect(rebaseSetupEdit(base, accepted, accepted)).toBeNull();
    expect(rebaseSetupEdit(accepted, base, base)).toBeNull();
  });
  it("nothing changed: nothing to re-apply", () => {
    expect(rebaseSetupEdit(base, base, accepted)).toBeNull();
  });
  it("the survey design is compared by value", () => {
    const withDesign: DataSetup = { ...accepted, design: { mode: "explicit", psu: "psu", strata: null } as DataSetup["design"] };
    expect(rebaseSetupEdit(accepted, { ...accepted, waveDate: "2026-06" }, { ...withDesign })).toEqual({ ...withDesign, waveDate: "2026-06" });
  });

  describe("Codex E1-F02: an acceptance is of the structure the researcher saw", () => {
    const cols = (s: DataSetup): DataSetup => ({ ...s, layout: "columns_are_cases" as DataSetup["layout"] });
    const other: Record<"unit" | "layout" | "method", (s: DataSetup) => DataSetup> = {
      unit: (s) => ({ ...s, unit: (s.unit === "respondents" ? "businesses" : "respondents") as DataSetup["unit"] }),
      layout: cols,
      method: (s) => ({ ...s, method: (s.method === "survey" ? "panel" : "survey") as DataSetup["method"] }),
    };
    for (const field of ["unit", "layout", "method"] as const) {
      it(`${field} changed elsewhere, then this view accepts: a conflict, so the changed structure is shown, not accepted`, () => {
        expect(rebaseSetupEdit(base, accepted, other[field](base))).toBeNull();
      });
      it(`${field} changed here, accepted elsewhere: asks for acceptance again (the other interleaving)`, () => {
        expect(rebaseSetupEdit(base, other[field](base), accepted)).toMatchObject({ [field]: other[field](base)[field], accepted: false });
      });
    }
    it("the repro: unaccepted rows-as-cases, columns-as-cases saved elsewhere unaccepted, Accept on the old view stays unaccepted", () => {
      expect(rebaseSetupEdit(base, accepted, cols(base))).toBeNull();
    });
    it("a wave label merges onto a structure changed elsewhere and keeps that structure's acceptance state", () => {
      expect(rebaseSetupEdit(base, { ...base, wave: "Wave 2" }, cols(base))).toEqual({ ...cols(base), wave: "Wave 2" });
      expect(rebaseSetupEdit(base, { ...base, wave: "Wave 2" }, { ...cols(base), accepted: true })).toEqual({ ...cols(base), accepted: true, wave: "Wave 2" });
    });
    it("unchanged structure: an acceptance merged with another field's change is kept", () => {
      expect(rebaseSetupEdit(base, accepted, { ...base, wave: "Wave 1" })).toEqual({ ...accepted, wave: "Wave 1" });
    });
    it("recovery: accepting from the reloaded (changed) structure succeeds", () => {
      expect(rebaseSetupEdit(cols(base), cols(accepted), { ...cols(base), wave: "Wave 1" })).toEqual({ ...cols(accepted), wave: "Wave 1" });
    });
  });
});
