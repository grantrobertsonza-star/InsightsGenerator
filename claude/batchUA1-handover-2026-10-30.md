# BatchUA1: Usage and attitudes dashboard

Status: implemented, ready for review.
Base: acd572122dd03f0133f76acbafb6f985f8083648. Branch: codex/ua-module.

## Scope and contracts

A new Analytics tile opens nine U&A pages. Recognition uses confirmed codebook question identities, wording, answer labels, routing and companion state fields. It never derives the printed question number from a physical column prefix. Ambiguous roles are mapping questions. Missing page inputs are labelled Not asked in this file. Optional missing inputs do not suppress the entire dashboard.

Read `claude/usage-attitudes.md` for recognition, statistical, storage and integration contracts. `claude/ua-metric-contracts.json` records every planned measure's formula, source variables, answer conditions, assignment, eligibility, period, unit and logical-zero rule. `src/lib/uaMetrics.ts` is the definition owner; the JSON is an inspectable output, never a calculation input. Figures use `computeCrosstab`, existing survey-design resolution and the existing statistical engine. U&A temporary measures cannot be saved as ordinary tables through buildCrosstab.

## Tier A impact checklist

1. Rule: canonical variables and confirmed labels come from existing dictionary/instrument owners. Shared surveyDesign resolves the design and crosstab owns estimates, Kish bases and suppression. New semantic, route, metric, scope and comparability owners are registered in rules-registry.md. Relational workbook tables join by explicit IDs rather than names or positions. Python support files live under scripts/engine, not api, so they are not extra Python function endpoints.
2. Inputs: unsupported, incomplete, ambiguous or unavailable inputs refuse the affected calculation with a reason. Assignment precedes eligibility and valid-answer selection. Routed, refused, unknown and unshown blanks are not zero. Explicit logical zeros require confirmed non-use for the same period. Means exclude unanswered values. Numeric code aliases and out-of-domain answered codes refuse instead of silently merging. Analysis weights and fictional expansion weights are distinct. Population universes never sum across waves.
3. Persistence: only researcher choices are stored in migration 0140_ua_dashboards.sql. Tenant, project, active document and programme scope are checked again under project/document locks. Scope and revision are compared in the transaction, including initial inserts. Conflicting saves cannot overwrite each other; a moved project requires a reload. The pre-migration screen computes but refuses saving with a migration explanation. This migration has only been applied in task-owned disposable databases.
4. Freshness: figures compute on read against the current dictionary/setup; no stored tables or findings are inserted. Saved role corrections are revalidated. Human choices that do not apply to a wave are retained with a reason. Previous-wave changes require identical variable, method, conditions, codes, unit and label. Percent changes use unrounded values, are descriptive and never imply respondent retention or significance.
5. Screens: response identities include file, page, weighting, brand selection and saved revision. Old responses cannot replace the selected page or appear under new controls. Saved appears after acknowledgement. The panel is keyboard reachable, traps modal focus, supports Escape and wraps labels. Only AnalyticsBuilder.tsx is changed among existing screen files, by its import and tile. Segment wiring is deferred through withUaSegment; uaWaveDifference is the descriptive integration point for future significance work.
6. Proof: actual CSV readers, relational codebook reader, confirmed links, database and statistical engine exercise all three supplied QA waves. Tests also cover independent pandas repertoire/basket controls, split assignment, routed blanks, rescaled weights, recognition negatives, failures/recovery, ownership and concurrent saves. Mounted panel tests substitute server actions only. Production browser uses native uploads and a task-owned local storage/auth/model replay stand-in; figures and PostgreSQL remain real. Completed gate counts are recorded below.

## Shared import prerequisites and measurements

The native 5,000-case, 600-variable files exposed two existing bottlenecks. Both fixes preserve outputs and have focused boundary and recovery checks.

* Routing quality reused a gate's identical raw-value groups rather than rebuilding them for each missing target. Complete quality JSON is exactly equal to the base commit, SHA256 a6d921447ee74bdb83f1aac7639b2ef2489ca81ed7a94f63af14a45fb2f1d59f. Paired calculation time: 22.7116471 s before, 1.7052958 s after. Reproduce with node scripts/benchmark-import-routing.cjs. This excludes import I/O, database and UI time.
* Worker framing scans each incoming chunk once, retains UTF-8-safe fragments until newline, and parses a complete reply once. Paired identical 16,777,239-byte reply: 13.9856942 s before, 0.0570547 s after, one complete message in both cases. Reproduce with node scripts/benchmark-stats-framing.cjs. This excludes engine computation, storage and UI time. Protocol 7 replaces the old listener during dev hot reload, including a protocol-6 holder.

Native attempts before these fixes are retained under work/ua. They are failed attempts, not passing evidence. The first timed out uploading the codebook; the next reached upload completion but could not select the refreshed source within the helper budget. The final native journey and timings are reported with the browser receipt below.

## Validation

Final tested code: ba9a67e6b00d2e583e370b1dfcb5f651c112ccb5. The final evidence commit adds only this handover, screenshots and validation receipts. Full file coverage is machine checked in `docs/ua-validation/validation-summary.json`.

