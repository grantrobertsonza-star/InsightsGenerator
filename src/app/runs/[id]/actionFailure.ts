/**
 * Runs a server action from a client control and turns a failure into text the control can show.
 *
 * A server action that throws inside a transition otherwise escapes to the route's error boundary:
 * the whole project page is replaced and any open draft (edited wording, an objective being
 * added) is lost. Catching it here lets the control keep the draft and say what happened.
 *
 * Production builds withhold a thrown server-action message and attach a `digest` instead, so that
 * case gets a generic sentence; the digest is included so it can be matched to the server log.
 * Actions that need their own wording to reach the researcher should return a result instead
 * (see saveStatedObjectiveEdit in runContextActions.ts).
 */
export function actionFailureMessage(error: unknown): string {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  if (digest) return `The server could not complete this (reference ${digest}). Try again; if it keeps failing, reload the page to see what was saved.`;
  if (error instanceof Error && error.message) return error.message;
  return "The server could not complete this. Try again.";
}

/** Awaits `run` and returns null on success, or the failure text. Never throws. */
export async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return actionFailureMessage(error);
  }
}
