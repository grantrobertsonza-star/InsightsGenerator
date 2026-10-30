import { describe, expect, it } from "vitest";
import { crosstabStageStatus, importStageStatus, objectiveStageStatus, stageStateOf, type ImportFileFacts, type ObjectiveStageInput } from "../stageStatus";

const file = (over: Partial<ImportFileFacts> = {}): ImportFileFacts => ({
  documentId: "d1",
  filename: "survey.sav",
  kind: "table",
  processing: "read",
  acceptance: "accepted",
  previewUnverified: false,
  readError: null,
  flaggedChecks: 0,
  linksToCheck: 0,
  ...over,
});

describe("stageStateOf", () => {
  it("is Ready only with no issues, and takes the worst state otherwise", () => {
    expect(stageStateOf([])).toBe("ready");
    const it = (state: "needs_you" | "working" | "couldnt_check") => ({ key: state, state, text: "", target: { kind: "none" as const } });
    expect(stageStateOf([it("working"), it("needs_you")])).toBe("needs_you");
    expect(stageStateOf([it("needs_you"), it("couldnt_check")])).toBe("couldnt_check");
  });
});

describe("importStageStatus", () => {
  it("sends a transcript with incomplete coding to Coding, and another partly read file to its preview", () => {
    const s = importStageStatus({
      tablesReadFailed: false,
      files: [
        file({ documentId: "t1", filename: "groups.docx", kind: "transcript", processing: "partly_read" }),
        file({ documentId: "r1", filename: "report.pdf", kind: "report", processing: "partly_read", acceptance: "none" }),
      ],
    });
    expect(s.state).toBe("needs_you");
    expect(s.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "needs_you", text: "Coding of groups.docx is incomplete: run Code themes again for it", target: { kind: "section", id: "coding" } }),
      expect.objectContaining({ state: "needs_you", text: "report.pdf was only partly read", target: { kind: "import_file", documentId: "r1", tab: "preview" } }),
    ]));
  });

  it("says all ready with plain counts when every file is read and accepted", () => {
    const s = importStageStatus({ tablesReadFailed: false, files: [file(), file({ documentId: "d2", filename: "brief.pdf", kind: "evidence", processing: "not_read", acceptance: "none" })] });
    expect(s.state).toBe("ready");
    expect(s.headline).toBe("2 files imported, all ready");
    expect(s.issues).toEqual([]);
  });

  it("links each thing that needs the researcher to the file and tab it is about", () => {
    const s = importStageStatus({
      tablesReadFailed: false,
      files: [file({ acceptance: "needs_review" }), file({ documentId: "q1", filename: "questionnaire.docx", kind: "instrument", acceptance: "none", linksToCheck: 3 })],
    });
    expect(s.state).toBe("needs_you");
    expect(s.headline).toBe("2 files need you");
    expect(s.issues.map((i) => i.target)).toEqual([
      { kind: "import_file", documentId: "d1", tab: "setup" },
      { kind: "import_file", documentId: "q1", tab: "links" },
    ]);
  });

  it("never passes an unverified preview, a file with nothing read or unloaded tables as ready", () => {
    expect(importStageStatus({ tablesReadFailed: false, files: [file({ previewUnverified: true })] }).state).toBe("couldnt_check");
    expect(importStageStatus({ tablesReadFailed: false, files: [file({ kind: "transcript", processing: "not_read" })] }).state).toBe("couldnt_check");
    const failedLoad = importStageStatus({ tablesReadFailed: true, files: [file()] });
    expect(failedLoad.state).toBe("couldnt_check");
    expect(failedLoad.headline).toBe("The files could not all be checked");
  });

  it("puts couldn't-check ahead of needs-you, and counts each file once under its worst state", () => {
    const s = importStageStatus({
      tablesReadFailed: false,
      files: [file({ previewUnverified: true, acceptance: "needs_review" }), file({ documentId: "d2", acceptance: "needs_review" }), file({ documentId: "d3" })],
    });
    expect(s.state).toBe("couldnt_check");
    expect(s.issues[0].state).toBe("couldnt_check");
    expect(s.counts.map((c) => c.label)).toEqual(["1 ready", "1 could not be checked", "1 needs you"]);
  });

  it("shows a failed read with its message, a read in progress as working, and flagged checks as a caveat that does not block", () => {
    const failed = importStageStatus({ tablesReadFailed: false, files: [file({ processing: "failed", readError: "The file is password protected." })] });
    expect(failed.issues[0].text).toBe("survey.sav could not be read: The file is password protected");
    expect(importStageStatus({ tablesReadFailed: false, files: [file({ processing: "reading" })] }).state).toBe("working");
    const flagged = importStageStatus({ tablesReadFailed: false, files: [file({ flaggedChecks: 2 })] });
    expect(flagged.state).toBe("ready");
    expect(flagged.caveats).toEqual([{ key: "d1:quality", state: "caveat", text: "2 data quality checks are flagged in survey.sav", target: { kind: "import_file", documentId: "d1", tab: "quality" } }]);
  });

  it("asks for a first file when there are none", () => {
    const s = importStageStatus({ tablesReadFailed: false, files: [] });
    expect(s.state).toBe("needs_you");
    expect(s.headline).toBe("No files yet");
  });
});

const objectives = (over: Partial<ObjectiveStageInput> = {}): ObjectiveStageInput => ({
  objectives: [{ id: "o1", text: "Understand why members lapse", status: "accepted", unscoredReason: null, scoreTier: "strong" }],
  qualityStatusFailed: false,
  scoresUnavailable: false,
  failedFill: null,
  fillRecordFailed: false,
  coverage: [],
  coverageError: null,
  ...over,
});

