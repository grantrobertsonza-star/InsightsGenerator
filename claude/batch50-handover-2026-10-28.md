# Batch 50 handover: Cross tabs as two tabs, Build table and View tables (28 October 2026)

Base: Batch 49. Status: implemented, ready for independent review. Tier B (screens), plus test-harness and check
changes (tier C). No migrations. No engine, library or stored-data change. Grant tried it on 3001 (a prototype
branch on Batch 47) and asked for it in the main app.

## What changed (`CrosstabWorkspace.tsx`, page layout only; the overlay opened from a data file is unchanged)

- Two tabs under the header: **Build table** (the variable list, Columns "groups to compare", Rows "questions to
  measure", the build controls) and **View tables N** (the chosen way's tables at full width, no variable list,
  and the cell pane on the right while a cell is selected).
- **Refine your table:** three cards, Filters and layers, Table settings, Display and statistics, each showing
  what is set; a card opens its panel under the cards, one at a time; Table settings opens by itself while the
  survey design needs a choice. The settings line (weight, design, non-answers, filters, comparisons, Change
  settings) sits under the cards.
- **One scroll bar:** the tables are no longer in a fixed-height scroll box; the page scrolls. The cell pane stays
  in view beside a long table set (sticky; `ThreePane` stretches its right column to the row for this).
- Adding a table, layered tables or a starter set switches to View tables and goes to the new table, **only when
  the researcher has not chosen a view since pressing Add** (the view and a count of view choices are one state;
  the list's refresh switches through an updater that checks the count). A late refresh therefore never pulls
  the researcher away from a view they chose meanwhile.
- **Commit N tables** sits beside the tabs, so drafts waiting are in view on either tab.
- All tables has nothing to build, so it opens on View tables and Build table is disabled there; each other way
  of making tables opens on Build table.

## Tests and harness

- `crosstabs-entry.check.mjs`: Table settings as a card with its panel (opens from Change settings, one panel at a
  time); after Add, View tables is selected, the variable list is gone, the tables region has no scroll box of
  its own (`overflow-y: visible`) and nearly the workspace's full width, the cell pane is still in view after
  scrolling to the bottom; Build table brings the variable list back.
- `helpers/crosstabs.mjs` (`showBuild`, `showTables`) and the golden-thread adapter switch tabs where a step needs
  the build controls or the tables; `mean-tick`, `saved-table-reload`, `scale-missing-reload` open View tables
  after a reload.
- `helpers/sources.mjs`: a source tab is clicked again until it is selected (a click before the page is
  interactive is lost; `data-setup-hydration` releases the scripts and selects at once, and failed 2 of 4 full
  runs for that reason).
- `scripts/e2e/model-replay.mjs`: a fixture file read while a check is rewriting it is read again, and any other
  unexpected error answers that request with a 500 instead of ending the server. One crash on a half-written
  fixture had stopped the whole stack, so every later check timed out.

Bugs the full runs caught in this batch, both fixed and covered: `crosstab-ask-memory` (a late list refresh
switched to View tables after the check had gone back to SemanticTabs) and `analysis-plan` (Commit was only on
View tables while Cross tabs opened on Build table). Limit: no check delays the refresh on purpose; the
late-refresh case is caught when the timing falls that way, as it did here.

## Impact checklist

1. Rules: display only; no rule owner changes.
2. Inputs: unchanged.
3. Persistence: unchanged; tables are added, listed and committed through the same actions.
4. Freshness: unchanged.
5. Screens: late list responses never override a view chosen since Add; document switching and reload keep
   their earlier behaviour (each reload opens on Build table); "saved" wording unchanged.

## Gates

- On `768327c` (the code of this package except the source-tab helper fix): `npx tsc --noEmit` passed;
  `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all checks passed;
  `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 263 files passed (1 skipped), 1,944
  passed, 82 skipped; targeted `analysis-plan`, `crosstab-ask-memory` (twice), `crosstabs-entry`,
  `quick-charts`, `mean-tick` passed.
- On `2305bb0` (the code of this package; the change since `768327c` is `e2e/ui/helpers/sources.mjs` only):
  `data-setup-hydration` passed 5 of 5; `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 128
  passed, 1 skipped, 0 failed (25.1 min); `npx playwright test` (smoke): 1 passed.
- Real infrastructure: disposable PostgreSQL 16 and the local stack; the model replayed; storage the local
  disposable store. Nothing ran against cloud Supabase.

Screenshots: Build table with the three cards, and View tables with the cell pane (taken before Commit moved
beside the tabs and the settings line moved under the cards).
