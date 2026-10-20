import { describe, expect, it } from "vitest";
import { HISTOGRAM_SOURCE_NOTE, histogramNote } from "../chartKinds";

// IR-10 (Codex, 2026-10-20): the histogram's note comes only from the method the distribution
// action reports; the variable's labels or distinct-value count play no part.
describe("histogramNote", () => {
  it("describes the method the action applied", () => {
    expect(histogramNote("bins")).toBe(HISTOGRAM_SOURCE_NOTE.bins);
    expect(histogramNote("values")).toBe(HISTOGRAM_SOURCE_NOTE.values);
    expect(HISTOGRAM_SOURCE_NOTE.bins).toMatch(/range of values/);
    expect(HISTOGRAM_SOURCE_NOTE.values).toMatch(/One bar per answer value/);
  });

  it("says nothing when the method is not known, rather than guessing", () => {
    expect(histogramNote(undefined)).toBeNull();
  });
});
