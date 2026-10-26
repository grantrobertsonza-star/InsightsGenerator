# Repair handover: Codex's 20 October review (IR-01 to IR-11, M-01, M-02), 21 October 2026

Status: **implemented, ready for independent review.** Repairs for every finding in `docs/independent-review-2026-10-20.md`, on both copies, authorised by Grant at 22:07 on 20 October ("do all three overnight"). The last accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked. Nothing pushed or deployed; no development or live database touched; no migration added.

## Review targets

| Copy | Path | Package 1 | Package 2 | Package 3 | Docs |
|---|---|---|---|---|---|
| Main (3000) | `C:\Personal\InsighsAI\app` | `bee2612` | `356a3e9` | `dcefdc0` | this commit |
| Redesign (3001) | `C:\Personal\InsighsAI\app-import-redesign` | `b8b4299` | `d8e4ba2` | `40be83b` | this commit |

Code trees after package 3: 3000 `bad146ef346ac0c01d62b75d9a3b173d9e31d934`, 3001 `ce38efe32d9065dcdbec987d7a5a256f067bb744`. Each package has its `hashes.txt` under `.fnd001/overnight/{m,r}-ir{A,B,C}`. Intermediate states were type-checked on their own: on 3000 package 1, and 1+2; on 3001 package 1 (each commit compiles). The shared files (engine, scatter, driver, chart and margin-of-error code, `AnalyticsBuilder.tsx`, `DocumentPicker.tsx`, `CrosstabWorkspace.tsx`) are byte-identical across the copies; the questionnaire files, `ResearchQualityReview.tsx` and the run page are repaired separately in each.

One change from the agreed packaging: the IR-10 histogram caption is in package 1, because it shares `AnalyticsBuilder.tsx` with the driver and scatter repairs and could not compile as its own commit. Package 2 is IR-06 alone.

## What changed, by finding

**IR-09 (engine).** `_apply_zero_padded_id_formats`: when the number-format inspection cannot open an `.xlsx`/`.xlsm` that has identifier columns, the read fails with the columns named and why (leading zeros like 0007 cannot be confirmed; identifiers could merge), and tells the researcher to read again or store identifiers as text. Chosen over blank-and-flag because, once the format is unknown, a padded cell and a literal "7" cannot be told apart, so flagging would leave the collision and blanking would destroy good literal IDs. Failed reads are not cached, so a retry reads formats fresh. `.xls` is unchanged: openpyxl can never inspect it (a permanent reader limit, stated in the comment). The one-pass `iter_rows` path is untouched.

**IR-01, IR-02 (scatter findings).** `scatterActions.ts`. Identity: file, the two variable names, weight (weighted and unweighted stay distinct). Each finding stores `stated_stats.basis`, a SHA-256 over the stored path, `content_sha256` (0098; null where absent), chosen sheet, saved layout and the three variables' labels, using `canonicalJson`. A repost or a revival recomputes on the server and updates the same row (id kept, so insights built on it see the change through the existing support check); a researcher-set theme is kept; same figures with a new basis refresh only the basis. The file is read before the transaction, so a failed read writes nothing and returns the error. Inside the transaction the document row is locked (`for update`, confirming it exists in this project) and the finding looked up after the lock. `scatterFindingStatusAction` returns `current` (true, false, or null when unknown, never shown as current); the Analytics card says when a posted finding was worked out from an earlier version and offers "Update it with the current figures".

**IR-03 (driver analysis).** `AnalyticsBuilder.reopenSaved` restores the saved request (outcome, type, top box, predictors, weight, group by; stated importance as saved), the analysis id and its posted state, from the list already loaded (no second read to arrive late). `saveDriverAnalysis` locks the run row (confirming it exists for this organisation), checks the data file is in the project, and returns the existing analysis for the same file, request and report. `addDriverFindings` locks the analysis row before its duplicate check; returns `{ added, alreadyPosted }`; findings in use are left alone with their wording, taken-out ones restored. List and count failures are reported (a missing table is the only empty list), not shown as empty or unposted. Delete reports failure.

**IR-04 (questionnaire confirmation).** `instruments.ts`: one rule, `variableTakenBy`, used by manual choice (3000), single Confirm/Reject (`setInstrumentLinkStatus`) and bulk Confirm (`confirmInstrumentLinks`), each locking the data file row(s) in id order first. A variable confirmed for another question of the same data file is refused with that question named; repeats are no-ops; Reject never conflicts. Bulk Confirm confirms the free links and leaves conflicts as suggestions, reported with the reason (one conflict does not hold back other strong matches; within a batch the stronger suggestion wins). `InstrumentCard` says how many were left as suggestions and why.

