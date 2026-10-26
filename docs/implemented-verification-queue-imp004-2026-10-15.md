# Independent verification queue and IMP-004 calculation subpackage ? 2026-10-15

This is one bounded package, not a new audit. Application code is unchanged. DEC-001, OBJ-REV-009 and all preserved code subcases remain closed. No active REP-IN-002 source was opened. Import statements in other candidate modules exposed active dependencies; those paths were excluded from execution.

## Active exclusion boundary

Exclude extractFindings.ts, findingArchive.ts, findingProvenance.ts and provenance-bearing actions (including findingActions.ts and dashboard posting/status mutations), researchAssistantActions.ts, src/app/runs/[id]/page.tsx, migration0094 and their newly changed tests. Also exclude full callers whose runtime path imports or invokes those active modules. A controlled pure calculation subcase may be verified without importing those mutation paths; this is not closure of a complete application workflow.

## All22 implemented-awaiting rows: overlap screen

These are contract/dependency mappings, not a fresh inspection of active files. A named path is an exclusion or future test target, not a claim it was reviewed now.

| Row | Relevant files/dependencies | Boundary decision |
|---|---|---|
| IMP-002 / IMP-SHIP-001/002 | parseTable.ts, parseStatsFile.ts, engine; extraction/upload/page, crosstabs.ts -> findingArchive.ts | Existing code passes retained; full live chain overlaps. Prepared P2a harness only until stable target/authorization. |
| IMP-003 | parser canonicalization, variableOverrideActions/variableOverrides, calculation requests; page/crosstabs/archive | Existing code passes retained; real correction/provenance chain overlaps. |
| IMP-004 | engine, csmMetrics.ts -> descriptiveFindings.ts; chart/dashboard consumers import active mutations | FIRST safe calculation subpackage executed below. Full metadata decoding/save/reload deferred. |
| IMP-005 | variableOverrides.ts/actions, crosstabs.ts, findings consumers/page | Override primitives independently testable later; full stale-output chain overlaps active archive/page. |
| IMP-007 | upload/delete actions, storage cleanup, page and archive | Full acceptance overlaps active publication/deletion; defer. |
| IMP-009 | parseTable.ts, Python reader/dictionary/crosstab, driver input; page/provenance | Reader/calculation-only subcase independently testable later; full preview/provenance workflow overlaps. |
| IMP-010 | cached preview reader, dictionary/sample, page/browser reopening | Raw reader subcase available; browser/reopen contract overlaps page. |
| IMP-012 | instruments.ts -> extractFindings.ts and crosstabs.ts; instrumentActions.ts | Direct active text-extraction/shared archive dependency; defer full reread. |
| IMP-013 | dashboard posting/status/remove/revive mutations and finding provenance | Explicit active boundary; defer. |
| IMP-015 | labelOverlay.ts, engine metadata, crosstabs.ts/page consumers | Pure conflict detection independently testable later; visible analytical blocking/reload overlaps. |
| OBJ-SET-001 | objectiveLines.ts, candidate/framer actions, Setup save/page and Review | Normalization independently testable; cross-module acceptance overlaps Setup page. |
| OBJ-SET-002 | objectiveCandidateActions.ts, db.ts, text/normalization, uniqueness migration | Candidate-action-only verification potentially independent; real DB race/fallback requires separate authorized environment. No closure from mere mapping. |
| OBJ-SET-003 | objectiveFramer.ts, candidate lifecycle, initial Setup save/page | Framer-only cases potentially independent; complete Setup lifecycle overlaps page. |
| OBJ-SET-M02 | objectiveLines.ts and dual UI entry points | Pure marker parsing independently testable; whole UI roundtrip overlaps page. |
| OBJ-REV-004 | objectiveCandidateActions/framer, evidence edits and Review/Setup presentations | Candidate lifecycle subcases potentially independent; full dual-presentation/reload acceptance deferred where page/publication dependencies apply. |
| OBJ-REV-006 | objectiveEvidence.ts -> crosstabs.ts -> archive, dictionary/model and saved result | Pure matcher subcase potentially independent; full evaluator overlaps active shared module. |
| OBJ-REV-007 | objectiveEvidence.ts/actions, question revision persistence and evaluation builder/archive | Lock/edit primitive inspection/testing possible independently; complete protocol integration needs stable dependencies and separately authorized DB. |
| OBJ-REV-008 | validator/evidence model-response parser and persistence/evaluation | Parser subcase potentially independent; full evaluator/persistence path deferred where active dependencies apply. |
| OBJ-REV-011 | objectiveEvidenceActions.ts error mapping; objectiveEvidence.ts imports shared calculation/archive | Wrapper-only actual-action tests with controlled external boundary potentially independent; do not import active dependency implementation. |
| OBJ-REV-012 | objectiveValidator/evidence, findings publication/provenance, reload/page/consumers | Reads actively changing evidence and consumers; defer full durable-degradation handover. |
| OBJ-REV-013 | evaluation actions, persistence, continuation UI/page, shared builder/archive | Counter/parser primitives potentially independent; full persistence/reload and UI acceptance overlaps. |
| OBJ-REV-M04 | evidence actions, bounded evaluator, Continue UI/page | Comment/parser/loop subcase possible later; full continuation/load-failure UI overlaps. |

