# Handover: DI-F02 waves, B21-F01, B23-F01 (main copy), 25 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch23 (`4dbf8a1`).
Follows Codex's batch 21-23 review (14 closed; DI-F02 still open for wave comparisons; two new
findings). **No migration.** Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | DI-F02 (waves), B21-F01, B23-F01 | correctness |
| docs commit | This handover and the status line | |

Contracts: `claude/output-set-integrity.md` and `claude/coding-write-ownership.md` (both updated).

## DI-F02 (S2, still open): an unread wave comparison retired reviewed findings

`compareOutputSets` now locks both sets (by id, run and tenant, in id order) before reading them. If
any file in either set that should have a table could not be read, it stops before anything is
archived: "<files> could not be read, so the waves were not compared and the earlier comparison's
findings were kept. Try again; ...". The write transaction locks both sets again, so a change made
while the files were read is not compared against stale ownership. A comparison is all or nothing:
there is no partial wave comparison, because a difference between two waves read from part of one set
would be a different comparison.

## B21-F01 (S2): an invalid coding operation deleted an assignment

`codingOverrides.parseTurnCodeAction(value)` accepts exactly `"add"` or `"remove"` and returns null for
anything else. `changeTurnCode` and the in-transaction change both check it before any write and
refuse with INVALID_ACTION: "That change to the turn's themes is not one this screen makes (add or
remove). Nothing was changed; reload the page." Previously anything other than `"add"` fell through to
the remove branch.

## B23-F01 (S3): an over-long label caused a false edit conflict

`saveOutputSetAction` stores through `update ... returning name, wave_label` and returns
`{ ok: true, stored }` with the values as stored (name up to 120 characters, wave up to 60). The card
takes its opened baseline, name and wave from `stored`, not from what was typed, so the next save is
compared with what is really in the database. The inputs also carry `maxLength` 120 and 60.

## Files

- `src/lib/outputAnalysisRun.ts`: wave comparison locks and unreadable-file refusal.
- `src/lib/codingOverrides.ts`: `parseTurnCodeAction`, checked on both write paths.
- `src/lib/outputSetActions.ts`, `src/app/runs/[id]/OutputSetCard.tsx`: stored labels returned and used.
- `claude/output-set-integrity.md`, `claude/coding-write-ownership.md`: contracts updated.
- Tests:
  - `src/lib/__tests__/dataIntegrityDI.db.test.ts`: "an unreadable file in either wave refuses the
    comparison and keeps the earlier comparison's findings; a readable retry replaces them"; "an
    over-long wave label or name is stored at its limit, returned as stored, and the next save from
    those values goes through".
  - `src/lib/__tests__/codingOwnership.db.test.ts`: "B21-F01: an operation other than add or remove
    is refused and changes nothing" ("", null, undefined, "REMOVE", "Add", "delete").
  - `e2e/ui/stale-label-editors.check.mjs`: a 61-character wave label case added.

## Checks run (real disposable PostgreSQL 16 and the disposable browser stack)

- Focused: the two library files above, 23 passed. Mutation checks, undoing each of the three repairs
  in turn, make the new tests fail.
- `npx tsc --noEmit`: clean.
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): 1,697 passed, 72 skipped, 4 failed.
  All 4 failures were in `researchQuality.db.test.ts` and were "Test timed out in 5000ms" while other
  work loaded the machine; the file run alone: **54 passed**. None touch this batch's code.
- Browser: the extended `stale-label-editors.check.mjs`, 1 passed. Full browser suite
  (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`): **104 passed, 1 skipped**. Smoke: 1 passed.

Mocks: the model is not involved. Storage is stubbed only where a test needs an unreadable file.

## Remaining

- TP500/IP1000 one-reader import findings remain open (unchanged).
- File deletion (the bin) is the next batch (25), with migration 0115.
