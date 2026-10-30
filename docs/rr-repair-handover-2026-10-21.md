# Repair handover: Codex's 21 October re-review (RR-01 to RR-05, V-01), 21 October 2026

Status: **implemented, ready for independent review.** Repairs for every finding in `docs/independent-review-2026-10-21.md`, on both copies, at Grant's request ("codex is done complete the fixes", 07:47). The last accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; no migration added.

## Review targets

| Copy | Path | Repairs | Follow-up | Other work in range |
|---|---|---|---|---|
| Main (3000) | `C:\Personal\InsighsAI\app` | `bf244dd` | `d433992` | none |
| Redesign (3001) | `C:\Personal\InsighsAI\app-import-redesign` | `7282c71` | `5520856` | `18cb7e7` Findings and Insights overviews (Grant, 21 October; separate, touches none of the repaired files) |

The follow-up commit closes two acceptance gaps found while checking the repairs against Codex's criteria (RR-03 late failure; RR-04 known zero). Package hashes: `.fnd001/overnight/{rr-3000,rr-3001,rrb-3000,rrb-3001}/hashes.txt`. The shared files (`api/parse-stats-file.py`, `scatterActions.ts`, `AnalyticsBuilder.tsx`, the scatter and engine tests, the new driver check) are byte-identical across the copies; `instruments.ts` and its single-flight test are repaired separately in each copy because the copies differ there (3001 has no in-flight lookup and records no read failure on the card).

## What changed, by finding

**RR-01 (scatter wording).** `scatterActions.addScatterFindingAction`. A finding whose `human_edited_fields` include `finding_text` keeps the researcher's wording and its provenance on every repost and revival. With the same figures (a relabelled answer included) nothing but the basis changes. With changed figures, `stated_stats` takes the new figures, the wording stays, and `stated_stats.wording_review = { reason: "figures_changed", suggested_text }` records that it was written for earlier figures, with the sentence the tool would write now; the flag stays until the researcher rewords. Wording nobody edited is still regenerated. Identity (one finding per file, variable names and weight) and the duplicate protection are unchanged. `scatterFindingStatusAction` returns `wordingReview`; the Analytics card says "Your wording of this finding was kept, but it was written for earlier figures. Reword it in Findings." with the current sentence, and reads the status again after a post (only the server knows whether the wording was kept). A status check that fails now says so on the card instead of showing an unposted card.

**RR-02 (scatter file identity).** `documentContentSha`: only a missing column (Postgres 42703, a database before 0098) reads as "no recorded hash". Any other error propagates: the post returns the error and writes nothing; the status check returns `current: null` (unknown), never true. A finding posted with the column present compared on a database without it (or the reverse) is unknown, not current or changed.

**RR-03 (questionnaire read claim).** `instruments.ts`. A claim ends only on an `instrument_read_finished` or `instrument_read_released` row naming its own `claimId`, or by expiry; a failure row ends nothing (a failed read writes its own release). Before writing results a read locks the document row (the lock the claim is taken under, confirming the row exists) and checks `claimSuperseded`; when a newer claim exists it raises `InstrumentReadSupersededError` and writes nothing. Follow-up: a read that fails after a newer read took over raises the same error, so its failure is not recorded on the card while the newer read runs (3000; 3001 records no read failures). If ownership cannot be checked, the failure is reported as it is. The action treats the superseded error as "a read is under way".

**RR-04 (driver posted state).** `AnalyticsBuilder.tsx`, driver parts only; the server is unchanged. Each analysis has a count state: loading, known(n) or failed. The result header and the saved list show "Checking whether this is posted..." while loading, the error with Retry when failed, Post only on a known zero, Remove only on a known positive. The open result's posted state is derived on each render, so a count that arrives late, or a Retry that succeeds, updates it without reselection. Only the newest count read publishes, and a post or remove made on screen during a read is not overwritten by that read's older answer. The misleading "Unknown is not zero" comment is replaced.

**RR-05 (engine).** `_read_plain`: every exit after `pd.ExcelFile` opens the workbook closes it: the sheet and format reading is wrapped in `try/except BaseException` (close, re-raise), and the label-sheet reading in `try/finally`. The explicit format error is unchanged.

