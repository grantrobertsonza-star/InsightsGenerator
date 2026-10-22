// UI-GT1000-01 (Codex, 2026-10-21): a chart or NPS card whose posted-state read failed is "not
// known", never "not posted", and offers neither Post nor Remove until a read succeeds.
import { describe, expect, it } from "vitest";
import { canPostOrRemove, postedStateFrom } from "../../app/runs/[id]/postedState";

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
