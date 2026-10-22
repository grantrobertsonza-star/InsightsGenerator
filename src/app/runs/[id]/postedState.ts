/**
 * Whether a chart or NPS result is already in findings (UI-GT1000-01, Codex 2026-10-21).
 *
 * The posted-state read can fail (a dropped connection, a permission or database error). A failed
 * read is "not known", never "not posted": the card shows the error with Retry and offers neither
 * Post nor Remove until a read succeeds, so a researcher is never invited to post something that
 * may already be posted. The driver and scatter cards keep the same distinction in their own state.
 */
export type PostedState = { committed: boolean; statusError: string | null };

export function postedStateFrom(status: { ok: true; committed: boolean } | { ok: false; error: string }): PostedState {
  return status.ok ? { committed: status.committed, statusError: null } : { committed: false, statusError: status.error || "The check could not be completed." };
}

/** Post and Remove are offered only while the posted state is known. */
export const canPostOrRemove = (s: PostedState) => s.statusError === null;
