# Batch D3aR handover: Codex's R1/D3a findings (29 October 2026)

Status: implemented, ready for independent review. Branch d3ar (worktree b91), on BatchD3a (49cf6d1b on Grant's
laptop). Review: `docs/independent-r1-d3a-review-2026-10-29.md`.

## R1-F01 (S1): workbook tables read before the label reader repair stay current

- **Engine.** It now records `labelReader` ("2026.10.29", `LABEL_READER`) in every table's notes.
- **Rule.** `tableMethod.ts` `tableMethodStatus(methodVersion, source)` marks a table read from an .xlsx or .xls
  file without the current label reader as "earlier". `earlierMethodText` gives its reason in words: answers may
  have been merged, so rebuild. Tables from other formats are unaffected. A caller that cannot name the table's
  source is judged on the method version alone, as before.
- **Where it shows.** Every place that already shows an earlier method now passes the table's source
  (`provenance.sourceFile`) and label reader:
  - the Cross tabs list badge and its reason;
  - the Findings page flag and its reason;
  - insight support status, through `method_changed` with the reason as detail.
- **Nothing recalculated.** Researcher wording, review status and the saved table are kept until an explicit
  rebuild.
- **Test.** `r1WorkbookFreshness.db.test.ts` (real engine and database, 3 tests):
  - a new workbook table is current;
  - the same table as saved before R1 (no label reader, answers merged under the question label) is earlier
    with the workbook reason;
  - its insight reads stale (`method_changed`), with wording, review and table kept;
  - a rebuild gives Toyota/BMW/Haval and is current;
  - control: a CSV table with no label reader stays current.

  `tableMethod.test.ts` also checks that the constant equals the engine's `LABEL_READER`.

## D3A-F01 (S2): sparse switching data changed the risk definition

- **Rule.** `trackerCsmFigures.ts` `boxCodesFor` fixes the codes a box counts from the question's stated scale,
  never from the answers present. The scale comes from `trackerRoles.scaleTop`, now exported: the answer list
  without non-answer codes, else the range the wording or name states. On a 0 to 10 scale, likely to switch counts
  8, 9 and 10; any other box counts the top two codes.
- **Shared rule.** `csmMetrics.shareOfCodes` adds the shares of exactly those codes. An absent code is 0, and a
  suppressed bar makes the box unavailable.
- **Unstated scale.** The tile is "failed" with an actionable reason (add labels or choose another question),
  never guessed.
- **Inputs.** `csmOverviewFigures` now takes the role variables, so the scale is read from the file.
- **Tests.**
  - Codex's repro in `trackerCsmFigures.db.test.ts` (answers 0 to 7 and 10, real engine): 11.11%, where it was
    22.22%.
  - `trackerD3aRepairs.test.ts`: missing 8, 9 or 10; a declared zero-count code; non-answer codes on the answer
    list; a shorter scale; an unstated scale; a suppressed bar.

## D3A-F02 (S2): an explicit "No" could count as selected

- **Rule.** `trackerFigures.selectedCode`, when no label says selected or yes, gives code 1 only if code 0 alone is
  labelled as the opposite ("No", "Not selected", "Not mentioned") and 1 is unlabelled. A label on 1, or a 0
  labelled anything else, is never overruled: the variable is unavailable, with the existing reason.
- **Tests.** Partial labels {0: Not applicable, 1: No}, all-negative labels, a lone "No" on 1, reversed coding,
  Yes absent from the data, and unlabelled 0/1 controls. These failed on the previous rule (shown).

## D3A-F03 (S2): wave change ignored the brand code

- **Rule.** `changesAgainst` compares only the same stage, variable and brand code. When both waves' brand lists
  are given (as the overview now does), the code must also name the same brand.
- **Otherwise.** No change is shown, with the reason: not asked about this brand in the previous wave, the code
  was another brand, or the code is not in the previous list.
- **Tests.** Another code on the same variable (it gave +20 before, shown failing on the previous rule), a reused
  code naming another brand, a missing brand, and a stable control. The BMW reference changes still pass.

## Comments

Codex noted two stale comments, both now corrected:
- the trackerFigures header now says `computeCrosstab`;
- "Adds one table to the draft set" is back on `buildCrosstab`.

## Checks

Results so far:
- 11 rule tests passed;
- the affected suites passed: 7 files, 90 tests, 1 skipped;
- the R1 freshness tests passed (3).

Full gates on the exact tree (laptop `49cf6d1b` code plus D3aR, commit `364cc8e`):
`npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors; `python3 scripts/crosstab_selftest.py` all passed;
`TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks` 316 files, 2,405 passed, 91 skipped, 0 failed;
`npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` 144 passed, 1 skipped, 0 failed; `npx playwright test`
(smoke) 1 passed. The new checks: `tracker-dashboard` 2 passed (BMW change against the previous wave; banking CSM
tiles), `nps-driver-split` 1 passed.

The first browser run failed `nps-driver-split`: this worktree did not yet hold UI1R and UI1R2, which are on the
laptop (the check's own repair is in UI1R). They were added, the code folders were confirmed identical to the
laptop's, and every gate was run again (results above). One library test that builds a throwaway git repository
failed in the first run because commit signing is broken in this container; it passes with signing off (7 of 7)
and passed in the rerun.

Real versus mocked: the engine, PostgreSQL (disposable databases) and the browser stack are real; storage is the
local stand-in and the model is replaced by recorded answers.

## Why the earlier tests missed these

- R1-F01: the R1 tests built tables after the repair only; none loaded a table saved before it.
- D3A-F01: the reference packs have every scale point present, so "top answers present" and "stated codes" agreed.
- D3A-F02: the test files labelled code 1 "Yes"; none had a lone "No" label or non-answer labels.
- D3A-F03: the BMW waves keep the same brand codes, so a comparison by variable alone gave the right answer.