| Check | Actual command | Result |
|---|---|---|
| Types | `node_modules/.bin/tsc.cmd --noEmit` | Exit 0 |
| Lint | `node_modules/.bin/eslint.cmd src e2e --quiet` | Exit 0, no errors |
| Engine | Portable Python 3.12 `scripts/crosstab_selftest.py` | 565 checks passed, 0 failed |
| Production build | `node_modules/.bin/next.cmd build --webpack` | Exit 0; existing unpdf import.meta warning |
| Broad library | `node_modules/.bin/vitest.cmd run src/lib/__tests__ --pool=forks --maxWorkers=2 --minWorkers=1 --testTimeout=30000 --hookTimeout=300000 --exclude '**/statsWorkerFreshness.test.ts' --exclude '**/statsWorkerReload.test.ts' --reporter=default --reporter=json --outputFile=work/ua/library-release.json` | 368 files: 362 passed, 3 failed, 3 skipped. Tests: 2,761 passed, 7 failed, 97 skipped |
| Serial failure-family rerun | Same Vitest flags, one worker, the complete `researchAssistantTools.db.test.ts`, `trackerAdvertising.db.test.ts` and `trackerCategory.db.test.ts` families | 3 files passed; 36 tests passed, 1 skipped, 0 failed |
| Worker checks after browser completion | `node_modules/.bin/vitest.cmd run src/lib/__tests__/statsWorkerFreshness.test.ts src/lib/__tests__/statsWorkerReload.test.ts --pool=forks --maxWorkers=1 --minWorkers=1 --testTimeout=30000 --hookTimeout=300000 --reporter=default --reporter=json --outputFile=work/ua/worker-release.json` | 2 files, 8 tests passed, 0 failed |
| Native browser | `node_modules/.bin/playwright.cmd test -c e2e/ui/ui-check.config.mjs e2e/ui/ua-dashboard.check.mjs --workers=1` with `GOLDEN_SMOKE_TARGET_MANIFEST=work/ua/stack-release/target-manifest.json` | 1 passed, 0 failed; 454.2 seconds |
| Visibility regression | `vitest run src/lib/__tests__/uaPanel.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1 -t 'queues no recognition'` on the previous tile, then the complete family on the repair | Before: expected 0 requests, received 1. After: 5 tests passed, including boundary and failure recovery |

All 370 library test files are covered. Taking the complete serial rerun families and the separate worker checks gives 2,776 passed and 97 skipped, with no remaining failed case in that consolidated coverage. This is **not one clean full-suite run**. The broad run's seven failures remain recorded by name in the JSON receipt. Five were in Research assistant capacity/claim timing and the subsequent blocked cases; two were Windows temporary-file permission errors in tracker recovery. All three families passed serially. Scheduling/concurrent temporary-file access is implicated, but their complete root cause is not established by a passing rerun. No unrelated application code was changed to conceal these failures. Claude should rerun the integrated full gates.

All 198 supplied QA instances reproduce: 990 checked quantities (eligible count, valid count, weighted valid base, numerator, value). Counts are exact; weighted tolerance is max(1e-6, abs(reference) * 1e-6). No QA metric is withheld or replaced. Independent pandas checks additionally verify named-brand repertoire and recalled basket change, including weighted, raw and Kish bases. The final database family passed 9 tests in 95.7 seconds. Recognition passed 7 tests; mounted panel and visibility passed 5. New wide-quality and framing families passed 4 and 5 respectively. The complete engine self-test includes routed-blank counterexamples, missing/domain refusal and recovery, split samples, weight rescaling, suppression and indicative-base controls.

The production journey uses the actual three 5,000 by 600 CSV files, relational workbook and questionnaire. It confirms codebook links, reads back all three wave labels, checks headline QA values, saves focal brand and light threshold, visits nine pages, checks the wave-2 change from unrounded values and reopens after reload to verify saved choices. All nine 1440x900 captures are committed under `docs/screenshots/ua/` and visually reviewed. There is no database seeding shortcut for the browser inputs.

The earlier native attempt reached the correct 89.5% figure but failed because Node's en-ZA formatter produced a comma and Chromium produced a decimal point. The assertion now obtains its formatting from Chromium. That was a test-oracle correction, not an arithmetic correction. Earlier upload/source-refresh failures remain failed attempts in work/ua. The final native pass took 7.6 minutes; no fast-import or commercial-release claim is made.

The complete library used a fresh task-owned pgvector PostgreSQL 16 cluster at loopback port 56343, with TEST_DATABASE_URL set. The browser used a separate task-owned local cluster at 56342 and the app's `scripts/e2e/local-stack.mjs`, production mode through E2E_NEXT_START, app port 3231 and synthetic service port 39731. No real Supabase credentials or real model calls were used. Portable Python 3.12 plus the existing local test dependencies was selected explicitly through PYTHONHOME/PYTHONPATH/PYTHON_EXECUTABLE and PATH; BLAS threads were limited to one. Database tests have their normal per-family timeout overrides; the broad command uses a 30-second default and a 300-second hook budget.

Existing gates missed the two wide-import bottlenecks because small fixtures do not exercise repeated 600-variable routing groups or a fragmented 16 MB pipe reply. The native full pack and paired complete-output benchmarks now cover both. The hidden-tile request regression independently measures the extra eager request and its removal; it is not used to claim a causal end-to-end speedup.

## Limits and integration

* This first version targets the supplied structured English, numeric-coded U&A schema. Relational workbooks need a successful reread to publish the new research metadata. It is not a universal arbitrary questionnaire parser.
* Claude must connect trackerSegment/SegmentPicker and the effective-base significance tool. The UI says segment integration is pending and makes no significance claim.
* The light-user threshold is a researcher choice, never an invented cut-off. Without it the light-user measure is unavailable with its reason.
* Wave and compare-brand controls affect the current view. Focal brand, weighting, role corrections and light threshold are revision-saved per programme/project scope.
* Basket differences are recalled consecutive baskets, not measured churn. Recent occasion is one reported episode, not a distribution of all occasions. Shopping trips overlap. Open text is sourced verbatim excerpts, not generated themes or representative prevalence.
* Population output is explicitly a fictional planning universe within one wave. Known-answer spend totals do not impute unanswered spend.
* No deployment, live Supabase changes, main-branch changes, report integration, export or cross-module segment work is included. Claude reviews and integrates this branch before application.