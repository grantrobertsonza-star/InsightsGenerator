# Handover: AN500-F01 (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch19. Follows
`docs/independent-analytics500-review-main-2026-10-24.md` (AN500-F01). No migration. Nothing pushed
or deployed.

| Commit | What | Kind |
|---|---|---|
| repair commit | AN500-F01 | correctness |
| docs commit | This handover and the status line | |

## AN500-F01: driver label collisions

Codex: canonical predictors X1, X2, X3 labelled "Service", "Service", "Service (X2)" were named
"Service", "Service (X2)", "Service (X2)" in the driver report. `drivers.ts` counted original labels
but did not reserve the names it generated. The chart then joined each ranked driver to its
performance by name, so X3 (the strongest driver, 76.2%, mean 106) was plotted at X2's mean of 16,
and the posted findings and their Excel export named "Service (X2)" as both the strongest and the
third strongest driver. The Python reader kept all three identities; the collision came afterwards.

- **Names.** New `driverDisplayNames` (`src/lib/driverPresentation.ts`), used by
  `runDriverAnalysisFor`: a predictor's label when no other predictor has taken it, otherwise
  "<label> (<code>)", with a further " (2)", " (3)" while that would still clash. Every label is
  reserved before any name is given, so a generated name never lands on another predictor's literal
  label. The fixture now gives "Service", "Service (X2) (2)", "Service (X2)". An empty label falls
  back to the code. The comment that claimed uniqueness is replaced with one that says how it is
  achieved and that names are for reading only.
- **Codes.** Every result row (`DriverRow.variable`), performance record (`DriverPerformance.variable`)
  and segment row carries the predictor's code; a stated-importance record carries it as
  `predictor` (its existing `variable` is the importance question's code).
- **Joins.** All consumers join by the code through one helper, `recordForRow`: the Analytics
  importance-against-performance chart (the defect), the stated-importance chart, the CSM quadrant,
  and the CSM and wave-tracking tables across waves (`waveTrackingActions.ts` and
  `CsmAnalyticsPanel.tsx`, found by inspection; across waves a display name can also differ or
  carry a suffix).
- **Posted findings.** Each driver finding records `variable`, and the "adds little" finding records
  `variables`, beside the existing display name in `question` / `questions`.
- **Older saved reports** have no codes. `recordForRow` then joins by name only when the name is
  unique on both sides and otherwise joins nothing, so a point is left off the chart rather than
  placed at another question's figure. Posting findings from an old report in which two rows share a
  name is refused ("Two drivers in this saved analysis share a name, so the findings could not say
  which question each one is. Run the analysis again, then add its findings."), and nothing is
  added. An old report with distinct names posts as before. Findings already posted from an
  ambiguous old report are not rewritten.
- Figures are unchanged; only identity and joins. Brief: `claude/driver-finding-provenance.md`
  ("Predictor identity").


## Files

- `src/lib/driverPresentation.ts`: `driverDisplayNames`, `recordForRow`, `driverRowsAmbiguous`.
- `src/lib/drivers.ts`: names from `driverDisplayNames`; codes on rows, performance, stated and
  segment results; types.
- `src/lib/driverAnalysis.ts`: `DriverRow.variable`.
- `src/lib/driverFindings.ts`: refusal for ambiguous old reports; codes in finding stats.
- `src/lib/waveTrackingActions.ts`: wave rows by code.
- `src/app/runs/[id]/AnalyticsBuilder.tsx`: quadrant and stated-importance joins.
- `src/app/runs/[id]/CsmAnalyticsPanel.tsx`: CSM quadrant join; wave table keyed by code.
- Tests: `src/lib/__tests__/driverLabelIdentity.test.ts` (8), `src/lib/__tests__/driverLabelCollision.db.test.ts` (5),
  `e2e/ui/driver-label-collision.check.mjs`.
- Docs: `claude/driver-finding-provenance.md`, this handover.

Callers and consumers: `runDriverAnalysisAction`, `runWaveDriverAction` and the CSM dashboard
build (all through `runDriverAnalysisFor`); `addDriverFindings` (through `driverFindings`); the
Analytics and CSM panels. The Findings Excel and deck exports read posted finding text and are
unchanged; their attribution follows from the distinct names.

## Checks run

On the batch20 tree (`047f53c`, batch19 underneath), fresh disposable PostgreSQL 16 (port 55432) and
a fresh disposable application stack (production `next build --webpack`, `next start`); no
development or live database, storage or provider.

- `npx tsc --noEmit`: exit 0. `eslint` on the changed files: 0 errors, 1 warning (an unused `save`
  at `AnalyticsBuilder.tsx:1115`, present before this batch).
- Library suite, `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **1,655
  passed, 0 failed, 72 skipped**, 219 files passed and 1 skipped (this includes batch19's suite with
  its crosstab mock fix, and the 13 new tests).
- Driver and Analytics browser checks, `npx playwright test -c e2e/ui/ui-check.config.mjs
  --workers=1` on the 6 files `analytics-kept`, `analytics-landing`, `analytics-posted-unknown`,
  `driver-label-collision` (new), `driver-posted-state`, `driver-reopen`: **6 passed**. The full
  browser suite was run on batch19 (100 passed, 1 skipped) and not rerun here.
- Golden-thread smoke: **1 passed**.
- Screenshot of the new check: the chart's horizontal axis runs to 106.1 and the strongest driver
  ("Service (X2)", X3, 90.5%) sits at the right; the table lists "Service (X2)", "Service",
  "Service (X2) (2)".

Mutation checks (the fix removed, the test rerun, then restored):
- The exact old naming rule restored in `driverDisplayNames`: **5 of the 13** new library tests fail
  (the exact fixture, reorder, saved/posted/Excel, and two naming tests).
- The old naming rule and the old name join in the Analytics chart, built and served on the stack:
  the browser check **fails, expected above 100, received 16.1**, Codex's reported symptom. The stack
  was then rebuilt on the clean tree.
- Name joins restored in `recordForRow`, the posting refusal removed and the suffix bump disabled: **7 of 13** fail.

## Limits

- The browser check and the database test use synthetic data built to Codex's description (means
  about 6, 16 and 106), not Codex's own SAV files.
- In the database test only the statistics-file transport is supplied (the columns Python's
  `driver_columns` returns); the browser check runs the real upload and Python reader.
- Old saved reports with colliding names are refused for posting and drop the colliding points
  from the chart; they are not repaired in place. Running the analysis again records the codes.
- Not covered by a new browser check: the CSM quadrant and the wave tables (covered by the shared
  helper's tests and by inspection).
