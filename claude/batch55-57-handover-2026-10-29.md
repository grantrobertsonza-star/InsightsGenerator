# Batches 55 to 57, D2b, Cross tabs and codebook links fixes: handover (29 October 2026)

Status: implemented, ready for independent review. Branch `cb2` (worktree b92), on the redesigned dashboards (D3b) and
CB1. The repairs come from the import test library (`claude/import-test-library-findings-2026-10-28.md`), whose L1, L2,
L3 runners and L4 cases are now in the repository under `conformance/`. Grant's decisions governing them are in
`claude/decisions-2026-10-29.md`. Tier A throughout (engine readers, codebook persistence, claim checks, statistics).

## Batch 56: codebooks and linking (library L2)

- **Engine library cases:** 127 cases, 18 failures before, 0 after. **Linking cases:** 48 of 48 pass (1 failure before:
  L052).
- **Answer lists written without "=".** These are read: `{1, Yes}`, `1. Yes`, `1: Yes`, `1) Yes`, `1 - Yes`, and `1 Yes`
  when the codes run consecutively. Every part of the cell must fit, and there must be at least two answers, so "18
  years and older" and "5 or more, 3 to 4" stay labels.
- **Headers.** A header row is found under up to 14 title rows. Var / Lab / Varname / Indicator Name now count as
  header names.
- **Layouts read.**
  - One row per answer: headed "Value Code", SPSS "Variable Values" tables (both versions, merged with the
    "Variable Information" sheet), and with no header row at all (read by content).
  - Codes across columns: code numbers as headers, or Code1/Label1 pairs.
  - Codes on their own rows under a variable.
- **Sheets and columns kept out of the reading.**
  - A multiple-response sets sheet is skipped.
  - A question map's Filter column (routing) and its Question column are never taken for answer codes.
- **XLSForm.** `select_one yn or_other` keeps the yn list.
- **L052 (S2).** A reworded codebook entry keeps its identity, and its confirmed link, by its code. The rule applies
  only when the code names one item on both sides, so entries sharing a code are never merged.
- **Library linking runner.** It runs without migration 0133. Its cases test the matching rules; CB1's automatic
  confirmation has its own tests.

## Batch 55: data reading (library L1 and L3)

- **Library cases:** L1 had 14 failures before, 0 after (324 pass, 24 questions for Grant).
- **Excel numbers.** Whole numbers beyond 2^53 are kept as exact text, so two identifiers never merge in the preview
  (S1, F1).
- **Identifier formats.** An identifier row formatted 0000 is applied in the columns-as-cases layout (F2).
- **.zsav.** Read, and accepted for upload (F3).
- **Blank rows.** A skipped empty row no longer turns whole numbers into decimals (F4).
- **Data sheet choice.** The data sheet is the one holding the most filled cells, not the longest (L3 D1: the EV
  workbook opened on its pivot output). Both earlier sheet tests keep their outcome.
- **One answer-list reader.** The in-workbook codebook now uses the same reader as codebook files (L3 D2 to D5:
  glued labels). `;` separates answers. A range cell labels both end points (Grant's decision 8).
- **Codes shown as 1, not 1.0.** An unlabelled code shows as 1, not 1.0, when its column has blanks (L3 D8). Cross tab
  row groups saved naming "1.0" still find the code.
- **Blank text answers.** A blank is no answer in SPSS and Stata, as in every other format (decision 6).
- **Non-answers.** "Not sure" and "Unsure" are non-answers. A don't-know that names its subject ("Don't know which
  ...") is an answer (decision 7).
- **Documentation.** The written byte limit is corrected to 100,000,000 (F5).

## Batch 57: claims against aggregated tables (library L4)

- **Library cases:** L4 aggregated had 5 S1 failures before, 0 after; contract-basis failures 0. The remaining 82
  research-basis checks need the banner and layer reading Grant chose to build with the Tables redesign.
- **Proportions.** A column of proportions (0 to 1, labelled as percentages or adding to 1) is read as percentages, and
  the check says so (S1: AGG-02, AGG-12).
- **Counts.** A stated percentage is never compared with a figure the table does not show as one (S1: AGG-08).
- **Row names.** Rows are named by the first text column that varies (S1: AGG-19, a constant SDMX column collapsed the
  table).
- **Label matching.** Labels match by whole words: "55+" no longer finds "5" (AGG-06/16).
- **Document reads.**
  - An answer with no list of tables fails the read instead of reporting none (B-04).
  - A document whose pages hold no text is refused as scanned before any model call (B-07).
- **Pattern scan off** (Grant, 17:19). The open pattern scan does not run on an uploaded summary table. Regenerating
  publishes no scan findings: untouched earlier scan findings are retired, any a researcher acted on are kept. The
  trace records the scan as off. An interim version that kept scan findings as suggestions was reverted; it also
  reached banner-plan findings.
- **"-" and "\*" cells** (Grant, 17:19). "-" is read as 0 and "\*" as more than 0 but under 0.5%. The check's
  summary states each reading. A stated figure or threshold is decided against "\*" only when the range settles it;
  otherwise the check says it cannot tell.
- **Bases.** A re-derived test uses the unweighted base when the table also gives a weighted one (decision 3).

## D2b part 1: NPS group against the rest

- **What it computes.** Each banner column's NPS against everyone else in its banner variable (the complement, as every
  column test), in points.
  - Its standard error is the domain contrast's Taylor-linearised standard error: design-based with a design, the
    with-replacement estimator without.
  - The groups of one banner variable are corrected by Benjamini-Hochberg.
  - It is carried into the NPS tool's segments as `versusRest`.
