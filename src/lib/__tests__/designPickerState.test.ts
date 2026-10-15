// Permanent regression test for the Codex re-review's package 4 repair: "make conflict hydration
// reset every picker state, including auto and no-saved-design configurations." Exercises the
// actual resolveDesignPickerState function both CrosstabWorkspace.tsx call sites (hydration and
// the save effect's conflict branch) now share.
import { describe, expect, it } from "vitest";
import { resolveDesignPickerState } from "../dataSetupShared";

describe("resolveDesignPickerState (Codex re-review, package 4)", () => {
  it("an explicit design populates psu/strata and clears no-design", () => {
    const r = resolveDesignPickerState({ mode: "explicit", psu: "PSU_VAR", strata: "STRATA_VAR" });
    expect(r).toEqual({ psuChoice: "PSU_VAR", strataChoice: "STRATA_VAR", noDesignChosen: false });
  });

  it("an explicit strata-only design is preserved (psu null is not coerced away)", () => {
    const r = resolveDesignPickerState({ mode: "explicit", psu: null, strata: "STRATA_VAR" });
    expect(r).toEqual({ psuChoice: "", strataChoice: "STRATA_VAR", noDesignChosen: false });
  });

  it("mode 'none' (explicit no-design) sets noDesignChosen and clears psu/strata", () => {
    const r = resolveDesignPickerState({ mode: "none", psu: null, strata: null });
    expect(r).toEqual({ psuChoice: null, strataChoice: null, noDesignChosen: true });
  });

  it("mode 'auto' resets the picker to not-yet-decided, not whatever was previously shown", () => {
    const r = resolveDesignPickerState({ mode: "auto", psu: "STALE_PSU", strata: "STALE_STRATA" });
    // This is exactly the gap the re-review found: before the fix, this third case was never
    // handled at all, so whatever the PREVIOUS document or PREVIOUS conflict-adopted value had
    // set stayed displayed, even though "auto" means the heuristic should decide, not this value.
    expect(r).toEqual({ psuChoice: null, strataChoice: null, noDesignChosen: false });
  });

  it("no persisted design at all (undefined) resets the picker to not-yet-decided", () => {
    expect(resolveDesignPickerState(undefined)).toEqual({ psuChoice: null, strataChoice: null, noDesignChosen: false });
  });

  it("null design resets the picker to not-yet-decided", () => {
    expect(resolveDesignPickerState(null)).toEqual({ psuChoice: null, strataChoice: null, noDesignChosen: false });
  });
});
