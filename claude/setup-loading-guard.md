# Setup controls before hydration

A visible server-rendered layout select could change before React attached its save handler.
The displayed choice then differed from the saved layout without an error. Held-script native
verification reproduced that mismatch; the parked guard was inspected before integration.

The shared useHydrated hook returns false for the server/hydration snapshot and true after
handlers attach. Data and transcript setup controls stay disabled with a loading explanation
until ready. This does not change saved layout, compare-and-swap, visit identity or scoring rules.
The native held-script check verifies disabled/loading state, enabling and save/reload recovery.
Transcript setup uses the same hook; its server-rendered guard must also remain covered.

The earlier parked test had an unsafe route-release/unroute race; the retained test waits for
held route handlers when releasing them. No claim is made that this explains every old failure.

## One file's edits in quick succession (R3e1, 30 October 2026)

Codex's E1R browser receipt: Wave 2 persisted with `waveDate: null` and `waveIncluded: true` while the screen showed
June 2026 and the box unticked. Reproduced on the disposable stack by logging every Setup save request: the form sent
the month and the inclusion while the wave label's save was still on its way, each expecting the label's unconfirmed
value. The form's own view was also behind what was saved (its first-view acceptance had met an acceptance from
another page view, and the form kept its defaults), so the label's save had to be re-applied; the later saves then
conflicted, re-applied themselves on a version read before the label landed, conflicted again and were dropped.

Contract now:
- `dataSetupRebase.createSetupEditQueue` sends one file's edits one at a time. Each edit is the fields that differ
  between the view it was made on and the new value, applied by `rebaseSetupEdit` to what the previous edit actually
  saved, then sent through `saveSetupEdit` as a compare-and-swap, so a change in another tab is still merged or
  reported as a conflict, and an acceptance given to a structure that is no longer saved is still refused (E1-F02).
- A save that throws (a lost response) is a failed edit, never "saved"; the queue goes on with the next edit.
- Only the latest edit's answer sets what the form shows; an earlier answer never replaces a newer edit on screen.
- A first-view acceptance that conflicts adopts the stored set-up it is given, so later edits start from it.
- The form shows "Saving your change..." (`data-testid="setup-save-status"`, `data-saving`) while any edit is
  unanswered, and a save error as an alert (`setup-save-error`).

Limit: leaving or reloading the page while an edit is still being saved can still lose that edit; the form shows it
is saving but does not block navigation.
