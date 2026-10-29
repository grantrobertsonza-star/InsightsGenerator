# Batch 66 handover: smoke helper waits for the clicked action (29 October 2026)

Status: **implemented, ready for independent review.** Tier C (test tooling). No migration. No application code.

## Finding

Codex, review of batches 54 to 65 (28 October): the unchanged smoke failed after rejecting a finding because
`viaServerAction` in `e2e/adapter/golden-thread-adapter.mjs` waited for any server action's response headers;
a background read could end the wait while the rejection was still being written, and the reload showed the
finding accepted. Acceptance: correlate the requested mutation, await its full response, and add a control
with a simultaneous background action.

## Change

- `viaServerAction(click, isClickedAction)` now takes a test that recognises the clicked action:
  `withArguments(...)` (the action's arguments as Next serialises them: the finding id and "accepted" or
  "rejected", the finding id for a note) or `formSubmission()` (Run synthesis is a `<form action>` whose bound
  run id is encrypted, so it is recognised as the multipart submission; the page's background reads call
  actions with plain arguments).
- The wait ends on the browser's "request finished" (the whole body has arrived) or "request failed" event for
  that request, with the step timeout. Playwright's `response.finished()` did not settle for some streamed
  action responses (seen while writing the control: one never resolved and its body was unavailable).
- New control `e2e/ui/action-wait-control.check.mjs`: the rejection's request is held for three seconds;
  while it is held, another action the page sent earlier is replayed (to the same page with `?decoy=1`, which
  the interception leaves alone) and answered; the adapter's `rejectFinding` must still reload only after
  the rejection finished, and the database must hold the finding rejected.

## Proof

- With the old helper the control fails: after the reload the finding reads "accepted" (Expected "rejected",
  Received "accepted"), run on the disposable stack.
- With the new helper: 1 passed, and the whole browser suite and smoke pass with it (below). While writing it, two things about the stack were learned and handled: Next aborts its own action request after reading the result ("net::ERR_ABORTED" after a 200), so that counts as done; and Run synthesis's request carries only the run id, as background reads do, so it is recognised by an action id the page had not sent before the click.

Gates on the final tree (`83665a3` in the cloud; batches 66, 67, 68, 53 and D1 on top of `16253c5b`): tsc and eslint clean; engine self-test passed; library 304 files, 2,315 tests passed, 91 skipped, 0 failed (real disposable PostgreSQL, run on `0bcbfc0`, which differs only in the control check); full browser suite 140 passed, 1 skipped (the real-model check), 0 failed; smoke 1 passed.
- The first version of the control deadlocked (the held request waited on the decoy, which went through the
  same interception); the decoy now bypasses it. Recorded because it delayed the proof, not a product issue.
