// The Import source list's status rules (importSources.ts): processing and acceptance kept apart,
// a stored failure outranking an older preview, and the state filters not hiding one another.
import { describe, expect, it } from "vitest";
import { fileTag, flaggedChecks, matchesSearch, matchesStateFilter, processingState, sourceTypeLabel } from "../importSources";

describe("processing state", () => {
  it("reads a stored failure or partial read before anything previewed", () => {
    expect(processingState({ kind: "table", processingStatus: "failed", preview: { kind: "tables", count: 3 } })).toBe("failed");
    expect(processingState({ kind: "report", processingStatus: "incomplete", preview: { kind: "text", length: 900 } })).toBe("partly_read");
  });
  it("a data file with no tables yet is still being read; with tables it is read", () => {
    expect(processingState({ kind: "table", processingStatus: null, preview: { kind: "tables", count: 0 } })).toBe("reading");
    expect(processingState({ kind: "table", processingStatus: null, preview: { kind: "tables", count: 1 } })).toBe("read");
  });
  it("text that came back empty is a failed read, except a context file not read yet", () => {
    expect(processingState({ kind: "report", processingStatus: null, preview: { kind: "text", length: 0 } })).toBe("failed");
    expect(processingState({ kind: "evidence", processingStatus: null, preview: { kind: "text", length: 0 } })).toBe("not_read");
  });
  it("questionnaires by whether their questions were read; output sets as read", () => {
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: false })).toBe("not_read");
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: true })).toBe("read");
    expect(processingState({ kind: "output", processingStatus: null, preview: null })).toBe("read");
  });
});

describe("state filters", () => {
  const s = (processing: string, acceptance: string, previewUnverified = false) => ({ processing, acceptance, previewUnverified }) as Parameters<typeof matchesStateFilter>[1];
  it("keeps attention (read problems) and review (setup to accept) apart", () => {
    expect(matchesStateFilter("attention", s("failed", "none"))).toBe(true);
    expect(matchesStateFilter("attention", s("read", "accepted", true))).toBe(true);
    expect(matchesStateFilter("attention", s("read", "needs_review"))).toBe(false);
    expect(matchesStateFilter("review", s("read", "needs_review"))).toBe(true);
  });
  it("accepted, processing and failed match their own state only", () => {
    expect(matchesStateFilter("accepted", s("read", "accepted"))).toBe(true);
    expect(matchesStateFilter("accepted", s("read", "none"))).toBe(false);
    expect(matchesStateFilter("processing", s("reading", "accepted"))).toBe(true);
    expect(matchesStateFilter("failed", s("partly_read", "none"))).toBe(false);
    expect(matchesStateFilter("all", s("failed", "none"))).toBe(true);
  });
});

describe("search and tags", () => {
  it("search matches the name or the wave, ignoring case and outer spaces", () => {
    expect(matchesSearch(" baseline ", { filename: "survey.xlsx", wave: "Baseline" })).toBe(true);
    expect(matchesSearch("SURV", { filename: "survey.xlsx", wave: null })).toBe(true);
    expect(matchesSearch("wave 2", { filename: "survey.xlsx", wave: "Wave 1" })).toBe(false);
    expect(matchesSearch("", { filename: "x", wave: null })).toBe(true);
  });
  it("tags a file by extension, an output set as SET", () => {
    expect(fileTag("Consumer survey.xlsx", "table")).toBe("XLSX");
    expect(fileTag("models.zip", "output")).toBe("SET");
    expect(fileTag("README", "evidence")).toBe("FILE");
    expect(fileTag("deck.pptx", "report")).toBe("PPTX");
  });
});

describe("type labels", () => {
  it("names a stored table by how it was read, and briefs and proposals together", () => {
    expect(sourceTypeLabel("table", "raw")).toBe("Raw data");
    expect(sourceTypeLabel("table", "aggregated")).toBe("Aggregated tables");
    expect(sourceTypeLabel("evidence", null)).toBe("Brief or proposal");
    expect(sourceTypeLabel("transcript", null)).toBe("Qualitative data");
    expect(sourceTypeLabel("something-new", null)).toBe("something-new");
  });
});

describe("briefs and proposals by their recorded role", () => {
  it("names a context file by its role, both when it has both, and neither when none is recorded", () => {
    expect(sourceTypeLabel("evidence", null, ["brief"])).toBe("Brief");
    expect(sourceTypeLabel("evidence", null, ["proposal"])).toBe("Proposal");
    expect(sourceTypeLabel("evidence", null, ["brief", "proposal"])).toBe("Brief and proposal");
    expect(sourceTypeLabel("evidence", null, [])).toBe("Brief or proposal");
    // Roles that could not be read are not guessed.
    expect(sourceTypeLabel("evidence", null, undefined)).toBe("Brief or proposal");
  });
});

describe("flagged checks", () => {
  it("counts Check and Problem flags, not passes", () => {
    expect(flaggedChecks([{ status: "pass" }, { status: "warn" }, { status: "fail" }, { status: "warn" }])).toBe(3);
    expect(flaggedChecks([])).toBe(0);
  });
});
