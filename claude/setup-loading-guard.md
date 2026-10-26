# Setup controls before hydration

A visible server-rendered layout select could change before React attached its save handler.
The displayed choice then differed from the saved layout without an error. Held-script native
verification reproduced that mismatch; the parked guard was inspected before integration.

The shared useHydrated hook returns false for the server/hydration snapshot and true after
handlers attach. Data and transcript setup controls stay disabled with a loading explanation
until ready. This does not change saved layout, compare-and-swap, visit identity or scoring rules.
The native held-script check verifies disabled/loading state, enabling and save/reload recovery.
Transcript setup uses the same hook; its server-rendered guard must also remain covered.

The earlier parked test had an unsafe route-release/unroute race; the retained test waits for
held route handlers when releasing them. No claim is made that this explains every old failure.