**IR-05 (automatic reading).** A read takes a claim under the document's row lock before any model call: an `instrument_read_started` trace row as the record, ended by a later finished, failed or released row, or after 15 minutes (`INSTRUMENT_READ_CLAIM_MINUTES`; the longest read is about 7). A read that throws writes a release, so Read again works at once. A second session gets "already being read" with no model call and no recorded failure; on 3000 the page shows that and checks back every 5 seconds. No existing column could hold the claim without a migration; the row lock is what serialises, the trace row is the record.

**IR-06 (margin of error).** `marginOfError.ts`: every stated confidence level in the sentence is collected ("at the 90% level", "90% confidence", "(95% CI)", "confidence level of 95%" and similar); one stated level is used and labelled stated; 95% is assumed and said only when none is stated; a level other than 90/95/99 is "not checked" with the reason. Margins: after "margin of error"/"sampling error"/"MoE" or a plus-or-minus, or just before "margin of error", in %, per cent, pp, points, percentage points; a percentage followed by confidence/level/CI is never the margin. Two levels, two different margins or two sample sizes: "not checked" with the reason. Formula, verdict names (`consistent`, `understated`, `conservative`) and the screen and Word text unchanged.

**IR-07 (Coding switching).** `DocumentPicker.tsx`: an opened file's card stays mounted, hidden, when another is chosen (each in its own keyed subtree; a file gone from the list is dropped and the selection falls back to the first). `CodeThemesSubmit.tsx` replaces the Code themes button: it also polls the server's progress for its transcript, so it shows "Coding..." and stays disabled after a reload, in another tab or after a remount, and refreshes the page once when that run ends. Server side, `codeThemesAction` claims the transcript (`codingProgress.claimCodingRun`) for the whole action and refuses a second start; the claim shows as "Preparing coding" before the first model pass. Limit: the progress store and claim are process memory, so they cover one server instance, not a multi-instance deployment (said in the code).

**IR-08 (Cross tabs titles).** `CrosstabWorkspace.tsx`: the saved-table header row wraps; the title button keeps at least 16rem with its "may be outdated", design and freshness labels wrapping under the title; the actions move to the next line.

**IR-11 (Research quality switching).** `chooseDoc` compares the chosen document's latest review with the review last requested, not the one still on screen; the request counter already drops the older answer. Applied to both copies (the comparison was the same on 3000; Codex's 3000 probe did not reach it).

**M-01 (3001).** The Projects page's facts query moves to `lib/projectList.listProjectFacts`, with an explicit `tenant_id` filter as `listProjects` has; the page only renders.

**M-02.** `concurrent-limit-uploads` says it tests the 100,000-case limit with 20 MB files, not the 100 MB byte limit, and names the checks that do (renamed "concurrent case-limit uploads"). Empty states, the unsupported-format message and the knowledge base no longer offer SAS; the crosstab workspace and analytics header comments describe the current screens. Code comments that describe which file names are recognised (SAS is recognised, then refused) are unchanged.

## New and changed tests

Unit and real-database (PostgreSQL 16; only file readers, the model and Next request plumbing mocked):

