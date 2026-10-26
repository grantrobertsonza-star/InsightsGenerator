# IMP-006 / REP-IN-001 verification, including REP-IN-002 — 2026-10-15

Decision: **further repair required** for preservation/publication. Completion-status code-level subcases pass. Existing closures and baseline counts are preserved; no unrelated audit or new defect ID is introduced.

Source HEAD 955a4eccef132956520b3e3c4ba78378d6748885 plus uncommitted changes. Six target/helper/test hashes matched before/after. The return-shape changes and real archive implementation were inspected.

## Retained tests actually executed

```powershell
node node_modules/vitest/vitest.mjs run src/lib/__tests__/reportImportCompletion.test.ts src/lib/__tests__/findingArchive.test.ts src/lib/__tests__/sheetSelectionConsistency.test.ts src/lib/__tests__/buildCrosstabStrictSetup.test.ts src/lib/__tests__/callerToBuilderStrictSetup.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread
```

Exit0; **41 passed, 1 skipped**, five files. reportImportCompletion7passed/1skipped; findingArchive6; parser20; strict-builder2; caller-builder6. The reported whole-lib457 result was not independently rerun or claimed.

## Criteria

1. **Complete/partial/total failure -> caller status: code-level verified.** Executed actual extractFindingsAction, setDocumentProcessingStatus and getLatestProcessErrors bodies extracted by AST, with controlled boundaries. Complete writes ready; partial writes incomplete; total failure writes failed and produces an error. Executed the actual batch mapper too: same statuses, partial not restamped ready. Live database persistence/reload remains unverified.
2. **Status-write failure actionable: code-level verified.** Actual markDocumentProcessingStatus returned false after injected missing-column SQL error. Single-document action fed an actionable message through actual recordSingleDocumentError and getLatestProcessErrors. Batch mapper appended the same actionable warning. Rendered the actual page JSX error-banner expression and confirmed error text in HTML. This is stronger than a trace-only assertion, but not a live browser or real trace-query execution. A thrown status failure and simultaneous failure of error-trace storage remain integration boundaries, not new proved defects.
3. **Partial reread preserves previous usable evidence: CONFIRMED FAILURE (REP-IN-002 / IMP-006 criterion5).** Executed actual extractFindingsFromDocument together with actual archiveAndReplaceFindings, not the archive mock used by the retained suite. Synthetic prior accepted and human-edited findings were present. One chunk succeeded and the other failed. The final archive DELETE targeted both prior IDs; only the new successful-part row remained. History is not preservation of live usable evidence, human wording identity or live dependencies. No per-failed-portion retention is implemented.
4. **Safe publication/failure/retry: CONFIRMED GAP WITH CONTROLLED REPRODUCTION (REP-IN-002).** Injected a failure on the real archive implementation's first finding_history INSERT after the successful chunk inserted its new row. The extraction threw; old findings remained but the new row also remained live because its chunk uses a separate withTenant transaction. Retrying succeeded and retired the old protected evidence. Thus staging retirement later solves total failure before inserts but is not atomic publication. Independent transactions are source-confirmed; persistence state here was a controlled SQL boundary, not actual PostgreSQL rollback. Duplicate-version coexistence is exposed by this sequence; exact PostgreSQL cascades/duplicate constraints need isolated integration.
5. **Real archive used: done for the reproduction above.** Its actual five archive/delete statements executed against the controlled client. The client modeled dependent-insight removal on DELETE according to the schema cascade; real database link behavior is not claimed verified. Native findingArchive6 tests separately pass. No new application code or assertion was substituted.

## Minimum correction handover

- Do not retire the previous whole evidence set merely because one chunk succeeded.
- Small supported recovery option: if a replacement is partial, keep the prior usable version authoritative and visibly incomplete; hold/discard new attempted replacement rows rather than presenting duplicate live versions. Per-chunk merge capability is not required.
- Preserve accepted/human-edited evidence and its identity/dependencies according to the frozen contract; archiving a history copy is not sufficient.
- Ensure a failed retirement cannot leave an unqualified live mix of old/new results. Publish a replacement consistently or expose a recoverable staged/failed attempt, with retry-safe membership.
- Replace the test asserting “all captured old IDs were archived on partial success” with a preservation acceptance test; do not count it as evidence that human work survived.
- Keep the now-passing return-status, total-failure/no-retirement, caller status and actionable-error behavior.

## Integration still open

Disposable writes beyond OBJ-REV-009 remain separately authorized. Required: real ready/incomplete/failed save/reload; missing-column/constraint/permission status failure -> real error query/banner; actual accepted/human-edited rows and dependent links through partial reread; failure before/during retirement and retry; concurrent visibility and duplicate membership. P2a integration remains paused behind this repair verification.

No full release closure. No broad issue closes from a passing subcase. This report preserves the43-item baseline rather than adding a duplicate blocker for the same replacement-preservation root.

