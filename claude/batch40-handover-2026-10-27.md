# Batch 40 handover: repairs from the Batch 37/38 review continuation (27 October 2026)

Base: Batch 39 (B37-F01 repair, staged as b39-b37f01-1026a; apply it first). Status: implemented, ready
for review. Tier A. No migrations. Codex's continuation (READY_FOR_CLAUDE, 2 S1 / 1 S2 / 1 S3; report
`work/release-verification-b3738-20261026/docs/independent-batch37-38-review-continuation-2026-10-26.md`).
B37-F01 is repaired in Batch 39. This batch repairs the other three and one test-environment limitation.

| Finding | Repair | Rule owner | Test (fails before the fix) |
|---|---|---|---|
| B38-F01 S1: a Parquet categorical of integers beyond 2^53 was stored as one identifier (the JSON parse rounded 9007199254740993 to ...992), so the preview disagreed with the calculation | Exact-integer transport is now the final step every R and Parquet column passes through, whatever its dtype became (`_exact_whole_numbers`): any column of whole numbers holding a value beyond 2^53 is written as exact text. Categorical, nullable, plain, object, negative and unsigned all go through it | `api/parse-stats-file.py` `_r_and_parquet_frame`, `_exact_whole_numbers` | `dataFileFormats.db.test.ts` (Codex's categorical bytes, plus negative Int64 and uint64 up to 2^64-1; preview and reread value by value; categories agree with the preview; safe-boundary control stays numeric) |
| B37-F02 S2: a decision reworded through the actual action still read as a current decision served | `loadRecommendationDecisions` compares wording as well as identity: each served decision is current, reworded (with the new wording) or gone. Cards, the trail and the export say "since reworded as ...; written for the earlier wording". A free-text decision's wording is its identity | `src/lib/recommendationDecisions.ts` (`ServedDecision.state`, `servedDecisionNote`) | `recommendationDecisions.db.test.ts` (actual `acceptDecisionCandidate` edit; spacing and case only stays current; reworded back recovers; rejection is gone; free text reworded is gone) |
| B37-F03 S3: before migration 0121 an existing narrative got no note (the same as current) | Without the column, whether a narrative exists is still read; an existing one is "Not known to be current", naming migration 0121; none is still no note; a malformed record is unknown | `src/lib/narrativeFreshness.ts` | `narrativeWrongGroup.db.test.ts` CE-3 case (column moved aside, with and without a narrative; malformed; recovery after regeneration) |
| Reviewer limitation: two XLS tests started Python with `-I`, which ignores a private PYTHONPATH | `workbookReaderEngine.test.ts` no longer isolates the interpreter (its script and files are its own) | test only | runs under a PYTHONPATH-supplied xlrd |

Why the tests missed them: the Parquet test covered nullable and plain integers but not a categorical of
them; decision freshness was tested by rejection only, never by an edit; narrative freshness was tested
with the column present only.

## Impact checklist

1. Rules: import identity (engine), CE-2 decisions served, CE-3 narrative freshness; owners above, no copies.
2. Inputs: unknown stays unknown (narrative before 0121); a reworded decision is not current; an
   identifier that cannot be held exactly is text, never rounded.
3. Persistence: none changed; reads only, except the engine's preview values.
4. Freshness: cards, trail and export qualify reworded decisions; narratives without a checkable record
   are qualified.
5. Screens: the card's "Serves" line and the trail show the new wording.
6. Proof: below.

## Gates

Run on worktree b47 at `748f61c` (code) and `f41f30e3` (the two test fakes below), disposable stack and PostgreSQL 16:

- `npx tsc --noEmit -p .`: ok. `npx eslint src e2e --quiet`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: first run 1,861 passed, 6 failed,
  78 skipped. The 6 were in `storyExportSupport.test.ts` and `storyExportDiscovery.test.ts`: their fake
  database has no `deck_narratives.inputs` column, which after the B37-F03 repair correctly reads as "not
  known to be current", so every framing passage gained that note and their exact-text expectations
  failed. These tests are about support status, not narrative freshness, so their narrativeFreshness mock
  now keeps the narrative current, with a comment saying why; the B37-F03 behaviour itself is tested
  against a real database (`narrativeWrongGroup.db.test.ts`). Rerun: **250 files passed, 1 skipped;
  1,867 tests passed, 78 skipped, 0 failed.** Why I missed it before handing over the draft: I ran the
  repair's own test files, not the full library, until this gate.
- Browser suite `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` (no filters): **119
  passed, 1 skipped, 0 failed** (27.3 min). Smoke `npx playwright test`: **1 passed**.
- Mocks: the model, storage and sign-in are mocked at their boundaries; the database, the Python engine
  (pandas 3 and pyarrow for the Parquet cases) and the browser are real.
