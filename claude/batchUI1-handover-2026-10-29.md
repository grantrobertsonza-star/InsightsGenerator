# Batch UI1 handover: chart legends and titles fit; NPS and drivers in a resizable split; full-width quadrant (29 October 2026)

Status: **implemented, ready for independent review.** Tier B (screens and a display-only helper). Grant, 29 October
2026: "the legends in the chart module are being cut off"; "the quadrant is tiny"; "a split screen so we can pull
left or right to make the nps bigger or smaller and the drivers bigger or smaller".

## Changed behaviour

1. **Chart legends and titles** (`src/app/runs/[id]/ChartVisual.tsx`, new `src/lib/chartTextLayout.ts`): the legend
   wraps onto as many rows as it needs (it was one row at a fixed 150 per entry, about 1,350 wide for nine provinces
   in a chart about 520 wide); each entry keeps its full name and n (shortened with an ellipsis only past a row's
   width, full name as its tooltip); the title breaks onto two lines and then ends with an ellipsis (full title as
   the chart's tooltip). A chart wide enough to scroll lays out its title and legend within the card's visible width
   (measured), so neither needs scrolling. Text width is estimated generously, so the estimate errs towards wrapping.
   Figures are unchanged.
2. **NPS and driver analysis** (new `src/app/runs/[id]/ResizableSplit.tsx`, `AnalyticsBuilder.tsx`): on screens 1280
   wide and up, the two sit either side of a divider that drags between a quarter and three quarters; double-click
   resets to half; keyboard: a focusable separator, arrows move it by 5%, Home resets. The split is kept per browser
   (browser storage, with an in-memory fallback when storage is blocked). Narrower screens stack them; one result
   alone takes the full width.
3. **Importance quadrant**: the two quadrant charts stack, each the driver pane's full width (side by side, each had
   half of a half-width pane), and the legend is a row above or below the chart instead of a column beside it.

## Proof

- `chartTextLayout.test.ts` (6): placements and wrapping worked out by hand from the stated estimate.
- `e2e/ui/chart-legend-fit.check.mjs`: a labelled workbook (Data, Variables and Values sheets) with Grant's C1_36
  question by nine provinces: all nine entries with names and n, and every title line, inside the chart and its frame,
  legend top and bottom; a wide HH_size chart shows its title and whole legend without scrolling.
- `e2e/ui/nps-driver-split.check.mjs`: NPS then drivers on a 0 to 10 outcome: half and half; three arrow presses to
  65%; a mouse drag to about a third; the quadrant at least 90% of its frame's width; no divider at 1100 wide.
- Screenshots (sent to Grant): chart-legend-fit (top, bottom, wide) and nps-driver-split.

All on the combined tested tree `523f4de7` (BatchD2aR then BatchUI1 on c8bfac21; worktree b86), real disposable
PostgreSQL 16:
- `npx tsc --noEmit -p .`: clean. `npx eslint src e2e --quiet`: clean.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 312 files passed, 2 skipped; 2,377 tests
  passed, 91 skipped, 0 failed.
- Disposable stack, full browser suite: 141 passed, 1 skipped, 1 failed: `review-action-failure.check.mjs` timed out
  opening the Objectives section (an area neither batch touches); it passed in the two previous full runs today
  (D2a 7c4d6bcc, UI1 alone 52cd0e00) and passed 3 of 3 when rerun alone on the same stack. Recorded as a flaky
  navigation wait, not a defect of these batches. Smoke: 1 passed.
- Documents added after the gates (no code): the two handovers and the status file.

## Files

`src/app/runs/[id]/ChartVisual.tsx`, `src/app/runs/[id]/AnalyticsBuilder.tsx`, `src/app/runs/[id]/ResizableSplit.tsx`
(new), `src/lib/chartTextLayout.ts` (new), `src/lib/__tests__/chartTextLayout.test.ts`,
`e2e/ui/chart-legend-fit.check.mjs`, `e2e/ui/nps-driver-split.check.mjs`. No migration.

## Limits

Text widths are estimates (an exported SVG has no layout engine); unusual fonts could wrap a little early. The split
is per browser, not per user account. The quick charts in Cross tabs use another component and are unchanged.
