# Batch 52R handover: repairs for the Batch 52 review (28 October 2026)

Base: Batch 52 (`f9b8f7e7`). Status: implemented, ready for independent review. Tier A (B52-F01 changes how
statistical output is grouped in storage; reassessed from Tier B as the review asked). No migrations.

## B52-F01: one statistical-output selection is one output set across requests

`ingestOutputFiles` (the grouping owner) takes `appendTo`: the set the selection's first request created. The upload
action returns `outputSetId`; the Add files dialog passes it with every later request of the same upload, and keeps it
on output files left unsent after a failure, so a retry completes the same set.

- Ownership on every write: the set must be an output set of this project (`run_id`, `tenant_id`); a set from another
  project or removed to the bin (documentBin moves it to the bin project) is refused with a visible message, nothing
  is recorded, and the stored copy of the refused file is removed.
- Each file's row is inserted `select ... from output_sets ... for share`, so removing the set to the bin waits for the
  write or is seen by it; a file is never recorded against a set outside the project.
- Families (`assignFamilies`) are a property of the whole set's names: after an append they are recomputed over every
  file in the set under a `for update` lock on the set. Two requests give exactly what one request gives.
- A refused append leaves the set and its earlier files as they were; only a set the call itself created is removed
  when nothing could be stored. A malformed set id is refused.
- Not done: a set id cannot be supplied by a stale tab to join an older set of the same project; it can, if that set
  is still active in the project. The ownership rule is the same as for any other write.

## B52-F02: each request sends the list as it stands

Before each request the dialog re-reads the chosen list: a file removed while an earlier request ran is not sent; a
changed type is sent as its new type; a file left without a valid type stays chosen. Files chosen during an upload are
kept for the next one, as before.

## Found by this batch's gates: a wave typed during the first-view save was lost

`waves-in-project` failed in two full runs (passing alone). Cause: opening a new data file saves its default setup in
the background (DataSetupForm's first-view acceptance). An edit made while that save was in flight was lost: the save's
success set the defaults over it, and the edit's own save then conflicted. The setup fields now wait for that save
(`editable = ready && !autoPending`). Standing requirement 5 (late responses never overwrite newer intent).

## Proof

- `outputSetAcrossRequests.db.test.ts` (real database, actual `uploadDocumentsAction` and `ingestOutputFiles`, storage
  mocked): 3 passed; on the base 3 failed. Two requests equal one (one set, both files, same families "model"); another
  project's set and a binned set refused with nothing added or left stored; a refused append keeps the set; a malformed
  id refused.
- `independent-upload-controls.check.mjs`: Codex's retained review checks, unchanged below a header naming them. On
  Batch 52 (probe `62b757e`): 1 passed, 2 failed (F01 and F02). On 52R: 3 passed.
- `setup-first-view-edit.check.mjs` (new): every server action except the upload is held from before the upload and
  released in order, so the slow first-view save is reproduced every time. On Batch 52 (probe `60338f3`): fails (fields
  editable during the save). On 52R: passes.
- Related library tests: uploadIdempotency.db, technicalDocumentUpload.db, uploadBatches, outputWaves: 19 passed.

Why the tests missed it: no check uploaded statistical output in more than one request, removed a file during an upload,
or edited setup while the first-view save was slow.

## Gates

Commit `2d530a3`.
- `npx tsc --noEmit`: exit 0; `npx eslint .`: 0 errors.
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- Library (on `0acab2f`; later commits change only browser checks): 265 files passed, 1 skipped; 1,962 tests passed,
  82 skipped, 0 failed.
- Targeted browser checks on `2d530a3`: independent-upload-controls 3 passed; add-files-batches passed (two real 60 MB
  files, 4.1 min); waves-in-project, add-files-panel, over-limit-refusal passed.
- Full browser suite on `2d530a3`: 132 passed, 1 skipped, 2 failed (`waves-in-project`, `large-spss-crosstab`), both
  stuck on "Loading..." late in a long run. Rerun alone on the same stack they failed again (8 and 10 minutes); after a
  fresh restart of the disposable stack both passed (21.9 s and 3.7 min). Recorded as a test-environment degradation of
  the long-running local stack (its stats worker had been busy for over an hour), not a product fault; a clean full run
  is still owed.
- Smoke (`npx playwright test`): 1 passed.

An earlier full run on `0acab2f` was invalid: a node_modules folder the browser stack used was deleted during it (my
error; repointed to the current packages, then rerun).

## Impact checklist

1. Rule: `ingestOutputFiles` owns grouping (one selection, one set); the batching helper preserves it.
2. Inputs: a gone or foreign set is refused visibly; malformed id refused; unknown server answer still says so.
3. Persistence: ownership on every write; set held FOR SHARE per file; families under FOR UPDATE; retry completes the
   same set; partial failure keeps earlier files.
4. Freshness: none; set-level checks now see the whole selection, as they did for single-request uploads.
5. Screens: removed queued files not sent; setup fields wait for the first-view save.

## Native 120 MB check (Codex's verification blocker)

It passed here twice (3.0 and 4.1 minutes). In Codex's environment both warm replays failed at the storage stage with
"fetch failed", before batching is involved; the cause is not established. Please replay it on a clean stack.
