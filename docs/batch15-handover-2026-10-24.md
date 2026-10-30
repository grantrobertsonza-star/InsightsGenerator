# Handover: TR500-F01, TR500-F02, TR500-F03 and TR500-M01 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-trust500-review-main-2026-10-23.md` (0 S1, 2 S2, 3 S3 open, RR-M02 included).
Reviewed together with batch14 (RR-M02, `docs/batch14-handover-2026-10-23.md`, commit `2cf49d9`,
applied while Codex's trust500 run had finished). No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `2cf49d9` | batch14: RR-M02 distinct storage locations | presentation |
| `ed1dc1f` | TR500-F01, F02, F03, M01 | correctness, UI reliability, validation |
| docs commit | batch14 and batch15 handovers, status line | |

## TR500-F01: a column named `__proto__` keeps its values

`src/lib/rowCells.ts` is the one rule for writing and reading a value on a row keyed by column name:
`setCell` defines an own property (never an assignment, which for `__proto__` sets the prototype and
drops the value), and `cellValue` reads only an own value. Used by the workbook/CSV reader
(`parseTable.ts`), the columns-as-cases flip (`dataSetup.transposeTable`, including the variable-name
column), tables read from documents (`documentTables.ts`) and the crosstab export rows
(`crosstabs.ts`). No name is renamed or dropped; a repeated name gets the usual suffix.

`importPreviewIdentity.loadImportPreviewIdentities` now matches a stored row only when it holds its
own value, null included, for every header, equal to the fresh read's own value. A missing or
inherited property is never read as a match, so a preview damaged by the earlier reader (or one
that lost a column whose value was missing) is shown as not verified, with the usual reread. Brief:
`claude/column-names-and-preview-identity.md`.

## TR500-F02, TR500-F03 and TR500-M01: Findings edits say whether they saved

Server (`findingActions.ts`): status (single and bulk), kind, theme and note return
`{ ok: true }` only when written, otherwise `{ ok: false, error }` with nothing written.

- Inputs are checked before any write (M01): status and kind from their lists; theme and note must
  be text; ids must be text. Null is accepted for none. A blank theme or note clears it; a kind
  cannot be cleared.
- A finding that is gone (never in the project, deleted, replaced by a reread, another project's)
  is refused with "no longer in this project ... Nothing was saved. Reload the page" (F03).
- Bulk status is all or nothing: fewer updated rows than distinct ids rolls the transaction back,
  and the reply says how many of how many are gone. An empty batch is a no-op.
- A database failure throws.

Page (`FindingsTable.tsx`), every control through `attemptResult`, so no refusal or failure reaches
the project's error boundary (F02):

- Note: the editor closes only after a successful save; while saving it is disabled showing the
  draft; on refusal or failure the draft stays with the reason beside it and Save retries the same
  draft.
- Status: optimistic, reverted with the reason if not saved; a shared per-finding request counter
  keeps an earlier reply from undoing a newer click.
- Bulk ("Accept all", "Reject all", "Accept all in theme"): reverted on screen if not saved, with a
  banner giving the reason.
- Kind and theme: the selects keep the saved value with the reason beside them; a new theme's form
  stays open with the typed name.

Two incidental fixes in the same lines: the kind select previously called its action without
awaiting it, and the theme form closed and added the theme to the list before the save answered.
Brief: `claude/finding-edit-failure.md`.

## Tests

- `reservedColumnNames.db.test.ts` (new; real database, actual reader, `extractAndStoreDocumentTables`,
  stored rows and preview check; storage stand-in), 4 cases: both layouts with `__proto__`
  (10, 20, 0, missing), `constructor` and `toString` (missing in one case each) and an ordinary
  control (missing in one case) store every own value and verify; a stored preview without the
  column's values, with a changed value, or that lost a key whose value was missing, is not
  verified, and a reread restores it; a repeated `__proto__` gets "__proto__ (2)" with both columns'
  values; the actual Python engine on the identical bytes gives the same case count, valid counts
  and `__proto__` category counts in both layouts.
- `findingEditContract.db.test.ts` (new; real database, actual actions), 5 cases: saves; gone
  findings refused with nothing written and recovery; bulk all or nothing (deleted and foreign
  ids, duplicates, empty); malformed inputs refused, blank clears; a database failure (trigger) throws
  with nothing saved, and the same call saves after.
- `e2e/ui/findings-edit-failure.check.mjs` (new; real browser, disposable stack, faults made in the
  database): refused note save keeps draft and view, the same draft saves on retry; delayed save keeps
  the editor disabled with the draft until it settles; a note for a finding deleted after the page
  opened is refused as gone with the draft kept; a refused status change reverts with its reason, then
  saves; a bulk change naming a deleted finding changes none, says so, and saves after a reload.
  Screenshots inspected.
- `signedInTenantAccess.db.test.ts`: another organisation's finding now gives the refusal rather than
  a silent no-op.
- Mutation checks (each made, run, reverted): the reader assigning again fails 3 cases; the flip
  assigning again fails 2; the preview check comparing inherited values fails 2; a bulk change
  accepting a partial update fails 1; a setter acknowledging zero rows fails 1; a theme of any shape
  accepted fails 1.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0111, real Python engine,
production build, model replayed. Exit codes and the vitest `Errors` line recorded.

| Gate | Result |
|---|---|
| Full library (the content of `ed1dc1f`) | exit 0; 1,563 passed, 72 skipped (208 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite (the tree before that change) | exit 0; 93 passed, 0 failed, 1 skipped (the gated real-model test) |
| Findings edit-failure check, rebuilt on the final tree | passed |
| Golden-thread smoke; objective acceptance (the tree before that change) | passed; passed |
| `reservedColumnNames.db`; `findingEditContract.db` | 4 passed; 5 passed |
| `npx tsc --noEmit`; lint on changed files; production build | pass; no errors (1 warning, an unused disable directive already in `FindingsTable.tsx`); pass |

The first full library run, on the tree before the last change, had 1 failure: the request-tenant source scan
(`requestTenantCoverage.test.ts`) found that the kind, theme and note setters reached the signed-in
tenant only through the shared helper. Each setter now resolves it first, before any input check
; the final runs above are on that tree (`ed1dc1f`). Between the two trees only `findingActions.ts`
changed; the native suite was not rerun in full on the final tree, only the Findings check.

## Limits

- Maps keyed by variable name (question types, label lookups) are not covered by the row rule; they
  hold settings, not data values.
- The browser check makes its failures with database triggers; a dropped connection is covered by
  `attemptResult`'s existing handling, not re-tested here.
- Unchanged from batch13 and batch14: the converted-copy in-flight lease limit, remaining dependency
  advisories and per-tenant model budgets.
