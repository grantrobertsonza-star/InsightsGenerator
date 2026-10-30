"use client";

/**
 * A save confirmation that survives the remount a successful save causes, without ever confirming a
 * save that has not succeeded (R2P-F01).
 *
 * Why it is needed: a successful server action revalidates the page, which can remount the panel
 * that started it before that panel's own `await` returns, so a confirmation set by the starting
 * instance is lost. The earlier fix wrote "Saved" to session storage before the save and showed it on
 * the next mount, which confirmed a save that was still pending, or one later refused, or one the
 * browser abandoned on a reload.
 *
 * The record now carries the request's own token and the page load it belongs to, and moves from
 * pending to succeeded or failed only when the starting call settles. The settling call runs in the
 * starting instance's closure even after it unmounts, so it writes the outcome and tells any mounted
 * instance of the same key (an event on window). A pending record from an earlier page load means the
 * browser reloaded before the reply: the outcome is unknown, and it is shown as unknown, never as saved.
 */

/** One per page load: tells a request still in flight in this page from one a reload abandoned. */
const PAGE_LOAD = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const EVENT = "remount-confirmation";

export type ConfirmationRecord<T> =
  | { status: "pending"; token: string; page: string; restore: T }
  | { status: "succeeded"; token: string; page: string; message: string; at: number }
  | { status: "failed"; token: string; page: string; error: string; restore: T };

/** What a newly mounted instance should show for this key. */
export type MountState<T> =
  | { kind: "none" }
  /** A request from this page load is still in flight: wait for its outcome (subscribe). */
  | { kind: "waiting"; token: string }
  | { kind: "succeeded"; message: string }
  | { kind: "failed"; error: string; restore: T }
  /** The page reloaded before the reply: the outcome is unknown. */
  | { kind: "unknown"; restore: T };

function read<T>(key: string): ConfirmationRecord<T> | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as ConfirmationRecord<T>) : null;
  } catch {
    return null;
  }
}

function write<T>(key: string, record: ConfirmationRecord<T> | null) {
  try {
    if (record) window.sessionStorage.setItem(key, JSON.stringify(record));
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the starting instance still shows its own outcome while mounted */
  }
}

/** Starts a request: records it as pending, with what to restore if it fails. Returns its token. */
export function beginConfirmation<T>(key: string, restore: T): string {
  const token = `${PAGE_LOAD}:${Math.random().toString(36).slice(2)}`;
  write<T>(key, { status: "pending", token, page: PAGE_LOAD, restore });
  return token;
}

/**
 * Records a request's outcome, if it is still the latest for this key (a later request owns the
 * record otherwise), and tells mounted instances. Returns false when a later request had replaced it.
 */
export function settleConfirmation<T>(key: string, token: string, outcome: { ok: true; message: string } | { ok: false; error: string }): boolean {
  const current = read<T>(key);
  if (!current || current.token !== token || current.status !== "pending") return false;
  const record: ConfirmationRecord<T> = outcome.ok
    ? { status: "succeeded", token, page: PAGE_LOAD, message: outcome.message, at: Date.now() }
    : { status: "failed", token, page: PAGE_LOAD, error: outcome.error, restore: current.restore };
  write(key, record);
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { key, token } }));
  } catch {
    /* no window */
  }
  return true;
}

/**
 * How long a success is offered to the next mount. A success is always recorded, because the remount
 * it causes may come after the starting instance has shown it (and that instance cannot tell); a
 * success is only worth showing to the mount that follows it, not on a visit minutes later.
 */
const SUCCESS_SHOWN_FOR_MS = 15_000;

/** Reads the record on mount. A settled outcome is taken (removed) so it is shown once. */
export function takeMountState<T>(key: string): MountState<T> {
  const r = read<T>(key);
  if (!r) return { kind: "none" };
  if (r.status === "pending") {
    if (r.page === PAGE_LOAD) return { kind: "waiting", token: r.token };
    write(key, null);
    return { kind: "unknown", restore: r.restore };
  }
  write(key, null);
  if (r.status === "succeeded") return Date.now() - r.at <= SUCCESS_SHOWN_FOR_MS ? { kind: "succeeded", message: r.message } : { kind: "none" };
  return { kind: "failed", error: r.error, restore: r.restore };
}

/** Calls back once the request with this token settles (for a mounted instance waiting on one). */
export function onConfirmationSettled(key: string, token: string, callback: () => void): () => void {
  const listener = (event: Event) => {
    const d = (event as CustomEvent<{ key: string; token: string }>).detail;
    if (d && d.key === key && d.token === token) callback();
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** Drops the record, for the instance that is still mounted and shows the outcome itself. */
export function clearConfirmation(key: string, token: string) {
  const r = read(key);
  if (r && r.token === token) write(key, null);
}
