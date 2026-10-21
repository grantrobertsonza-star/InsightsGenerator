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
