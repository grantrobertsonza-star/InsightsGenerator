import { describe, expect, it, vi } from "vitest";
import { assertImportFileSupported, assertImportCaseCount, IMPORT_LIMITS } from "../importLimits";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
describe("declared release import limits", () => {
  it("accepts exact boundaries and refuses one over with a recovery message", () => {
    expect(() => assertImportFileSupported("survey.csv", IMPORT_LIMITS.maxFileBytes)).not.toThrow();
    expect(() => assertImportFileSupported("survey.csv", IMPORT_LIMITS.maxFileBytes + 1)).toThrow(/100 MB limit \(100,000,000 bytes\).*Split/);
    // Grant 2026-10-19: real FinScope files (26.7 MB and 80.8 MB) are within the limit.
    expect(() => assertImportFileSupported("FinScope SA 2025.sav", 80_811_074)).not.toThrow();
    expect(() => assertImportCaseCount(IMPORT_LIMITS.maxCases)).not.toThrow();
    expect(() => assertImportCaseCount(IMPORT_LIMITS.maxCases + 1)).toThrow(/100,000.*retry/);
  });
  it("rejects over-limit bytes and excluded SAS before reading or storing their contents", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    for (const [name, size] of [["large.csv", IMPORT_LIMITS.maxFileBytes + 1], ["unverified.sas7bdat", 100]] as const) {
      const arrayBuffer = vi.fn();
      await expect(storeUploadedDocument("tenant", "run", "table", { name, size, arrayBuffer } as unknown as File, "raw")).rejects.toThrow(/limit|pending verification/);
      expect(arrayBuffer).not.toHaveBeenCalled();
    }
  });
});
