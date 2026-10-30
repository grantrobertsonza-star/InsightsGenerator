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
  it("rejects over-limit bytes before reading or storing their contents", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    const arrayBuffer = vi.fn();
    await expect(storeUploadedDocument("tenant", "run", "table", { name: "large.csv", size: IMPORT_LIMITS.maxFileBytes + 1, arrayBuffer } as unknown as File, "raw")).rejects.toThrow(/limit/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it("SAS files are accepted within the limit since their verification (26 October 2026)", () => {
    for (const name of ["survey.sas7bdat", "survey.xpt", "export.txt"]) expect(() => assertImportFileSupported(name, 1_000), name).not.toThrow();
    expect(() => assertImportFileSupported("big.sas7bdat", IMPORT_LIMITS.maxFileBytes + 1)).toThrow(/limit/);
  });
  it("Python pickle and Feather files are refused with what to upload instead, before reading or storing them", async () => {
    const { storeUploadedDocument } = await import("../documentUpload");
    for (const [name, reason] of [["frame.pkl", /can run code when they are opened.*Parquet/], ["frame.pickle", /can run code/], ["frame.feather", /Save the data as Parquet/]] as const) {
      const arrayBuffer = vi.fn();
      await expect(storeUploadedDocument("tenant", "run", "table", { name, size: 100, arrayBuffer } as unknown as File, "raw")).rejects.toThrow(reason);
      expect(arrayBuffer).not.toHaveBeenCalled();
    }
    for (const name of ["survey.rds", "survey.RData", "survey.rda", "survey.parquet"]) expect(() => assertImportFileSupported(name, 1_000), name).not.toThrow();
  });
});
