# Handover: RR-F03 (in-flight converted copies), RR-F06 (blank narrative fields), RR-M02 and RR-M03 (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows Codex's review of
`6fb7bda` (`docs/independent-batch11-12-review-main-2026-10-23.md`: 0 S1, 2 S2, 2 S3 open), whose
closures of RR-F01, RR-F05, RR-F07, RR-F08 and RR-M01 stand. **Migration 0111** (Grant applies it in
Studio). Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `b4b5b85` | RR-F03, RR-F06, RR-M02, RR-M03; migration 0111 | persistence, correctness, wording, test reliability |
| docs commit | This handover and the status line | |

## A correction to the batch11 and batch12 reports

The library results reported in both handovers ("1,545 passed, 72 skipped", and batch11's figures)
were read through a filter that kept the vitest summary lines but dropped its `Errors` line and the
exit code. Codex's run showed what that hid: two unhandled teardown errors and a failing exit. The
pass counts were right; the claim that the run was clean was not. From this batch the checks record
the exit code and the `Errors` line, and the figures below are taken that way.

## RR-F03: a converted copy is recorded before the parser is asked

Migration `0111_storage_cleanup_in_flight.sql` adds `kind` (`deleted_project`, the default for
existing rows, or `converted_copy`) and `in_flight_until` to `project_storage_cleanup`.

`parseStatsFile` (remote parser only):

- Before the request, `beginConvertedCopy` writes a `converted_copy` row naming
  `<storage path>.converted.json`, in flight for 15 minutes. The row has no foreign key to the
  project, so it survives the project being deleted while the parser runs. When the row cannot be
  written (path in no project's folder, project gone, 0111 missing, database failure) the parser is
  not asked and the read fails with that reason.
- After any HTTP answer, `finishConvertedCopy` removes the copy and the row in a `finally`. A failed
  or thrown removal keeps the row with the error and clears the in-flight time, so it is listed for
  "Remove them now". A failure to update the row is logged (no contents) and the row becomes due
  when its time passes.
- When the request fails with no answer, the row is left in flight: not listed, not retried, until
  its time passes; then listed and removed by the retry.
- `finishProjectStorageCleanup` and `loadPendingProjectCleanups` skip rows in flight. On a
  `converted_copy` row the copy is removed even when its source is still named (it has no use once
  read); on a deleted project's row a copy stays with its still-named source. The "still named"
  lookup now includes each listed copy's source; before, it looked only at listed paths, so that
  rule depended on the source also being listed (found by a mutation check while writing the tests).
- `queueOrphanStorageCleanup` (the previous after-the-fact record on the project's trace, which
  cascaded with the project) is removed.
- Project deletion also needs 0111 now: without it, deletion is refused with nothing deleted, as it
  is without 0110.

Brief: `claude/project-deletion.md` (the earlier sentence that a copy could not outlive its file is
replaced by the in-flight description and its limit).

## RR-F06: blank narrative content is a failed generation

`storyNarrative.generateStoryNarrative` now also rejects, before any write, an executive summary,
situation, complication or governing thought that is empty or whitespace only, and a blank question
when the project has no decision statement (a blank question with one is accepted: the decision
statement stands in for it, as it already did). The recommendations intro and caveats stay
optional. Brief: `claude/model-call-completion.md`.

## RR-M02: the cleanup notice counts locations

`ProjectCleanupNotice`: "Files may still be in storage: removal is not yet confirmed for N storage
location(s)." Items read "Deleted project X: N storage locations" or "A converted copy of a data
file in X", each with its last error. `PendingProjectCleanup` has `kind` and `locations` in place of
`files`. A deleted project's record lists every location its files could have, a converted copy
that may never have been made among them, so it cannot honestly be called a count of files.

## RR-M03: test pools are closed before the database is dropped

`figureTraceability.db.test.ts` and `latestVerdictReaders.db.test.ts` closed the main pool but not
`claimPool` (opened by the assistant capacity code they reach), which then hit the dropped database
after the suite ended. Their `afterAll` now closes both. Reproduced before the fix ("Errors 2
errors", exit 1) and clean after (exit 0, no Errors line).

## Tests

- `releaseAuditRepairs.db.test.ts` (real database; model client, storage and the parser's HTTP reply
  controlled), 29 cases. The converted-copy group is new: the row exists and is in flight while the
  parser runs, then goes with the copy; a reply naming another object is refused and that object is
  never removed; a project deleted mid-read with the later removal failing leaves a listed row the
  retry clears; no answer keeps the row in flight, unlisted and unretried until due, then retried; a
  still-named source's copy is removed by the retry itself; the parser is not asked when the copy
  cannot be recorded (outside a project folder, project gone, 0111 missing); deletion is refused
  without 0111; the listing reports `kind` and `locations`.
- Mutation checks (each made, run, reverted): finishing without regard to "no answer" fails the
  in-flight case; not writing the row before the request fails 5 cases; ignoring the record's kind
  fails 2 cases.
- `narrativeWrongGroup.db.test.ts`: whitespace summary and empty situation rejected with the saved
  report kept; blank question rejected without a decision statement and accepted with one.
- `e2e/ui/project-delete-storage.check.mjs`: the notice's new wording.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0111, real Python engine,
production build, model replayed. Tree: the content of `b4b5b85` (the cloud run was on the same code
before one comment was reworded). Exit codes and the vitest `Errors` line recorded.

| Gate | Result |
|---|---|
| Full library | exit 0; 1,551 passed, 72 skipped (206 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite | exit 0; 92 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | passed; passed |
| `releaseAuditRepairs.db` | 29 passed |
| `npx tsc --noEmit`; lint on changed files; production build | pass; no errors or warnings; pass |

## Limits

- If the server process stops after asking the parser and the parser then runs beyond the 15-minute
  in-flight time, a retry could clear the location before the copy is written. The time is fifteen
  times the parser function's limit (`vercel.json`, `maxDuration` 60 s); it would need revisiting
  if that limit were raised towards it.
- The remaining audit entries (development tooling, `pptxgenjs` through `image-size`) and per-tenant
  model budgets are unchanged from batch11 and batch12.
