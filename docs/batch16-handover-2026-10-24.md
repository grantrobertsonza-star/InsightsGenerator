# Handover: B15-F01, a grouped copy shows its latest attempt's error (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch14-15-review-main-2026-10-24.md` (0 S1, 0 S2, 1 S3 open), whose closures of
TR500-F01, F02, F03, M01 and RR-M02 stand. Reviewed together with the dashboards merge (`d5ee929`,
`docs/dashboards-merge-handover-2026-10-24.md`), which it follows; this repair is `f95999d`. No migration. Nothing pushed or
deployed.

## B15-F01

`projectStorageCleanup.loadPendingProjectCleanups` shows several records for one converted copy as
one item. It used to take the error of the newest-created record, so two reads of one file finishing
out of order showed the earlier failure as "Last attempt failed". It now takes the error of the
record whose attempt is latest by `last_attempt_at`; a record never attempted ranks below any
attempt; equal times fall to the higher record id (the later record). The records, their in-flight
times and their retries are unchanged. Brief: `claude/project-deletion.md`.

## Tests

`releaseAuditRepairs.db.test.ts`, 1 new case (33 in all), with the actual `beginConvertedCopy`,
`finishConvertedCopy`, `loadPendingProjectCleanups` and the rendered notice: two records for one
copy where the newer finishes first and the older last, and the in-order control, each show the last
finisher's error with 2 records, 2 attempts and 1 location; equal attempt times show the later
record's error; a healthy retry clears both records and the notice. Mutation checks (made, run,
reverted): choosing by creation order again fails it; reversing the tie rule fails it.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0111, real Python engine,
production build, model replayed. Tree: the content of `f95999d`. Exit codes and the
vitest `Errors` line recorded.

| Gate | Result |
|---|---|
| Full library | exit 0; 1,592 passed, 72 skipped (211 files, 1 skipped); no `Errors` line, no unhandled errors |
| Browser checks rebuilt on this tree: project deletion notice, stage status, layout, sidebar | 9 passed |
| Full native browser suite | on the merge tree before this repair (see the merge handover): exit 0, 95 passed, 1 skipped; this repair changes only server-side presentation data |
| `releaseAuditRepairs.db` | 33 passed |
| `npx tsc --noEmit`; lint on changed files | pass; no errors or warnings |
