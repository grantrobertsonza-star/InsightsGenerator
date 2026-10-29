# Batch UI1R handover: split preference from another tab (Codex UI1-F01), 29 October 2026

Status: implemented, ready for independent review. Code commit 0504ebf, check correction 58d904b, on BatchUI1
(6d00545d on Grant's laptop).

## Finding

UI1-F01 (minor): an open tab ignored split changes made in another tab, because its in-memory copy of the
setting masked the browser's storage event. Research results were not affected.

## Change

- `src/app/runs/[id]/ResizableSplit.tsx`: a storage event for the split's key (or a storage clear, key null)
  removes this tab's in-memory copy for that key and notifies the split, which then reads the new stored value.
  Events for other keys change nothing. The listener is attached once.
- `src/lib/trackerDashboards.ts`: a comment that claimed a stronger guarantee than the code gives was corrected.
  There is no behaviour change.

## Checks

- `e2e/ui/nps-driver-split.check.mjs` gained a second, real tab of the same site. That tab:
  - sets the key (the open view shows 40);
  - writes an unrelated key (still 40);
  - removes the key (back to 50).

  The first tab then moves the split with the keyboard (45, and the other tab reads 45). Finally the other tab
  sets the dragged value, and the first tab follows. The check failed on the UI1 code (received 33, the tab's
  own value) and passes on 0504ebf.
- Correction 58d904b: the check's last step referred to a variable inside a function that runs in the page,
  where it does not exist ("dragged is not defined"). It now passes the value in. The test was wrong, not the
  application, and this was found by the full browser run below.
- Gates on 0504ebf:
  - typecheck and lint clean;
  - engine self-test passed;
  - library 312 files, 2,377 tests passed, 91 skipped, 0 failed;
  - full browser suite 141 passed, 1 skipped, 1 failed (this check, for the reason above);
  - smoke 1 passed.
- On 58d904b: `nps-driver-split` 1 passed and `chart-legend-fit` 1 passed (real browser, disposable stack).
  Only the check file changed between the two commits.

Mocks: none for this change. Real browser, two real tabs.
