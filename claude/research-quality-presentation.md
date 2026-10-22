# Research quality review: how the results are presented

The Research quality section (`src/app/runs/[id]/ResearchQualityReview.tsx`) shows a stored review
of a brief, a proposal, or a proposal against its brief. It only presents: every score, band, weight
and overall percentage is computed on the server (`researchQualityDashboard.ts`) and read as stored.
The shared presentation rules live in `src/lib/researchQualityPresentation.ts`; the component
consumes them and computes no score of its own. Scoring itself is in the review's own modules
(`researchQualityDashboard.ts` for the figures, `researchQualityRules.ts` for the criteria
release, `researchQualityChecklist.ts` for the element checklists), unchanged by this brief.

Since Grant's review of 22 October 2026 the review pane has three tabs, Overview, Improvements and
Details, with the chosen item's detail in the right-hand pane. The Criteria tab was removed: its
status filter is now the Overview's Show filter.

## Overview and its Show filter

- **Ring and category bars are the whole review.** The overall ring (weighted percentage) and each
  category's or dimension's bar and score come from the stored dashboard and are never recalculated
  from what is shown. The Show filter narrows the list of criteria only: a filtered list is not a
  new score, and the ring and the category headings keep the whole review's figures. The browser
  check records the percentage before filtering and compares the header with it afterwards.
- **Choices.** `criterionRows` lists every criterion of the review's dashboards once (a criterion on
  two dashboards under the first), with its status from `criterionStatus`. `statusChoices` offers
  All and the statuses present, best band first (Strong, Workable, Weak, Absent), then the states
  without a rating (Not rated, Pending, Failed), and an unknown status last so it stays visible. An
  older-format review with no dashboards takes its choices from its scorecard rows.
- **Filtering.** `filterDimensionsByStatus` keeps each dimension (a category's heading, bar and score
  unchanged) with only its criteria of the chosen status, and leaves out a dimension with none; All
  keeps everything. Matching is by the status as shown, keyed to the stable criterion id, never by
  the criterion's wording.
- **States are not ratings.** `criterionStatus` gives a rated criterion its rating's own label and
  otherwise Not rated, Pending or Failed. These are separate filter choices and are never shown as a
  band, so a failed or pending criterion cannot read as a weak one.

## Improvements

- `improvementsByTiming` groups the suggested improvements of the review's observations (dismissed
  observations left out) by when they can be made: before commissioning or fieldwork, before this
  decision, next study. Empty groups are not shown.
- Each row shows its criterion's short name (`criterionShortLabel`, keyed by criterion id; an unknown
  id is shown as it is) with the same bar, score and band columns as the Overview. The figures come
  from `criterionRating`: the dashboard's rating when the criterion is rated there, else its
  observation's own rating, else Not rated. One decimal throughout.
- Choosing a row selects that criterion: the right-hand pane shows its improvement first, then the
  criterion's question, the reasons for its rating and the document's own words. With nothing chosen
  the pane says what choosing does.

## Selection and the right-hand pane

- A selection is a criterion id, or a dimension with no single criterion (then all of that
  dimension's criteria are shown, a category's with its weight and average). Opening another review
  clears the selection and resets the Show filter to All; a loaded review is shown only while its
  document is the one chosen, so a detail is never shown for another document. Switching between
  Overview, Improvements and Details keeps the selection. Choosing a filter status clears it.
- Quotes in the detail are spans of the stored document text, as recorded by the review.
- Failed or interrupted steps are listed once the run has settled (`shownFailedSteps`); while a retry
  runs, the live count of its own failures is shown instead.

## Tests

`researchQualityPresentation.test.ts` (criterion names, release order, step labels, failed-step
listing, `criterionRows`, `filterDimensionsByStatus`, `statusChoices`, `criterionRating`). Browser
`e2e/ui/research-quality.check.mjs` (no model call on opening; brief review with the overall
recomputed from the scores and weights on screen; the Show filter showing exactly the criteria of a
status with the overall unchanged; a proposal category keeping its heading when filtered; the
Improvements list opening an improvement on the right; the comparison review; the Word export).
The model is replayed: these checks cover presentation and orchestration, not the quality of the
model's judgement.

## Limits

- The Show filter and the selection are per view and not remembered after a reload.
- A status label introduced by a later criteria release sorts last until it is added to the order.
- Not certified for mobile layouts beyond the widths the checks use.
