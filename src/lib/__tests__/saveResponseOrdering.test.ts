// Permanent regression test for the Codex re-review's package 4 repair: "add same-document
// save-response ordering protection. Earlier responses must not overwrite newer state." Exercises
// the actual shouldApplySaveResponse/markSaveResponseApplied functions CrosstabWorkspace.tsx's
// save effect calls - not a reimplementation of the decision.
import { describe, expect, it } from "vitest";
import { shouldApplySaveResponse, markSaveResponseApplied } from "../saveResponseOrdering";

describe("same-document save-response ordering (Codex re-review, package 4)", () => {
  it("a later response applies, then an earlier (out-of-order, same document) response is rejected", () => {
    const applied = new Map<string, number>();
    // Request 1 (seq 1) and request 2 (seq 2) are both in flight for the same document; the
    // network reorders them so request 2's response arrives first.
    expect(shouldApplySaveResponse(applied, "doc-1", 2)).toBe(true);
    markSaveResponseApplied(applied, "doc-1", 2);

    // Request 1's response now arrives, late. It must NOT be applied - that would silently
    // revert state request 2's response already set.
    expect(shouldApplySaveResponse(applied, "doc-1", 1)).toBe(false);
  });

  it("responses applied in order all succeed", () => {
    const applied = new Map<string, number>();
    expect(shouldApplySaveResponse(applied, "doc-1", 1)).toBe(true);
    markSaveResponseApplied(applied, "doc-1", 1);
    expect(shouldApplySaveResponse(applied, "doc-1", 2)).toBe(true);
    markSaveResponseApplied(applied, "doc-1", 2);
    expect(shouldApplySaveResponse(applied, "doc-1", 3)).toBe(true);
  });

  it("a duplicate response for the same sequence number is rejected (already applied, not strictly newer)", () => {
    const applied = new Map<string, number>();
    markSaveResponseApplied(applied, "doc-1", 5);
    expect(shouldApplySaveResponse(applied, "doc-1", 5)).toBe(false);
  });

  it("ordering is tracked independently per document - a stale response for doc A never blocks a fresh one for doc B", () => {
    const applied = new Map<string, number>();
    markSaveResponseApplied(applied, "doc-A", 10);
    expect(shouldApplySaveResponse(applied, "doc-B", 1)).toBe(true);
  });
});
