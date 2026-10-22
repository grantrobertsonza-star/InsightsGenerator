# Analytics workspace memory, restore and posted state

The Analytics workspace (`src/app/runs/[id]/AnalyticsBuilder.tsx`) keeps the results a researcher
had open when they leave and come back (Grant, 2026-10-21). This brief is the contract.

**What is remembered** (`analyticsWorkspaceMemory.ts`). Requests only, never figures: each chart
card's variable, grouping, weight, chart type and presentation (a typed title, series colours,
legend position); each scatter card's pair, weight and the spread option; the NPS request; and the
driver result as either a saved analysis's id or the unsaved request that made it. Per viewer in
this browser (`localStorage`), per run and per data file (`workspaceMemoryKey`): it is not shared,
not durable and can be absent. The stored value carries `ANALYTICS_MEMORY_VERSION`; a value from
another version, malformed, or not JSON is read as nothing remembered (never migrated or half-read).
At most `MAX_CARDS` (60) cards are read, bounding what a corrupted value can make the page compute.
When the browser blocks storage the workspace says results will not be kept after leaving, and
building and posting still work. A bar and a line chart of one question are two remembered cards
(the chart type is part of a card's identity).

**Restoring.** On opening, each remembered card is worked out again from the current file, in its
remembered place, by the same code that builds a new card (`computeChartCard`, `computeScatterCard`,
the NPS and driver runs), so a restored card is made exactly as a new one. Exception: a saved driver
analysis is reopened by its id from Saved analyses as it was saved, its historical report, not a
recalculation, so it may describe an earlier version of the file (as Saved analyses always has). An
unsaved driver result is run again (the engine is statistics, not a model). Restoring only reads: it
posts nothing, saves nothing and calls no model. A restore whose result cannot be made (a variable
gone, a saved analysis deleted, the server not answering) shows the reason with Try again and Clear
and stays remembered until cleared. Leaving, switching file, Clear or Clear all supersede any restore
in flight (the restore epoch and live-slot set): a late answer never publishes over newer intent,
and a card the researcher built meanwhile for the same request is not duplicated.

**Clear.** Each card has Clear; Clear all sits above the results with how many are kept. Clear takes
a result off the workspace and out of the memory; posted findings stay as they are, and a saved
driver analysis stays in Saved analyses.

**Posted state** (UI-GT1000-01). Whether a result is in findings is read from the server for every
card, new or restored. A failed read is not known, never "not posted": chart and NPS cards
(`postedState.ts`) show the error with Retry and offer neither Post nor Remove until a read succeeds;
driver results do the same (`DriverPostStatus`). Scatter cards keep `statusFailed` and say the state
could not be checked; posting a scatter again does not add a second finding. Scatter card state
follows `scatterCardState.ts`: the newest read for a request wins; a post, take-back or wording
decision makes reads already in flight out of date and reads the state back itself; a rebuild that
replaces a card keeps that card's newer state; updates go to whichever card stands for the request.

**Tests.** `src/lib/__tests__/analyticsWorkspaceMemory.test.ts` (round trip, malformed, versioning,
blocked storage, separate files, card cap), `scatterCardState.test.ts` (read and write ordering),
`postedState.test.ts`; browser `e2e/ui/analytics-kept.check.mjs` (one grid, kept across leaving,
reload and file switch, Clear, Clear all, blocked storage), `analytics-posted-unknown.check.mjs`
(posted-state read refused for the application role, then recovery), `scatter-wording-review`,
`driver-posted-state`, `driver-reopen`.

**Limits.** Memory is per browser; another device or a cleared browser starts empty. Remembered
colours are dropped when the recomputed result has a different number of series. The NPS
posted-state failure path is covered by `postedState.test.ts` and shares the chart card's handling;
the browser check exercises the bar chart.
