/**
 * Whether a chart or NPS result is already in findings (UI-GT1000-01, Codex 2026-10-21).
 *
 * The posted-state read can fail (a dropped connection, a permission or database error). A failed
 * read is "not known", never "not posted": the card shows the error with Retry and offers neither
 * Post nor Remove until a read succeeds, so a researcher is never invited to post something that
 * may already be posted. The driver and scatter cards keep the same distinction in their own state.
 */
export type PostedState = {
  committed: boolean;
  statusError: string | null;
  /**
   * The read has not answered yet (UI-R1000-01): the result's figures can be shown, but whether it
   * is posted is not known, so neither Post nor Remove is offered, only "Checking".
   */
  pending?: boolean;
};

/** A result whose posted-state read is still running. */
export const PENDING_POSTED_STATE: PostedState = { committed: false, statusError: null, pending: true };

/** What the card offers: a note while checking, the error with Retry, or the one known action. */
export function postedControl(s: PostedState): "checking" | "unknown" | "remove" | "post" {
  if (s.pending) return "checking";
  if (s.statusError !== null) return "unknown";
  return s.committed ? "remove" : "post";
}

export function postedStateFrom(status: { ok: true; committed: boolean } | { ok: false; error: string }): PostedState {
  return status.ok ? { committed: status.committed, statusError: null } : { committed: false, statusError: status.error || "The check could not be completed." };
}

/** Post and Remove are offered only while the posted state is known. */
export const canPostOrRemove = (s: PostedState) => {
  const c = postedControl(s);
  return c === "post" || c === "remove";
};