describe("objectiveStageStatus", () => {
  it("CE-1: out-of-date coverage needs the researcher, and its gaps say they come from that check and point at the objective", () => {
    const s = objectiveStageStatus(
      objectives({ coverage: [{ id: "o1", text: "Understand why members lapse", status: "gap", degraded: false }], coverageStale: "Out of date: the accepted insights changed after this evidence check." }),
    );
    expect(s.state).toBe("needs_you");
    expect(s.issues.map((i) => i.text)).toContain("Out of date: the accepted insights changed after this evidence check.");
    const gap = s.caveats.find((c) => c.key.startsWith("gap:"))!;
    expect(gap.text).toMatch(/\(from an out-of-date check\)$/);
    expect(gap.target).toEqual({ kind: "objective", id: "o1", text: "Understand why members lapse" });
  });

  it("is ready when every objective is accepted and scored", () => {
    const s = objectiveStageStatus(objectives());
    expect(s.state).toBe("ready");
    expect(s.headline).toBe("1 objective set and scored");
  });

  it("links a suggestion waiting for review to that objective, and ignores rejected ones", () => {
    const s = objectiveStageStatus(
      objectives({
        objectives: [
          { id: "o1", text: "A", status: "accepted", unscoredReason: null, scoreTier: "strong" },
          { id: "o2", text: "B", status: "pending", unscoredReason: "Accept this objective to have it scored.", scoreTier: null },
          { id: "o3", text: "C", status: "rejected", unscoredReason: null, scoreTier: null },
        ],
      }),
    );
    expect(s.state).toBe("needs_you");
    expect(s.headline).toBe("1 suggested objective is waiting for you");
    expect(s.issues).toHaveLength(1);
    expect(s.issues[0].target).toEqual({ kind: "objective", id: "o2", text: "B" });
  });

  it("does not call an unscored objective ready, and says when why could not be read", () => {
    const unscored = { id: "o1", text: "A", status: "accepted" as const, unscoredReason: "Scoring failed: timeout. Rescore to try again.", scoreTier: null };
    expect(objectiveStageStatus(objectives({ objectives: [unscored] })).state).toBe("needs_you");
    expect(objectiveStageStatus(objectives({ objectives: [unscored], qualityStatusFailed: true })).state).toBe("couldnt_check");
    expect(objectiveStageStatus(objectives({ scoresUnavailable: true, objectives: [unscored] })).state).toBe("couldnt_check");
  });

  it("keeps weak scores, evidence gaps and a degraded check visible as caveats without blocking", () => {
    const s = objectiveStageStatus(
      objectives({
        objectives: [{ id: "o1", text: "A", status: "accepted", unscoredReason: null, scoreTier: "weak" }],
        coverage: [{ text: "A", status: "gap", degraded: true }],
      }),
    );
    expect(s.state).toBe("ready");
    expect(s.caveats.map((c) => c.key)).toEqual(["o1:weak", "gap:A", "degraded"]);
  });

  it("asks for objectives when there are none, a failed fill as needs-you, and an unread fill record or failed evidence check as couldn't check", () => {
    expect(objectiveStageStatus(objectives({ objectives: [] })).headline).toBe("No objectives yet");
    expect(objectiveStageStatus(objectives({ failedFill: { documents: "the brief b.pdf", reason: "No text could be read." } })).issues[0].text).toBe(
      "Filling in from the brief b.pdf did not work: No text could be read",
    );
    expect(objectiveStageStatus(objectives({ fillRecordFailed: true })).state).toBe("couldnt_check");
    expect(objectiveStageStatus(objectives({ coverageError: "Model unavailable" })).state).toBe("couldnt_check");
  });
});

describe("crosstabStageStatus", () => {
  const ready = { id: "f1", filename: "survey.sav", state: "ready" as const, draftTables: 0, committedTables: 2 };

  it("is ready with committed tables and no drafts", () => {
    const s = crosstabStageStatus({ tablesReadFailed: false, files: [ready] });
    expect(s.state).toBe("ready");
    expect(s.headline).toBe("2 tables committed on 1 data file");
  });

  it("asks for drafts to be committed, setups to be accepted, and a first table to be built", () => {
    const s = crosstabStageStatus({
      tablesReadFailed: false,
      files: [{ ...ready, draftTables: 1 }, { id: "f2", filename: "w2.sav", state: "needs_setup", draftTables: 0, committedTables: 0 }],
    });
    expect(s.state).toBe("needs_you");
    expect(s.issues.map((i) => i.target)).toEqual([
      { kind: "data_file", documentId: "f1" },
      { kind: "import_file", documentId: "f2", tab: "setup" },
    ]);
    const none = crosstabStageStatus({ tablesReadFailed: false, files: [{ ...ready, committedTables: 0 }] });
    expect(none.headline).toBe("No tables committed yet");
    expect(none.issues[0].target).toEqual({ kind: "data_file", documentId: "f1" });
  });

  it("says the tables could not be checked when they failed to load, instead of counting none", () => {
    const s = crosstabStageStatus({ tablesReadFailed: true, files: [{ ...ready, committedTables: 0 }] });
    expect(s.state).toBe("couldnt_check");
    expect(s.issues.map((i) => i.key)).toEqual(["tables-read-failed"]);
  });

  it("names aggregated-only projects and empty projects plainly", () => {
    expect(crosstabStageStatus({ tablesReadFailed: false, files: [{ ...ready, state: "aggregated" }] }).issues[0].text).toMatch(/Only aggregated tables/);
    expect(crosstabStageStatus({ tablesReadFailed: false, files: [] }).headline).toBe("No data file to open");
  });
});
