# Handover: RP0-F01, RP0-V01, RP0-M01 and the cross-tab design label (main copy), 26 October 2026

Status: **implemented, ready for independent review.** Main copy, on top of batch29 (`51863f3`).
Follows `docs/release-verification-phase0-batches28-29-2026-10-25.md` (Codex, verification branch
`dc0d36ae`). No migration. Nothing pushed or deployed.

Contracts: `claude/answer-domain.md` (new) and `claude/one-reader-import.md` (typing policy).

| Commit | What | Kind |
|---|---|---|
| repair commit | RP0-F01, RP0-V01, RP0-M01, design label; tests | correctness |
| docs commit | This handover and the status line | |

## RP0-F01 (programme S1): an excluded non-answer took a top-two-box slot

Root cause, as Codex traced it: the engine's row tabulation masks "Don't know" cases out of the valid
base, then `_ordered_categories_raw(..., include_unobserved=True)` adds every declared code back as a 0%
row (IMP-004), the non-answer code 99 included; its `rawCode` reaches the chart series and
`summarizeSeries` ranks codes numerically, so the top two were 99 and 5.

Repair, in the engine as the one authority (no new label guessing in TypeScript):
`api/parse-stats-file.py` `_non_answer_codes` names the declared codes that are not answers (declared
user-missing codes, and with non-answers excluded the codes whose label matches `_DK_RE`), and the row
categories exclude them. Substantive declared codes with no cases stay (IMP-004 preserved). With
non-answers included (`excludeDk: false`) the codes are answers and appear with their cases. Every
consumer (distribution, chart, CSM box and mean, NPS, findings) takes the domain from this table.

Changed behaviour: a cross-tab with non-answers excluded no longer shows a 0% row for an unchosen
declared non-answer code. Stored tables keep their rows until rebuilt; CSM and NPS are computed on
request and use the new domain at once. This also covers a declared user-missing code whose label is not
a "don't know" word, which had the same path.

## RP0-V01: the self-test's design reference

`scripts/crosstab_selftest.py`: both design-variance checks now use an independent Student t reference
(SciPy) with the design degrees of freedom computed from the data (PSUs minus strata: 599 for one case per
PSU), not the normal tail. Added: a sensitivity check that the t and normal references differ by more
than the tolerance (so the check can tell them apart), and a no-design control that uses the normal
reference. The "don't know: no row by default" assertion is unchanged and now passes (it was the
RP0-F01 symptom). The self-test is not wired into `npm` scripts or CI; it is run directly.

## RP0-M01: one typing policy for numbers written as text

`_exact_decimal`: a decimal or exponent spelling whose magnitude exceeds 2^53 makes its variable text,
exactly like a bare whole number beyond 2^53 (`9007199254740994.0`, `1e16`, `1e30`, `-1e16` are text);
below that the round-trip rule stands (2^53 itself, `0.1`, `1e15`, `0.5` are numbers). Comment and
contract say the same. Excel number cells are doubles already and not put through the rule.

Freshness: reader `engine-plain-2026.10.26b` (stored tables of earlier readers are compared with a fresh
read and withheld when they differ), `DICTIONARY_VERSION` 13 and `minimumDictionaryVersion` 13 for
CSV/TSV/Excel, `ENGINE_VERSION` `2026.10.26-2`.

## Cross-tab design label (found while preparing the calibration round)

`crosstabs.crosstabFindings` named the test ("t-test with design degrees of freedom") and set
`survey_design_modelled` from `notes.designUsed`, which the engine also fills when a design was requested
but no case had design data (then Kish standard errors and the normal reference). It now follows
`notes.designApplied`, as NPS does (ANA-NPS-003); `stats.design` still records the request with
`casesMissingDesign`.

## Files

- Engine: `api/parse-stats-file.py` (`_non_answer_codes`; row categories; `_exact_decimal`;
  `TABLE_READER`, `DICTIONARY_VERSION`, `ENGINE_VERSION`). `scripts/crosstab_selftest.py`.
- App: `src/lib/crosstabs.ts` (design label; `minimumDictionaryVersion` 13),
  `src/lib/importPreviewIdentity.ts` (reader id).
- Fixture: `fixtures/csm/dk-score-source.sav` (Codex's source, SHA-256
  `f796fc7452d654d79bef1c2d3d143d97dc6da23b24472952ed1dd31aef0fec11`).
- Tests: `answerDomainScores.db.test.ts` (new, 6), `crosstabDesignLabel.test.ts` (new, 2),
  `exactNumberBoundary.db.test.ts` (RP0-M01 case added); version expectations moved to 13.
- Contracts: `claude/answer-domain.md` (new), `claude/one-reader-import.md`.

## Checks run

Real disposable PostgreSQL 16 (migrations through 0117), the actual Python engine and the disposable
browser stack.

- `npx tsc --noEmit`: clean. `npm run lint`: exit 0, 0 errors, 41 warnings (the inherited set).
- `answerDomainScores.db.test.ts`: **6 passed**, through the actual `buildCsmDashboardAction`, stored
  table and reload: Codex's source (SHA-256 checked) gives base 100 and top two box 40 with no 99 row
  stored; an unchosen top scale code stays a 0% row and counts (25, not 50); no non-answer code (40); a
  declared user-missing code outside the domain (40); explicitly included non-answers shown with their
  20 cases; weighted and segmented (men 66.6, women 20, overall 45.5, written out from the counts);
  refusal of a variable with one substantive code, then recovery on a valid file. Mutation check: the
  domain filter removed, 4 of the 6 fail (Codex's repro among them); the IMP-004 and included-non-answer
  controls pass either way, as they should.
- `crosstabDesignLabel.test.ts`: **2 passed** (actual engine results: design requested but not
  applicable, z-test and not modelled; design applied, t-test and modelled). Mutation (label from
  designUsed again): the first fails.
- `exactNumberBoundary.db.test.ts`: **4 passed** (RP0-M01 case added). Mutation (no magnitude rule):
  the RP0-M01 case fails.
- `python3 scripts/crosstab_selftest.py`: **exit 0, all checks passed** (was 2 failed on 51863f3), with
  the new t-versus-normal sensitivity and no-design controls.
- Full library (`npx vitest run src/lib/__tests__ --pool=forks`): **1,759 passed, 72 skipped, 0 failed**
  (234 files passed, 1 skipped).
- Browser: `crosstabs-entry`, `large-spss-crosstab`, `logical-cells-and-exact-numbers`,
  `nps-pending-status`, `one-reader-import` **5 passed**; full browser suite (no filters) **107 passed,
  1 skipped, 0 failed**; smoke 1 passed.

Mocks: storage (in-memory stand-ins) and the model (never reached). The engine, database and actions are
real.

## Limits

- CSM box scores sum the bars' one-decimal percentages (33.3 + 33.3 = 66.6 for 66.67). Unchanged here.
- `categories()` (the list used to build NET groups) still lists declared non-answer labels, so a
  researcher can still choose them for a group deliberately.
- The self-test is run by hand; it is not part of `npm run` or CI.
