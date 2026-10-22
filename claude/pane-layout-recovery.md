# Pane preferences and separator values

ThreePane keeps preferences in page memory before trying browser persistence. Blocked reads or
writes therefore cannot discard collapse, keyboard or pointer changes. A real storage event
invalidates the matching memory entry so other-tab changes remain observable; a full reload
recreates memory and uses stored preferences or defaults. Server snapshots remain default-only.

ResizeObserver measures the grid and rendered side panes. Separator aria-valuenow uses the
rendered width, and maxima match the effective35%/50% bounds used by keyboard/pointer controls.
The observer disconnects on unmount. No research/persistence layer or calculation changes.

The focused native pane check covers normal persistence, blocked reads/writes, mounted unfinished
input, pointer/keyboard interaction, reload defaults and viewport-dependent accessible values.

Bounds use the same pixel rounding for keyboard/pointer and accessible values. Minimum widths
shrink when a narrow container cannot fit them; default right widths also respect the half-grid
maximum. Six exact-component/compiled-CSS checks cover normal and wideRight at1200/700/400px.
Five native route checks passed before that final narrow-container extension; the enhanced native
test has not been rerun afterward. Final strict validation and build cover the final source.

## Preference scope (DESIGN-GTR-01, 2026-10-21)

Each ThreePane caller that wants its own remembered layout passes its own `storageKey`. With
`leftOnTop` (filters across the top), the fold is stored under `three-pane-top:<storageKey>` and
the list/detail split below it under `<storageKey>:below-band`. Insights (`insights-review`),
Recommendations (`recommendations-review`) and Report claims (`report-claims`) each pass one, so
folding or resizing one section never changes another. A caller without a key falls back to the
shared `three-pane-top:band` key; no current caller relies on it. Earlier the three callers passed
none and shared that fallback. The band's content stays mounted while folded, so filters and
unsaved drafts survive. Covered by `e2e/ui/band-preferences.check.mjs` (cross-section isolation,
reload, a non-default width, filter and draft kept, keyboard, blocked storage).

## Objectives band columns (one-page Objectives, 2026-10-22)

The Objective and context band (fill from a brief or proposal, business problem, objectives and
audience) folds as the band of the page's ThreePane (`storageKey="objectives-one-page"`, fold under
`three-pane-top:objectives-one-page`, the scope rules above). Its three columns do not use ThreePane's
pixel-width store or ResizeObserver. They
come from `useBandColumns` (`src/app/runs/[id]/BandColumns.tsx`), called by `RunContextForm.tsx`
with key `objectives-band-columns` and a count of 3 when the project has documents (the fill column
shows), otherwise 2.

- Widths are shares of the band (`fr` columns with 16 px separators), so proportions hold as the
  window changes. Stored per browser under `objectives-band-columns:v1:2` and `:v1:3`: the two
  layouts are separate preferences, and the same share set applies to every project in that browser.
- Reads go through `useSyncExternalStore`; the server and first client render use equal shares. A
  stored value of the wrong length, non-numbers or non-positive values is ignored (equal shares).
  Values are normalised to sum to 1.
- Writes keep the shares in page memory first, then try localStorage; blocked storage keeps the
  widths for that page view. A change in another tab (storage event) drops that key's page copy;
  a cleared storage clears all page copies. A same-tab change notifies through a `band-columns`
  window event.
- Each column has a 200 px minimum, reduced to an equal share when the band is too narrow.
  Pointer drag, arrow keys (2% steps), Home and End move a separator; Enter and double-click make
  the columns equal. `aria-valuenow/min/max` give the separator position in percent of the band.
- Below the lg breakpoint the band stacks and the separators are hidden.
- Folding the band (ThreePane) does not unmount the form, so unsaved text survives.

Covered by `e2e/ui/objectives-band-resize.check.mjs` (pointer, keyboard, minimum, reload, Enter
reset, narrow stacking, blocked storage). No research or persistence layer is involved.
