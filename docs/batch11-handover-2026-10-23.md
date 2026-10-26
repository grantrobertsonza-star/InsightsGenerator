# Handover: RR-F05, Next 16.4.1 and SheetJS 0.20.3 (main copy), 23 October 2026

Status: **implemented, ready for independent review**, together with batch12 (`docs/batch12-handover-2026-10-23.md`). Main copy. Follows
`docs/independent-release-readiness-audit-main-2026-10-23.md` (RR-F05) and batch10. Grant approved
both changes on 2026-10-23 ("yes to both"). No migration. Nothing pushed or deployed.

| Commit | What | Kind |
|---|---|---|
| `91fed93` | Next 16.3.6 to 16.4.1 (and eslint-config-next); xlsx 0.18.5 to the vendored 0.20.3 | dependencies |
| docs commit after `ce2be9e` | Handover and status line, with batch12 | |

## Next 16.4.1

`package.json`: `next` and `eslint-config-next` 16.4.1, outside the range of the Server Actions
denial-of-service advisory (GHSA-p3m5-59mp-jv5r) that Codex cited. No application change was
needed: typecheck, the production build and every suite pass unchanged.

## SheetJS 0.20.3, vendored

SheetJS no longer publishes to npm after 0.18.5; the fixed versions are only on its own site. Grant
downloaded `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; it is kept in the repository at
`vendor/xlsx-0.20.3.tgz` and `package.json` names it (`"xlsx": "file:vendor/xlsx-0.20.3.tgz"`), so
no install or build (Vercel included) depends on the SheetJS site.

- File: 2,409,319 bytes, SHA-256
  `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`; its `package.json` reads
  `xlsx 0.20.3`, Apache-2.0. The hash was taken from Grant's download; SheetJS publishes no
  checksum this workspace could reach (its site answers 403 here), so it is not independently
  verified against the publisher.
- 0.20.3 is outside the advisories Codex cited (prototype pollution before 0.19.3, ReDoS before
  0.20.2). The API the app uses (`read`, `write`, and `utils` `sheet_to_json`, `aoa_to_sheet`,
  `json_to_sheet`, `book_new`, `book_append_sheet`, `encode_cell`, `decode_range`, with the
  `WorkBook`, `WorkSheet` and `CellObject` types) typechecks and runs unchanged; no source change.
- Where the suites reach SheetJS: workbook import (`parseTable.ts`, its library tests and the
  browser checks that import `.xlsx` files), statistical output sets (`outputIngest.ts`, through
  `uploadIdempotency.db`), the Excel exports (library export tests and the native export checks),
  and, new in this batch, coding files (`codedImportFile.test.ts`: an `.xlsx` table, a CSV, a merged
  code cell, a sheet named for its code, and that the installed version is 0.20.3).
  `outputAnalysisRun.ts` has no direct test of its workbook reading.

## npm audit after the change

`next` and `xlsx` are no longer listed. 14 entries remain (2 critical, 9 high, 3 moderate), none in
Next or SheetJS: development tooling (vitest and its tinypool, vite and esbuild, eslint's
fast-glob, micromatch and braces) and `pptxgenjs` through `image-size`. `image-size` is reached only
through PowerPoint export, with images the app renders itself (charts), not uploaded files; it is
listed for triage, not changed here.

## Checks run

Cloud workspace, disposable PostgreSQL 16 with all migrations to 0110, real Python engine,
production build, model replayed. Tree: the content of `91fed93`.

| Gate | Result |
|---|---|
| Full library (this tree) | 1,534 passed, 72 skipped (204 files, 1 skipped) |
| Full native browser suite (this tree) | 92 passed, 0 failed, 1 skipped (the gated real-model test) |
| Full library and native suite with batch12 on top (`ce2be9e` content) | 1,545 passed, 72 skipped; 92 passed, 1 skipped |
| Golden-thread smoke; objective acceptance | passed; passed |
| `codedImportFile` (new) | 3 passed |
| `npx tsc --noEmit`; production build | pass; pass |

A first library run, made while another copy's suite was using the same PostgreSQL server, had 20
database files fail to connect; run alone, all pass (the figures above).

## Limits

- The vendored file's origin rests on Grant's download from the SheetJS site.
- Remaining audit entries are listed above, not addressed.

## On the laptop

After pulling these commits, run `npm install` once: it installs Next 16.4.1 and SheetJS 0.20.3 from
`vendor/`. The commit tool reported a byte mismatch for the `.tgz` because it compares text with line
endings normalised; the committed blob is the same object as in the cloud copy (`b9df84a`, SHA-256
`8dc73fc3…99fe8`).
