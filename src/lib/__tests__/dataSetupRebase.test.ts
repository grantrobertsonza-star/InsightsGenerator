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
});
