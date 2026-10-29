# Current engineering status

Updated: 2026-10-29. State: **READY_FOR_CODEX** (BatchE1 on top of 919a3b54): CB1 (codebooks matched to every wave and confirmed automatically where the answer list covers the data; migration 0133), D3b (the brand and CSM dashboards redesigned, CSM by company), batches 55 to 57 (data reading, codebook layouts, claims against aggregated tables; scan off; '-' and '*' read as values), D2b parts 1 and 2 (NPS group against the rest; promoter model checked), the Cross tabs count, Copy here and Edit in Build table, the codebook links review per wave, the Setup save race, U1 (upload progress), T1 (export all tables; non-answer labels by the engine's rule). Implemented, ready for independent review. Migrations 0131, 0132 and 0133 to apply. **NOT READY for release.**

## Claude: batch E1, main copy (2026-10-29, evening)

Implemented, ready for review, on top of `919a3b54`. One package of the batches built today after D3aR2, in the order
they stack; each keeps its own handover:
- CB1: `claude/batchCB1-handover-2026-10-29.md` (migration 0133 `instrument_links.decided_by`).
- D3b: `claude/batchD3b-handover-2026-10-29.md`.
- Batches 55 to 57, D2b parts 1 and 2, the Cross tabs and codebook links fixes, the Setup save race:
  `claude/batch55-57-handover-2026-10-29.md`.
- U1, upload progress: commits only (see below).
- T1, export all tables and non-answer labels: `claude/batchT1-handover-2026-10-29.md` (first two sections).

Gates on the combined tree (T1 on U1 on 55-57 on D3b on CB1 on D3aR2):
- `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all passed.
- Library: 334 files, 2,520 passed, 91 skipped, 0 failed, no errors. This is the run on the tree with T1's second
  part; the first-part run had two failures, both fixed and rerun: a mounted test that did not resolve the new Setup
  rule, and a database hook timing out under load.
- Browser suite: 145 passed, 1 skipped, 2 failed; smoke 1 passed.
  - `mean-tick.check.mjs`: the new Export all links were also named "PowerPoint", so the check found them first.
    They are now named "Export all to PowerPoint" (and Excel, PDF).
  - `upload-progress.check.mjs`: its two 60 MB files were identical, so the second was recognised and not sent, and
    60 MB of short rows exceeded the case limit. The files now differ and stay under it. With the fixture fixed the
    check found a real fault: the first request's "Sending and saving" line was set inside the transition before its
    first await, so it never showed while that request ran. The first request's files are now named before the
    upload starts (`AddFilesPanel.tsx`); the check failed on the tree without this and passes with it.
  - Both, with `crosstab-wave-copy` and `crosstabs-entry`, were rerun on the fixed tree (see the package note).
- Each intermediate tree (CB1, D3b, 55-57) passed typecheck, lint and the self-test.
- The browser suite and the library suite ran on the combined tree only, not on each intermediate tree.
- U1's development-mode timing (the 120 MB upload with and without the fix) is not yet measured: its run used the
  identical-file fixture and was stopped.

Not in this package: T1's second part (NA warning, title rows, Objectives fill from a brief, path B, D2b part 3),
which follows as its own package; the Objectives prototypes (layout fold, wave selector), shown to Grant first.

## Claude: batch D3aR2, main copy (2026-10-29)

Implemented, ready for review, on top of `755e3c4d`. Handover `claude/batchD3aR2-handover-2026-10-29.md`; review
`docs/independent-d3ar-review-2026-10-29.md`. Gates on the exact tree (laptop code plus D3aR2; `94dc80f`):
`npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all passed;
library 316 files, 2,413 passed, 91 skipped, 0 failed, no errors; browser suite 143 passed, 1 skipped, 1 failed; smoke
1 passed. The first library run passed every test but reported one unhandled rejection from a timing-dependent test
(`instrumentScope.db.test.ts` 3, a confirmation racing a codebook removal); the test now settles the refusal at
once, and the rerun is the count above. The browser failure is `waves-in-project.check.mjs`: a wave label typed into
a newly imported file was reported as "changed elsewhere" while the file's first-view acceptance was saving, so the
label was not kept. It is not in D3aR2's code (tracker figures only); it passed in D3aR's run and recurs under load
(both failing runs had the library suite running beside them). It is being repaired with the next package.

## Claude: batch D3aR, main copy (2026-10-29)

Implemented, ready for review, on top of `49cf6d1b`. Handover `claude/batchD3aR-handover-2026-10-29.md`; review
`docs/independent-r1-d3a-review-2026-10-29.md`. Gates on the exact tree (laptop code plus D3aR; `364cc8e`):
`npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all passed;
library 316 files, 2,405 passed, 91 skipped, 0 failed; browser suite 144 passed, 1 skipped, 0 failed; smoke 1 passed.
The first run of the browser suite failed one check (nps-driver-split): the worktree lacked UI1R/UI1R2, which the
laptop has; they were added so the tested tree equals the laptop's code, and the full gates were run again.

## Claude: batches R1 and D3a, main copy (2026-10-29)

Implemented, ready for review, two commits on top of `4437102e`. Handovers `claude/batchR1-handover-2026-10-29.md`
(S1: workbook Labels sheet headed value_label; dictionary version 15; tables built before keep merged categories
until rebuilt) and `claude/batchD3a-handover-2026-10-29.md` (Tracker dashboard; figures from the Cross tab engine,
the NPS tool and driver analysis, checked against Grant's BMW and banking packs; `computeCrosstab` so opening a
dashboard saves no table). Gates: library 2,387 passed, 91 skipped, 0 failed on 8337d42; browser suite 142 passed,
1 skipped, 2 failed (checks corrected since, both now passing); smoke 1. No new migration.

## Claude: batch UI1R2, main copy (2026-10-29)

Implemented, ready for review, one commit on top of `1318db7a`. Handover `claude/batchUI1R2-handover-2026-10-29.md`:
UI1R-F01, the split keeps an in-memory value only when storage refuses the write, so a view reopened after another
tab saved a split shows the saved value. The browser check follows Codex's steps and failed on the UI1R code
(received 28 for 70); it and chart-legend-fit pass on the repair. tsc and eslint clean. No migration.

## Claude: batch UI1R, main copy (2026-10-29)

Implemented, ready for review, one commit on top of `6d00545d`. Handover `claude/batchUI1R-handover-2026-10-29.md`:
UI1-F01, the split follows a value saved, changed or removed in another tab; other keys ignored. The browser check
uses a second real tab and failed on the UI1 code (received 33). Gates on `0504ebf`: tsc and eslint clean; self-test
passed; library 2,377 passed, 91 skipped, 0 failed; browser 141 passed, 1 skipped, 1 failed (this check's own last
step referenced a variable the page does not have; corrected in the check, then it and chart-legend-fit passed);
smoke 1 passed. No migration.

## Claude: batches D2aR and UI1, main copy (2026-10-29)

Implemented, ready for review, applied as two commits on top of `c8bfac21`. Handovers in `claude/`:
`batchD2aR-handover-2026-10-29.md` (Codex D2A-F01 to F04, each with tests failing before the repair) and
`batchUI1-handover-2026-10-29.md` (chart legends and titles inside the chart, also on wide scrolling charts;
NPS and drivers in a draggable, keyboard-operable split; quadrants at full pane width). Gates on the combined tree
`523f4de7`: tsc and eslint clean; self-test passed; library 2,377 passed, 91 skipped, 0 failed; browser 141 passed,
1 skipped, 1 failed (review-action-failure, a navigation wait in an untouched area: passed in the two earlier full
runs today and 3 of 3 when rerun alone); smoke 1 passed. No migration.

## Claude: batch D2a, main copy (2026-10-29)

Implemented, ready for review, one commit on top of `c5837288`. Handover `claude/batchD2a-handover-2026-10-29.md`:
D1-F01 (recommend role only for a stated 0 to 10 scale, by `isZeroToTenScale`, the rule `computeNps` uses; partly
labelled lists asked about); tracker roles from raw files (brand list from names and labels, grids, CSM from names
and stated scales; Grant's coffee workbooks, CSM baseline, banking CSM CSV, BMW as SPSS and as CSV); codebook
question fields stored (migration 0131) and condition columns never an answer list; engine action `value_labels`;
dashboard choices per programme with compare-and-swap, carried by identity, weighted by default, Reset to
suggested (migration 0132). Gates on `7c4d6bcc`: tsc and eslint clean; self-test passed; library 2,358 passed,
91 skipped, 0 failed; browser 140 passed, 1 skipped; smoke 1 passed. Also recorded: Grant's decisions of 29 October
(`claude/decisions-2026-10-29.md`), the D6 indicator designs, the security backlog. Migrations 0131 and 0132 to apply
after a backup.

## Claude: batches 66, 67, 68, 53 and D1, main copy (2026-10-29)

Implemented, ready for review, applied as separate commits on top of `16253c5b`. Handovers in `claude/`:
`batch66-handover-2026-10-29.md` (the smoke helper waits for the clicked action's request to finish; control
check with a held rejection and an answered decoy), `batch67-handover-2026-10-29.md` (Grant's landing page;
Explore the platform enters the app), `batch68-handover-2026-10-29.md` (impossible months refused by engine and
server with one calendar rule, chart never moves a period; fully confidential countries selectable; published
indicator files read as Read), `batch53-handover-2026-10-29.md` (grid rows linked by their stem from column
labels and confirmed codebook wording, migration 0130; Confirm all N for one question; links in file order),
`d1-handover-2026-10-29.md` (tracker role recognition tested on four brand packs and a CSM pack). Migration
0130 must be applied after 0126 to 0129; before it, no grid link is made. Gates on the final tree: tsc, eslint, engine self-test clean; library 2,315 passed, 0 failed; browser 140 passed, 1 skipped; smoke 1 passed.

Batches 33 to 65 (26 to 28 October) are recorded in their handovers in `claude/` and in Codex's reviews in
`docs/`; this file was not updated for them at the time.

## Claude: batch32 (change tiers, rules registry, CI gates), main copy (2026-10-26)

Implemented, ready for review: the batch32 commit and its docs commit, on top of batch31. No application code, no migration. Details in `docs/batch32-handover-2026-10-26.md`. `AGENTS.md` change tiers and impact checklist; `scripts/change-tier.cjs`; `claude/rules-registry.md`; pull-request template; CI: whole-repo lint, engine self-test, tier summary, and a new browser workflow (not yet run on GitHub). **READY_FOR_CODEX.**

## Claude: batch31 (overview tiles, module roll-up, worker freshness), main copy (2026-10-26)

Implemented, ready for review: the batch31 repair commit and its docs commit, on top of batch30. No migration. Details in `docs/batch31-handover-2026-10-26.md`. Module pages roll up the rest of a module's items in place (Grant 07:05); overviews are tiles (07:06); the local statistics worker refuses unknown actions and restarts when its own script changes (the .xlsx refusal Grant hit at 06:57). Full library 1,763 passed / 72 skipped / 0 failed. Full browser 108 passed / 1 skipped / 0 failed; smoke 1 passed; self-test passed; lint 0 errors. **READY_FOR_CODEX.**

## Claude: batch30 (RP0-F01, RP0-V01, RP0-M01, cross-tab design label), main copy (2026-10-26)

Implemented, ready for review: the batch30 repair commit and its docs commit, on top of batch29. No migration. Details in `docs/batch30-handover-2026-10-26.md`; contracts `claude/answer-domain.md` (new) and `claude/one-reader-import.md`. RP0-F01: the engine keeps declared non-answer codes (user-missing, and "don't know"-type labels when excluded) out of a variable's answer domain (`_non_answer_codes`), so Codex's source scores top two box 40 with base 100; substantive unchosen codes stay (IMP-004). RP0-V01: the self-test uses an independent design t reference. RP0-M01: one typing policy beyond 2^53 for every text spelling; reader `engine-plain-2026.10.26b`, dictionary version 13. Cross-tab findings name the design treatment applied (`notes.designApplied`). Self-test all passed. Full library 1,759 passed / 72 skipped / 0 failed. Full browser 107 passed / 1 skipped / 0 failed; smoke 1 passed; lint 0 errors. **READY_FOR_CODEX.**

## Claude: batch29 (lint to zero errors), main copy (2026-10-25)

Implemented, ready for review: the batch29 repair commit and its docs commit, on top of batch28. No migration. Details in `docs/batch29-handover-2026-10-25.md`. `npm run lint` exit 0: 0 errors (was 349), 41 inherited warnings, none added. The 295 `.cjs` require errors are cleared by a rule change scoped to `**/*.cjs` (CommonJS by extension), stated as such; 48 test `any` casts typed; six `set-state-in-effect` fixes in ClaimTableChecks, CodingProgressBar, ProcessProgress, CrosstabFilters and RunShell, without suppressions (ClaimTableChecks also gains a stale-response guard it lacked). `effectStateRefactors.test.tsx` 6 passed with a mutation check each. Full library 1,750 passed / 72 skipped / 0 failed. Full browser 107 passed / 1 skipped / 0 failed; smoke 1 passed. **READY_FOR_CODEX.**

## Claude: batch28 (B26-F01, B26-F02, B27-F01, V-B27-01), main copy (2026-10-25)

Implemented, ready for review: the batch28 repair commit and its docs commit, on top of batch27 (`afc1b39`). No migration. Checks and limits in `docs/batch28-handover-2026-10-25.md`; contracts updated in `claude/one-reader-import.md` and `claude/document-deletion-contract.md`. B26-F01: decimal and exponent spellings a double cannot hold exactly keep their variable as text (`_exact_decimal`); reader `engine-plain-2026.10.26` and dictionary version 12 so earlier tables are rechecked and dictionaries rebuilt. B26-F02: `rowCells.TableCell`/`cellText` show logical cells as TRUE/FALSE in every table preview. B27-F01: erase counts each relationship once (current bin entry, plus links other bin entries hold to its findings). V-B27-01: one refusal notice at every moment after a layout change; the check waits for the settled Preview notice. Full library 1,744 passed / 72 skipped / 0 failed. Full browser 107 passed / 1 skipped / 0 failed; smoke 1 passed; flipped-codebook-guard alone 3 of 3 passed. **READY_FOR_CODEX.**

## Codex: batches26/27 independent verification, frozen afc1b39 (2026-10-25)

**READY_FOR_CLAUDE — 0 S1 / 0 S2 / 2 S3 newly reported (B27-F01 erase-count correctness; V-B27-01 native validation).** TP500-F01/F02/F03, IP1000-F01 to F04 and SYS5B-F01 to F04 close at the exercised boundaries. Original 1,000 imports and 1,000 bin cases pass after disclosed reviewer continuations; the 125 former bin failures repeat passing, with 36 extra three-file orders passing. Existing B26-F01 (S2 precision collision) and B26-F02 (S3 Boolean preview) repeat. **Cumulative: 0 observed S1 / 1 S2 / 3 S3 open; NOT READY for release.** Full library 1,736 passed / 73 skipped / 0 failed, exit 0. Full native 105 passed / 1 failed / 1 skipped, exit 1: two refusal alerts versus one expected; isolated repeats 3/3 pass, without superseding the failed full run. Six retained native repros and smoke pass. [Review and Claude handoff](independent-batch26-27-review-main-2026-10-25.md). Original implementation read-only; both 1,209-file archives exact, disposable infrastructure removed. Last accepted release remains 1e0f2a3, 37 Closed / 6 Blocked.

## Codex: batch26 independent repair review, frozen 67ef210 (2026-10-25)

**READY_FOR_CLAUDE — 0 S1 / 1 S2 / 1 S3 new findings.** TP500-F01/F02/F03 and IP1000-F01 to F04 close at the retained boundaries. B26-F01: decimal/exponent whole values beyond JSON exact range collide in stored data/categories; B26-F02: correctly stored Excel logical responses appear blank in Preview. Both repeat. Full library 1728 passed / 73 skipped, exit 0; fresh full native 106 passed / 1 skipped, exit 0. Original failed full runs remain with their investigations. [Review and Claude handoff](independent-batch26-review-main-2026-10-25.md). Cumulative at this frozen head: 0 observed S1 / 4 S2 / 2 S3 open; NOT READY for release. Batch27 remains separate and READY_FOR_CODEX; its claimed bin repairs are not verified here. Original implementation read-only, exact archives verified, disposable infrastructure removed; release acceptance remains 1e0f2a3, 37 Closed / 6 Blocked.

## Claude: batch27 (SYS5B-F01 to F04, document bin), main copy (2026-10-25)

Implemented, ready for review: the batch27 repair commit and its docs commit, on top of batch26. Checks and limits in `docs/batch27-handover-2026-10-25.md`; the contract in `claude/document-deletion-contract.md` (updated). Migration 0117 (`supabase/migrations/0117_document_content_identity_active_only.sql`, index change; needs 0115) for Grant to apply; until then removing a second identical copy is refused naming it. `documentBinIntegrity.db.test.ts` 8 passed, with a mutation check per finding. Full library 1,737 passed / 72 skipped / 0 failed. Full browser 106 passed / 1 skipped; smoke 1 passed.

## Claude: batch26 (one reader for CSV, TSV and Excel), main copy (2026-10-25)

Implemented, ready for review: the batch26 repair commit and its docs commit, on top of batch25. Checks and limits in `docs/batch26-handover-2026-10-25.md`; contracts in `claude/one-reader-import.md` and `claude/column-names-and-preview-identity.md`. Migration 0116 (`supabase/migrations/0116_document_table_read_provenance.sql`, additive) for Grant to apply; until then stored tables carry no read provenance and are checked against a fresh read when shown. Full library 1,729 passed / 72 skipped / 0 failed. Full browser 104 passed / 1 skipped / 2 failed (`flipped-codebook-guard` and `raw-file-reopen` assumed the retired reader; corrected), then those two and the new `one-reader-import` check, 3 passed; smoke 1 passed. `oneReaderImport.db.test.ts` covers each of the seven findings, with a mutation check for each.

## Codex: second System5000 complete; new bin integrity findings (2026-10-25)

**READY_FOR_CLAUDE — System5000B complete at frozen dbf2e8e: 5,000 executed / 4,875 pass / 125 fail; all 125 failures repeat unchanged. Seven known TP500/IP1000 defects excluded. 0 S1 / 3 S2 / 1 S3 new (SYS5B-F01 to F04, document-bin workflow). Cumulative 0 observed S1 / 10 S2 / 1 S3; NOT READY for release.** [Review and Claude handoff](independent-system5000b-review-main-2026-10-25.md), [5,000-case ledger](system5000b-cases-2026-10-25.md). Repair cross-file relationships lost on restore, erased-source warnings cleared by another restore, undurable RQ-text purge after erase, and blocked same-content recovery. Batch25 is not accepted across these boundaries. Core 4,000 cases pass; bin 875 pass / 125 fail after a disclosed 100-case fixture correction. All product failures repeat; native warning repro repeats. Production build and 8 targeted native checks pass; full library/unfiltered native suites not rerun. Pre-0115 refusal/upgrade control passes. Both 1,199-file archives exact, original implementation/lockfile edit preserved; disposable infrastructure removed. Existing import findings remain open, uncounted in this selection. No release acceptance; last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Claude: batch25 (document bin), main copy (2026-10-25)

Implemented, ready for review: the batch25 repair commit and its docs commit, on top of batch24. Checks and limits in `docs/batch25-handover-2026-10-25.md`; the contract in `claude/document-deletion-contract.md`. Migration 0115 (`supabase/migrations/0115_document_bin.sql`, additive) for Grant to apply; until then removing a file is refused with a message naming it, and pages still load. Full library 1,716 passed / 72 skipped / 0 failed. Full browser 104 passed / 1 skipped / 1 failed (`native-formats` asserted a hard delete; corrected), then every check that removes a file, 11 passed; smoke 1 passed.

## Codex: System5000 complete and batch24 boundaries verified (2026-10-25)

**READY_FOR_CLAUDE — System5000 complete at frozen 2793ac1: 5,000 executed / 4,831 pass / 169 fail; all failures repeat existing import/correction defects. 0 S1 / 0 S2 / 0 S3 new. Supplemental batch24 verification closes DI-F02 waves, B21-F01 and B23-F01. Cumulative 0 observed S1 / 7 S2 / 0 S3 open; NOT READY for release.** [Review and Claude handoff](independent-system5000-review-main-2026-10-25.md), [5,000-case ledger](system5000-cases-2026-10-25.md). Fresh input/profile permutations use retained independent contracts. 168 import failures plus one TP500-F03 correction failure repeat with identical mismatch details; no new defect established. Production build passes; 7 targeted native journeys and 2 original repair repros pass. Full library/unfiltered native suites not rerun. Both 1,186-file archives exact, original implementation/lockfile change preserved; disposable infrastructure removed. Main's later docs-only 4decba7 is recorded separately; no suite claimed on that tree. Seven TP500/IP1000 S2 findings remain open. No release acceptance; last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Claude: batch24 (DI-F02 waves, B21-F01, B23-F01), main copy (2026-10-25)

Implemented, ready for review: the batch24 repair commit and its docs commit, on top of batch23. Checks and limits in `docs/batch24-handover-2026-10-25.md`; contracts in `claude/output-set-integrity.md` and `claude/coding-write-ownership.md`. No migration. Full library 1,697 passed / 72 skipped / 4 failed: all 4 were 5-second timeouts in `researchQuality.db.test.ts` under machine load, and that file alone passes 54/54. Full browser 104 passed / 1 skipped; smoke 1 passed.

## Codex: batches 21–23 independent review (2026-10-25)

**READY_FOR_CLAUDE — batches 21–23 independently reviewed at frozen 4dbf8a1: 14 named findings closed; DI-F02 remains open for wave comparisons. New 0 S1 / 1 S2 / 1 S3 (B21-F01, B23-F01). Cumulative 0 observed S1 / 9 S2 / 1 S3; NOT READY for release.** [Review and Claude handoff](independent-batch21-23-review-main-2026-10-25.md). Repair unread wave comparisons, reject invalid coding operations before writes, and reconcile saved label limits with the editor baseline. Seven TP500/IP1000 findings remain open. Retained selections: 2,650 selected / 2,640 pass / 10 known TP500-F03 failures. Full library 1,697 passed / 73 skipped, exit 0; full native 104 passed / 1 skipped, exit 0; objective identity 3/3 supplemental repetitions pass. Build and TypeScript pass; lint 349 existing errors, none added/removed. Both 1,186-file archives exact, original implementation/package-lock change preserved, disposable infrastructure removed. No release acceptance; last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Claude: batch23 (DI-F01 to DI-F07), main copy (2026-10-25)

Implemented, ready for review: the batch23 repair commit and its docs commit, on top of batch22. Checks and limits in `docs/batch23-handover-2026-10-24.md`; the contracts in `claude/output-set-integrity.md`. Migration 0114 (`supabase/migrations/0114_finding_history_researcher_note.sql`, additive) for Grant to apply; until then retiring a finding with a researcher note is refused with a message naming it.

## Claude: batch22 (REC500-F01 to F04), main copy (2026-10-25)

Implemented, ready for review: the batch22 repair commit and its docs commit, on top of batch21. Checks and limits in `docs/batch22-handover-2026-10-24.md`; the contract in `claude/recommendation-edits.md`. Migration 0113 (`supabase/migrations/0113_recommendation_request_key.sql`, additive) for Grant to apply; until then adding your own recommendation is refused with a message naming it.

## Claude: batch21, main copy (2026-10-25)

Implemented, ready for review: the batch21 repair commit and its docs commit. Checks and limits in `docs/batch21-handover-2026-10-24.md`. No migration. Codex's previous status line is kept in `.fnd001/backup-status-1025a`, and recorded here as it set it:

Codex's verdict, recorded as it set the state line: "State: **READY_FOR_CLAUDE — integrity extension complete at frozen ed8c9c3: 1,400 additional selected / 1,170 pass / 230 fail; all failures repeat unchanged. 0 S1 / 5 S2 / 2 S3 new (DI-F01–F07; DI-F07 supplemental). Ten cases reproduce TP500-F03. Cumulative 0 observed S1 / 19 S2 / 3 S3; NOT READY for release.**"

## Codex: data-integrity extension complete (2026-10-24)

**READY_FOR_CLAUDE — integrity extension complete at frozen ed8c9c3: 1,400 additional selected / 1,170 pass / 230 fail; all failures repeat unchanged. 0 S1 / 5 S2 / 2 S3 new (DI-F01–F07; DI-F07 supplemental). Ten cases reproduce TP500-F03. Cumulative 0 observed S1 / 19 S2 / 3 S3; NOT READY for release.** [Review and Claude handoff](independent-data-integrity-extension-review-main-2026-10-24.md), [1,400-case ledger](data-integrity-extension-cases-2026-10-24.md). Prioritize cross-project/tenant output-set merges, destructive regeneration after unread sources, lost history notes, checks persistence and wave-label conflicts. Retained 36-file gate: 267 passed / 17 skipped, exit 0. Earlier same-HEAD full gates remain separately reported; no fresh full-suite/browser claim. Original implementation unchanged, all 1,168 archive files exact, disposable database container removed. Earlier findings/closures and last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Codex: Recommendations, Insights Reports and System3000 complete (2026-10-24)

**READY_FOR_CLAUDE — Recommendations500, Insights Reports500 and System3000 complete at frozen ed8c9c3. 4,000 selected / 3,715 pass / 285 fail; repeated failures unchanged. 0 S1 / 4 S2 / 0 S3 new (REC500-F01–F04, one supplemental native finding). Cumulative 0 observed S1 / 14 S2 / 1 S3; NOT READY for release.** [Completed handoff](recommendations-reports-system3000-handoff-2026-10-24.md). Full library 1,654 passed / 73 skipped, exit 0; full native 101 passed / 1 skipped, exit 0. Existing Import/Coding/Secondary failures remain open; no new system defect beyond the four Recommendations findings. Shared cleanup complete; both 1,168-file archives exact, original implementation and package-lock change preserved. Last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Codex: Recommendations and Insights Reports handoffs (2026-10-24)

**READY_FOR_CLAUDE — Recommendations500: 380 pass / 120 fail, unchanged repeat; 0 S1 / 4 S2 / 0 S3 new (REC500-F01–F04, one supplemental native finding). Insights Reports500: 500 pass / 0 fail. System3000 IN PROGRESS, not complete. Cumulative 0 observed S1 / 14 S2 / 1 S3; NOT READY for release.** [Recommendations handoff](independent-recommendations500-review-main-2026-10-24.md), [Insights Reports review](independent-reports500-review-main-2026-10-24.md). The 3,000 additional distinct system permutations are selected and hash-frozen; no completed system result is claimed. Shared disposable infrastructure remains active. Original application unchanged. Last accepted release 1e0f2a3, **37 Closed / 6 Blocked**, unchanged.

## Codex: independent batch19/batch20 repair review (2026-10-24)

**READY_FOR_CLAUDE — batch19/batch20 reviewed at frozen `ed8c9c3`: all 11 named targets closed at the exercised boundaries; 0 S1 / 0 S2 / 1 S3 new (V-B19-01, RQ test isolation). Full native 101 passed / 1 skipped, exit 0. Full library exit 1: 1,652 passed / 2 failed / 73 skipped; both unchanged focused continuations 58 passed / 1 skipped. Cumulative 0 observed S1 / 10 S2 / 1 S3; NOT READY for release.** [Review and handoff](independent-batch19-20-review-main-2026-10-24.md). Retained original action/export probes: 302 pass; original native repros: 8 pass; decision conflict 5/5 and pane readiness 3/3 repetitions pass. The controlled scheduler probe proves a timed-out RQ case can change the next case's shared tenant; its intentional failures are separate from product outcomes. The earlier decision-editor typing timeout was not reproduced and remains unexplained. Documentation closures are separate. Shared review infrastructure removed, both 1,168-file archives exact, original implementation and package-lock change preserved. Remaining TP500/IP1000/COD500/SEC500 findings stay open; last accepted release `1e0f2a3`, **37 Closed / 6 Blocked**, unchanged.


## Claude: batch20 (AN500-F01), main copy (2026-10-24)

Implemented, ready for review: the batch20 repair commit and its docs commit, on top of batch19. Checks and limits in `docs/batch20-handover-2026-10-24.md`; the contract in `claude/driver-finding-provenance.md` ("Predictor identity"). No migration. Not yet started: COD500-F01, COD500-F02 and SEC500-F01 from Codex's four-review queue.

## Claude: batch19, main copy (2026-10-24)

Implemented, ready for review: the batch19 repair commit and its docs commit. Checks and limits in `docs/batch19-handover-2026-10-24.md`. No migration. Codex's previous status line is kept in `.fnd001/backup-status-1024e`, and recorded here as it set it:

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE — Coding, Secondary analysis, Findings and Insights complete at frozen `e278adf`: 0 S1 / 3 S2 / 0 S3 new. 2,000 selected / 1,875 pass / 125 fail. Cumulative 0 observed S1 / 17 S2 / 4 S3; NOT READY for release.** All handoffs published, original implementation unchanged, shared disposable infrastructure removed."

## Codex: four-review queue complete (2026-10-24)

**READY_FOR_CLAUDE: 0 S1 / 3 S2 / 0 S3 new.** [Completed handoff](coding-secondary-findings-insights-handoff-2026-10-24.md). Coding 425 pass / 75 fail; Secondary analysis 450 pass / 50 fail; Findings 500 pass; Insights 500 pass. **2,000 selected / 1,875 pass / 125 fail**; all product failures repeat unchanged. COD500-F01/F02 and SEC500-F01 are actionable; no new Findings/Insights defect established at the exercised boundaries. Final shared cleanup complete, all 1,157 tracked archive files exact, original implementation unchanged. Cumulative independently open **0 observed S1 / 17 S2 / 4 S3; NOT READY**. No full-suite rerun or release acceptance. Last accepted scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.

## Codex: independent Insights500 handoff (2026-10-24)

**READY_FOR_CLAUDE.** [Review](independent-insights500-review-main-2026-10-24.md), [ledger](insights500-cases-2026-10-24.md). Frozen `e278adf`: **500 pass / 0 fail**. No new Insights defect at the exercised boundaries. Independent source/tier/action cases 500 pass; retained 22 pass / 4 skip. All four requested reviews are complete; shared cleanup is next. Cumulative independently open **0 observed S1 / 17 S2 / 4 S3; NOT READY**. Original implementation read-only; shared disposable services remain for the review queue until final cleanup. Last accepted scope/counts unchanged.

## Codex: independent Findings500 handoff (2026-10-24)

**READY_FOR_CLAUDE.** [Review](independent-findings500-review-main-2026-10-24.md), [ledger](findings500-cases-2026-10-24.md). Frozen `e278adf`: **500 pass / 0 fail**. No new Findings defect at the exercised boundaries. Independent actions 500 pass; retained 21 pass / 2 skip; native 3 pass. Earlier observer/schema quoting errors are retained separately. Cumulative independently open **0 observed S1 / 17 S2 / 4 S3; NOT READY**. Original implementation read-only; shared disposable services remain for the review queue until final cleanup. Last accepted scope/counts unchanged.

## Codex: independent Secondary analysis500 handoff (2026-10-24)

**READY_FOR_CLAUDE.** [Review](independent-secondary500-review-main-2026-10-24.md), [ledger](secondary500-cases-2026-10-24.md). Frozen `e278adf`: **450 pass / 50 fail**. SEC500-F01 (S2): malformed model output is published as an empty successful report reading, removing prior unreviewed findings; all 50 failures repeat, and native reload confirms Extracted, 0 findings. Retained library 53 pass / 3 skip. Cumulative independently open **0 observed S1 / 17 S2 / 4 S3; NOT READY**. Original implementation read-only; shared disposable services remain for the review queue until final cleanup. Last accepted scope/counts unchanged.

## Codex: independent Coding500 handoff (2026-10-24)

**READY_FOR_CLAUDE: 0 S1 / 2 S2 / 0 S3 new.** [Review](independent-coding500-review-main-2026-10-24.md), [ledger](coding500-cases-2026-10-24.md). Frozen `e278adf`: **425 pass / 75 fail**, all 75 failures repeat unchanged. COD500-F01: cross-tenant theme metadata and turn-note creation succeeds and blocks the legitimate owner’s save; controlled cleanup restores it. COD500-F02: a wrong-run request mutates another project’s coding and records inconsistent override lineage. Retained library 57 pass; native 4 pass; build passes. Original implementation read-only. Shared disposable services remain for the immediately following three reviews; no cleanup is claimed yet. Cumulative open **0 observed S1 / 16 S2 / 4 S3; NOT READY**. Last accepted scope/counts unchanged.

## Codex: independent Analytics500 handoff (2026-10-24)

**READY_FOR_CLAUDE: 0 S1 / 1 S2 / 0 S3 new.** [Review](independent-analytics500-review-main-2026-10-24.md), [500-case ledger](analytics500-cases-2026-10-24.md). Frozen `e278adf`: **500 selected permutations pass** (350 numerical / 150 actual action-persistence cases). Supplemental **AN500-F01 (S2)**: driver display-name allocation collides with a literal suffix label; the strongest driver receives another predictor’s performance mean **16 instead of 106**. Five collisions fail with five healthy controls passing, repeated unchanged. Native real-file chart/posting and actual Findings Excel confirm wrong chart association and ambiguous question attribution. Retained library **101 pass**; native Analytics **7 pass**; build passes. Full suites were not rerun. Disposable infrastructure removed; all 1,157 tracked archive files exact; original implementation unchanged. Cumulative independently open **0 observed S1 / 14 S2 / 4 S3; NOT READY**. Existing findings remain separate and RQ-F01 remains closed. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.

## Codex: independent Cross tabs500 handoff (2026-10-24)

**READY_FOR_CLAUDE: 0 S1 / 1 S2 / 1 S3 new.** [Review](independent-crosstabs500-review-main-2026-10-24.md), [500-case ledger](crosstabs500-cases-2026-10-24.md). Frozen `e278adf`: **452 pass / 48 fail**; unchanged database repeat again 52 pass / 48 fail. CT500-F01 (S2): wrong-run table deletion archives/deletes the other project’s table findings while leaving its table, and the real action reports success. CT500-F02 (S3): simultaneous builds collide on max+1 table allocation; the unique constraint refuses one explicitly. All 400 independent numerical cases pass. Targeted retained library 51 pass / 1 skip; native Cross tabs 4 pass; build passes; actual Excel/Slides retain the independent mean. No full-suite rerun or general statistical certification is claimed. Disposable resources removed; all 1,157 tracked archive files exact. Cumulative independently open **0 observed S1 / 13 S2 / 4 S3; NOT READY**. RQ-F01 remains closed and other findings stay separate. Last accepted scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.

## Codex: batch18 independent repair handoff (2026-10-24)

**RQ-F01 CLOSED; READY_FOR_CLAUDE for RQ-F02, 0 S1 / 1 S2 / 0 S3 new.** [Review](independent-batch18-review-main-2026-10-24.md). Frozen `e278adf`: all-rejected reading/retry, partial absence/checklist, genuine-empty, legacy-note and unfinished-step Word controls pass. The selected review updates after retry without reload; the documented top stage-banner limitation remains. New RQ-F02: RQ-CMP-PROBLEM is rated 3/5 as compared with the brief although the proposal failed reading and every cited quote is from the brief. Actual native screen and Word reproduce it; healthy both-source control passes. Full evidence and retained reviewer setup corrections are in the review. Cumulative independent open counts remain **0 observed S1 / 12 S2 / 3 S3; NOT READY**: close RQ-F01, open RQ-F02. Other import, citation, Objectives and Business decisions findings are unchanged. No application repair; disposable infrastructure removed and 1,157 tracked archive files exact. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.


## Codex: independent Business decisions500 handoff (2026-10-24)

**READY_FOR_CLAUDE for Business decisions: 0 S1 / 2 S2 / 1 S3 new.** [Review](independent-decisions500-review-main-2026-10-24.md), [500-case ledger](decisions500-cases-2026-10-24.md). Frozen `e278adf`: **380 pass / 120 fail**; all 120 failures repeat unchanged. DEC500-F01: stale edits overwrite the winner; gone-target saves report success and discard drafts. DEC500-F02: simultaneous reject/unaccept/delete operations leave stale current-decision context despite completed refresh; native reload and actual Excel metadata confirm it. M-DEC500-01: regeneration comment falsely says accepted candidates are never touched. Retained targeted checks: 34 library passes / 4 placeholder skips; 4 native passes. Three independent native repros fail their integrity expectations; no full-suite rerun is claimed. Services/container removed; all 1,157 tracked archive files match frozen Git bytes. Cumulative independent open counts: **0 observed S1 / 12 S2 / 3 S3; NOT READY for release**. Batch18 RQ-F01 remains awaiting separate review; its READY_FOR_CODEX header is preserved. Last accepted scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.


## Claude: batch18 (RQ-F01), main copy (2026-10-24)

Implemented, ready for review: `8b3a77a` (RQ-F01) and this docs commit. Checks and limits in `docs/batch18-handover-2026-10-24.md`; the contract in `claude/research-quality-evidence.md`. Codex's previous status line is kept in `.fnd001/backup-status-1024d/`, and recorded here as it set it:

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE — Objectives500 at frozen `06aaa11`: 0 S1 / 1 S2 / 0 S3 new; 0 observed S1 / 10 S2 / 2 S3 open cumulatively; NOT READY for release.** All 500 selected permutations pass in the valid harness. Supplemental concurrent delete/reject/unaccept probes fail 60/60, with passing sequential controls; native two-page Unaccept and actual DOCX bytes confirm OBJ500-F01: saved objective context can contradict current candidate status. Retained Objectives integration 91 passed / 8 skipped; retained native Objectives 15 passed. Prior batch17 and import/Research quality findings remain separate. Application implementation unchanged; disposable infrastructure removed. No existing-database migration, commit, push or deployment."

## Codex: independent Objectives500 handoff (2026-10-24)

**READY_FOR_CLAUDE: 0 S1 / 1 S2 / 0 S3 new.** [Review](independent-objectives500-review-main-2026-10-24.md), [500-case ledger](objectives500-cases-2026-10-24.md). Frozen `06aaa11`: 500 selected permutations pass; separate 60-permutation concurrency confirmation fails throughout. OBJ500-F01 leaves rejected/pending wording in accepted context, or a deleted objective in the stated list. Native two-page Unaccept survives reload with stale context; an actual DOCX exports rejected wording. The initial owner-seed harness errors and export alias continuation remain. Targeted retained checks: 91 library passes / 8 placeholders skipped; 15 native passes. No full-suite rerun is claimed. Review-owned services and container removed; all 1,154 tracked archive files match Git bytes and original dirty lock preserved. Cumulative independent open counts: 0 observed S1 / 10 S2 / 2 S3. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.


## Codex: batch17 independent handoff (2026-10-24)

**READY_FOR_CLAUDE at frozen `06aaa11`: 0 S1 / 1 S2 / 2 S3 new.** [Review](independent-batch17-review-main-2026-10-24.md). Technical TXT/PDF/DOCX reads, a true pre-0112 refusal followed by actual migration/recovery, project/tenant scoping, explicit query failure/recovery and weighting metadata pass their exercised controls. The browser reproduces the missing second same-name citation; technical failed reads remain failed through project processing, with no Findings mined. Both M-B16 S3 findings close. New S3 actions are lasting engineering contracts and pane-test readiness. The first full native failure, its trace and all reviewer continuations remain. Full gate results and limits are in the review. Known TP500/IP1000 import findings are not regressions in this batch; RQ-F01 remains separate. Cumulative independent open counts: 0 observed S1 / 9 S2 / 2 S3. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.


## Codex: focused Research quality investigation (2026-10-24)

**READY_FOR_CLAUDE for RQ-F01: 0 S1 / 1 S2 / 0 S3 new.** [Independent handoff](independent-research-quality-review-main-2026-10-24.md), frozen `3184b06`. Rejected extraction quotes can produce a complete 0% review with ten Absent criteria, surviving reload and Word export; retry does not recover, a healthy new review does. Independent library probes: 187 pass / 1 fail across 188 logical cases; retained Research quality/margin controls: 112 pass. Normal native journey passes; independent native repro fails the correctness expectations and verifies healthy recovery. Disposable infrastructure removed; 1,144 archive files exact. Earlier independently open totals become 0 observed S1 / 8 S2 / 2 S3; the two M-B16 S3 repairs and batch17 are awaiting separate verification. This frozen review does not replace main's newer READY_FOR_CODEX status or accept its newer changes. Last accepted release scope and counts remain unchanged.


## Claude: batch17 and M-B16-01/M-B16-02, main copy (2026-10-24)

Implemented, ready for review: `f35034f` (batch17), `4224d5d` (M-B16-01, M-B16-02) and this docs commit. Checks and limits in `docs/batch17-handover-2026-10-24.md`. Migration 0112 (`supabase/migrations/0112_technical_documents.sql`) for Grant to apply in Studio. Codex's previous status line is kept in `.fnd001/backup-status-1024c/`, and recorded here as it set it:

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE — 0 observed S1 / 7 S2 / 2 S3 open cumulatively; NOT READY for release.** All three queued investigations are complete: second 500 probes (432 pass / 68 fail at `5f67734`), dashboard/batch16 review (B15-F01 CLOSED; full library 1,591 passed / 73 skipped, native 95 passed / 1 skipped, exit0 at `3184b06`), and 1,000 import permutations (565 pass / 435 fail at `3184b06`). Four new S2 import findings IP1000-F01/F02/F03/F04 join TP500-F01/F02/F03; M-B16-01/M-B16-02 remain S3. Handoffs and exact evidence linked below. No application repair, migration of an existing database, commit, push or deployment."

## Codex: 1,000-import accuracy investigation (2026-10-24)

[Claude handoff](independent-import1000-review-main-2026-10-24.md), [1,000-case ledger](import1000-cases-2026-10-24.md). Eight format variants, 1,000 distinct sources, final 565 pass / 435 fail. New S2: text-code coercion, date meaning lost, UTF-8 corruption without BOM and supplemental malformed-CSV publication. Earlier naming defects confirmed; the correction-map defect remains open separately. Four rendered native accuracy repros fail, as retained. Numeric-to-numeric cell receipts show 0 ULP difference; that does not cure text/date/identity failures. Verified review infrastructure removed, 1,144 archive files unchanged. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.

## Codex: second 500 probes and dashboard/batch16 review (2026-10-24)

Handoffs: [500-permutation review](independent-trust500b-review-main-2026-10-24.md), [500-case ledger](trust500b-cases-2026-10-24.md), [dashboard/batch16 review](independent-dashboards-batch16-review-main-2026-10-24.md). Three independent S2 identity/persistence findings remain open; two separate S3 documentation/dead-import findings. Original B15-F01 repro and recovery pass. Last accepted release scope `1e0f2a3`, baseline **37 Closed / 6 Blocked**, unchanged.

## Claude: dashboards merge and batch16 (B15-F01), main copy (2026-10-24)

Implemented, ready for review: `d5ee929` (dashboards from the 3001 prototype), `f95999d` (B15-F01) and this docs commit. Checks and limits in `docs/dashboards-merge-handover-2026-10-24.md` and `docs/batch16-handover-2026-10-24.md`. Codex's previous status line is kept in `.fnd001/backup-status-1024b/`.

## Claude: batch14 (RR-M02) and batch15 (TR500-F01, F02, F03, M01), main copy (2026-10-24)

Implemented, ready for review: `2cf49d9` (RR-M02), `ed1dc1f` (trust500 repairs) and this docs commit. Checks and limits in `docs/batch14-handover-2026-10-23.md` and `docs/batch15-handover-2026-10-24.md`. Codex's previous status line is kept in `.fnd001/backup-status-1024a/`.

## Claude: batch13 (RR-F03, RR-F06, RR-M02, RR-M03), main copy (2026-10-23)

Implemented, ready for review: `b4b5b85` (repairs, migration 0111) and this docs commit. Checks and limits in `docs/batch13-handover-2026-10-23.md`, which also corrects the batch11 and batch12 library reports (their filter hid the vitest Errors line and exit code). Codex's previous status line is kept in `.fnd001/backup-status-1023o/`.

## Claude: batch11 (RR-F05) and batch12 (RR-F01, RR-F03, RR-F06, RR-F07, RR-F08, RR-M01), main copy (2026-10-23)

Implemented, ready for review: `91fed93` (dependencies), `ce2be9e` (repairs) and this docs commit. Checks and limits in `docs/batch11-handover-2026-10-23.md` and `docs/batch12-handover-2026-10-23.md`. Run `npm install` after pulling. Codex's previous status line is kept in `.fnd001/backup-status-1023n/`.

## Claude: release audit RR-F01 to RR-F04, main copy (2026-10-23)

Implemented, ready for review: `1f19dfa` (repairs, migration 0110) and this docs commit. Checks and limits in `docs/batch10-handover-2026-10-23.md`. Codex's previous status line is kept in `.fnd001/backup-status-1023m/`.

## Claude: B8-F01, B8-F02, M-B8-01, M-B8-02 and the movable window, main copy (2026-10-23)

Implemented, ready for review: `d5b5f66` (window), `0bc3ec2` (repairs) and this docs commit. Checks and limits in `docs/batch9-handover-2026-10-23.md`. Codex's previous status line is kept in `.fnd001/backup-status-1023l/`.


## Claude: B7-F01 and four open items, main copy (2026-10-23)

Implemented, ready for review: `cbe4b29` (open items, migration 0109), `658ca5b` (B7-F01, compact window) and this docs commit. Checks and limits in `docs/batch8-handover-2026-10-23.md`. Codex's previous status line is kept in `.fnd001/backup-status-1023k/`.


## Claude: B6-F01 and B6-F02, main copy (2026-10-23)

Implemented, ready for review: `98230f8` (with migration 0108) and this docs commit. Checks and limits in `docs/batch7-handover-2026-10-23.md`. Codex's previous status line is kept in `.fnd001/backup-status-1023j/`.


## Claude: B5-F01 to B5-F05, main copy (2026-10-22)

Implemented, ready for review: `af9fed4` and this docs commit. Checks and limits in `docs/batch6-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022i/`.


## Claude: B4-F01, B3-01, M-B4-01, prompt caching and the Research assistant, main copy (2026-10-22)

Implemented, ready for review: `7c9c783` (prompt caching), `1eda64b` (Research assistant tools), `2b0868b` (floating assistant), `a67bf69` (B4-F01, B3-01, M-B4-01) and this docs commit. Checks and limits in `docs/batch5-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022h/`.


## Claude: B3-01, B3-02, one-page Objectives and Grant's evening changes, main copy (2026-10-22)

Implemented, ready for review: `458a829`, `587636a`, `8f256ef`, `66fe59d`, `c9390ac`, `49d8026`, `9b5c123` and this docs commit. Checks and limits in `docs/batch4-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022g/`.


## Claude: M-B2-01, M-B2-02 and the knowledge base, main copy (2026-10-22)

Implemented, ready for review: `41cdc49` (knowledge base and manual), `8ff226d` (M-B2-01, M-B2-02) and this docs commit. Checks and limits in `docs/batch3-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022f/`.


## Claude: M-BATCH-01, sidebar roll-up and 10 point scales, main copy (2026-10-22)

Implemented, ready for review: `f8f0420` (M-BATCH-01), `1f220a6` (sidebar), `9a03ad7` (10 point scales) and this docs commit. Checks and limits in `docs/batch2-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022e/`.


## Claude: IR repairs and design batch, main copy (2026-10-22)

Implemented, ready for review: `2e0ba53` (Research quality), `d10d28b` (multiple-response links), `5628913` (IR-01, IR-02, IR-03, M-IMPORT-01), `b78ceae` (SemanticTabs mean), `9af17ed` (SemanticTabs memory), `90e2753` (StarterTabs) and this docs commit. Checks and limits in `docs/design-batch-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022d/`.


## Claude: Import screen and proposal re-read rule, main copy (2026-10-22)

Implemented, ready for review: `2ad3ece`, `650735c`. Checks and limits in `docs/import-and-reread-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022c/`.


## Claude: repairs for Codex's GT1000 repair review, main copy (2026-10-22)

Implemented, ready for review: `20e49ab`, `88f092a`, `7d9fd96`. Checks and limits in `docs/r1000-repair-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022b/`.


## Claude: repairs for Codex's GT1000 review, main copy (2026-10-22)

Implemented, ready for review: `63d50af`, `522df47`, `190ae7f`. Checks and limits in `docs/gt1000-repair-handover-2026-10-22.md`. Codex's previous status line is kept in `.fnd001/backup-status-1022a/`.


## Claude: repairs for Codex's GT500 re-review, main copy (2026-10-21)

Implemented, ready for review: `678bbf8` (R500-02 Setup edits bound to their candidate; R500-01 failed fill kept through ordinary saves) and `26a37ee` (UI-R500-01). Checks and limits in `docs/r500-repair-handover-2026-10-21.md`. Codex's previous status line is kept in `.fnd001/backup-status-1021c/`.


## Claude: repairs for Codex's GT500 review, main copy (2026-10-21)

Implemented, ready for review: `0e37127` (GT500-F01 import lineage, F02 visible failed fills, F03 stale-edit conflicts, P01 one identity for Add, Fill and scoring, M-GT500-01 briefs and comments) and `b07a79a` (UI-GT500-01). Checks and limits in `docs/gt500-repair-handover-2026-10-21.md`. Codex's previous status line is kept in `.fnd001/backup-status-1021b/`.


## Claude: repairs for Codex's GT100 re-review, main copy (2026-10-21)

Implemented, ready for review: `9ff70e5` (keys), `12ae030` (GTR-01), `bfb6df5` (GTR-02), `b007ef4` (SEC-01, SEC-02), `979cdc9` (M-GTR-01 briefs), `74ed2ef` (filters across the top and theme tiles, design) and this docs commit. Full suite on `74ed2ef`: browser 67 passed (1 skipped), unit 1,269 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details: `docs/gtr-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 100-case and RR re-reviews, and the new section design (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: the full 100-case golden-thread review found shared GT100-F01 to GT100-F03; RRV-01 remains open. See `docs/golden-thread-100-independent-review-2026-10-21.md` and its case matrix. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked unchanged."

Implemented, ready for review, main copy only: `df90a55` (RRV-01), `053a475` (rename), `2322679` (GT100-F01), `ddb4c00` (GT100-F02, F03), `670eb38` (Findings, Insights, Recommendations and Insights report overviews with OV-01 to OV-04; please assess apart from the repairs) and this docs commit. Full suite on `670eb38`: browser 67 passed (1 skipped), unit 1,257 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details, controls and limits: `docs/gt100-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 21 October re-review (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: independent repair review found five remaining correctness issues (RR-01 to RR-05); see `docs/independent-review-2026-10-21.md`. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked remain unchanged."

Implemented, ready for review: repairs (3000 `bf244dd`, 3001 `7282c71`), a follow-up closing two acceptance gaps (3000 `d433992`, 3001 `5520856`) and this docs commit. On 3001 the Findings and Insights overviews (`18cb7e7`, Grant's design trial) sit between them and touch none of the repaired files; please assess them apart from the repair verdict. Full suites on both copies: browser checks 64 and 65 passed (1 skipped each), unit 1,193 / 1,206 passed, smoke and objective acceptance passed, lint errors unchanged at 349. Details, previous-code controls and limits: `docs/rr-repair-handover-2026-10-21.md`.

## Claude: repairs for Codex's 20 October review (2026-10-21)

Codex's verdict, recorded as it set the state line: "**READY_FOR_CLAUDE**: independent A–E review of both copies found 11 correctness issues and 2 maintainability concerns; see `docs/independent-review-2026-10-20.md`. Last accepted scope `1e0f2a3` and release baseline 37 Closed / 6 Blocked remain unchanged."

Implemented, ready for review: three packages per copy (3000 `bee2612`, `356a3e9`, `dcefdc0`; 3001 `b8b4299`, `d8e4ba2`, `40be83b`) and this docs commit. Full suites on both copies: 63 browser checks passed (1 skipped), unit 1,184 / 1,192 passed, smoke and objective acceptance passed, lint unchanged at 349. Details, previous-code controls and limits: `docs/repair-handover-2026-10-21.md`.

## Claude: 18 to 20 October work ready for review (2026-10-20)

Implemented, ready for review. Review targets: main copy (`app`, port 3000) at `6a8dc08` (Coding and Reports and decks carried from 3001 at Grant's request, 20 October evening), redesign copy (`app-import-redesign`, port 3001) at `0afd1c3`; the check fixes and docs-only commits around them are named in the handover. The last independently accepted scope stays `1e0f2a3`; the release baseline stays 37 Closed / 6 Blocked.

- What changed, the checks run with their counts, mocks versus real infrastructure, migrations (0106 and 0107 new) and limits: `docs/handover-2026-10-20.md`.
- What to double-check tonight, sequenced as the standard asks (calculations and identity, persistence and concurrency, asynchronous UI state, parity between the copies, comments and checks): `docs/codex-double-checks-2026-10-20.md`.
- Nothing pushed or deployed; no development or live database touched.


## Claude repair of recommendation currentness (2026-10-17; commit `8fa326c`)

Implemented, ready for review. Base: application `1f21f71`, docs `9225d95`. Scope: only the recommendation-currentness gap, with the schema extension recorded in the handoff before editing.

**Reproduced first.** Codex's DB probe assertion (`independentRecommendationContext.db.test.ts`, no-context insight with an older recommendation) fails on the previous code with `expected 0 to be greater than 0`; the native generator replay was already recorded failing by Codex (`native-unframed-reworded.log`, `native-unframed.log`).

**Repair.**
- Migration `0102_recommendation_decision_context.sql` (additive, idempotent): `recommendations.decision_context`. Existing rows stay null.
- `recommendationAgent.ts`: both generators (per-finding and synthesized) store the decision statement their prompt was built from. It is read before the model call, so a change committed during drafting is not mistaken for what the model saw. Stored only when 0102 is applied.
- `decisionContext.ts`: recommendations are judged on their own record, never inferred from their insight. With a record: "earlier" when it differs from the current statement (whitespace ignored). AI recommendation without a record: "unknown", counted and said as unknown, never assumed current. Without 0102 applied, every AI recommendation is unknown. Researcher-written and rejected recommendations are not counted.
- `decisionRefresh.ts`: `decisionContextMismatch` now returns `{ insights, recommendations, recommendationsUnknown }`; recommendations counts earlier plus unknown.
- `DecisionBriefReview.tsx`: the standing notice names earlier insights, earlier recommendations and unknown recommendations separately, after reload too; "Could not check" when the lookup fails. The misplaced comment Codex noted is moved back above `DecisionRefreshNotice`.
- Nothing is rewritten, deleted or reworded.

**Migration.** `0102` must be applied wherever the app runs before new recommendations carry a record; until then every AI recommendation shows as unknown (conservative). Not applied to any live or development database (not authorised).

**Limitations.** Existing AI recommendations written before 0102 stay "unknown" until rewritten; there is no rewrite action (a product decision). Recommendation lists, synthesized-insight cards, decks and the narrative still carry no per-item mark; the panel count is their qualification.

**Checks on the final tree (cloud workspace, disposable PostgreSQL 16, real Python; model replay or mock only):**
- `npx tsc --noEmit -p .`: pass. ESLint on the changed files: clean.
- `vitest run src/lib/__tests__ --pool=forks`: 122 files, **868 passed, 0 failed, 40 skipped**.
- New `recommendationDecisionContext.db.test.ts` (actual generators, actual decision actions, mocked model that echoes the decision it was shown): Codex's replay A to C to A with researcher-edited wording kept; insight and recommendation recording different decisions (returning to the insight's decision leaves the recommendation counted); synthesized path; decision committed during drafting (record = prompt); unknown, researcher-written, rejected and other-run controls; Codex's original probe assertion. **All 6 fail on the previous application code** (migration kept), pass now.
- `decisionRefreshReconciliation.db.test.ts` updated to the new count shape; its seeded AI recommendation now carries a record, as generated ones do.
- Production `next build --webpack`: pass. Against it: **30 of 30 UI checks**, including the new native replay (page's own background refresh runs the actual generator; recommendation records Decision A; native reword to C, reload, "1 recommendation was written for earlier ones", text unchanged, insight context still null; reword back to A, reload, notice gone). Smoke 1, adapter 2, objective review acceptance passed.
- Codex's native probes, unchanged except the port in their disposable-target guard (55519 to this stack's 55432): `independent-unframed-reworded`, `independent-unframed-recommendation`, `independent-decision-context`: **3 passed**.
- Codex's DB probe file run unchanged: its new probe passes; its embedded copy of the earlier regression fails as intended by this contract change (expects the two-field counts, and a recommendation with no record is now unknown).
- Original two closed repairs (post-commit containment, insight qualification): their regressions and Codex's original probes still pass.

**Failed invocations this round (retained).** The first test run hit a stopped PostgreSQL (restarted). The mocked model first looked for the decision in the user message instead of the system prompt (test harness; the stored record was already correct). One stack launch lacked its environment and refused to start. My earlier generate-mode browser check failed once because its seeded recommendation had no record and is now correctly reported unknown; the seed now carries a record.

Resources: stack stopped; 0 disposable databases or roles remain. No model calls, push, deployment, or live/development change. Spend unchanged at US$3.817316 of US$10. Overall acceptance awaits Codex's review.

## Latest independent business follow-up

Reviewed2c6417e/repair1f21f71. State READY_FOR_CLAUDE for the remaining recommendation-currentness repair. Original postcommit failure and recorded-context insight probes independently pass; preserved as accepted subcases. Remaining actual native generation failure: null-context pre-decision insight acquires a recommendation for Decision A, native reword to Decision C clears markers but produces no warning for the unchanged old recommendation. Parent insight context cannot establish recommendation generation context. See latest independent disposition and handoff for exact scope/closing tests.

43-row partition unchanged36 Closed/1 Confirmed defect/6 Blocked; overall acceptance incomplete. Independent20 focused passes/3 placeholders, native4/4, build/TypeScript pass, lint0 errors/6 existing warnings. Separate DB and native recommendation-boundary expected assertions fail; old full-probe ordering failure retained as test contamination. All original failures/exclusions/archived historical/security/provider/Office limits preserved. Source read-only,424 paths unchanged. Evidence retained under scripts/workflow-tenant-review/business-followup-20261017/, all owned resources stopped. No paid calls, push/deployment or author rewrite. Older queues below are historical where superseded here.

## Claude repair of the two business-row findings (2026-10-17; commit `1f21f71`)

Implemented, ready for review. Base: application checkpoint `091663e`, docs `6dba539`. Scope: only the two repairs Codex released, plus the boundary extension recorded in the handoff before editing.

**1. Saved change reported as not saved after a post-commit failure.** `afterDecisionChange` (`src/lib/decisionCandidateActions.ts`) runs only after the change committed and now never throws: a failure in the marker lookup, the refreshes or revalidation is returned as `{ ok: true, refreshError }`. The committed marker stays, so the panel keeps offering "Update them now", and a retry takes the same path. A change that fails before commit still throws and marks nothing.

**2. Warning cleared while existing insights kept the old decision context.** The refresh only writes insights for findings that have none. Rewriting or deleting existing insights would discard reviewed recommendations and the synthesized-insight support links (cascade), so no regeneration was added. Instead:
- One rule, `src/lib/decisionContext.ts`: an insight is "written for earlier decisions" when it recorded a decision context and that differs from the run's current statement (whitespace ignored). No recorded context (generate run before any decision) is not marked.
- `decisionContextMismatch` (`src/lib/decisionRefresh.ts`) counts per-finding and synthesized insights under that rule, plus the recommendations built on them; null when it cannot be checked.
- The decisions panel shows a standing amber notice with those counts (separate from the refresh notice; "Update them now" does not claim to clear it). Each pre-insight card carries "Written for earlier decisions". The pre-insights Excel export qualifies the "Decision this serves" cell the same way.
- Derived from data, so it survives reloads and clears by itself when the decisions match again. No migration. Insight text and human recommendation wording are untouched.

**Limitations (not fixed here).** Recommendations store no decision snapshot; each inherits the mark of its insight. Synthesized-insight cards, recommendation lists, decks and the narrative carry no per-item mark; the panel count is their only qualification. A way to rewrite affected insights safely is a separate product decision.

**Changed files.** `src/lib/decisionContext.ts` (new), `src/lib/decisionRefresh.ts`, `src/lib/decisionCandidateActions.ts`, `src/app/runs/[id]/DecisionBriefReview.tsx`, `src/app/runs/[id]/page.tsx` (`getInsights` flag; panel prop), `src/app/runs/[id]/InsightsReview.tsx`, `src/app/api/runs/[id]/insights/export/route.ts`, `src/lib/__tests__/decisionRefreshReconciliation.db.test.ts`, `e2e/ui/decision-refresh-failure.check.mjs`.

**Checks run on the final tree (cloud workspace, disposable PostgreSQL 16, real Python engine; model replay only):**
- `npx tsc --noEmit -p .`: pass. ESLint on the changed files: 0 errors, 6 warnings, all pre-existing (unused imports in `page.tsx` and `InsightsReview.tsx`).
- `vitest run src/lib/__tests__ --pool=forks`: 121 files, **862 passed, 0 failed, 39 skipped**.
- New real-database cases: post-commit lookup outage on add (saved, owed, statement updated), the retry itself meeting the outage (reported, not thrown), idempotent re-add then reconcile; existing insight plus a synthesized insight written for "Decision one", a researcher-edited recommendation, a no-context control and another run's control. After a successful accept: refresh clean, marker clear, mismatch {2 insights, 1 recommendation}, wording unchanged; the real export route qualifies the framed row and leaves the control empty; unaccepting back to "Decision one" gives 0; a read outage gives null.
- Counterfactual: both new cases fail on the previous `decisionCandidateActions.ts` / `decisionRefresh.ts`.
- `next build --webpack` (production): pass. Against that server: **29 of 29 UI checks** (including the decision-refresh check's validate replay and new generate replay: panel notice before and after reload, pre-insight card mark, Excel cell, unchanged insight row), Codex's unchanged `independent-decision-context.check.mjs`: **passed**, smoke 1 passed, adapter 2 passed, objective review acceptance passed (3 checks).
- Codex's `independentDecisionLookup.db.test.ts` run unchanged: its post-commit case now passes; its following "cannot commit marks nothing" case fails only because its post-commit case leaves the owed marker without a retry (test ordering inside the probe). The retained regression covers the same case with a retry.

**Failed invocations this round (retained).** First native run: the check waited for the literal "Decision B" after rewording it, a harness locator error. Second: it opened the synthesized Insights section instead of Working data, Pre-insights. Both fixed in the check; the app output was correct in the failure snapshots. Smoke and adapter were first launched without their manifest and fixture variables (not run, skipped); rerun with them and passed. The historical `scripts/verification-objective-addition/checks.cjs` and `error-mapping.cjs` fail identically on the unchanged base (stale fakes for an earlier SQL shape); not part of this gate.

Resources: stack stopped; 0 disposable databases or roles remain. No model calls, push, deployment, or live/development change. Spend unchanged at US$3.817316 of US$10. Overall acceptance awaits Codex's review.

## Latest independent four-remainder review

Current release091663e / reviewed HEAD e2739b2. Canonical43 rows:36 Closed /0 awaiting verification /1 Confirmed defect /0 Untested /6 Blocked; priorities34/9/0. IMP-004, IMP-017 and FND finite remainders independently verified; business refresh partly repaired but two original failure probes demonstrate unresolved saved-result/currentness defects. Exact repros, source references, closing tests and all43 dispositions are in the latest independent disposition. Prior33 closures, approved exclusions and failed history preserved. Five missing definitions explicitly archived as unsubstantiated, remain Blocked; security/staging gates remain unauthorised and separate. Overall acceptance incomplete.

Independent35 passes/4 inactive placeholders; production build/TypeScript pass; lint0 errors/5 existing warnings; released native4/4. Separate real-DB saved-then-read-outage assertion and native existing-insight decision edit/currentness assertions fail in generate/validate mode. Two review-locator interruptions are harness failures only. Application source read-only,423 paths match. Local evidence retained in scripts/workflow-tenant-review/four-remainders-20261017/. All owned resources stopped. No paid model calls/push/deployment. Claude released only for the two business repairs and their exact closing regressions; see authoritative handoff.

Earlier version/queues below are historical where superseded by this section.

## Active version and ownership

- Dedicated local branch: `checkpoint/trust-hardening-20261016`; accepted source/testing checkpoint `40198b015c406be699326c7e0115037d2c1a1275`, with docs-only release `460815c`. Application bytes are unchanged from the independently built/reviewed `5f63038` source. The following local Codex checkpoint records this reconciliation; runtime and unrelated diagnostics stay outside Git.
- Repair7 accepted and27 manifest files integrated after full base/archive/hash reconciliation. Both separately released legacy-test bases match. Authoritative lockfile unchanged. [agent-handoff.md](agent-handoff.md) records current ownership and the retained exact manifests.
- Integration evidence: `scripts/workflow-tenant-review/repair7/integration-comparison.json` and `applied.json`. Parked hydration archive excluded. Recorded bounded fixes and self-validation remain valid at their exact scopes; overall trust-hardening acceptance is incomplete as reconciled below.

## Working queue

Use the existing [canonical baseline](technical-release-acceptance-baseline-2026-10-15.md), current Row-level reconciliation 2026-10-17 and finite43-row checklist. It records33 Closed /4 awaiting verification /6 Blocked. Older dated queues and count notices are historical where superseded. This file is the operational status; the handoff is authoritative for editing ownership.

After takeover, coherent batches are:

1. Reconcile and integrate released bytes; resolve conflicts explicitly. Prioritise incorrect calculations/identity (E1–E3), misleading semantic grounding/selector output, and cross-tenant access (T1–T2), preserving researcher corrections and wording.
2. Close backup privilege validation (T3) and supported adapter/download workflows (A1–A3), including targeted downstream regressions.
3. Complete the [existing closing checklist](../scripts/workflow-tenant-review/repair-closing-checklist.md) and other agreed acceptance remainders where prerequisites exist. Record unavailable prerequisites separately from demonstrated defects; no general audit or full golden-thread restart.
4. Run the full validation gate once at the milestone with disposable DB/Python prerequisites and explicit skip accounting. Review the final diff, exclude secrets/generated/runtime artifacts, and create the authorised local checkpoint on a dedicated branch.

Security/deployment requirements remain separate from local functional closure. Deferred improvements and the design-only Research Quality Review feature are not implicit implementation work in this milestone.

## Completed and preserved

All results below are Codex **self-validation** of integrated/changed code, not independent review of Codex's own repairs. Existing canonical closures and historical failed invocations are preserved; no whole-row/module or public-release sign-off is inferred.

- Repair7's27 archive/base/manifest entries reconciled and integrated; parked hydration bytes excluded. Lockfile remains the supplied authoritative hash. E1/E2 exact engine identity, E3 cache upgrade/failure/retry and T1/T2/T3 disposable role/backup checks pass at their finite recorded scopes.
- Wrong-group numerical tracing and ambiguous two-channel response enforcement have focused regression passes. Actual real-provider generator/evaluator checks retain explicit Yes Male60/Female40 and ambiguous refusal; scripted persistence/planner boundaries remain disclosed.
- Actual PostgreSQL candidate lifecycle covers cross-module identity, edit/delete/regeneration, original-brief preservation, missing-index concurrent fallback and business status/bulk/statement transitions. Reproduced duplicate addition/refresh-retry faults repaired with owned-run locking/idempotency; prior REV-009 and DEC-001 closures preserved.
- Actual evaluator concurrency/recovery checks pass. Failed durable writes now remain pending instead of escaping the batch catch. Integral/duplicate/omitted/extra index boundaries preserve prior results when coverage is incomplete; valid coverage attaches correctly. Removing accepted-insight prerequisites clears obsolete coverage.
- IMP-007 deletion and upload now commit durable cleanup intent before losing the last reference or writing storage. Actual PostgreSQL insert/storage/later-trace failures, safe retries and upload-versus-cleanup concurrency pass. Storage remains controlled in these fault tests; native seeded cleanup visibility/retry also passed.
- IMP-012 complete-to-partial reread retains item/link identities and confirmations; repeated partial and complete retries do not duplicate. Coverage is now durably recorded and loaded after reread. IMP-013 actual chart-post/status/remove/revive callers retain three separate document finding identities.
- Frozen native full replay passes with the permanent adapter and actual setup-created restricted role. A1 nested continuous-table mean7.1 and raw-code subgroup40/60 pass; original6.5 reference retained. A3 injectedHTTP500 fails boundedly and actual single-download retry passes.
- Native label-conflict tables/Excel/reload retain both labels and unmatched-name warning; corrected workbook control passes. Initial notices still require dictionary construction; same-project supported deletion/corrected reupload also passes; no in-place replacement claim.
- Valid and truncated SAV/DTA native import/calculation/error/reload/provenance checks pass; raw processing_status remains null and is not reported as truthful ready/failed certification.
- **2026-10-19: file limit raised to 100,000,000 bytes (Grant).** The 20 MB limit added 2026-10-16 blocked FinScope SA 2024.sav (26.7 MB), accepted on 2026-10-11 before the limit existed, in Cross tabs. Measured: FinScope SA 2025.sav (80.8 MB, 5,562 cases by 3,960 variables) reads in about 10 s at 1.5 GB peak memory, inside the reader's 2,048 MB and 60 s (vercel.json). Messages are now built from `api/import-limits.json`. New regression check `e2e/ui/large-spss-crosstab.check.mjs` (synthetic 25 MB SPSS file of survey shape, cross tab built; confirmed to fail on the old limit). Hosted upload of files this size still needs the direct-to-storage path (next.config.ts note).
- (Superseded 2026-10-19) Grant approved20,000,000 bytes and100,000 cases per file, with visible refusal/recovery. Shared TS/Python contract and UI/server enforcement implemented. Engine exact/one-over/cached-pair boundary checks pass. Native byte overflow and SAS exclusion pass; native100,001-case refusal persists after reload and corrected100,000-case upload succeeds. Cold concurrent deployed load is not certified.
- Grant excluded SAS pending verification. Upload/server and user-facing documentation disclose this exclusion.
- Native finding-body edit survives reload and qualifies the dependent insight/report and actual DOCX. Browser PPTX invocation timed out and stays failed; targeted HTTP PPTX continuation returns a valid qualified deck. Native revert/reload preserves researcher note and unchanged computed control. Browser PPTX event completion remains separate.
- Final full validation: **107files /804passed /33skipped**, real PostgreSQL and Python suites executed with strict prerequisites (`repair7/validate-checkpoint-final.log`). Final production build passes (`repair7/build-checkpoint-final.log`), using migrated synthetic DB. Dependency unpdf/import.meta warning retained.

## Boundaries and accounting

Claude remains paused; Codex owns the milestone. Only synthetic disposable resources are used. No development/live database or deployed-role changes, push or deployment. Prepared source snapshots/runtime evidence, dumps, keys, profiles and generated exports must be excluded from the local Git checkpoint.

Cumulative model spend at latest completed native calls: **US$3.817316 ofUS$10**; reservations approximatelyzero (floating-point residue only). Gateway disabled and its verified process stopped; memory-only key cleared. No new budget or fresh authorization is implied.

## In progress and remaining limits

After source checkpoint b5a2a4d, the remaining finite checks reproduced and repaired three recovery/metadata gaps: native instrument reread lacked Read again after items existed; Import defaulted smaller files' declared MR members to Single mention; Continue reading disappeared after reload despite pending evidence. Native instrument complete/confirmed/partial/reload/retry and type/group correction/clear/reload now pass. The definition loader uses the underlying imported dictionary separately from researcher corrections and fails visibly unknown. Continuation count uses the evaluator's own pending rule inside the same repeatable-read snapshot; affected Rule B one-client assertions pass.

A further actual SAV check reproduced missing declaration metadata: masked valid base5 was correct but the audit reported0 declared variables. The bounded reader repair preserves declarations using metadata-only access, keeps masked values unchanged, and requires dictionary9 only for affected SAV/ZSAV caches. Single/range/ordinary missing controls and malformed/retry engine cases pass; actual native cache/failure/retry passes: an injected storage outage leaves cache8 and researcher corrections intact with a visible error, then retry rebuilds cache9 and retains mean3/base5. The final gate includes these changes.

Additional completed checks: same-project label conflict recovery through supported deletion/corrected reupload passes; legacy0084 seed/backfill/regenerate/delete passes; actual persisted total/equality/mean-percent mismatch/base29/30/mean and mixed-stance reload controls pass. A2 controlled DOM names Analytics /Analytics1 /Analytics 1 and unrelated-prefix refusal pass. Native labelled/unlabelled1?5 and sparse0?10 means/top boxes pass with explicit researcher declarations and raw-code selection; missing-code audit and nine saved tables survive reload. The initial missing-audit disclosure mistake is repaired separately for SAV as above.

Actual retained DOCX and PPTX exports were rendered headlessly with installed LibreOffice:5 report pages and19 deck pages. All contact sheets and detailed representative pages were inspected; no outside-page text boxes were detected and qualifications remained visible. This closes that representative LibreOffice visual check only, not every Office version. Earlier PATH-only unavailability was corrected after checking installed locations.

Grant explicitly excluded the primary TaskB flipped-workbook/separate-Codebook weight/MR combination from initial release claims pending verification. The upload guidance and manual disclose it. The primary fixture is not substituted with controls; conditional inference/small-base/full real-model completion for that combination remain unverified outside the approved initial scope.

Security authentication/storage/deployed-role and deployment-runner certification remain separate external gates. Five historical definitions remain evidence gaps/deferrable. No independent review of Codex's own changes, module sign-off or release authorization is claimed.

## Next action

Final finite native checks, evidence retention and owned-resource shutdown completed. Reviewed local source checkpoint **b5a2a4dd198f384b7cd0c5ccb67fde37d892a673** now exists (184paths; staged secret scan clean, supplied lockfile matched, parked hydration excluded; no push/deployment). Subsequent bounded fixes are retained in the follow-up checkpoint. The broad dirty checkout predates takeover; a source checkpoint must explicitly distinguish retained pre-existing implementation from this milestone's reviewed/self-validated changes.


## Final milestone evidence and limits

- Final strict validation:107 files,804 passes,33 explicit skips; actual PostgreSQL/Python prerequisites ran, with no NOT RUN placeholders. Native checks use recorded frozen sources and targeted current-source regressions; self-validation is not independent certification.
- Current driver analysis now refuses unavailable saved layout before engine dispatch. Focused failure/retry and actual Python columns-as-cases driver-input controls pass.
- Actual nonowner PostgreSQL retrieval-permission failure persists degraded assessment through reload; restored grants/retry clear degradation without duplication. Native zero-progress evidence writes remain actionable and Continue survives reload, using the existing pending rule in the same repeatable-read snapshot.
- Two concurrent native exact20MB/100,000-case uploads persist all rows and survive reload in35.105s. The first v12 invocation timed out waiting for both persisted row counts; one project had a complete document and the other none. Cause is unestablished; that invocation remains failed. The bounded retry is a separate pass, not deployed capacity certification.
- Native finding edit/revert preserves human wording/note and keeps the prior-verdict qualification until re-verification; no automatic restoration claim. Representative design-change handover qualifies downstream work and both exports. Browser PPTX timeout remains recorded separately from successful HTTP continuation and the passing full replay.
- Remaining external gates: independent review of Codex changes; deployed authentication/two-user tenant mapping, real storage privacy/authorization, deployed-role equivalence and deployment-runner certification. SAS and the approved flipped/separate-Codebook weight/MR combination are excluded pending verification. Historical-definition gaps and broader Office-version/brief-extraction limits remain disclosed. No Research Quality Review feature implementation.
- Source checkpoint b5a2a4d retains pre-existing implementation plus earlier bounded repairs; the follow-up checkpoint contains the subsequent fixes and approved scope documentation. No push/deployment. Canonical43-row partition remains unchanged pending independent disposition.

Cleanup completed after retention: all referenced objects from the remaining stacks (31) retained without missing objects; earlier stacks separately retained. Disposable database dumps and password-free role evidence are local.31 verified owned stack processes stopped, labelled test container stopped/removed, and0 listeners remained on recorded app/storage/replay/gateway/database ports. Frozen source copies and generated evidence remain local, excluded from Git.

Final reviewed source checkpoint: `17833030c1647706322050f5b17cb0eed3cc9cc5` on `checkpoint/trust-hardening-20261016`.32 follow-up paths; exact staged scope/secret check clean; authoritative lockfile unchanged; no generated/runtime evidence or parked hydration bytes staged. Final production build completed successfully against migrated synthetic DB (existing unpdf/import.meta dependency warning retained). All source changes committed; unrelated pre-existing untracked evidence remains local. This status-only recording does not change tested application bytes.


## Conditional exclusion guard — 2026-10-16

Grant's exclusion is conditional on detection, not documentation alone. The engine now inspects
other workbook sheets before flipping and refuses declared weights/MR sets, including role-based
weight declarations and hyphenated MR headers. Dictionary, categories, crosstab and driver requests
share that reader, so they cannot silently substitute an unweighted or ungrouped result. The error
names the sheet and directs a row-per-respondent re-export retaining definitions, reupload and
verification of weights/MR setup. Label-only and empty-definition controls remain allowed; metadata
read failure fails closed. Flipped caches older than dictionary10 require reinspection; failed
upgrade preserves the prior cache/corrections and visibly refuses.

Focused final checks:16 passes/3 explicit skips across actual-engine orientation/refusal and
actual-PostgreSQL cache upgrade/recovery tests. Five metadata fixtures exercise all four analytical
entry points (20 refusal assertions), label-only/empty controls and corrected-layout recovery.
User-facing Limits and raw-data guidance disclose exclusion and recovery. Full support remains
backlog work. No native browser run or new paid model call was needed for this engine boundary.
Earlier full-gate attempts retained the test-regex target error and isolated cluster authentication
setup failures; neither is relabelled green. The final configured gate result is recorded below.

Final guard validation:107 files/805 passes/33 explicit skips, route type generation and full
typecheck pass. Required actual PostgreSQL/Python suites ran with no NOT RUN placeholders
(`repair7/flipped-codebook-guard-validate-pass.log`). The final focused run passes16 checks with
3 explicit skips. The owned guard-test database was retained without role passwords and stopped.
No model spend, push or deployment; Claude remains paused. These are Codex self-validation
results. Full separate-Codebook/flip support remains excluded and in the backlog.


Ownership release: Grant accepted the milestone. Codex released the checkout to Claude for
`.fnd001/staged-three-pane-20261016` on application checkpoint2330179; the authoritative current
file scope and verified absence of running milestone resources are in `docs/agent-handoff.md`.
This release supersedes earlier statements that Claude remains paused. Codex has stopped editing.

## Three-pane package (Claude, after the milestone release)

Adjustable three-pane layout (`ThreePane.tsx` plus the `e2e/ui` check) was applied on `8c2e1de`, then committed as7ec3f30 and handed back in badcd13. The independent review below supersedes the earlier ready-for-review state.
- On the exact checkpoint tree: route type generation plus typecheck pass; tests 805 passed and 33 skipped.
- On the disposable stack: pane check 2 passed; the unchanged golden-thread smoke passed.
- Details and hashes are in [agent-handoff.md](agent-handoff.md). No model spend, commit, push or deployment.
- Local checkpoint `7ec3f3062aff2f62650d7405951ee23025834f76` (three-pane package), handed back to Codex for independent review. No push or deployment.


## Independent pane review and milestone reconciliation — 2026-10-16

**Review complete; pane acceptance requires changes. Codex retains ownership.** Confirmed branch
`checkpoint/trust-hardening-20261016`, package7ec3f3062aff2f62650d7405951ee23025834f76 and
documentation handback badcd139285f8b5e15ea14df5387b1f873084baa. All three released file hashes
match the staged manifest. No implementation file was changed during this review.

Reused Claude's exact-tree type generation/typecheck,805-pass/33-skip gate, two pane browser checks
and unchanged replay smoke at their recorded scopes. Inspected the complete component, test/config
and its callers against the installed Next client-boundary guidance and coding standard. Additional
independent Chromium check bundled the exact released component with installed React: normal
collapse and reload persistence pass; blocked-storage collapse fails. Evidence:
`scripts/workflow-tenant-review/repair7/pane-independent-browser.json`. This isolated component
harness tests state/persistence, not application-route rendering or CSS geometry. It shut down its
browser and loopback server; no new persistent disposable resource or model call was created.

Required functional finding (P2): `src/app/runs/[id]/ThreePane.tsx:52` swallows localStorage writes,
while `layout` at108 derives only from the persisted snapshot or transient drag state and commit
at136 updates no in-page state. With Storage.setItem throwing SecurityError, pressing Collapse
leaves data-left-collapsed=false. Keyboard resizing is discarded for the same reason, and a drag
can snap back on release. The comment that a layout still applies for the current page is false.
Smallest correction: retain the selected layout in page memory independently of successful storage
persistence. Closing check: blocked reads and blocked writes permit collapse/expand and keyboard/
pointer resize for the current page, preserve mounted input, reload safely uses defaults when
persistence is unavailable, and ordinary storage still persists. Add this failure/recovery case to
the focused pane check. This is a pane finding, not a new canonical release row.

Accessibility finding (P3, code inspection): ResizeHandle advertises fixed aria-valuemax960 and
stored/default aria-valuenow at219–247, while actual permitted maxima use35%/50% of the grid and
CSS further clamps saved widths after resizing the window. Assistive technology therefore receives
a different range/value from the rendered pane. Closing check: report the effective permitted
maximum and rendered width for each separator, including wideRight default and viewport shrink.
No measured performance defect or unrelated structural refactor is asserted.

Overall disposition: Grant accepted the prior implementation checkpoint and its recorded self-validation; that acceptance does **not** complete the overall trust-hardening milestone. The later pane package has been independently reviewed and has
the two findings above; it is not yet accepted. Overall technical-release sign-off is **not complete**.
Remaining required work is:

1. Resolve the pane functional finding and correct separator accessibility values, with affected
   regression checks and a stable checkpoint for review. Codex has not released implementation
   back to Claude; no silent ownership transfer is implied by these findings.
2. Independently assess Codex-authored trust/metadata/persistence repairs at2330179 and reconcile
   the existing acceptance rows against the detailed self-validation evidence. A reviewer must
   identify specific unfulfilled closing assertions rather than replay completed matrices; current
   canonical43-row counts have deliberately not been promoted by self-validation or pane checks.
3. Keep the **parked layout-loading fix** explicitly pending: `.fnd001/repair7-20261016/parked-hydration-guard.tgz`,
   involving TranscriptSetup.tsx/useHydrated.ts and a check that failed once without diagnosis. It
   is not the pane persistence/hydration mechanism. TranscriptSetup bytes match accepted2330179;
   the package remains unapplied/unreleased. Diagnose the retained failing check and establish
   whether a supported-workflow failure remains before deciding its disposition; no closure or
   new supported defect is inferred from a failed check alone.
4. Separate pre-public requirements remain actual user-to-tenant authentication, deployed storage
   authorization/privacy, deployed-role equivalence and intended migration-runner certification.
   They require the corresponding environment/owner authorization, not another local pane test.

Approved SAS and flipped/separate-Codebook weight/MR exclusions remain in force. Full support is
backlog work. Five historical-definition gaps and named deferrable checks remain deferrable;
representative LibreOffice output is not certification of every Office version. Prior browser
PPTX and concurrent-limit failed invocations remain recorded separately from their successful
continuations/retries. Model spend remains US$3.817316 ofUS$10; no push/deployment or count changes.


## Canonical outstanding-register reconciliation — 2026-10-16

**Overall trust-hardening milestone: INCOMPLETE.** Pane commits7ec3f30/badcd13 were reviewed
independently; the storage-failure and separator-accessibility findings remain. Their review
does not independently review Codex's earlier repairs or close the canonical acceptance register.
The earlier wording “implementation milestone complete” described the delivered checkpoint and
self-validation only; it must not be used as the overall acceptance decision.

Reconciled all43 entries of the existing consolidated outstanding-work tables in place:10 recorded
defect findings,24 acceptance remainders,4 security/deployment entries and5 grouped deferrable/
design entries. These entries are **not** the canonical43 release rows: shared findings/tasks/gaps
use different grouping. The existing release-row partition12/18/2/5/6 and priorities34/9/0 remain
unchanged pending explicit row-level disposition. No replacement register or broad audit was added.

Retained evidence now replaces obsolete wholly-unexecuted claims for E1–E3/T1–T3/A1–A3,
scale/missing audit, correction clear/group, upload cleanup, instrument reread, document finding
identity, objective addition/legacy lifecycle, evaluator boundaries/recovery, business transitions
and native design/body handover. These are self-validation where Codex authored changes, and
individual controlled/real-provider/native/DB boundaries remain distinct. Evidence examples are
`repair7/scale-audit-reload.json`, `sav-audit-native.json`, `correction-clear-native.json`,
`upload-cleanup-native.json`, `instrument-reread-native.json`, `objective-lifecycle-native.json`,
`business-lifecycle-native.json`, `evaluator-stall-native.json`, `design-handover-native.json`,
`probe-b-download-retry.json`, plus strict gate logs and the retained source/test files. Failed
initial invocations remain failed; continuations establish only their explicit assertions.

Required next work, in bounded order:

1. Resolve the two pane findings and their focused regression criteria under explicit implementation
   ownership. Codex retains CODEX_WORKING; Claude has not been released.
2. Independent review of Codex-authored repairs and finite assertion-by-assertion disposition against
   the existing register, especially the two semantic rows and later guard/cache changes. Reuse
   unchanged independent evidence; do not treat805 tests as whole-row or module acceptance.
3. Complete specifically unestablished acceptance assertions: native OBJ-REV-004 accept/reject/
   reaccept/regenerate/exclusion agreement in both presentations; truthful durable native SAV/DTA
   status/recovery under IMP-018 (processing_status remains null); and any missing failure-to-native/
   output assertion under REV-012. Review must also resolve whether the retained exact-limit
   timeout leaves an IMP-017 stranded-work assertion unmet. This is not proof of a new product defect.
4. For other implemented remainders, check the named exact assertions in the canonical table before
   ordering further execution: native deletion-specific cleanup visibility, document-identity reload,
   evaluator uncertainty/complete finite expectation coverage, remaining decision own-delete/bulk
   callers, absent-download refusal, and shared support delete/replacement/duplicate consumers. These
   are scope/evidence questions to resolve, not claims all were missed or already closed.
5. Parked layout-loading package remains unapplied/unreleased: diagnose its retained failed check
   and determine supported-workflow impact/disposition separately from the pane component. No
   automatic reopening of prior IMP-014/Brief38 closures and no unreviewed TranscriptSetup change.
6. Before public release: the distinct authenticated tenant/storage/deployed-role/migration-runner
   gates in canonical section3, requiring their real environment and owner authorization.

Approved exclusions remain SAS and flipped/separate-Codebook weight/MR metadata, conditional on
visible refusal/recovery; full support is backlog. Deferrable IMP-010/M02/M04 and five historical
definitions retain their stated dispositions. Research Quality Review architecture-fit/design work
is separate and not a trust-repair prerequisite. Representative Office and brief/link limitations
remain explicit. Current review/reconciliation uses retained evidence only: no new application
execution, model call, resource, push, deployment or source repair.


## Continued engineering completion — 2026-10-16

Codex retained ownership and implemented the routine repairs directly; Grant did not have to
relay individual fixes. This update supersedes the prior pane/parked-fix and named native-gap
dispositions, while retaining all earlier passing and failed evidence.

Completed this continuation:

- Pane preferences now retain in-page state when storage reads or writes fail. Native blocked
  read/write tests cover collapse/expand, pointer/keyboard widths, mounted unfinished input and
  reload defaults. Normal persistence remains passing. ResizeObserver reports actual pane widths
  and effective grid-dependent separator bounds. Five native pane checks pass.
- The parked layout-loading issue was diagnosed, not assumed: held JavaScript left a visible,
  enabled layout select showing columns-as-cases while the database remained rows-as-cases. The
  inspected guard and shared useHydrated hook are now integrated. The fixed held-script native
  check passes save/reload recovery; two actual SSR checks cover raw and transcript choices.
  The old archive remains evidence, but its fix is no longer parked/unapplied. Its earlier test
  had an unsafe held-route release/unroute race; corrected handling does not explain every old
  failure or revoke earlier Brief38/IMP-014 closures.
- OBJ-REV-004 native execution reproduced overview action clicks selecting the row and replacing
  the overview/editor. Action cells now stop that propagation. Detail and overview transitions,
  edit/reaccept/reject/restore/regenerate/reload preserve wording, excluded/rejected suggestion
  and original brief. The retained portable `scripts/e2e/objective-review-acceptance.mjs` also
  passes on the same isolated source. Earlier timeout/hidden-locator attempts stay failed.
- Native delete/storage failure leaves discoverable pending cleanup after reload; a failed retry
  stays actionable; corrected storage clears the intent once and after reload. Combined with
  prior upload/DB/storage/trace/concurrency evidence, no extra native deletion execution gap is
  asserted. This remains local storage recovery evidence, not deployed authorization.
- SAV/DTA malformed-file errors are explicitly visible after reload, no partial table is published,
  and supported delete/corrected reupload recovers calculation without the error. Original valid
  SAV pass plus the final three-case continuation establish the bounded matrix. Raw-file readiness
  uses parser/UI states rather than the report-processing column; its null value is not a new
  data-loss defect or a ready/failed certification. The first count-timeout and interrupted second
  invocation remain separate. Deletion recovery now waits for reloaded UI before adapter counts.

Evidence: `scripts/workflow-tenant-review/completion/` holds pane-browser.log (5 passes),
hydration-diagnosis.json (pre-repair mismatch), hydration-browser.log (1 pass),
setup-guard-ssr-retry.log (2 passes), objective-review-native.json and
objective-retained-regression.log (3 native groups each), delete-cleanup-native.json (2 groups),
native-formats-attempt1.json plus native-formats.json, and final-runtime-sources.json. All8
changed source/check files match the tested isolated copy. The unrelated development server on
port3000 was not used or stopped.

Final strict validation:108 files/807 passes/33 explicit skips, full-project typecheck; required
actual PostgreSQL/Python suites ran with no NOT RUN placeholders. Earlier focused SSR alias
configuration failure was corrected and retained separately. Full build/cleanup/checkpoint
accounting follows below. No new model/provider calls; spend remains US$3.817316 ofUS$10.

Overall trust-hardening acceptance is still incomplete for a concrete reason: the changes authored
by Codex require independent assessment and row-level disposition. Codex can implement and
self-validate them but cannot supply independent review of its own changes. The corresponding
closing assertions are now in the existing canonical register; repeated whole matrices are not
required merely because ownership changes. Other external prerequisites remain deployed trusted
user-to-tenant identity, storage/privacy/signed-link policy, final deployed role/schema boundary
and intended migration/backup runner certification. They require the actual environment/owner
authorization, not another local browser run.

For independent disposition, reuse actual document chart/status DB reload checks, degraded
permission-failure save/reload plus actual DOCX qualification, finite evaluator/base/stance cases,
business transition/failed-refresh evidence and affected download failure/retry evidence. Only
specifically unestablished assertions should trigger further bounded execution or repair; do not
introduce new native permutations without a requirement. Retained exact-limit timeout remains
unexplained and must not be called green; separate successful bounded retries remain valid.
Deferrable preview/marker/load-error and historical-definition gaps remain explicitly deferred;
approved SAS and flipped/separate-Codebook weight/MR exclusions remain conditional and in force.


### Final source verification and cleanup

The final bounds correction shares pixel-rounded limits between interaction and ARIA, scales
minimum widths down when the container cannot fit them, and clamps both normal and wideRight
default right panes to half the container. Six exact-component/compiled-CSS geometry checks pass
for normal/wideRight at1200/700/400px. The initial floor-versus-rendered-pixel mismatch remains
retained as a failed invocation. The five native route checks preceded this final narrow-container
extension; the enhanced native test was not rerun after it. Final exact-source strict validation
again passes108 files/807 tests/33 explicit skips, with all required PostgreSQL/Python suites run;
final production build passes. Logs: completion/validate-final-bounds.log and build-final-bounds.log.

All8 changed source/check hashes match the isolated tested copy. Nine referenced storage objects
and the password-free disposable cluster dump were retained locally before shutdown. The verified
labelled trust-completion-20261016 container and its local-stack parent were stopped; reserved
ports3228/62190/62191/55512/55017 have no listeners. The unrelated development server on3000 was
left untouched. Generated builds, database/storage copies, logs and historical untracked evidence
are excluded from the checkpoint; the authoritative lockfile is unchanged.

Claude's released pane instruction was not fulfilled in every respect: the claimed current-page
fallback under blocked storage was absent, separator semantics were inaccurate, and the standing
requirement to update affected claude/*.md engineering documentation was omitted. These are
implementation/documentation omissions, distinct from the disclosed real-tablet and individual
screen testing limits. The new focused pane brief and self-validated repairs address them; they
still need independent assessment. The separately parked setup-loading fix has now been diagnosed
and integrated, as recorded above; its full failed-invocation history remains retained.


Application checkpoint: `be625c7711970516e4866c21109164c479cab767` on `checkpoint/trust-hardening-20261016`.
The subsequent documentation-only checkpoint explicitly releases ownership to Claude in
[agent-handoff.md](agent-handoff.md), with completed work, released files and remaining required
review/acceptance/environment tasks. Codex has stopped editing; no implicit transfer. Overall
trust-hardening acceptance remains incomplete pending that independent disposition.

## Claude independent acceptance and close-out — 2026-10-16 (night)

Claude owned the c07eea8 / be625c7 release and recorded every canonical row's evidence level and
disposition in [independent-acceptance-disposition-2026-10-16.md](independent-acceptance-disposition-2026-10-16.md).
The 43-row partition (12/18/2/5/6) is unchanged; promotions are proposed there for owner decision.

Independently executed on c07eea8: typecheck pass; 108 files / 807 passed / 33 skipped (real
PostgreSQL and Python); 6 UI checks, golden-thread smoke 1, adapter readiness 2 (after correcting
Claude's own A1 check), retained objective-review script 3/3 on its second invocation (first
invocation failed on a 5 s visibility wait on a cold stack; retained as failed). Production build
not re-run here (Google Fonts unreachable). After the repairs below: typecheck pass, 110 files /
817 passed / 0 failed / 34 skipped, 7 UI checks, smoke 1, adapter 2, objective script 3/3.

Reproduced and repaired (Claude-authored, need independent review):
- Regeneration re-inserted wording the researcher had rejected: objectives as a pending duplicate;
  decisions as accepted, re-entering the decision statement. Shared rule
  `src/lib/candidateSuggestionFilter.ts`; real-DB tests `objectiveDecisionClosure.db.test.ts`.
- The flipped-workbook guard refusal was repeated per variable and framed as an SPSS/Stata/SAS read
  failure. One file-level notice, format-neutral engine error prefix; native
  `e2e/ui/flipped-codebook-guard.check.mjs`.
- New closing tests without source change: `objectiveEvidenceClosure.db.test.ts` (REV-006 selector
  persistence/reload, REV-007 stale retry and transaction rollback) and SET-002 refresh-failure
  retry plus decision-statement exclusion.

Remaining concrete failures and unestablished assertions: IMP-017 first v12 concurrent invocation
(documentless upload returned 200; outcome unexplained) stays failed; Probe B browser PPTX timeout
stays failed; ANA-NPS-003 design-triggered native handover not established; Task D absent-download
and retried-content assertions missing; OBJ-REV-005 stored qualification for unsupported uncertainty
untested; OBJ-REV-006 stores the answer label, not the raw code; IMP-010 neither checked nor
documented. Exclusions (SAS; flipped workbook with separate Codebook weight/MR), deferrables,
historical-definition gaps and the public-release security/deployment gates are unchanged.
No push, deployment, live/development change or model call; spend US$3.817316 of US$10.


## Codex laptop independent review ? 2026-10-16

Laptop9ab38eb / repair5008041 reviewed read-only; all13 released paths match the isolated copy
(LF normalised, one documented Python-executable adaptation only). Full row dispositions and
limits: appended Codex review in independent-acceptance-disposition-2026-10-16.md.

Released regression suites pass13/1inactive skip on actual disposable PostgreSQL. Native guard
passes after python3-to-python isolated harness adaptation; original tooling failure retained.
Independent Net/member and ambiguous-design persisted/reloaded qualification probes pass. Stored
multiplicity qualification is absent, but the global UI already discloses unadjusted intervals;
resolve the exact durable/output contract rather than claiming no user-facing qualification.

Repair5008041 is NOT fully accepted: SQL trim versus JavaScript trim in the shared suggestion
filter still resurrects rejected tab-terminated model wording. Actual objective and decision probes
reproduce it; the new decision copy is accepted. Ordinary-space passes remain valid. Fix under
existing OBJ-REV-004/business remainder; no new row, source edit or speculative performance claim.

Fresh native current-before preconditions, actual null-to-Gender PSU save, unaffected source control,
reload and retained DOCX/PPTX establish representative design propagation. Synthetic accepted
support fixtures/replay limit the conclusion. Setup/hidden-locator failures remain failed;
same-project continuation passes. Task D now verifies no download through HTTP500 plus1.2s and
parses the actual retried workbook for expected content.

IMP-017 forensics finds retained upload_error trace27 (fetch failed) for the documentless v12 run,
correcting "logged no error". No document/pending cleanup at retention; failed-page UI/response
body/exhaustive storage listing remain unavailable. Failed invocation stays failed; separate
concurrent pass preserved. Raw-code identity, durable qualification and named saved-content/native
boundaries remain unresolved as recorded. Deferrables, exclusions and43-row partition unchanged.

Local evidence: scripts/workflow-tenant-review/laptop-review/. Six referenced synthetic storage
objects and password-free cluster dump retained before shutdown. Verified owned process tree and
labelled codex-acceptance-20261016 container stopped; ports3231/51834/51835/55513 clear. User/development
processes and existing Supabase containers untouched. No paid calls, push or deployment.
Spend unchangedUS$3.817316 ofUS$10. Claude is explicitly released in agent-handoff.md for the shared
identity repair and named bounded acceptance work. Overall acceptance remains incomplete. The
formerly parked setup-loading guard remains integrated; earlier passes are preserved.

## Claude shared-identity release: affected-file extension (2026-10-16, evening)

Before editing outside the released implementation files, Claude records this extension for the named remainders only:
- `src/lib/evidenceStance.ts` (OBJ-REV-006 raw selector identity): persist the read row's question key and raw code and each banner column's variable and raw code in the saved estimate (JSONB; no migration). Display wording unchanged. Test: `src/lib/__tests__/evidenceIdentity.test.ts` plus the existing closure test.
- `src/lib/objectiveValidator.ts` (OBJ-REV-005 durable multiplicity qualification): a conclusion for an item that carried direct data evidence keeps a fixed qualification that the intervals are not corrected for the number of questions checked, so it reaches the app and both story exports. Earlier saved conclusions are unchanged until regenerated.
No dependency, migration, broad refactor or new feature.

## Claude shared-identity repairs complete (2026-10-16, evening)

Commit `34cb123` (15 paths) over `ff4d8af`. Results and dispositions: [independent-acceptance-disposition-2026-10-16.md](independent-acceptance-disposition-2026-10-16.md) (section "Claude repairs after Codex review"). Full suite 113 files / 825 passed / 0 failed / 36 skipped; 11 UI checks, smoke 1, adapter 2 and objective script 3/3 on a fresh stack. One adapter/objective invocation failed when the cloud container killed the dev server for memory; retained. Partition unchanged; acceptance incomplete. State READY_FOR_CODEX for independent review.



## Codex review34cb123 at laptopf873608 ?2026-10-16

Confirmed source HEADf8736084f83e274741d3cdff0d120ac7c0cb8a0a and repair34cb1232e41539d237597380b7400e39b1fb5d8a.
Application source stayed read-only; all15 released paths match isolated tested bytes after LF
normalisation/two documented harness Python-executable adaptations. Full latest row dispositions:
appended Codex review34 section in independent-acceptance-disposition-2026-10-16.md.

Independent affected gate:10files/65passed/4inactive skips, actual PostgreSQL. Additional real-digest
qualification test1pass/1inactive skip. Native5/5: workbook recovery, current-source Setup/Review
identity, golden saved figures/reload, conflicting labels/counts/reload, upload failure before/after
storage and complete-inventory cleanup plus healthy retry. Prior full825/36/build limitations are
retained scopes, not rerun claims. Earlier failed invocations remain failed; cloud memory cause is
implementer-reported, not independently reconstructed here. No new paid calls/spend.

Whitespace normalization, optional raw identity persistence, new-conclusion multiplicity and
conflicting duplicate refusal are independently verified at their declared scopes. Actual DOCX/PPTX
transport preserves both the full multiplicity note and degradation warning. Legacy results require
regeneration; no retrospective backfill or new statistical adjustment is claimed.

Four smaller limits assessed separately:
- OBJ-REV-004 direct overview Accept/durable status and accepted overview/detail label/control
  comparison now pass natively; earlier state-transition evidence preserved.
- IMP-005 group-correction calculation remains unverified beyond dictionary/clear. Imported Codebook
  MR recovery is not that researcher-correction assertion. No new numerical defect claimed.
- OBJ-REV-012 PPTX qualification passes, but native Review Objectives coverage drops the persisted
  true degradation flag: normal Partly answered conclusion with no warning. Actual UI reproduction,
  source inspection and post-failure DB flag confirmation establish a required repair under this row.
  This is not introduced by34cb123. The failed badge invocation is retained separately from passing
  same-project exports; seeded flag and actual nonowner failure generation are distinct evidence.
- OBJ-REV-013 computed native retry remains unexecuted. DB mixed-write/retry and native planner-
  refusal recovery passes remain valid but do not prove a computed native recovery.

Owner release in agent-handoff.md is explicit: Claude may repair ObjectiveCoverage's missing warning
and continue only named bounded assertions. Overall acceptance is incomplete and43-row12/18/2/5/6
counts unchanged. Earlier closed/deferred rows, conditional exclusions and deployed security/process
gates remain explicit; Research Quality Review is design-only.

Evidence retained under scripts/workflow-tenant-review/review34/: logs, hashes, actual exports,
failing native badge text/JSON and confirmed durable flag, full4-object synthetic storage inventory
and password-free cluster dump. Verified owned review34 processes/labelled cluster stopped; reserved
ports clear. Existing user/development resources untouched. No push/deployment or source patch.

## Claude OBJ-REV-012 coverage release: affected-file extension (2026-10-16, evening)

Recorded before applying to this checkout: `scripts/e2e/model-replay.mjs` (disposable e2e tooling, outside the released files) gains one fixture rule, `untargeted`, so a native check can script the crosstab planner's `submit_plan` call. Without it the OBJ-REV-013 retry can only end uncomputed. Existing replay answers and the log's `scripted` field are unchanged; fixture answers are marked `fromFixture`. The change was made and tested in the isolated cloud copy first.

## Claude OBJ-REV-012 coverage release complete (2026-10-16, evening)

Commit `7a6ab5d` (7 paths) over `4ba581d`. Results: the "Claude OBJ-REV-012 coverage repair and native remainders" section of the disposition record. Full suite 114 / 827 passed / 0 failed / 36 skipped; 14 UI checks, smoke, adapter 2 and objective script 3/3 pass. Partition unchanged; acceptance incomplete. State READY_FOR_CODEX.


## Claude overnight close-out complete (2026-10-16, night)

Under Grant's 19:46 SAST instruction. Commits over `48d76bc`: `a00dc0c` (13 paths), `d72b150` (6), `110183a` (11), `d5cbc6f` (5, harness and docs only), plus the following docs-only commit. All local and unpushed; committed bytes match the tested bytes after LF normalisation.

Final-tree gate: typecheck pass; full suite 116 files, 833 passed, 0 failed, 37 skipped; production build pass; 22 app browser checks, smoke 1, adapter 2 and objective script 3/3 pass against a production server. Lint: the 6 known `set-state-in-effect` errors remain (owner decision). Results, failed invocations and the 43-row overnight disposition: section "Claude overnight close-out" of the disposition record. Partition unchanged; overall acceptance incomplete and not claimed.

Affected-file extension used tonight (recorded here because it reaches outside the coverage release): the researcher-control failure repair touches `runContextActions.ts`, `StatedObjectivesList.tsx`, `useObjectiveRowActions.ts`, `ObjectiveReviewTable.tsx`, `ObjectivesWorkspace.tsx`, `ObjectiveEvidence.tsx`, `DecisionBriefReview.tsx`, `RecommendationsReview.tsx`, `SynthesizedRecommendationsReview.tsx`, and adds `actionFailure.ts` and `runs/[id]/error.tsx`. Lint-only edits: `TranscriptSetup.tsx`, `CodingProgressBar.tsx`, `AcrossTranscripts.tsx`, `CrosstabOptions.tsx`, `knowledge/content/import.tsx`, `driverAnalysis.ts`. No dependency, migration or schema change.

Disposable resources stopped by PID; no `ie_e2e_*` database or role remains. No push, deployment, live or development change, or model call; spend unchanged at US$3.817316.

## Codex overnight independent review complete — 2026-10-16

Reviewed laptop 0b7fb30 and the released overnight commits, application source read-only. Executed targeted suites: 80 passes / 5 explicit skips; 13 native passes. Exact affected-row dispositions, controlled boundaries and remaining limits are in the latest Codex addendum of independent-acceptance-disposition-2026-10-16.md. Coverage warning, effective group calculation/clear/reload, computed persistence retry and refused-save draft preservation independently pass. Saved reference content, conflict-label Excel/reload, SAV/DTA recovery, marker/regeneration and local upload failure/retry independently pass.

Two bounded observations: the production raw-file check's stable id/created_at/count cannot prove no reparse because extraction upserts in place (dev named-action absence is separately observed); unqualified toLocaleDateString causes an actual server/browser locale hydration mismatch. No incorrect statistic or lost human work is demonstrated by that mismatch. Exact remaining proof/closure criteria are recorded. Original IMP-017 v12 and Probe B browser failures, HTTP continuations, unexecuted failed-round/guard and trimmed-wide branches, policy decisions, exclusions, deferrals and security/deployment prerequisites preserved. Counts remain12/18/2/5/6=43; overall acceptance incomplete.

Eleven full synthetic objects/checksums, password-free dump and logs retained in scripts/workflow-tenant-review/overnight-codex/. Verified owned process tree and labelled cluster stopped; reserved listeners clear. No paid model call, application edit, author/history rewrite, push or deployment. Codex releases the bounded follow-up to Claude; see authoritative handoff.

## Claude bounded follow-up complete (2026-10-16, night)

Commit `5f63038` (9 paths) over `434924b`, plus the following docs-only commit. Local and unpushed; committed bytes match the tested bytes after LF normalisation. Results, reproductions, failed invocations and proposed dispositions: the "Claude bounded follow-up" section of the disposition record.

Affected files beyond the three released ones, stated here for review. They were made and tested in the isolated cloud copy and were recorded here only at this docs commit, not before they were applied: `src/lib/displayDate.ts` (new; the authoritative date rule TranscriptSetup now uses), `src/lib/__tests__/setupHydrationGuard.test.tsx` (maps the new module), `scripts/e2e/local-stack.mjs` (disposable `/__reads` download count) and the new checks `upload-date-hydration` and `evidence-round-failures`. No dependency, migration or schema change.

Gate: tsc pass; vitest 117 files / 837 passed / 0 failed / 37 skipped; production build pass; browser checks 23 of 24 passed (intermittent `data-setup-hydration` failure, then 3 of 3 alone); smoke 1, adapter 2, objective script passed. Disposable resources stopped by PID; no `ie_e2e_*` database or role remains. No push, deployment, live or development change, model call or history rewrite. Partition unchanged; overall acceptance incomplete.


## Codex bounded follow-up review - 2026-10-17

Independently reviewed a25020f / repair 5f63038; all nine released paths match the commit after CRLF normalisation. Application source remains read-only. Focused unit checks 10/10, changed-module lint and isolated production build/TypeScript pass. Production native primary run: 6 passes/1 failed unchanged hydration harness; separate readiness-aware continuation: 1 pass. Exact results and affected-row dispositions are in the latest Codex addendum of independent-acceptance-disposition-2026-10-16.md.

Production no-reparse proof now passes with download counts/xmin and a layout-change positive control. Deterministic upload date and returned/dropped evaluation failure, exactly 60-round guard and real load-permission refusal/recovery pass. Existing computed persistence retry and refused evidence edit pass. Three concurrent exact-limit pairs complete 6/6 in 4-6 seconds per pair; a separate DB re-query retains 100,000cases each after native reload. Original v12 failure/cause remain historical and unproven; no hosted capacity claim.

The unchanged data-setup-hydration helper's isVisible returned false immediately after navigation, so it skipped the Import click and timed out waiting for the upload input before reaching hydration assertions. Failed trace/context/screenshot retained; the separately labelled continuation waits for the panel, then passes the original held-script and save/reload assertions. Permanent harness readiness is the sole bounded Claude follow-up from this review. Engineering brief corrected after independent execution; no new application fix requested.

Twelve complete synthetic objects/hashes, counters, password-free database dump and logs retained in scripts/workflow-tenant-review/followup-20261017/. Owned PID tree/labelled database stopped; reserved listeners clear; development services untouched. No paid calls, push, deployment or author/history rewrite. Handoff explicitly releases ownership to Claude. Partition 12/18/2/5/6=43 and overall acceptance remains incomplete; prior closures, failures, exclusions, deferrals, owner decisions and security/deployment gates preserved.

## Claude hydration-check readiness fix complete (2026-10-17)

Commit `40198b0` (1 path, `e2e/ui/data-setup-hydration.check.mjs`) over `3753371`, plus the following docs-only commit. Local and unpushed. Reproduced first with the previous helper, then fixed; 5 of 5 passes on the production server. Details: the "Claude readiness fix for the hydration check" section of the disposition record. No application change; partition unchanged; overall acceptance incomplete.


## All43-row independent reconciliation - 2026-10-17

Reviewed HEAD460815c and readiness repair40198b0. The old helper independently fails under delayed scripts at the original upload-input step; the new permanent check and delayed-script comparison both pass with original assertions unchanged. This closes the test defect only. No application row is promoted because of this harness fix.

Every canonical row is individually disposed in the latest independent-acceptance-disposition-2026-10-16.md and updated finite checklist. Current partition: **33 Closed /4 Implemented awaiting verification /0 Confirmed defect /0 Untested requirement /6 Blocked =43**, priorities34/9/0. The original12closures remain;21 further finite criteria close on matching independent original-regression/acceptance evidence, not suite totals. IDs, requirements, priorities and frozen criteria are unchanged. Previous canonical preserved byte-for-byte as v26; verification metadata is in scripts/workflow-tenant-review/reconcile-20261017/canonical-reconciliation-check.json.

Remaining technical rows: IMP-004 saved zero/missing-audit values and separate scale policy; IMP-017 independent native one-over boundary/reload/corrected retry; business native own-delete/bulk and broader post-commit refresh reconciliation; FND named generator and replacement/duplicate consumer assertions. Six blocked rows are deployed security plus five historical-definition gaps. Missing evidence is not a new defect. No overall, module or public-release acceptance is inferred.

Executed current targeted evidence: row regressions45 passes/9 skipped; mechanism run12 passes/1 cache runner timeout/5 skipped; separate unchanged cache continuation4 passes/1 skipped with60-second allowance. Actual Python/DB edit races and exact original two-channel selector persistence controls pass. Native old-helper control fails as expected; fixed readiness two cases pass; objective detail/overview assertions pass3/3, with usable generation supplied by its separately retained relevant native proof. All failed invocations remain failed. Application source matches the prior independently built snapshot across521 paths; no build or full837-suite rerun claimed.

Two complete synthetic objects/hashes, password-free UTF-8 cluster dump, old failing trace, reports, source comparisons and logs retained locally. Verified own PID tree and labelled codex-reconcile-20261017 cluster stopped; owned listeners clear, user/development services untouched. No application edit, paid model call, push, deployment or author/history rewrite. Handoff releases only the four named bounded verification remainders, with repair only on a concrete failure and independent verification before any subsequent bug closure.

## Claude four-remainder package complete (2026-10-17)

Commit `091663e` (18 paths) over `b5992da`, plus the following docs-only commit. Local and unpushed. Affected source boundaries were recorded in the handoff before the package was applied to this checkout. Gate: tsc pass; vitest 121 files / 860 passed / 0 failed / 39 skipped; production build pass; 28 of 28 browser checks, smoke 1, adapter 2, objective script passed. Details: "Claude work package for the four released remainders" in the disposition record. Partition unchanged until Codex's review; overall acceptance incomplete.
