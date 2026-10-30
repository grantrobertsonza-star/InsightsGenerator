# Handover: section dashboards and stage status merged from the 3001 prototype (main copy), 24 October 2026

Status: **implemented, ready for independent review.** Main copy. Grant asked (24 October, 07:19) for
the dashboards built and reviewed visually on the 3001 prototype (`app-import-redesign`, last commit
`6cf7e8a`) to be brought into main, so review restarts from main. Applied after Codex's review of
`5f67734` (batch14 and batch15). No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `d5ee929` | Section dashboards, module status lines, project stages on the home page, Start a project band | feature (UI and read-only status rules) |
| docs commit (with batch16) | This handover and the status line | |

## What is added

- **Status rules** (`src/lib/stageStatus.ts`, `src/lib/sectionStatus.ts`): each module (Import data,
  Research quality, Objectives, Business decisions, Cross tabs, Analytics, Coding, Secondary analysis,
  Findings, Insights, Recommendations, Insights report) and each of the four sections (Prepare,
  Analyse, Develop findings, Deliver) gets one of: ready, needs you, working, could not check, not
  used, with a headline and a next step. Read-only; computed from stored records. A record that
  could not be read is "could not check", never "ready" or "not used". Brief: `claude/stage-status.md`.
- **Facts** (`src/lib/projectStageFacts.ts`): `loadProjectStageFacts` reads what the rules need for
  one project; `loadProjectOverviews` reads it for the home page's 25 newest projects, four at a time
  (each about 25 ms, measured on the disposable stack with 26 projects: home page 0.7 to 0.9 s).
  Older projects say to open the project for its status.
- **Project page** (`src/app/runs/[id]/page.tsx`, `RunShell.tsx`, `SectionDashboard.tsx`,
  `stageLinks.ts`, `components/StageLook.tsx`, `components/sectionIcons.tsx`): a dashboard per section
  as the first entry of its sidebar group (`overview-prepare`, `-analyse`, `-develop`, `-deliver`),
  with a card per module and its next step; a status line at the top of each module's page linking
  back to its dashboard; a `?section=` link opens a section directly.
- **Home page** (`src/app/page.tsx`): each project row shows its four sections and its next step;
  the right pane counts projects that need you, are working, or are delivered; "Start a project" is a
  foldable band above the list (as on the section pages), with the two starting points side by side.

## How the overlaps were resolved

Six files had changed on both sides since the prototype branched. Main's later repairs win:

- `RunShell.tsx`: main's foldable sidebar groups (Grant, 22 October) are kept; the group heading
  folds the group. The prototype's heading opened the dashboard instead; the dashboard remains the
  group's first entry.
- `page.tsx` (home): main's storage-cleanup notice, delete button (with its refusal message) and the
  research-assistant usage outside projects are kept, alongside the prototype's stage rows, summary
  tiles and band.
- `RunContextForm.tsx`, `briefFillText.ts`, `runContextFormFailure.test.tsx`: main's re-read result
  wording (IR-03) is kept; the prototype had the older wording.
- `runs/[id]/page.tsx`: the Objectives module status line is added beside main's changes.

## Tests

- New: `stageStatus.test.ts` (Import, Objectives and Cross tabs rules: never ready with an
  unverified preview or unscored objective, could not check ahead of needs you, failed loads as could
  not check) and `sectionStatus.test.ts` (the other module rules and how a section takes its worst
  module in use); `projectStageFacts.db.test.ts` (real database: each module's facts read from stored
  records; an empty project; an unknown project throws); `e2e/ui/stage-status.check.mjs` (status
  lines, dashboards, linked items, refresh on reopening, and the home page's project rows, in a real
  browser).
- Not tested directly: the 25-project bound on the home page (the slice in `page.tsx`).
- Changed: `sidebar.check.mjs` and `research-quality.check.mjs` (the dashboard entries in each group);
  `three-pane.check.mjs` (its left-column cases moved to the Insights report section, since the home
  page's left pane is now a band, and a home band case added); `stage-status.check.mjs` opens the
  Analyse dashboard from its sidebar entry (the heading folds).

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0111, real Python engine,
production build, model replayed. Tree: the content of `d5ee929`. Exit codes and the vitest `Errors` line recorded.

| Gate | Result |
|---|---|
| Full library | exit 0; 1,591 passed, 72 skipped (211 files, 1 skipped); no `Errors` line, no unhandled errors |
| Full native browser suite | exit 0; 95 passed, 0 failed, 1 skipped (the gated real-model test) |
| Golden-thread smoke; objective acceptance | passed; passed |
| `npx tsc --noEmit`; production build | pass; pass |
| Lint on the merged files | no new errors; the 2 `react-hooks/set-state-in-effect` errors in `RunShell.tsx` are on both sides already |

## Limits

- The status rules read stored records only; previews, data quality, survey design and support are
  checked inside a project's own dashboards, not on the home page.
- Statuses on the home page cover the 25 newest projects.
- The 3001 prototype copy is left as it is; it is not updated from main.
