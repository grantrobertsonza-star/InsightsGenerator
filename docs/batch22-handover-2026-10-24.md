# Handover: REC500-F01, REC500-F02, REC500-F03, REC500-F04 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch21. Follows
`docs/independent-recommendations500-review-main-2026-10-24.md`. **Migration 0113** (additive) for
Grant to apply. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | REC500-F01, F02, F03, F04; migration 0113 | correctness |
| docs commit | This handover and the status line | |

## REC500-F01: stale and missing-target edits acknowledged as saved

Codex: `updateAndAcceptRecommendation` updated all eight fields with no opened baseline, no compare
under lock and no affected-row refusal, and both screens closed the editor when it resolved. A stale
editor overwrote a newer save; a deleted or recreated target updated nothing and still read as saved.

- New `saveRecommendationEdit` (`src/lib/recommendationWrites.ts`), behind the action: one transaction
  locks the row by id and run, refuses with the stored fields when it differs from `expected` (all
  eight fields as the editor opened them), refuses with `current: null` when the row is gone (a
  recreated recommendation has a new id, so it is gone for the old editor), and only then writes.
  The update's row count is checked.
- The action validates the fields at the boundary (eight strings, a non-blank action, a known
  priority) and returns `{ ok }`, a conflict, or a refusal; it no longer resolves silently.
- Both review screens use one shared hook, `useRecommendationEdit` (`recommendationEditing.tsx`):
  opened state captured on Edit; a refusal keeps the editor and draft and shows the error; a conflict
  shows "Stored now: <action>" with "Use current wording" and "Replace with mine" (a checked save with
  the stored fields as the new opened state). The editor closes only on a confirmed save.

## REC500-F02: an edit could keep the earlier strong score

Codex: the quality columns were cleared in a second transaction whose every failure was swallowed as
"columns not there yet", after the wording had committed; the scorer only scores null rows, so the old
95 / strong stood.

- The seven quality columns are cleared in the same statement as the wording, when migration 0045's
  columns exist (checked through `information_schema`; that absence is the only tolerated case). Any
  failure rolls the whole edit back and is reported; nothing is saved with the old score.
- The scorer then runs as before; it never throws, and a failed scoring leaves the recommendation
  unscored (shown as not scored), never with the earlier score.

## REC500-F03: retrying one own-add inserted twice

- **Migration 0113** (`supabase/migrations/0113_recommendation_request_key.sql`, additive): nullable
  `recommendations.client_request_key uuid` and a partial unique index on (run_id, key) where the key
  is not null. Existing rows are unaffected.
- `addResearcherRecommendation` (shared by both add actions; the anchor kind decides the column):
  inserts with the key and `on conflict ... do nothing`; when nothing is inserted, a stored row with
  the same key, anchor and fields is returned (`alreadySaved: true`); the same key with different
  contents is refused ("An earlier attempt from this form was already saved, as it was then"); no row
  means the anchor was refused (REC-001, unchanged). Two sends at once wait on the index and store
  one. A new key is a deliberate new recommendation. A send refused for its anchor stores nothing, so
  a later valid send with the same key adds it.
- Both actions now take the key (`addOwnRecommendation(runId, insightId, fields, requestKey)`,
  `addOwnSynthesizedRecommendation(...)`), validate it as a UUID, and refuse before migration 0113
  ("needs database migration 0113 ... nothing was added").
- Both add forms make the key when they open and keep it until a confirmed add.

## REC500-F04: a failed own-add lost the form

- Both add forms catch a failed send inside the form: every field and the chosen insight stay, the
  error is shown under the form (`recommendation-add-error`), and Add sends again with the same key.
  The message is the app's connection-lost wording when the connection dropped ("this may not have
  been saved. Your changes are still here..."), otherwise the server's error plus "Your recommendation
  is still in the form; press Add recommendation to try again." Both describe what is actually kept.

## Files

- `src/lib/recommendationWrites.ts` (new): field contract, `saveRecommendationEdit`,
  `addResearcherRecommendation`, messages.
- `src/lib/recommendationActions.ts`: edit and add actions delegate to it; key parameter; boundary checks.
- `src/app/runs/[id]/recommendationEditing.tsx` (new): shared edit hook and conflict panel.
- `src/app/runs/[id]/RecommendationsReview.tsx`, `SynthesizedRecommendationsReview.tsx`: edit hook,
  add key, add failure handling.
- `supabase/migrations/0113_recommendation_request_key.sql` (new).
- Tests: `src/lib/__tests__/recommendationWrites.db.test.ts` (10, new),
  `src/lib/__tests__/recommendationIntegrity.db.test.ts` (key argument), `e2e/ui/recommendation-edit-and-add.check.mjs` (new).
- Docs: `claude/recommendation-edits.md` (new), this handover.

Callers and consumers: the two review screens; the adapter's `addEligibleHumanRecommendation` (goes
through the form, so it now sends a key); `figureTraceability.db.test.ts` (edit without `expected`,
unchanged behaviour).

## Checks run

Fresh disposable PostgreSQL 16 (port 55432) and a fresh disposable application stack (production
`next build --webpack`, `next start`, every migration including 0113 applied to its throwaway
database); no development or live database, storage or provider.

- `npx tsc --noEmit`: exit 0. `eslint` on the changed files: 0 errors, 0 warnings.
- Full library suite, `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **exit 0,
  1,683 passed, 0 failed, 72 skipped**, 222 files passed and 1 skipped (batch21's suite plus the 10
  new tests).
- `recommendationWrites.db.test.ts` 10 passed; `recommendationIntegrity.db.test.ts` and
  `figureTraceability.db.test.ts` pass with the changed signatures.
- Browser checks, `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` on
  `recommendation-edit-and-add` (new), `recommendations-report-overview` and
  `main-recommendation-exports`: **3 passed**. The full browser suite was run on batch21 and not rerun
  here.

Mutation checks (the fix removed, the test rerun, then restored):
- The compare against the opened fields removed: 2 of 10 library tests fail (stale editor, two editors
  at once).
- The score clearing moved back out of the edit into a separately swallowed step: the fault test fails
  (the edit is saved with 95 / strong).
- The request key not stored: 3 of 10 fail (resend, racing sends, refused-then-valid and changed
  resend).
- Browser, built and served: the editor sending no opened fields fails the check at the conflict
  panel; the add form with a new key per send and no failure handling fails it at the add error (the
  form was lost). The stack was rebuilt on the clean tree afterwards.

## Migration and compatibility

Apply `0113_recommendation_request_key.sql` (adds one nullable column and one partial unique index).
Before it is applied, editing works as described and adding your own recommendation is refused with a
message naming the migration; nothing else changes.

## Limits

- The model's answers are controlled in the library tests and replayed in the browser; this is
  orchestration and persistence evidence, not model quality.
- An edit sent without `expected` is still applied unconditionally; no caller in the app does this.
- Recommendations added before 0113 have no key; a resend of such a form is not recognised (they were
  added before this protection existed).
