// UI-GT1000-01 (Codex, 2026-10-21): a chart or NPS card whose posted-state read failed is "not
// known", never "not posted", and offers neither Post nor Remove until a read succeeds.
import { describe, expect, it } from "vitest";
import { PENDING_POSTED_STATE, canPostOrRemove, postedControl, postedStateFrom } from "../../app/runs/[id]/postedState";

describe("postedStateFrom", () => {
  it("a successful read that finds the finding is posted and offers Remove", () => {
    const s = postedStateFrom({ ok: true, committed: true });
    expect(s).toEqual({ committed: true, statusError: null });
    expect(canPostOrRemove(s)).toBe(true);
  });

  it("a successful read that finds nothing is genuinely unposted and offers Post", () => {
    const s = postedStateFrom({ ok: true, committed: false });
    expect(s).toEqual({ committed: false, statusError: null });
    expect(canPostOrRemove(s)).toBe(true);
  });

  it("a failed read keeps its error and offers neither Post nor Remove", () => {
    const s = postedStateFrom({ ok: false, error: "permission denied for table findings" });
    expect(s.statusError).toBe("permission denied for table findings");
    expect(canPostOrRemove(s)).toBe(false);
  });

  it("a failed read with no message is still not known", () => {
    const s = postedStateFrom({ ok: false, error: "" });
    expect(s.statusError).not.toBeNull();
    expect(canPostOrRemove(s)).toBe(false);
  });
});

// UI-R1000-01 (Codex, 2026-10-22): a new NPS result was published before its posted-state read
// answered, and offered Post for a result already in findings.
describe("postedControl: loading, known posted, known unposted and failed are distinct", () => {
  it("while the read has not answered, neither Post nor Remove is offered", () => {
    expect(postedControl(PENDING_POSTED_STATE)).toBe("checking");
    expect(canPostOrRemove(PENDING_POSTED_STATE)).toBe(false);
  });

  it("a pending read with an earlier error still shows checking, not Retry or an action", () => {
    expect(postedControl({ ...PENDING_POSTED_STATE, statusError: "earlier failure" })).toBe("checking");
  });

  it("each answer gives exactly one control", () => {
    expect(postedControl(postedStateFrom({ ok: true, committed: true }))).toBe("remove");
    expect(postedControl(postedStateFrom({ ok: true, committed: false }))).toBe("post");
    expect(postedControl(postedStateFrom({ ok: false, error: "x" }))).toBe("unknown");
  });

  it("a delayed healthy read replaces checking with the known control (posted and unposted)", () => {
    for (const committed of [true, false]) {
      let state = PENDING_POSTED_STATE;
      expect(canPostOrRemove(state)).toBe(false);
      state = postedStateFrom({ ok: true, committed });
      expect(postedControl(state)).toBe(committed ? "remove" : "post");
      expect(state.pending).toBeUndefined();
    }
  });
});
