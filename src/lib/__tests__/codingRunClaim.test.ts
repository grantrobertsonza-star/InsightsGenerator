import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginCodingWork,
  claimCodingRun,
  endCodingWork,
  getRunCodingProgress,
  releaseCodingRun,
} from "../codingProgress";

// Codex IR-07 (2026-10-20): a second "Code themes" start for a transcript that is still being coded
// is refused on the server, and the progress endpoint reports the transcript as busy from the start
// of the action, before its first model pass has a bar of its own.
describe("one coding run per transcript", () => {
  afterEach(() => {
    releaseCodingRun("doc-a");
    releaseCodingRun("doc-b");
    endCodingWork("doc-a");
    vi.useRealTimers();
  });

  it("refuses a second claim for the same transcript until the first is released", () => {
    expect(claimCodingRun("run-1", "doc-a")).toBe(true);
    expect(claimCodingRun("run-1", "doc-a")).toBe(false);
    expect(claimCodingRun("run-1", "doc-b")).toBe(true); // another transcript is independent
    releaseCodingRun("doc-a");
    expect(claimCodingRun("run-1", "doc-a")).toBe(true); // retry after the run ends
  });

  it("reports a claimed transcript as busy before its first model pass, then shows the pass itself", () => {
    claimCodingRun("run-1", "doc-a");
    expect(getRunCodingProgress("run-1").map((p) => [p.documentId, p.label])).toEqual([["doc-a", "Preparing coding"]]);
    expect(getRunCodingProgress("run-2")).toEqual([]); // another project's run sees nothing
    beginCodingWork("run-1", "doc-a", "Coding", 4);
    expect(getRunCodingProgress("run-1").map((p) => [p.documentId, p.label])).toEqual([["doc-a", "Coding"]]);
    endCodingWork("doc-a");
    releaseCodingRun("doc-a");
    expect(getRunCodingProgress("run-1")).toEqual([]);
  });

  it("lets an abandoned claim lapse so the transcript can be coded again", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T20:00:00Z"));
    expect(claimCodingRun("run-1", "doc-a")).toBe(true);
    vi.setSystemTime(new Date("2026-10-20T20:31:00Z")); // past the 30-minute staleness bound
    expect(getRunCodingProgress("run-1")).toEqual([]);
    expect(claimCodingRun("run-1", "doc-a")).toBe(true);
  });
});
