# Batch 52 handover: uploads over 100 MB chosen together (28 October 2026)

Base: Batch 50R (`45ce6002`). Status: implemented, ready for independent review. Tier B (the Add files
dialog) with a pure library helper. No migrations, no server change. Batch 51 now follows this batch.

## The report

Grant, uploading into a new project: "This part of the project could not be shown (reference 2276258824)".
The server log: `Request body exceeded 100MB for /runs/... Only the first 100MB will be available` then
`Error: Unexpected end of form`, `POST /runs/... 500`.

Cause: the Add files dialog sent every chosen file in one server action. Each request passes the sign-in proxy,
which keeps only the first 100 MiB of a body (`next.config.ts` `proxyClientMaxBodySize`, matching
`bodySizeLimit`). Files each within the supported 100,000,000-byte limit but together over 100 MiB were cut
off before the server could check any of them, and the multipart parser's error reached the page's error
boundary instead of the dialog.

## Repair

- `src/lib/uploadBatches.ts` `planUploadBatches`: the chosen files, in order, in batches whose combined size is
  at most `maxFileBytes` (100,000,000, from `api/import-limits.json`), so the largest supported file fits alone
  under the proxy's 104,857,600 with room for the form's own bytes. A file over the limit goes in `tooLarge`.
- `AddFilesPanel.upload`: sends the batches one after another. A file over the limit is never sent; it is named
  with the shared limit message (`FILE_LIMIT_MESSAGE`) and leaves the list. Files that were sent leave the list;
  a batch not yet sent when an earlier one fails stays chosen, so a retry sends it and never re-sends what went
  through (IMP-008's rule). A batch with no answer from the server says so and asks the researcher to reload to
  see whether it was added, rather than calling it failed or added. The success message counts every batch.

The server's own checks are unchanged (each file is still refused over the limit when it arrives whole).

## Proof

- `uploadBatches.test.ts` (5): small files together; 80+15+10+60 MB in two batches, none over the limit; a
  file of exactly the limit alone, one byte over never sent and the rest still sent; the budget under the
  proxy's 100 MiB; nothing chosen.
- `add-files-batches.check.mjs` (real browser, server, database, the proxy as configured): two 60 MB data files
  chosen together are both added, the page keeps working, both listed after a reload; a file one byte over the
  limit chosen with a small one: the small one added, the large one named with the limit message and never
  stored. Fails on Batch 50R (probe commit `8392dec`: 50R plus only this check): the dialog shows no
  "Added" message because the request is cut off. The two 60 MB files have different contents, since the project
  correctly refuses a second copy of identical bytes (IMP-008); the first version of the check used identical
  files and was corrected in `685f8bb`.

Why the tests missed it: every upload check sent files whose total was under 100 MiB; `over-limit-refusal`
sends one file at a time.

## Impact checklist

1. Rule: the import limits stay in `api/import-limits.json` (`IMPORT_LIMITS`); the batch budget is that limit.
2. Inputs: a file over the limit is named and not sent; no answer from the server is reported as unknown.
3. Persistence: unchanged server action per batch; a retry never re-sends what was added.
4. Freshness: none.
5. Screens: the dialog's message and error report every batch; the page no longer fails.

## Gates

Commit `685f8bb` (code `d3f230e` plus the corrected check). Base: Batch 50R, `AddFilesPanel.tsx` checked equal to the
laptop's `45ce6002` copy (`7f0e07657c46fabf`).

- `npx tsc --noEmit`: exit 0 (after `npx next typegen`). `npx eslint .`: 0 errors (44 warnings, unchanged).
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- Library, `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks` on `d3f230e`: 264 files passed,
  1 skipped; 1,959 tests passed, 82 skipped, 0 failed.
- Full browser suite (`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`) on `d3f230e`: 128 passed,
  1 skipped, 2 failed:
  - `add-files-batches`: the check's own identical-files fault above; corrected, then passed on `685f8bb` (3.0 min).
  - `waves-in-project`: did not reproduce; passed twice in a row on `685f8bb` (18.9 s, 14.3 s). It uploads two
    small files in one batch, which this change sends exactly as before.
- Smoke (`npx playwright test`): 1 passed.
- Probe on 50R plus only the corrected check (`8392dec`): fails as expected.

Mocks versus real: the browser checks run the real server, database and sign-in proxy on the disposable stack; the
library test is pure.
