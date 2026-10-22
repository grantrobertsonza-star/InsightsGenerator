# Driver analyses: finding provenance and the request contract

Driver analysis (Analytics, `src/lib/drivers.ts`, engine `src/lib/driverAnalysis.ts`) ranks
predictors of an outcome; a saved analysis (`driver_analyses`, migration 0072) can be posted to
findings (`addDriverFindings`, wording in `driverFindings.ts`).

**Provenance (GT1000-F01, Codex 2026-10-21).** Before this change posted driver findings had no
`source_document_id`: deleting their data file cascaded to the saved analysis and left the findings,
and any accepted insight on them, reading "Support current" in Excel and the Accepted deck. Now:

- `runDriverAnalysisFor` records, with the result, `provenance = { documentId, overridesSnapshot,
  variables }`: the data file, the variable corrections in effect (`loadVariableOverrides`) and the
  variables the request reads (`driverRequestVariables`).
- `addDriverFindings` inserts each finding with `source_document_id` = the saved analysis's data file
  (the same link every other calculated finding has) and `stated_stats.provenance` (the corrections
  and variables, null corrections when the result recorded none). Restoring a rejected legacy finding
  fills its `source_document_id`.
- `deleteDocument` removes driver findings with the file's other findings; legacy findings (no
  `source_document_id`) are reached through their saved analysis before it cascades away
  (`driverFindingSource.ts`). The deletion confirmation counts (`documentDeletionImpact`) use the
  same rule.
- Support (`supportStatus.ts`, rule in `supportStatusShared.ts`): a driver link resolves its data
  file (`source_document_id`, else the saved analysis's file) and whether its saved analysis still
  exists. Saved analysis gone, or no data file: no longer valid, with the reason. Otherwise the
  recorded corrections are compared with the file's current ones for the analysis's variables
  (changed: "variable corrections changed"; not recorded: not checked, never current). Survey design
  (clusters, strata) does not enter a driver analysis, so it is not compared. Excel's Support column,
  the Accepted deck and every other consumer of the loaders follow.
- Legacy findings: resolved through their saved analysis while it exists (not checked: no recorded
  corrections); unresolvable ones are no longer valid. No backfill; no migration.

**Dependencies come from the request (R1000-01, Codex 2026-10-22).** A result travels through the
browser before it is saved, so nothing in its `provenance` is trusted as a dependency list:

- `saveDriverAnalysis` replaces `provenance.variables` with `driverRequestVariables` of the checked
  request (outcome, predictors, weight, group, stated-importance variables), whatever list came
  back: omitted, empty, shortened, foreign or wrongly typed. Replaced rather than refused, because the
  list is derived from the request and carries no choice of the researcher's. A corrections snapshot
  that is not a plain object is stored as null (not checked). The data-file check is unchanged.
- `addDriverFindings` (`savedProvenance`) records the same canonical list on each finding, from the
  saved request, never the saved report's list.
- Support reads the variables from the saved analysis's own request (`driver_analyses.request`,
  joined in both loaders), not from the finding's recorded list, so a list shortened afterwards
  changes nothing. When the request cannot be read (the table is absent, or the request no longer
  parses) the variables are unknown and every correction of the file is compared: any change reads
  as changed, never as current. A missing snapshot stays not checked.

Limits: the saved result is the one the screen received from the run (not recalculated on save);
its provenance must name the same data file or the save is refused. A data-layout change is not
compared (as for calculated tables). Deleting a saved analysis keeps its findings, which then read
"no longer valid".

**Request contract (GT1000-F02).** `parseDriverRequest` (`src/lib/driverRequest.ts`) is the one
runtime contract; `runDriverAnalysisFor` and `saveDriverAnalysis` refuse anything it refuses, before
any read, calculation or write, with an actionable message ("This driver analysis request cannot be
run: ..."). Rules: outcome and predictors are non-empty canonical variable names; outcome type
`continuous` or `binary`; at least two distinct predictors, none the outcome, at most 500; a top box
only for a binary outcome and finite; weight and group distinct from the outcome, the predictors and
each other; stated importance only for listed predictors. Bootstrap: omitted means 200; otherwise an
integer, 0 (no ranges, said in the report) or 20 to 300; 1 to 19, negatives, fractions and
non-numbers are refused. A binary outcome split exactly (Shapley) draws at most 60 resamples, and the
report says so. The engine, called directly, refuses only a value that is not a whole number from 0:
1 to 19 run with no ranges and say so, above the cap are drawn at the cap and say so; the cap (300,
or 60 for a binary exact split) is a run-time bound, because every resample refits the split
(M-R1000-01). Whether a variable exists in the file is decided by the engine's read of exactly
those columns, which refuses an unknown column. The engine itself refuses an unsupported outcome
type and a non-integer bootstrap, so no caller can skip the intervals silently. Figures are unchanged.

**Tests.** `driverProvenance.db.test.ts` (real PostgreSQL, actual actions, deleteDocument, loaders
and export routes); `driverDependency.db.test.ts` (R1000-01: tampered lists, each role, an unrelated
control, a shortened recorded list, clear and rebuild, a non-object snapshot, refusal and retry,
both loaders, Excel all and accepted); `driverRequestContract.test.ts` (contract, engine, actions with the file
boundary shown unreached); existing `driverReopen.db`, `driverAnalysis`, `supportStatus`.