Potential independence is not a verification result. Only IMP-004 calculation subpackage was executed this pass.

## Executed evidence

Historical HEAD955a4eccef132956520b3e3c4ba78378d6748885 plus working tree. [Exact four-file SHA-256 manifest and results](../scripts/verification-imp004/results.json). In the retained synthetic pipeline, hashes are checked before/after execution; a final check also matched. Type-only imports do not execute chart/dashboard actions. No active archive/provenance module is loaded.

Commands:

    node node_modules/vitest/vitest.mjs run src/lib/__tests__/csmMetrics.test.ts --no-cache --pool=threads --poolOptions.threads.singleThread
    node scripts/verification-imp004/summary-check.cjs

- Retained Vitest: exit0, 1 file, **7/7 tests passed**.
- Synthetic pipeline: exit0, **17 Python engine cases**, **15 actual TypeScript summary fixtures**, **45 summary/invariant assertions passed**. These overlap by construction and are not claimed as 69 independent tests.
- The first synthetic pipeline launch was blocked by sandbox child-process spawning (status null, no Python result). The same script completed under the approved native execution context. No assertions weakened or credentials supplied.
- Actual dictionary/crosstab and summarizeSeries executed. Only the decoded-file reader boundary supplies controlled DataFrame/metadata; no formula was substituted for the functions under review.
- Actual native file metadata decoding, chart request construction, saved projection/reload and browser rendering were NOT executed.

## Requirement / risk / check / result / limitation

| Requirement | Material risk | Independent check | Result | Remaining limitation |
|---|---|---|---|---|
| Labelled/unlabelled1-5 agreement | Display wording changes numerical score | 100 individual responses,20 of each code: mean3, top2=40; actual Python rows feed TS summary | Pass | Controlled decoded metadata, not SAV/XLSX reader |
| Declared zero top category survives | Promoting category3 into top2 inflates score | 25 responses each1-4, declared5 has0; five rows retained; mean2.5/top2=25 | Pass | Live metadata persistence not tested |
| Sparse0-10 stays valid | Sparse NPS domain rejected | Only0/10 observed, declared eleven codes retained including nine zero rows | Pass for domain preservation | Not a new NPS uncertainty audit |
| Missing audit survives dictionary use | Missing definitions/denominator lost | Controlled native-style missing_ranges and NaN input; dictionary declares one missing definition, answered base100 of105 | Pass | Does NOT test native missing-range decoding or reload |
| Raw-code scale identity | Label/order changes score | Reverse bars and replace all labels while retaining raw codes | Pass | Actual chart rawCode projection is not imported because active mutation dependencies overlap |
| Generated count distributions | Zero categories or distribution changes break scoring | Twelve deterministic100-case vectors; count conservation and declared code set; means checked from individual responses and top2 from individual membership | Pass | Finite unweighted supported categorical fixtures, not every scale/design |

## Decisions and remaining work

**Closed at code level:** these numerical/domain/audit subcases of IMP-004. **Broad row remains implemented awaiting verification. No reproduced defect.** This pass does not create22 repairs or close the broad row using one subcase.

Remaining acceptance: actual supported native/plain reader metadata -> dictionary -> chart/crosstab -> saved values/reload, preserving declared codes, measurement/missing definitions, zeros, raw-code scoring and answered bases. Existing fixture pipeline can be extended once its chart/publication dependencies freeze. Required database/storage/browser writes are not authorized by OBJ-REV-009 scope. Prepare/use named disposable targets and explicit package authorization first. Existing scripts/p2a-integration setup/safety/browser protocol is the integration starting point, not executed here.

Next single verification package available without active code: OBJ-SET-002 candidate-addition/action subcases, after confirming its immediate dependency boundary is unchanged. Real uniqueness races/missing-index transaction recovery remain separately authorized integration checks. Do not start a second package simultaneously or reopen REV-009.

Retained scripts are read-only with synthetic in-memory fixtures. No application code/config/dependency/migration or live data was modified.
