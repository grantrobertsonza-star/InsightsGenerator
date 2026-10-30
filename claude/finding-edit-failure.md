# Findings edits: saved, refused or failed

Codex TR500-F02, TR500-F03 and TR500-M01 (2026-10-23). Covers status (single and bulk), kind, theme
and note on the Findings page. Wording edits keep their own contract (`finding-wording-edit-contract`
in the project docs; `findingWording.ts`).

## Server contract (`src/lib/findingActions.ts`)

Each setter returns `{ ok: true }` only when the change was written, with its provenance, in the
same transaction; otherwise `{ ok: false, error }`, and nothing is written.

- **Inputs** are checked before any write: a status outside accepted, rejected and pending; a kind
  outside the seven kinds; a theme or note that is not text; an id that is not text. Null is not
  accepted for any of them.
- **Clearing**: a blank theme or note (after trimming) clears it, stored as null and recorded as an
  edit. A kind, once set, cannot be cleared here (the page offers only the kinds).
- **A finding that is gone** (never in the project, deleted, replaced when its file was read again,
  or in another project) is refused: "This finding is no longer in this project ... Nothing was
  saved. Reload the page to see the current findings." The update's returned rows decide this, under
  the tenant's row-level security and the `run_id` scope.
- **Bulk status** is all or nothing. Duplicate ids count once. If fewer rows are updated than ids
  requested, the transaction is rolled back and the reply says how many of how many are gone. An
  empty batch is a no-op.
- **A database failure** throws, with nothing saved.

## Page contract (`src/app/runs/[id]/FindingsTable.tsx`)

Every control runs its action through `attemptResult` (`actionFailure.ts`), so neither a refusal
nor a thrown failure (server, connection) reaches the project's error boundary; the view stays.

- **Note**: the editor closes only after the save succeeds. While saving it is disabled with the
  draft shown and the button reads "Saving...". On refusal or failure the draft stays, the reason
  shows beside it ("Your note is still here."), and Save retries with the same draft.
- **Status**: the buttons change at once (optimistic) and go back to what they showed before the
  click if the save is refused or fails, with the reason beside them. A shared per-finding request
  counter means an earlier reply never undoes a newer click on the same finding.
- **Bulk status** ("Accept all", "Reject all", "Accept all in theme"): on refusal or failure every
  finding it changed on screen goes back (unless clicked again since) and a banner above the list
  says the bulk change was not saved, with the reason.
- **Kind and theme**: the selects keep showing the saved value, with the reason beside them; a new
  theme's form stays open with the typed name.

## Tests

- `findingEditContract.db.test.ts` (real database, actual actions): saves; never-existing, deleted
  and other-project findings refused with nothing written, then recovery; bulk all-or-nothing with a
  gone or foreign finding, duplicates and an empty batch; malformed status, kind, theme and note
  (arrays, objects, null, unknown values) refused; blank clears; a database failure (a trigger
  refusing the update) throws with nothing saved and the same call saves once it clears.
- `e2e/ui/findings-edit-failure.check.mjs` (real browser, disposable stack): a refused note save
  keeps the draft and the view and the same draft saves on retry; a delayed save keeps the editor
  disabled with the draft until it settles; a note for a finding deleted after the page opened is
  refused as gone with the draft kept; a refused status change reverts with its reason and then
  saves; a bulk change naming a deleted finding changes none, says so, and saves after a reload.
