# Brief 38 bounded verification — 2026-10-15

Decision: all three existing repair subcases are **closed at code level**, within the evidence boundaries below. No new blocker or optional refactoring is added.

Source: HEAD 955a4eccef132956520b3e3c4ba78378d6748885 plus uncommitted changes; before/after SHA-256 matched for 18 scoped application/component/test files. See [hash manifest](brief-38-source-hashes-2026-10-15.json).

## Results

1. **IMP-014 visit/hydration subcase — closed at code level.** Native reconciliation tests pass. Executed the actual save Effect callback extracted by TypeScript AST from CrosstabWorkspace.tsx: old A conflict after A→B→A with no new A save caused no picker/setup/error changes. Executed the actual hydration callback: an edit made while awaiting load kept touched=true and prevented applying the loaded design to the picker; loaded baseline remained available. These are actual production callbacks with controlled timers/actions, not helper reimplementations and not a mounted browser.
2. **ANA-NPS-003 strict calculation boundary — closed at code level.** Real buildCrosstab now checks loadDataSetupWithStatus before constructing a crosstab engine request. Retained tests execute real callers and builder, injecting low-level failures. Explicit NPS design/no-design, chart, Objectives, manual/ask-resolved build and starter paths refuse calculation; actual dict/engine/persistence boundaries remain mocked. Starter planning may issue a dictionary request through the retained tolerant planner; it cannot produce a crosstab result when the strict setup check fails. This is not an assertion that no metadata-only engine call can occur.
3. **Findings migration-fallback identity — closed at code level.** Executed the actual getFindings function body with controlled SQL responses. First query threw missing design_snapshot; fallback query was captured and contained dt2.document_id as source_table_document_id. Sourced row returned unknown; genuinely unsourced row returned null. Actual SQL execution/browser rendering were not performed in this pass. Earlier current/stale/unknown badge execution remains preserved.

## Exact retained test command

```powershell
node node_modules/vitest/vitest.mjs run src/lib/__tests__/saveReconciliation.test.ts src/lib/__tests__/buildCrosstabStrictSetup.test.ts src/lib/__tests__/callerToBuilderStrictSetup.test.ts src/lib/__tests__/designLookupFailureSurfacing.test.ts src/lib/__tests__/designSnapshotStaleness.test.ts src/lib/__tests__/saveResponseOrdering.test.ts src/lib/__tests__/designPickerState.test.ts src/lib/__tests__/dataSetupStatus.test.ts src/lib/__tests__/sheetSelectionConsistency.test.ts src/lib/__tests__/objectiveEvidencePublish.test.ts src/lib/__tests__/waveTrackingNpsMetadata.test.ts src/lib/__tests__/csmMetrics.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread
```

Exit 0. **12 files / 87 tests passed.** Scoped32 = reconciliation8 + strict-builder2 + caller-builder6 + lookup9 + freshness7. Affected regressions55 = ordering4 + picker6 + setup6 + parser20 + Objectives11 + wave1 + scale7. No unexecuted tests are counted.

## Baseline transition

Original43 status partition: Closed3 / Implemented-awaiting-verification22 / Confirmed-defect6 / Untested6 / Blocked6.
On completion report, before verification: Closed3 / Implemented-awaiting-verification25 / Confirmed-defect3 / Untested6 / Blocked6.
After this verification: **Closed6 / Implemented-awaiting-verification22 / Confirmed-defect3 / Untested6 / Blocked6 = 43**.

Priority is independent: Release-blocker34 (33 technical + 1 deferred security gate), Important-but-deferrable9, Optional0 =43. These are priority assignments, not 34 remaining confirmed blockers. The three remaining confirmed technical blockers are IMP-006/REP-IN-001 partial status, OBJ-REV-001/recovered REV-002 identity overlap, and FND-001/REP-OUT-001 necessary evidence-validity handover.

## Preserved evidence and next package

DEC-001 and OBJ-REV-009 remain closed. Independent48 native unit tests and agreed13-group live PostgreSQL evidence are unchanged. Brief38's older statements about missing harness/Windows execution are superseded.

Next single package: **P2a Import parser/provenance closure verification**, IMP-002/IMP-003 (IMP-SHIP aliases included). Reuse passing20 tests; verify only synthetic upload/stored preview/dictionary/correction/saved calculation/reload agreement and selection failure recovery after source freeze. Real DB/storage/browser writes beyond OBJ-REV-009 need their own authorization; do not infer it from the old disposable scope.

Other release-priority items remain exactly in the baseline. Insights/recommendations/narratives freshness is still open. Mounted browser orchestration and real findings SQL are named integration checks, not demonstrated new defects and not grounds to demand a new RTL/jsdom installation.

Application code read-only; no application dependencies, migrations or live data changed.

