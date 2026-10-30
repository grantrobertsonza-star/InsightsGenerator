// The Import source list's status rules (importSources.ts): processing and acceptance kept apart,
// a stored failure outranking an older preview, and the state filters not hiding one another.
import { describe, expect, it } from "vitest";
import { fileTag, flaggedChecks, matchesSearch, matchesStateFilter, matchesTypeFilter, processingLabel, processingState, sortSources, sourceGroup, sourceTypeLabel } from "../importSources";

describe("processing state", () => {
  it("calls a transcript's partial state Coding incomplete, and every other file's Partly read", () => {
    const state = processingState({ kind: "transcript", processingStatus: "incomplete", preview: { kind: "text", length: 41621 } });
    expect(state).toBe("partly_read");
    expect(processingLabel(state, "transcript")).toBe("Coding incomplete");
    for (const kind of ["report", "instrument", "table", "evidence"]) expect(processingLabel(state, kind)).toBe("Partly read");
    expect(processingLabel("read", "transcript")).toBe("Read");
    expect(processingLabel("failed", "transcript")).toBe("Read failed");
  });
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
  it("indicator data by its published read, never by text it does not have (Codex NEW10K-F03)", () => {
    // Published: the read sets "ready"; its text preview is empty and must not count as a failure.
    expect(processingState({ kind: "indicator", processingStatus: "ready", preview: { kind: "text", length: 0 } })).toBe("read");
    expect(processingState({ kind: "indicator", processingStatus: "ready", preview: null })).toBe("read");
    // A first read the reader refused stays "Read failed"; one never read is not read yet.
    expect(processingState({ kind: "indicator", processingStatus: "failed", preview: { kind: "text", length: 0 } })).toBe("failed");
    expect(processingState({ kind: "indicator", processingStatus: null, preview: { kind: "text", length: 0 } })).toBe("not_read");
    // The report rule is unchanged: a report with no text is a failed read.
    expect(processingState({ kind: "report", processingStatus: "ready", preview: { kind: "text", length: 0 } })).toBe("failed");
  });
  it("questionnaires by whether their questions were read; output sets as read", () => {
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: false })).toBe("not_read");
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: true })).toBe("read");
    // 27 October 2026: a read that failed showed "Not read yet" beside its own failure message.
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: false, instrumentReadFailed: true })).toBe("failed");
    // A failure recorded before items that are still there (a reread failed): the stored read stands.
    expect(processingState({ kind: "instrument", processingStatus: null, preview: null, instrumentRead: true, instrumentReadFailed: true })).toBe("read");
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

describe("questionnaires and guides by their type", () => {
  it("names each by the type it was added as, and keeps the joint name when none is recorded", () => {
    expect(sourceTypeLabel("instrument", null, undefined, "questionnaire")).toBe("Questionnaire");
    expect(sourceTypeLabel("instrument", null, undefined, "interview_guide")).toBe("Interview guide");
    expect(sourceTypeLabel("instrument", null, undefined, "focus_group_guide")).toBe("Focus group guide");
    expect(sourceTypeLabel("instrument", null, undefined, null)).toBe("Questionnaire or guide");
  });
});

describe("type groups", () => {
  it("puts data, tables, output and questionnaires in quant; transcripts and guides in qual; the rest in neither", () => {
    expect(["table", "output"].map((k) => sourceGroup(k))).toEqual(["quant", "quant"]);
    expect(sourceGroup("instrument", "questionnaire")).toBe("quant");
    expect(sourceGroup("transcript")).toBe("qual");
    expect(sourceGroup("instrument", "focus_group_guide")).toBe("qual");
    expect(sourceGroup("instrument", "interview_guide")).toBe("qual");
    expect(sourceGroup("instrument", null)).toBe("context");
    expect(sourceGroup("evidence")).toBe("context");
    expect(sourceGroup("report")).toBe("context");
  });
  it("filters by group or by one type", () => {
    const raw = { kindLabel: "Raw data", group: "quant" as const };
    const guide = { kindLabel: "Focus group guide", group: "qual" as const };
    expect([matchesTypeFilter("group:quant", raw), matchesTypeFilter("group:quant", guide)]).toEqual([true, false]);
    expect([matchesTypeFilter("group:qual", raw), matchesTypeFilter("group:qual", guide)]).toEqual([false, true]);
    expect(matchesTypeFilter("Raw data", raw)).toBe(true);
    expect(matchesTypeFilter("all", guide)).toBe(true);
  });
});

describe("sorting the sources", () => {
  const rows = [
    { filename: "Wave 10.sav", kindLabel: "Raw data", uploadedAt: "2026-10-19T10:00:00Z" },
    { filename: "brief.docx", kindLabel: "Brief", uploadedAt: "2026-10-20T09:00:00Z" },
    { filename: "models", kindLabel: "Statistical output" },
    { filename: "Wave 2.sav", kindLabel: "Raw data", uploadedAt: "2026-10-18T10:00:00Z" },
    { filename: "guide.pdf", kindLabel: "Focus group guide", uploadedAt: "2026-10-20T11:00:00Z" },
  ];
  const names = (order: Parameters<typeof sortSources>[1]) => sortSources(rows, order).map((r) => r.filename);
  it("by date, newest or oldest first, a source with no upload time last either way", () => {
    expect(names("newest")).toEqual(["guide.pdf", "brief.docx", "Wave 10.sav", "Wave 2.sav", "models"]);
    expect(names("oldest")).toEqual(["Wave 2.sav", "Wave 10.sav", "brief.docx", "guide.pdf", "models"]);
  });
  it("by type in the Add files order, newest first within a type", () => {
    expect(names("type")).toEqual(["brief.docx", "Wave 10.sav", "Wave 2.sav", "models", "guide.pdf"]);
  });
  it("by name, numbers in number order and case ignored", () => {
    expect(names("name")).toEqual(["brief.docx", "guide.pdf", "models", "Wave 2.sav", "Wave 10.sav"]);
  });
  it("leaves the list it was given unchanged", () => {
    const before = rows.map((r) => r.filename);
    sortSources(rows, "name");
    expect(rows.map((r) => r.filename)).toEqual(before);
  });
});