- **Reference.** statsmodels' weighted regression of d on a group indicator, with a cluster-robust variance times
  G/(G-1), on a fixed 240-case weighted, clustered fixture. The values are recorded in
  `fixtures/reference/nps_groups_reference.json` (script `scripts/reference/nps_group_reference.py`). The engine
  equals it to 4 decimals, clustered and unclustered.
- **Not covered.** A stratified design is not covered by this reference (statsmodels has no strata). The engine uses
  the same PSU-total machinery as its other design-based tests.

## D2b part 2: promoter model accuracy

- The promoter model's accuracy and majority-class baseline (already computed by driver analysis, with its no-gain
  warning) are checked against an independent statsmodels weighted logistic regression on a fixed 300-case fixture
  (`scripts/reference/promoter_accuracy_reference.py`). Coefficients, accuracy and baseline agree.

## Cross tabs (Grant's screenshot, 29 October 2026)

- The menu count is the project's saved tables, not its data files. After every table was deleted it still showed 3.
- Deleting a table clears earlier notes and says what it deleted. A table already gone reads as already deleted, not
  "That table is not in this project". Delete waits while another action runs.
- `crosstabs-entry.check.mjs` step 6 deletes every table and checks the count and the message.

## Codebook links review (Grant's screenshot, 29 October 2026)

- **Bug.** With a codebook linked to three wave files, the links column listed all three waves' links under one
  file's heading. respondent_id showed three times, and "Confirm all 2" on one variable would have confirmed
  another wave's link the researcher could not see.
- **Change.**
  - The column shows the chosen data file's links only. A note says how many other data files have links and how
    to check them.
  - `confirmQuestionLinksAction` takes the shown data file, and `confirmInstrumentLinks` confirms only that file's
    suggestions for the question. The action checks the id's form; the existing locks and ownership checks still
    run on the write.
  - The panel is 70% of the screen height when it lists more than 8 questions, and resizable by its corner. The
    links column takes 45% of the width.
- **Why the tests missed it.** The links tests used one data file. `gridLinks.db.test.ts` now has a two-wave case,
  and `codebook-waves.check.mjs` step 3 checks one link per wave in the review.

## Cross tabs "Copy here" (Grant, 29 October 2026: a copy "didnt seem to work")

- **What was wrong.** The server copy itself works (shown with the actual engine on the banking pack's two
  waves), but the screen gave little to go on:
  - From a wave with no tables it said "Copied 0 table(s)".
  - The copies keep the way their originals were made, so a StarterTabs or SemanticTabs original was not
    listed under CrossTabs, where the researcher was.
  - A second click built every table again.
  - The copy had no test.
