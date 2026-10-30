# Batch 44 handover: repairs from the Batch 39/40 review (27 October 2026)

Base: Batch 40 (`3ff2d287`). Status: implemented, ready for review. Tier A. No migrations. Codex's review
(READY_FOR_CLAUDE, 1 S1, 1 S2, 1 unresolved reference mismatch): `work/release-verification-b3940-20261027/docs/independent-batch39-40-review-2026-10-27.md`.

| Finding | Repair | Rule owner | Test (fails before the fix) |
|---|---|---|---|
| B40-F01 S1: an R or Parquet preview stored before the B38-F01 repair (identifiers rounded, no read provenance) was shown as the file's data | The engine's stats conversion names its reader (`STATS_READER = "engine-stats-2026.10.27"`), stored as the table's read provenance. An R or Parquet table without that name is compared value by value with a fresh conversion by the same engine and withheld with the recovery notice when they differ or the file cannot be read; reading the file again replaces it. SPSS, Stata and SAS tables are shown as before: they store doubles, which the old transport carried exactly | `src/lib/importPreviewIdentity.ts` (`checkStatsTable`, `ENGINE_STATS_READER`), engine `convert` | `dataFileFormats.db.test.ts` "B40-F01": fresh read shown; the pre-repair rows (rounded, no provenance) withheld; a healthy old table shown; source unreadable withheld; reread recovers with the exact identifiers, keeping a saved table, its finding and a variable correction. `engineTableReader.test.ts` keeps the reader names equal |
| B39-F01 S2: coverage read its cited insights' support on a second connection while holding the caller's, so a pool's worth of concurrent reads waited on themselves | Coverage is read in two steps: `readObjectiveCoverage(client)` (rows and freshness, in the caller's connection) and `withCoverageSupport` (the support reader, on its own connections, called with none held). `loadObjectiveCoverage(tenantId, runId)` does both and is what every caller uses, before its own transaction (page, both story exports, stage facts, the assistant, the suggest action). The evidence trail had the same shape (coverage and insight support inside the trail's connection): its coverage and support are now a `TrailContext` read first, once per report for the appendix | `src/lib/objectiveCoverage.ts`, `src/lib/evidenceTrail.ts` (`loadTrailContext`) | `coveragePoolCapacity.db.test.ts`: with the default pool of 10, 10 stage-facts reads, 10 trail actions, 10 coverage reads and an unrelated query at once all finish, with no connection left busy or waiting; changed support under load reads invalid, never current. The stage-facts and trail part, run on the old code, was still waiting after 30 s |
| Unsigned Parquet value mismatch | Not the application. Under pandas 3.1, `pd.array([18446744073709551615, 9007199254740993, 1, 1], dtype="uint64")` built from a Python list gives `[0, 9007199254740992, 1, 1]` (through float) before anything is written; under pandas 3.0.5 it is exact. The fixture now builds that column with numpy and asserts its values before writing, so a writer that changes them fails as a fixture error. Checked: a file written by pandas 3.0.5 reads exactly under both versions with fastparquet; one written by pandas 3.1 holds the wrong values under both | test only | `dataFileFormats.db.test.ts` Parquet case, run with the fixture written by pandas 3.1 (`PYTHON_EXECUTABLE`) and 3.0.5 |

Why the tests missed them: the B38-F01 test checked fresh reads only, never a table stored before the fix;
no test ran coverage at pool capacity; the uint64 fixture was trusted without checking what it wrote.

## Impact checklist

1. Rules: stored preview identity (`importPreviewIdentity.ts`), coverage (`objectiveCoverage.ts`), the
   support reader unchanged and still the one classifier.
2. Inputs: an old R/Parquet table is withheld when the file cannot be read now, never shown as verified;
   a failed support read is "Support not checked", as before.
3. Persistence: none changed; the reread path is the existing one (upsert of table 0; saved tables,
   findings and corrections untouched).
4. Freshness: unchanged; coverage rows and their support are now read in separate snapshots everywhere
   (they already were: the support reader always opened its own).
5. Screens: the Import preview shows the existing recovery notice for a withheld table.
6. Proof: below.

## Gates

Run on worktree b47 at `ad53a57d`, disposable stack and PostgreSQL 16, default pool of 10:

- `npx tsc --noEmit -p .`: ok. `npx eslint src e2e --quiet`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **251 files passed, 1 skipped;
  1,870 tests passed, 79 skipped, 0 failed.**
- The Parquet cases also run with the fixture written by pandas 3.1.0 (`PYTHON_EXECUTABLE`, the
  reviewer's version): passed.
- Browser suite `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` (no filters): **119
  passed, 1 skipped, 0 failed**. Smoke `npx playwright test`: **1 passed**.
- Each fix shown failing on the old code: B40-F01 test failed (no provenance, the rounded table shown);
  the pool test's stage-facts and trail reads were still waiting after 30 s.
- Mocks: the model, storage and sign-in at their boundaries; database, engine and browser real.

## Limits

An old R or Parquet table is converted again on each view until the file is read again (the same cost
policy as plain tables from an earlier reader). Other nested support reads were audited: the remaining
callers of the support reader call it at the top level of their functions, after their own reads.
