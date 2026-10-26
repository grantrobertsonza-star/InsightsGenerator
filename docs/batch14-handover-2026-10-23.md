# Handover: RR-M02, distinct storage locations in the cleanup notice (main copy), 23 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch13-review-main-2026-10-23.md` (0 S1, 0 S2, 1 S3 open), whose closures of
RR-F03, RR-F06 and RR-M03 stand. No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `2cf49d9` | RR-M02 | presentation, count semantics |
| docs commit (with batch15) | This handover and the status line | |

## RR-M02: the notice counts each storage location once

Codex reproduced two reads of one data file, each failing to remove its converted copy, giving two
records for one location and a notice reading "2 storage locations" with the copy listed twice.

- `loadPendingProjectCleanups` now returns `locations`: the number of **distinct** paths across every
  listed (due) record. It is not a sum of the items: records overlap when one file is read twice, and
  when a deleted project's record also names a copy's location.
- Converted-copy records naming the same location are shown as **one item** (`records` says how many
  records it stands for; attempts are summed; the latest error is shown). A deleted project's record
  stays its own item.
- The records themselves are unchanged and kept apart: each has its own producer, in-flight time and
  retry (Codex's acceptance: do not discard a still-active producer's record to tidy the display).
- `ProjectCleanupNotice` shows that distinct total. After a retry that leaves something, it says "Not
  all removed; the error is shown above." instead of a number, since the retry's `remaining` counts
  records, which can overlap.

Brief: `claude/project-deletion.md`.

## Tests

`releaseAuditRepairs.db.test.ts` (real database; storage and the parser's HTTP reply controlled;
the actual `ProjectCleanupNotice` rendered to static markup with the router stubbed), 3 new cases,
32 in all:

- Same copy read twice, both removals failing: two records; the notice says "1 storage location",
  one list item, attempts 2, the latest error. A healthy retry removes the copy for each record and
  clears both; the notice then renders nothing.
- A copy's record plus its deleted project's record (file and copy): "2 storage locations", two
  items, the project's item "2 storage locations"; a healthy retry clears both.
- Copies of two different files: two items, "2 storage locations".

Mutation checks (each made, run, reverted): summing the items' counts again fails the overlap case;
not merging records for the same copy fails the read-twice case.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0111, real Python engine,
production build, model replayed. Tree: the content of `2cf49d9`. Exit codes and the vitest
`Errors` line recorded.

| Gate | Result |
|---|---|
| Full library | exit 0; 1,554 passed, 72 skipped (206 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite | exit 0; 92 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | passed; passed |
| `releaseAuditRepairs.db` | 32 passed |
| `npx tsc --noEmit`; lint on changed files; production build | pass; no errors or warnings; pass |

## Limits

- A deleted project's item and a converted-copy item can still name the same location (shown as two
  items, counted once in the total), since they come from different producers.
- Unchanged from batch13: the in-flight lease limit, the remaining dependency advisories and
  per-tenant model budgets.
