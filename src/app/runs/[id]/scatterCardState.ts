// Ordering for a scatter card's posted and wording state (Codex/Grant, 2026-10-21: a wording review
// resolved on a restored scatter card came back after the card was rebuilt).
//
// A scatter card's state (posted, current, wording review) comes from the server. Several things
// can read it for the same request at once: building the card, a restore on reopening, and the
// read after the researcher posts, takes back or resolves the wording. A read that started before
// one of the researcher's writes may answer after it, with the state from before the write, and a
// rebuilt card replaces the earlier card for the same request. Two rules keep the researcher's
// latest action on screen:
//   1. Per request, only the newest read may publish, and a write makes every read already in
//      flight stale (it starts a new generation), so an answer from before the write is never shown.
//   2. A rebuilt card that replaces an earlier one keeps that card's state when its own read is
//      stale, and keeps the earlier card's in-progress flags, so a write still in flight finishes
//      on the card that is on screen (updates are addressed by request, not by card id).

/** Identifies a scatter request: the same pair and weight is the same correlation and the same finding. */
export const scatterRequestKey = (x: string, y: string, weightVar: string | null) => JSON.stringify([x, y, weightVar]);

/** Per-request generations for status reads; see rule 1 above. */
export class ScatterStatusClock {
  private latest = new Map<string, number>();

  /** Starts a read (or a write): returns its generation; any earlier generation is now stale. */
  begin(key: string): number {
    const next = (this.latest.get(key) ?? 0) + 1;
    this.latest.set(key, next);
    return next;
  }

  /** Whether the read with this generation is still the newest for its request. */
  isLatest(key: string, generation: number): boolean {
    return this.latest.get(key) === generation;
  }

  private writing = new Map<string, number>();

  /**
   * A post, take-back or wording decision starts: reads in flight are stale from now on. The write
   * reads the state again itself once it has finished (endWrite after that read), so nothing else
   * should start a read for the request meanwhile: such a read could begin before the write lands
   * and still be the newest when it answers.
   */
  beginWrite(key: string): void {
    this.begin(key);
    this.writing.set(key, (this.writing.get(key) ?? 0) + 1);
  }

  endWrite(key: string): void {
    const n = (this.writing.get(key) ?? 0) - 1;
    if (n > 0) this.writing.set(key, n);
    else this.writing.delete(key);
  }

  /** Whether a write for the request has started and not yet read its result back. */
  writeInFlight(key: string): boolean {
    return this.writing.has(key);
  }
}

/**
 * After a rebuilt card is placed: whether it needs a read of its own. Not when its read is still
 * the newest, and not while a write is in flight (that write's own read, started after it lands,
 * settles the card on screen).
 */
export function rebuiltCardNeedsRead(clock: ScatterStatusClock, key: string, generation: number): boolean {
  return !clock.isLatest(key, generation) && !clock.writeInFlight(key);
}

/** The fields of a scatter card that come from the server's record of its finding. */
export type ScatterStatusFields<R> = {
  committed: boolean;
  current: boolean | null;
  wordingReview: R | null;
  statusFailed: boolean;
};

/** The fields that say an action on the card is still in flight. */
export type ScatterBusyFields = { commitBusy: boolean; wordingBusy: boolean; wordingError: string | null };

type Keyed = { xVar: string; yVar: string; weightVar: string | null };

/**
 * Puts a newly built (or rebuilt) card in the list, replacing any card for the same request.
 * `statusIsLatest` is whether the new card's own status read is still the newest; when it is not,
 * the replaced card's status is newer and is kept. In-progress flags always carry over.
 * `where` says whether the new card goes first (built now) or last (restored, in its place by seq).
 */
export function placeScatterCard<R, C extends Keyed & ScatterStatusFields<R> & ScatterBusyFields>(
  prev: C[],
  built: C,
  statusIsLatest: boolean,
): C[] {
  const key = scatterRequestKey(built.xVar, built.yVar, built.weightVar);
  const earlier = prev.find((c) => scatterRequestKey(c.xVar, c.yVar, c.weightVar) === key);
  let card = built;
  if (earlier) {
    card = { ...card, commitBusy: earlier.commitBusy, wordingBusy: earlier.wordingBusy, wordingError: earlier.wordingError };
    if (!statusIsLatest) {
      card = { ...card, committed: earlier.committed, current: earlier.current, wordingReview: earlier.wordingReview, statusFailed: earlier.statusFailed };
    }
  }
  return [...prev.filter((c) => c !== earlier), card];
}
