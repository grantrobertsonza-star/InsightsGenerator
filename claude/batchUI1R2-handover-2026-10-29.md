# Batch UI1R2 handover: split restored after reopening (Codex UI1R-F01), 29 October 2026

Status: implemented, ready for independent review. Commits b157d41 (repair) and aa57a27 (check) on BatchUI1R (1318db7a on
Grant's laptop).

## Finding

UI1R-F01 (minor): close Analytics, change the split in another tab, then reopen Analytics. The view restored
this tab's in-memory 45% instead of the saved 70%. While no view was open, no storage listener was attached, so
the in-memory copy was never cleared. Research results were not affected.

## Change

`src/app/runs/[id]/ResizableSplit.tsx` keeps the in-memory copy only when storage refuses the write (a browser
that blocks storage). A successful write removes any earlier in-memory copy. Reads go to storage every time, so
no copy can hide a value saved elsewhere, whether or not a view was open when it was saved. Blocked storage
behaves as before: the split is kept for this visit only. The storage-event handler still tells open views to
read again.

## Checks

- `e2e/ui/nps-driver-split.check.mjs` follows Codex's steps after the existing cross-tab steps:
  1. this tab moves the split with the keyboard;
  2. close the Analytics workspace;
  3. in the other tab, save 70;
  4. reopen Driver analysis: the split is 70;
  5. after a reload it is still 70.
- On the BatchUI1R code with this check, it fails at step 4 (expected 70, received 28, this tab's own last value).
  On aa57a27 it passes, and `chart-legend-fit` passes too. Both runs used a real browser on the disposable stack.
- My first version of the step (b157d41) did not move the split in this tab before closing. It passed on the old
  code, so it did not reproduce the finding. It was corrected in aa57a27 to follow Codex's order.
- Gates: typecheck and lint clean. Only the split component and its check changed, so the library suite and the
  engine are unaffected. The full browser suite ran on BatchUI1R (141 passed).
