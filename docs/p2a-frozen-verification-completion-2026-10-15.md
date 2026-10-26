# P2a frozen-boundary verification completion — 2026-10-15

## Decision

Code-level parser/provenance checks pass. IMP-002 and IMP-003 remain **implemented awaiting integration verification** against the release baseline's explicit real upload/save/reload/browser criteria. No new confirmed defect or optional improvement was found. Existing closures are unchanged.

**The P2a frozen boundary is RELEASED after this pass.** Claude may proceed with the agreed IMP-006 / REP-IN-001 partial-report-status implementation. Any later P2a integration pass must re-establish hashes for changed dependencies rather than reuse the prior freeze.

Source HEAD 955a4eccef132956520b3e3c4ba78378d6748885 plus working tree. All28 boundary files had matching start/end SHA-256 hashes; see p2a-final-source-hashes-2026-10-15.json.

IMP-002 original definition was actually recovered and reread in user attachment 20c9b907-7ca9-4866-be5a-914875b83971/Pasted text.txt, item2. It is not inferred from IMP-003 or IMP-SHIP IDs.

## Executed checks

- Native retained suite: **20/20 passed**, exit0.
  Command: node node_modules/vitest/vitest.mjs run src/lib/__tests__/sheetSelectionConsistency.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread
- Actual getDocumentPreviewUrl, real parseTableDocument with controlled storage/database: CSV read, XLSX read, each stored-preview reload, missing-selected-sheet actionable failure: **5/5 checks passed**.
- Actual Python _read_plain then dictionary and crosstab: **2/2 fixture pipelines passed** (CSV and XLSX).
  Bytes were in-memory identical to TypeScript fixtures. File/byte access was adapted to BytesIO/StringIO; actual reader/calculation code was not reimplemented. An in-memory raw-reader adapter passes that reader's real DataFrame/metadata into dictionary/crosstab, avoiding temporary file writes.
- CSV2cases and Sparse/Dense XLSX40cases retain respondent_id,q,q (3),q (2), leading-zero001 and independent sibling values. Both readers select Dense for the workbook. XLSX calculation returns both q and q (3), each with independently known20/40=50%, unweighted.
- Retained20 cover collision override targeting, losing-publisher reparsing, cache confirmation/rebuild, selection-persistence failure, unsupported-ID blanking/recovery trace and actual captured winning-sheet JSON parameters.
- No dependency installation, application mutation, migration, database/storage write or live credential use.

## Exact remaining checks and blocker

Unexecuted, not demonstrated defects:
1. Synthetic real upload/storage→extraction→DB saved preview/dictionary→saved calculation→reload agreement.
2. Real override persistence/reload keyed to q (2), isolated from q/q (3).
3. Two-session authoritative selection publication, losing-reader reparse, and real permission/migration failure recovery.
4. Browser missing-sheet/unsupported-ID recovery and actual saved provenance display.

**Blocker:** no P2a disposable database/storage/browser target has been provisioned/authorized. Existing write authorization is restricted to OBJ-REV-009; it was not silently expanded. Current test suite mocks these external boundaries, so its pass does not establish these guarantees.

No change to43-item baseline statuses/totals; all technical closures including DEC-001, OBJ-REV-009 and Brief38 subcases preserved. Security and the rest of Import are outside this verification.