**V-01 (harness).** `research-quality.check.mjs` (both copies): `page.unrouteAll({ behavior: "wait" })` replaces the plain unroute, so a slowed request still in its handler finishes before the route goes; the delayed-switch and comparison assertions are kept.

## Tests

New or extended, run as retained files:
- `scatterFindingPersistence.db.test.ts` (real PostgreSQL, actual actions; the file read is the mocked boundary, and one query is made to raise a permission error): edited wording kept on unchanged repost and on remove/revive with provenance; changed figures keep wording, update figures and set the review flag; label-only change; refused read then retry; lookup failure gives unknown status and a refused post with nothing written, then success on retry; missing-column compatibility. 6 of the 7 new tests fail on the previous code (the seventh is a control).
- `instrumentReadSingleFlight.db.test.ts` (real PostgreSQL, actual actions; model and file text mocked, model calls counted): takeover with late success (refused, nothing written, newer claim stands, third request refused, 2 model calls, newer result kept); late failure (no failure recorded, newer read continues); newer read fails then Read again recovers. Previous-code controls: the late-success test fails on the code before the repair; the late-failure test fails on `bf244dd`; the newer-read-fails test passes on both (control).
- `engineFormatInspectionFailure.test.ts` (real Python engine): counts every opened workbook; none left open after a format failure, a lost sheet choice, a label-sheet failure, or success. Fails on the previous engine (1 left open).
- `e2e/ui/driver-posted-state.check.mjs` (new, real browser on the disposable stack): slowed count read (Checking, then Remove without reselection), failed count read (error and Retry in result and saved list, no Post anywhere), Retry recovers, known zero offers Post. It identifies the count read as the server-action POST whose body is exactly `[runId]` and asserts each step matched at least one request.

## Checks run

Cloud workspace, disposable PostgreSQL 16, real Python engine, production build against the disposable stack; the model is replayed or mocked, never called.

Full suites on the repair commits (3000 at `bf244dd`; 3001 at `18cb7e7`, which includes `7282c71`):

| Gate | 3000 | 3001 |
|---|---|---|
| `npx tsc --noEmit -p .` | pass | pass |
| Browser checks (`e2e/ui/ui-check.config.mjs`, 1 worker) | 64 passed, 1 skipped | 65 passed, 1 skipped |
| Golden-thread smoke | 1 passed | 1 passed |
| Objective review acceptance | passed | passed |
| Unit and database tests (`vitest --pool=forks`) | 1,193 passed, 62 skipped (165 files) | 1,206 passed, 61 skipped (167 files) |
| `npx eslint .` | 349 errors, 38 warnings (errors unchanged from Codex's baseline) | 349 errors, 39 warnings |

The redesign copy's earlier full run of the overview build alone (before these repairs) failed only `research-quality` with "Route is already handled!", Codex's V-01; it passes in the run above. A test file also failed to load there (`findingWordingCard.test.tsx` needed a mock for the new overview module); fixed in `18cb7e7`.

Follow-up commits (`d433992`, `5520856`): `vitest run src/lib/__tests__/instrument` 25 passed, 4 skipped (3000) and 22 passed, 3 skipped (3001); browser `driver-posted-state` and `driver-reopen` 2 of 2 on each copy; tsc and eslint on the changed files clean.

Focused checks on the repairs before commit: `driver-posted-state`, `driver-reopen`, `research-quality`, `analytics-landing` on both copies, and `findings-insights-overview` on 3001, all passed. `scatterFindingPersistence.db` plus `scatter`: 28 passed. Engine tests (`engine*`, `parse*`): 31 passed, 4 skipped.

## Limits and remaining checks

- RR-05 is verified on Linux by counting opened and closed workbooks without relying on garbage collection; deleting the temporary file immediately after a failed read on Windows has not been run here.
- RR-04's failed-read step depends on Next rejecting a server action that answers 500; it does on this build.
- The scatter wording flag is shown on the Analytics card; the Findings card does not yet mark it (the finding stays as the researcher wrote it, with the flag in `stated_stats`).
- The 3001 Findings and Insights overviews (`18cb7e7`) are Grant's design trial, not part of this repair; their own check (`findings-insights-overview`) passes.
