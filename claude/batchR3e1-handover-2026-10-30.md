# Batch R3e1 handover (30 October 2026)

Status: **implemented, ready for independent review.** Repairs Codex's E1R review
(`docs/independent-e1r-review-2026-10-30.md`, pinned tree `4b14f3c9`) on branch `r3e1`, base `16fe56e`. No migration.

## E1R-F01: a failed per-wave re-check was reported as a completed check (medium)

- **Rule:** the codebook automatic confirmation row in `claude/rules-registry.md`; contract `claude/codebook-import.md`
  (CB1, "Per-wave outcome of the re-check"). Owner reused: `matchCodebookToDataFiles` and its `files[]` outcome. No
  new matching rule.
- **Cause:** `readInstrumentItems` caught only a thrown error from `matchCodebookToDataFiles`. The matcher reports a
  wave it could not check as `files[].status = "failed"` without throwing, so the wrapper returned `status: "done"`
  and the card said the links "were checked again against every wave".
- **Change (`src/lib/instruments.ts`):** the outcome is judged from the matcher's per-file results, for the files that
  held a withdrawn confirmation:
  - every such file matched: `{ status: "done", reconfirmed, files }`;
  - any such file failed or no longer described by the codebook (`few_names`): `{ status: "failed", error, reconfirmed,
    files }`, where `error` names each file and its reason and `reconfirmed` counts the files that were checked;
  - the matcher threw, or the count after it failed: `status: "failed"` as before.

  The successful waves' re-confirmations stand; the unchecked waves' links stay suggestions (never confirmed).
  `automaticRecheck.files` is new; callers that compared the whole object with `toEqual` see the extra field.
- **Wording (`src/lib/instrumentMatchMessage.ts` `automaticRecheckMessage`, used by `InstrumentCard.recheckNote`):**
  "checked again against every wave they were on (...)" only for `done`. Otherwise, for example: "2 automatic links
  whose answer list changed could not be checked again on every wave. Not checked: wave1.csv (error); their links stay
  suggestions until they are checked. Checked again on wave3.csv: 1 still fits and is confirmed. To retry, choose that
  wave under Data file and press Match again." All waves failed: "could not be checked again on any wave". A wave the
  codebook no longer describes is named with that reason and no retry advice. The incomplete-read message now
  carries the same sentence (it dropped it before). The card's note has `data-testid="instrument-message"`.
- **Inputs:** a file that is not in the matcher's result is no longer an active data file; its links count nowhere.
- **Persistence and freshness:** unchanged. The withdrawal stays in the read's transaction (E1-F04); the re-check
  writes go through `suggestInstrumentLinks` as before.
- **Proof:**
  - `codebookRereadRecheck.db.test.ts` (real PostgreSQL, actual engine, CSV codebook, no model; failure injected by
    a test-only trigger refusing link inserts for chosen waves): one wave failed among successes (wave named, error
    carried, wave 3 confirmed, wave 1 suggested and not returned as confirmed, recovery by matching confirms wave 1);
    all waves failed (nothing confirmed, recovery confirms both); ordinary non-fit reported `done` with both files
    matched. 8 tests; without the `instruments.ts` change 3 fail (the two E1R cases on `status`, the non-fit control
    on the missing `files`).
  - `automaticRecheckMessage.test.ts`: 6 wording cases (none, done, one failed, all failed, few_names, whole call).
  - `e2e/ui/codebook-recheck-failed.check.mjs` (browser, disposable stack): two waves and a CSV codebook, a revised
    codebook stored under a new key, a trigger in the stack's disposable database refusing wave 1's link writes, Read
    again on the card. Asserts the wording, wave 1 suggested, wave 3 confirmed; drops the trigger; choose wave1.csv and
    Match again confirms it. Without the `instruments.ts` change it fails, showing "were checked again against every
    wave they were on: 1 still fits". Screenshot: the failed-recheck wording on the card.
  - Codex's own probe (`independentE1RRecheck.db.test.ts`, run as a temporary copy, not committed): its F01 case now
    passes (`{status:'failed', error:'wave1.csv: independent wave recheck unavailable', reconfirmed:1, files:[...]}`).
    Its two copies of the older `toEqual({withdrawn, status:'done', reconfirmed})` assertions fail only on the new
    `files` field.
