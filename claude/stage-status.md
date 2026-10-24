# Stage status: section overviews, module status lines and the main dashboard

Grant, 2026-10-23, prototype on 3001: one overview per sidebar stage (Prepare, Analyse, Develop
findings, Deliver) with a card per module; a one-line status at the top of every module's page;
and on the main dashboard, each project's four stages and its next step.

## Where

- Module rules: `src/lib/stageStatus.ts` (Import, Objectives, Cross tabs) and
  `src/lib/sectionStatus.ts` (Research quality, Business decisions, Analytics, Coding, Secondary
  analysis, Findings, Insights, Recommendations, Insights report), the section roll-up
  (`sectionStatuses`) and the next step (`nextStep`). Pure.
- Facts: `src/lib/projectStageFacts.ts`. `loadProjectStageFacts` reads one project's stored records
  (the same for its own overviews and the main dashboard); `loadProjectOverviews` reads the main
  dashboard's rows, four projects at a time, each with its own error. `objectiveUnscoredReason` is
  the one rule for an objective's unscored reason, shared with the Objectives page.
- Fuller checks, inside a project only (`runs/[id]/page.tsx`, `sectionState`): a preview's identity
  and data quality flags (Import), whether the stored tables loaded (Import, Cross tabs), and the
  attention counts of the Findings, Insights and Recommendations overviews (`summarizeFindings`,
  `summarizeInsights`, `summarizeRecommendations`). Where a fact is absent its items are not
  produced, and the main dashboard says its status is from the stored records.
- UI: `runs/[id]/SectionDashboard.tsx` (the overview and `ModuleStatusBar`),
  `components/StageLook.tsx` (colour, icon and word per state), `runs/[id]/stageLinks.ts`
  (cross-module links), `app/page.tsx` (project rows).

## States

| State | Meaning |
|---|---|
| Couldn't check | Something the module depends on could not be read or verified; never Ready |
| Needs you | Only the researcher can do it |
| Working | The app is doing it by itself |
| Ready | None of the above; caveats can still be listed |
| Not used | An optional module not used in this project (Research quality, Analytics; Coding without transcripts; Secondary analysis without reports; Cross tabs when the project has only transcripts or reports). Shown, left out of the stage's state |

A stage takes the worst state among its modules in use; all unused is Not used. The next step is the
first item, in workflow order, that needs the researcher or could not be checked.

## Navigation

The overviews are the first entry of each sidebar group (on main the group heading folds the group,
as it did before the merge; Grant, 2026-10-22). An item
links to the module, or to the exact file and tab (Import), data file (Cross tabs) or objective;
a link made before the module was first opened is held until it mounts. The main dashboard's stage
pills open the overview and its next step opens the module (`/runs/<id>?section=<id>`, read by
`RunSectionProvider`). An overview refreshes the page's data each time it is opened again.

## Limits

- Module status lines and overviews read the page as loaded; a change shows after the page
  refreshes (opening an overview, an action that refreshes, or a reload).
- Raw data or a transcript with no saved setup reads as "Accept the setup" on the overviews:
  Import accepts the defaults when it is opened.
- `getInstrumentSummaries` and `getTranscriptSetups` return empty results when their tables are
  missing (before their migrations); the facts inherit that.

## Tests

`src/lib/__tests__/stageStatus.test.ts`, `sectionStatus.test.ts` (each module rule, Not used,
precedence, roll-up, next step), `projectStageFacts.db.test.ts` (real database: each module's facts
from stored records, an empty project, an unknown project throws, the dashboard rows) and
`e2e/ui/stage-status.check.mjs` (overviews on a new project and after an import, item links,
heading link, module status lines, the main dashboard's row and next step).
