# P2a parser/provenance verification — 2026-10-15

Scope: frozen IMP-002/IMP-003 parser/provenance package only; no supported-scope expansion.

IMP-002 is **recovered**, not inferred: original user attachment 20c9b907-7ca9-4866-be5a-914875b83971/Pasted text.txt explicitly defines it as “Preview and calculations can parse different datasets from the same file.” Its scope includes reader sheet/delimiter/missing/identifier agreement. IMP-SHIP-001/002 are traceable subcases. Original evidence was reread in this pass.

HEAD 955a4eccef132956520b3e3c4ba78378d6748885 plus working tree. Ten scoped source/test/migration files hashed before/after the principal checks; hashes matched. Shared crosstabs.ts changed since the older parser snapshot, warranting one affected retained-suite run.

## Executed

Exact command:
```powershell
node node_modules/vitest/vitest.mjs run src/lib/__tests__/sheetSelectionConsistency.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread
```
Exit0; **20/20 tests passed**. Existing fixtures/assertions unchanged. Controlled storage/persistence/engine boundaries, not live integration.

Actual TypeScript parseTableDocument and Python _read_plain consumed the same in-memory CSV/XLSX bytes:
- CSV: headers respondent_id,q,q (3),q (2); two rows; identifier001 retained as string.
- Sparse/Dense XLSX: Sparse has one real case and inflated A1:J101 extent; Dense has40 populated cases. Both readers chose Dense, identical canonical headers and first-row values.
- Actual Python dictionary and crosstab functions then consumed the actual reader's DataFrame/metadata via an in-memory raw-reader adapter to avoid temporary-file writes. Dictionary retained all four canonical names. Crosstabs for q and q (3) retained separate identities and each returned20/40 =50%, unweighted, selectedSheet Dense.
- An initial request for the deliberately constant q (2) produced no question; this is not used as evidence for calculation correctness or a new defect. Canonical override targeting for q (2) is covered by the retained actual builder payload test.
- Python file/byte access was adapted with in-memory pandas/openpyxl boundaries; parsing/statistical logic was executed, not reimplemented. Local/remote process execution was not exercised.

The retained20 additionally cover missing sheet errors, unsupported-ID blanking/recovery traces, losing-publication reparsing, cache confirmation/rebuild, persistence-error propagation, captured winning-sheet provenance and collision correction targeting. Existing independent TS/Python unsupported-ID and missing/tie evidence remains preserved.

## Decisions

- IMP-002: code-level parser/provenance subcases pass; **implemented awaiting live integration verification** for the baseline's upload/stored/reload/browser acceptance. No new reproduced defect in this pass.
- IMP-003: code-level collision/correction-request subcases pass; **implemented awaiting live integration verification** for real save/reload/correction/calculation identity. No new reproduced defect in this pass.
- These are missing checks, not newly demonstrated bugs. No release blocker or optional improvement was added.

## Exact outstanding acceptance checks

1. One CSV and Sparse/Dense XLSX through real upload/storage→stored preview→dictionary→saved calculation→reload, checking selected sheet, headers, IDs, missing values, counts and provenance.
2. Persist/clear/reload an override for q (2); only that canonical column changes its calculation treatment.
3. Controlled competing sheet publications; losing caller reparses winner before saving/caching; real permission/migration failure prevents unconfirmed analytical output.
4. Browser sees actionable missing-sheet and unsupported-ID states; affected IDs cannot silently enter inconsistent joins.

Next action: execute only this synthetic I2/I3 subset in a separately authorized disposable database/storage/browser environment, or obtain a stable independently inspectable completion record from that environment. Current DB-write authorization is OBJ-REV-009-specific; it was not reused here.

Both baseline statuses and43-item totals remain unchanged. DEC-001, OBJ-REV-009, their48-test/13-group evidence and Brief38 closures are preserved. Other Import/analytics issues are outside P2a. No application code, migrations, database/storage or credentials changed.