| File | Tests | Reproduces | On the previous code |
|---|---|---|---|
| `engineFormatInspectionFailure.test.ts` | 2 | IR-09: 0007,0008,0009 and 7 with only the inspection open failing; retry exact; short row; no-ID sheet unaffected | both fail |
| `scatterFindingPersistence.db.test.ts` | 9 | IR-01/02: r +1 to -1, label-only, revive, failed read and retry, two simultaneous posts, simultaneous revival, weighted and unweighted, another project | 8 of 9 fail |
| `driverReopen.db.test.ts` | 5 | IR-03: same result saved twice, repost (Codex's 3 to 6), rerun, remove and repost, simultaneous saves and posts, another project | 4 of 5 fail |
| `chartMethod.test.ts`, `chartKinds.test.ts` | 3 + 2 | IR-10: 26 unlabelled values tabulated as categories give the one-bar-per-value caption | |
| `instrumentConfirmCollision.db.test.ts` | 5 (4 on 3001) | IR-04: two-connection race, Confirm after manual choice, bulk mixed, repeat, reject then confirm | 9 of the 10 IR-04/05 tests fail |
| `instrumentReadSingleFlight.db.test.ts` | 5 | IR-05: two concurrent reads give 1 model call, failure and retry, expired claim, another project | |
| `marginOfError.test.ts` | 17 (9 new) | IR-06: Codex's 90% sentence, two levels, 80%, ±3pp, reverse order, space thousands, two sizes; hand-worked reference values | |
| `codingRunClaim.test.ts` | 3 | IR-07: second claim refused, busy before the first pass, abandoned claim lapses | |

Browser (production build, disposable stack, replayed model):

| Check | Covers | On the previous code (3000) |
|---|---|---|
| `coding-switch` (new) | IR-07: server-reported running state after reload; other transcript free; switch back keeps "Coding..." and the chosen coding file; button returns when the run ends (progress route stubbed) | fails: "Code themes" shown while running |
| `driver-reopen` (new) | IR-03 in the browser: run, post, reload, reopen restores outcome and predictors and shows posted; remove and post again: 1 analysis, same findings | fails: predictors unchecked |
| `group-correction-calculation` (extended) | IR-08 at the default 1280px viewport: the title toggle at least 200px and its "may be outdated" label visible, then with the variable pane at its widest | fails: 66px |
| `research-quality` (extended) | IR-11: proposal, brief, proposal with server answers slowed 800ms; the proposal's review and Improvements stay | fails: Improvements tab not found |

The four "previous code" runs used the 3000 commit before the repairs (`d2dea50`) with only the new check files copied in; all four failed for the reasons above, and pass on the repaired code.

## Checks run

All in the cloud review clones on a disposable PostgreSQL 16 and the local stack (production build), model replayed. Their code is identical to the laptop commits (comparing `git ls-tree`, only review documents differ). Mirrors: 3000 `3c87880`, 3001 `ee71ea5`.

| Check | Command | Main (3000) | Redesign (3001) |
|---|---|---|---|
| Types | `npx tsc --noEmit -p .` | Pass | Pass |
| Whole-repository lint | `npx eslint .` | 349 errors, the same total as Codex's baseline (`1e0f2a3`, `d2dea50`); none in the repaired files beyond the pre-existing `CodingProgressBar` set-state-in-effect, which moved a few lines | 349, same |
| Unit and real-database | `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks` | 165 files passed, 1 skipped; **1,184 passed**, 62 skipped, 0 failed | 166 files passed, 1 skipped; **1,192 passed**, 61 skipped, 0 failed |
| Full browser suite | `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` | **63 passed**, 0 failed, 1 skipped (real-model check on replay), 18.1 min | **63 passed**, 0 failed, 1 skipped, 17.9 min |
| Smoke | `npx playwright test` | 1 passed | 1 passed |
| Objective acceptance | `node scripts/e2e/objective-review-acceptance.mjs` | passed (3 checks) | passed (3 checks) |
| Targeted browser checks before commit | coding-switch, driver-reopen, group-correction-calculation, research-quality, coding-reports-sections, transcript-card, import-file-detail, analytics-landing, crosstabs-entry, plus questionnaire-manual-link and guide-auto-read (3000) or projects-page and set-objectives-workspace (3001) | 11 passed | 11 passed |
| Previous-code controls | the four new or extended checks against `d2dea50` | 4 failed, as intended | not run |

The browser suites ran at Playwright's default 1280x720 except where a check sets its own viewport; Codex's Windows run may still differ in font metrics, which is why the IR-08 assertion measures widths rather than only visibility.

## What used mocks versus real infrastructure

Real: PostgreSQL 16 (unit `.db` tests and the stacks), the Python engine, production Next builds, Chromium. Mocked or replayed: model answers, Supabase Auth and Storage stand-ins, the statistics file reader in the scatter and instrument unit tests, the `/coding-progress` route in `coding-switch` (the boundary the page polls, so the check does not depend on replay timing).

## Limits and items for Codex to judge

- IR-05's claim is a trace row guarded by the row lock, not a dedicated job table; a read longer than 15 minutes could be taken over. A claim column (migration) would be cleaner if wanted.
- IR-07's server claim and progress are per server instance.
- IR-01: the Findings list does not mark a scatter finding stale by itself; the Analytics card does, and a repost updates it in place. Duplicates created before this repair are not merged (the oldest is updated).
- IR-03: saved-analysis deduplication compares stored JSON; the engine is seeded, so a re-run on the same data matches.
- IR-09: `.xls` identifiers still cannot be format-checked; Codex's original `csm_Wave1_Baseline.xlsx` is not available here.
- Whole-repository lint: see Checks run.
