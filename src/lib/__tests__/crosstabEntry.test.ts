import { describe, expect, it } from "vitest";
import { crosstabDatasetState, initialCrosstabDataset } from "../crosstabEntry";

describe("Cross tabs file states", () => {
  it("opens statistics files and case-level CSV or Excel files whose setup is accepted or absent", () => {
    expect(crosstabDatasetState({ filename: "survey.sav", ingestion: "raw", processingStatus: "ready" })).toBe("ready");
    expect(crosstabDatasetState({ filename: "survey.xlsx", ingestion: "raw", processingStatus: null, setupAccepted: true })).toBe("ready");
  });
  it("asks for setup when acceptance was undone, and keeps aggregated, unsupported and failed files apart", () => {
    expect(crosstabDatasetState({ filename: "survey.csv", ingestion: "raw", processingStatus: "ready", setupAccepted: false })).toBe("needs_setup");
    expect(crosstabDatasetState({ filename: "tables.xlsx", ingestion: "aggregated", processingStatus: "ready" })).toBe("aggregated");
    expect(crosstabDatasetState({ filename: "cases.json", ingestion: "raw", processingStatus: "ready" })).toBe("unsupported");
    expect(crosstabDatasetState({ filename: "survey.sav", ingestion: "raw", processingStatus: "failed", setupAccepted: true })).toBe("failed");
  });
});

describe("the file Cross tabs opens first", () => {
  const files = [
    { id: "agg", state: "aggregated" as const },
    { id: "a", state: "ready" as const },
    { id: "b", state: "ready" as const },
  ];
  it("opens the one used last while it is still listed", () => {
    expect(initialCrosstabDataset(files, "b")).toBe("b");
  });
  it("otherwise opens the first file the workspace can open, then the first file, then none", () => {
    expect(initialCrosstabDataset(files, "deleted")).toBe("a");
    expect(initialCrosstabDataset([{ id: "agg", state: "aggregated" }], null)).toBe("agg");
    expect(initialCrosstabDataset([], "a")).toBeNull();
  });
});