- **Change.**
  - A wave with no tables says so.
  - After a copy the screen shows All tables, where every copy is listed, and the note names the wave and says
    where the copies are.
  - Each copy records its original (`crosstab.copiedFrom`). A repeated click, a retried request, two copies at
    once (checked under the file's lock) or a copy of a copy adds nothing, and the note says the table is
    already there.
  - Copying a wave onto itself is refused.
  - Tables that cannot be rebuilt are still listed with their reasons.
- **Tests.**
  - `crosstabWaveCopy.db.test.ts` (4 tests, real database and actual engine; all 4 fail without the change).
  - `waveCopyMessage.test.ts` (4).
  - `crosstab-wave-copy.check.mjs` (browser).
- **Why the tests missed it.** There was no test of the copy at all.

## Cross tabs: Edit in Build table (Grant, 29 October 2026: "i would not have to do it all from scratch, just change what i wanted for that wave")

- **Edit in Build table.** Each saved table now has this button. It loads the table's columns, rows, nets, column
  groups, filters, layer, comparison correction, non-answer and mean settings into Build table for the open file.
  - Variables that file does not hold are left out and named in the note.
  - The weight and survey design stay the file's own settings, as for any table built on it.
  - A table saved before tables kept their definition says it cannot be edited.
- **Update table.** Shown when the table being edited is a draft of this file and not part of a layered set. It
  replaces the draft:
  - The edited table is built first, then the old draft is removed only if it is still a draft of this file. If
    it was committed or deleted meanwhile, it is left as it is and the note says so.
  - The new table keeps the old one's `copiedFrom`, so Copy here does not bring the original back.
  - A committed table, or another file's table, is never replaced. Add table to set always keeps both.
- **Screen state.** While a definition loads, Edit, Stop editing, Add and Update wait (the workspace's pending
  state), so a slow load cannot land over a later choice. Each data file has its own workspace, so switching files
  does not carry an edit across.
- **Tests.**
  - `crosstabWaveCopy.db.test.ts`: a fifth test reads a copy back, replaces it with an edited banner, copies again
    (nothing added), and refuses a committed table and another file's table.
  - `tableDefinitionEdit.test.ts` (3).
  - `crosstab-wave-copy.check.mjs` step 4: edit, add a column, Update table, still one table.

## Setup: a wave label typed during the first acceptance (found by the browser suite, 29 October 2026)

- **Bug.** A file's Setup saves by compare and swap. When a wave label was saved while the file's first-view
  acceptance was also saving, the label's save met that acceptance. The screen said "changed elsewhere", showed the
  saved version and dropped the label. `waves-in-project.check.mjs` failed this way twice today, both times under
  load (on D3aR2's tree and on CB1's). Your laptop's code has the same behaviour.
- **Change.** `rebaseSetupEdit`: when the other save changed none of the fields this edit changed, the edit is
  applied once more on top of what is saved, with what is saved as the expected version.
  - If the other save changed the same field, it is still a conflict, shown as before.
  - A structure change still asks for acceptance again, judged against what is saved, so a concurrent acceptance
    never accepts a structure nobody checked.
  - A second conflict on the retry is shown, never retried in a loop.
  - A layout change made this way re-reads the file, as before.
- **Tests.** `dataSetupRebase.test.ts` (6): the repro, the same field changed elsewhere, a structure change, an
  explicit accept or undo, nothing changed, and the design compared by value. `waves-in-project.check.mjs` is the
  browser check that caught it.
- **Why the tests missed it.** The setup tests saved one change at a time. The race needs a save to land while the
  first-view acceptance is still in flight, which only happened on a loaded machine.

## Found by the combined run (29 October 2026, evening)

- **Older tests.** Three older library tests still expected an unlabelled whole-number code to be listed as
  "1.0": `dataFileFormats.db.test.ts`, `delimiterChoice.db.test.ts` and `reverseCoding.db.test.ts` (2). Batch 55
  (L3 D8) lists it as "1", the raw code. They now expect "1", with the reason in their comments. Saved groups
  naming "1.0" still resolve.
- **Help index.** The help index was stale after the screen text changed. It has been rebuilt
  (`node scripts/build-help-index.mjs`).
- **Cross tabs count.** The menu's Cross tabs count and the file chooser's table counts are drawn by the server,
  so they did not change after a table was added or copied. `crosstabs-entry.check.mjs` step 6 caught it. The
  workspace now refreshes them whenever its list is reloaded.

## Tests (each shown failing without its change)

| Test | Result | Before the change |
|---|---|---|
| `codebookShapes.test.ts` | 8 | 7 failed (control passed) |
| `codebookReread.db.test.ts` | 2 | the reword case failed |
| `dataReadingRepairs.test.ts` | 10 | 7 failed |
| `tableClaimsUnits.test.ts` | 8 (one new: "-" and "\*") | 6 failed |
| `tableRegeneration.db.test.ts` | 9 (one new: scan off) | n/a |
| `npsGroupTests.test.ts` | 5 | n/a (against the independent reference) |
| `promoterAccuracy.test.ts` | 3 | n/a (against the independent reference) |
| `gridLinks.db.test.ts` | 4 (one new: two waves) | the new case failed |

`instrumentScope.db.test.ts` and the codebook, instrument, engine, tracker and claim suites were run as affected
suites. Full gates: see the package note.

## Not done yet (recorded)

- **Decision 5:** a warning when "NA" sits in a column of two-letter codes. It needs the diagnostic carried to the
  Import screen, as unsupported identifier formats are.
- **Decision 9:** title rows above an Excel header detected, with the header row changeable on Import.
- **Batch 55's measured resource limit by cells.** A case count checked before the full read; the CSV preview at
  144,090 cases took 125 s against 60 s. This is a performance change and needs before-and-after measurements.
- **Path B (Word/PDF tables).** Keep the banner group row (B-02), join a table across the 5-page reading boundary
  (B-03), and flag rows longer or shorter than their headers (B-05, B-06).
- **Known mirror.** `descriptiveFindings.ts` keeps its own don't-know pattern (registry gap). It does not yet include
  "not sure".