- **Why the earlier tests missed it:** every re-check test had the matcher succeed on every wave; none injected a
  per-file failure, and the wrapper's only failure path was a thrown error.

## Waves-in-project browser check: Setup edits lost (Codex's two browser receipts)

- **Rule:** the data setup saves row; contract `claude/setup-loading-guard.md` ("One file's edits in quick
  succession").
- **Root cause, product defect (receipt a).** Reproduced on the disposable stack with an instrumented copy of the old
  check that logged every Setup save request (body and expected value) and the stored set-ups before and after the
  reload. Old code, 3 runs: 1 passed, 2 failed. Run 2 ended exactly as Codex's receipt (Wave 2: wave set, month null,
  still included). Its log:
  1. the Setup form for tracker-w2.csv started from `accepted:false` although the database held `accepted:true`:
     its first-view acceptance had met an acceptance from another page view, and on that conflict the form only
     refreshed and kept its defaults;
  2. the wave label save (expected `accepted:false`) conflicted and was re-applied onto `accepted:true`;
  3. meanwhile the month and the inclusion saves had been sent, each expecting the label's unconfirmed value; they
     conflicted, re-applied themselves on the version read before the label landed (wave null), conflicted again and
     were dropped (`saveSetupEdit` re-applies once).

  The earlier response's `setChoice` also replaced newer edits on screen while later saves were in flight, and the
  form showed no saving state (only the Sources list's badge).
- **Receipt b (Cross tabs not opening the latest wave):** not reproduced directly. The selector's `latestWave` comes
  from the server render at the reload; with Wave 2's month and exclusion not yet saved, Wave 2 is an included wave
  without a date, waves fall back to upload order, and tracker-w2.csv (uploaded last) is the latest. Same cause: the
  check reloaded before the saves were answered, and some saves could be lost. Not seen in 6 runs after the fix.
- **The check's own race.** `page.waitForLoadState("networkidle")` returns at once once the page has loaded, so the
  old check reloaded with saves still on their way. Fixing only the check would have hidden the lost saves, so the
  product is fixed first and the check then waits for the form's own saved state.
- **Change:**
  - `src/lib/dataSetupRebase.ts` `createSetupEditQueue`: one file's edits are sent one at a time. Each edit is the
    fields that differ between the view it was made on and the new value, applied with `rebaseSetupEdit` to what the
    previous edit actually saved, then sent with `saveSetupEdit` (compare-and-swap, one re-application). A change in
    another tab still merges or conflicts; an acceptance of a structure no longer saved is still refused (E1-F02). A
    save that throws is a failed edit, never saved, and the queue continues. Each outcome says whether it is the latest
    edit.
  - `src/app/runs/[id]/TranscriptSetup.tsx` `DataSetupForm`: uses the queue; only the latest edit's answer sets the
    form; a conflicted first-view acceptance adopts the stored set-up it returns; a count of unanswered edits drives
    "Saving your change..." (`data-testid="setup-save-status"`, `data-saving`) and the Sources badge; the save error is
    an alert (`setup-save-error`). The transcript form is unchanged.
  - `e2e/ui/waves-in-project.check.mjs`: after each file's edits it waits for `data-saving="false"` and no save error,
    then reloads once and reads back every wave's label, month and inclusion with plain assertions (no retry loop), so
    a lost save fails there.
  - `e2e/ui/setup-first-view-edit.check.mjs`: the same wait before its reload. It failed on the base tree too (1 of
    2 runs, at the read-back after reload); an instrumented run showed the wave save answered in about 1 s with no
    error, so this was the check reloading early, not a lost save.
- **Screens:** late responses (only the latest answer is shown), "saved" only after the answer (the status returns
  to the ordinary line only when no edit is unanswered), failures shown, never silently replaced.
- **Proof:** `setupEditQueue.db.test.ts`, real PostgreSQL through `saveDataSetupAction`, 5 tests: the receipt (stale
  view behind an acceptance made elsewhere, three edits not awaited: all saved), one at a time with each expecting what
  the previous saved, a lost response failing only its edit, another tab merging a different field and conflicting on
  the same field, and E1-F02 through the queue. With the old screen path substituted (each edit sent at once with its
  view as the expected value), 2 fail on each of 3 runs: the receipt (an edit not saved) and the one-at-a-time case (3
  saves in flight at once).
- **Why the earlier tests missed it:** the rebase tests covered one edit meeting one other save, not one form's edits
  overlapping each other, and the browser check's no-op wait made its failures look like flakiness.

## Files

- E1R-F01: `src/lib/instruments.ts`, `src/lib/instrumentMatchMessage.ts`, `src/app/runs/[id]/InstrumentCard.tsx`;
  tests `src/lib/__tests__/codebookRereadRecheck.db.test.ts`, `src/lib/__tests__/automaticRecheckMessage.test.ts`,
  `e2e/ui/codebook-recheck-failed.check.mjs`; `claude/codebook-import.md`.
- Setup: `src/lib/dataSetupRebase.ts`, `src/app/runs/[id]/TranscriptSetup.tsx`; tests
  `src/lib/__tests__/setupEditQueue.db.test.ts`, `e2e/ui/waves-in-project.check.mjs`,
  `e2e/ui/setup-first-view-edit.check.mjs`; `claude/setup-loading-guard.md`.
- `claude/rules-registry.md` (both rows), this handover.
- Callers checked: `instrumentActions.readInstrumentAction` (passes `automaticRecheck` through unchanged),
  `InstrumentCard` (read and Read again messages), `useInstrumentAutoStart` (unchanged). `saveSetupEdit` keeps its
  contract for `setupAcceptanceRace.db.test.ts`.

## Gates (worktree b111)

- `npx next typegen` then `npx tsc --noEmit`: exit 0.
- `npx eslint src e2e --quiet`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: 555 PASS, 0 FAIL, "All checks passed".
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign
  GIT_CONFIG_VALUE_0=false npx vitest run <34 files> --pool=forks`: 34 files passed, 183 tests passed, 8 skipped, 0
  failed. The 8 skips are the "TEST_DATABASE_URL not set" placeholder blocks, which skip when it is set. The files are
  every test that imports `instruments`, `instrumentMatchMessage`, `dataSetupRebase`, `instrumentActions`,
  `dataSetupActions`, `TranscriptSetup` or `InstrumentCard`, the new suites, and `instrumentMatch.test.ts`.
- Browser, disposable stack (`node scripts/e2e/local-stack.mjs`, port 3230), each run
  `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 <check>`:
  - `waves-in-project.check.mjs`: 3 of 3 passed on the final tree (45.5 s, 33.7 s, 36.3 s), and 3 of 3 passed earlier
    on the fixed product.
  - `codebook-recheck-failed.check.mjs`: passed 3 times; failed once without the `instruments.ts` change (above).
  - `setup-first-view-edit.check.mjs`: 3 of 3 plus 1 final passed with the wait.
  - Every check that drives the Setup form or codebook waves (17 files, 19 tests: add-files-panel, codebook-waves,
    codebook, coding-switch, crosstab-wave-copy, data-setup-hydration, flipped-codebook-guard, header-row-choice,
    raw-file-reopen, setup-first-view-edit, the five tracker pages, tracker-dashboard (3), transcript-card): 18 passed,
    1 failed (setup-first-view-edit, before its wait was added).
  - Not run: the full browser suite and smoke.

## Mocks and real

Real disposable PostgreSQL and the actual Python engine in the database tests; storage, the request context, the
model client and `revalidatePath` are stand-ins. Browser checks use the disposable stack (non-owner, non-superuser,
non-RLS-bypass application role, storage and auth stand-ins, model replay). Every failure trigger exists only in a
disposable database and is dropped by the test.

## Limits

- Leaving or reloading the page while a Setup edit is still being saved can still lose that edit; the form says
  "Saving your change..." but does not block navigation.
- The old check's logs also showed Setup save requests reported as aborted in the browser (`net::ERR_ABORTED`) that
  the server still applied. Not root-caused. The queue treats a thrown action as failed, and the next edit's
  compare-and-swap finds what is stored.
- The transcript Setup form keeps its own save path (already one at a time).
- Environment notes: the worktree's `node_modules` symlink pointed outside the tree, which Turbopack refuses (the dev
  server exits), and another session's stack held port 3210, so a stack started on 3210 printed "ready" while the
  checks reached that other server. The stack used port 3230 with a hard-link copy of `node_modules`. The stack's
  synthetic sign-in lasts an hour; one batch hit the expiry and was rerun on a fresh stack.
