// The ordering rules for a scatter card's posted and wording state (scatterCardState.ts), with the
// interleaving the browser check scatter-wording-review hit on 2026-10-21: a remembered scatter is
// restored, the researcher builds the same scatter again and resolves the wording review on the
// restored card while the rebuild's status read is still in flight. The researcher's decision must
// stay on screen whichever answer lands last. Pure functions, so every order is driven here directly.
import { describe, expect, it } from "vitest";
import { placeScatterCard, rebuiltCardNeedsRead, ScatterStatusClock, scatterRequestKey } from "../../app/runs/[id]/scatterCardState";

type Review = { suggested_text: string };
type Card = {
  id: string;
  xVar: string;
  yVar: string;
  weightVar: string | null;
  committed: boolean;
  current: boolean | null;
  wordingReview: Review | null;
  statusFailed: boolean;
  commitBusy: boolean;
  wordingBusy: boolean;
  wordingError: string | null;
};

const review: Review = { suggested_text: "Ease goes with trust (r = 0.93)." };
const card = (id: string, p: Partial<Card> = {}): Card => ({
  id,
  xVar: "EASE",
  yVar: "TRUST",
  weightVar: null,
  committed: true,
  current: true,
  wordingReview: null,
  statusFailed: false,
  commitBusy: false,
  wordingBusy: false,
  wordingError: null,
  ...p,
});
const key = scatterRequestKey("EASE", "TRUST", null);

describe("scatter card ordering", () => {
  it("a read started before a wording decision can never publish after it", () => {
    const clock = new ScatterStatusClock();
    const rebuildRead = clock.begin(key); // the rebuild reads the state, still showing the review
    clock.beginWrite(key); // the researcher resolves the review on the restored card
    expect(clock.isLatest(key, rebuildRead)).toBe(false);
    const afterWrite = clock.begin(key); // the decision reads the state back once written
    clock.endWrite(key);
    expect(clock.isLatest(key, afterWrite)).toBe(true);
  });

  it("a stale rebuild keeps the state of the card it replaces, and its in-progress flags", () => {
    const resolved = card("restored", { wordingReview: null, wordingBusy: true });
    const rebuiltWithOldRead = card("rebuilt", { wordingReview: review });
    const next = placeScatterCard([resolved], rebuiltWithOldRead, false);
    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("rebuilt");
    expect(next[0].wordingReview).toBeNull();
    expect(next[0].wordingBusy).toBe(true); // the decision in flight finishes on the card on screen
  });

  it("a rebuild whose read is still the newest shows its own state", () => {
    const earlier = card("restored", { wordingReview: review });
    const rebuilt = card("rebuilt", { wordingReview: null, committed: false });
    const [only] = placeScatterCard([earlier], rebuilt, true);
    expect(only).toMatchObject({ id: "rebuilt", wordingReview: null, committed: false });
  });

  it("other requests are left alone", () => {
    const other = card("other", { xVar: "TRUST", yVar: "EASE" });
    const next = placeScatterCard([other], card("new"), true);
    expect(next.map((c) => c.id)).toEqual(["other", "new"]);
  });

  it("asks for a fresh read only when the rebuild is stale and no decision is still in flight", () => {
    const clock = new ScatterStatusClock();
    const g = clock.begin(key);
    expect(rebuiltCardNeedsRead(clock, key, g)).toBe(false); // newest: its own read stands
    clock.beginWrite(key);
    // A read started now could begin before the write lands and still be newest when it answers,
    // so the decision's own read-back settles the card instead.
    expect(rebuiltCardNeedsRead(clock, key, g)).toBe(false);
    clock.endWrite(key);
    expect(rebuiltCardNeedsRead(clock, key, g)).toBe(true); // stale, nothing pending: read again
  });

  it("the full interleaving ends on the researcher's decision in every order the answers can land", () => {
    // Restored card R shows the review; a rebuild B starts its read; the researcher resolves on R.
    for (const order of ["rebuild-first", "decision-first"] as const) {
      const clock = new ScatterStatusClock();
      let cards: Card[] = [card("R", { wordingReview: review })];
      const patch = (p: Partial<Card>) => (cards = cards.map((c) => (scatterRequestKey(c.xVar, c.yVar, c.weightVar) === key ? { ...c, ...p } : c)));
      const rebuildGen = clock.begin(key);
      clock.beginWrite(key);
      patch({ wordingBusy: true });
      const placeRebuild = () => {
        const latest = clock.isLatest(key, rebuildGen);
        cards = placeScatterCard(cards, card("B", { wordingReview: review }), latest); // B read before the write
        if (latest) throw new Error("the rebuild's read should be stale here");
      };
      if (order === "rebuild-first") placeRebuild();
      const readBack = clock.begin(key);
      if (clock.isLatest(key, readBack)) patch({ wordingReview: null }); // the write's read-back
      patch({ wordingBusy: false });
      clock.endWrite(key);
      if (order === "decision-first") placeRebuild();
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ id: "B", wordingReview: null, wordingBusy: false });
    }
  });
});
