# Batch 39 handover: repair of B37-F01 (26 October 2026)

Base: laptop 5518de7c (Batch 38). Status: implemented, ready for review. Tier A. No migrations.
Codex's combined review of Batches 37 and 38 (review commit b0742d4d) stopped on one S1, B37-F01. This
batch repairs it only; nothing else is in it.

## B37-F01: rejected supporting evidence left objective coverage answered and current

**Cause.** Coverage freshness fingerprints the accepted insight ids. Rejecting the only finding behind an
insight makes the insight's support invalid, but its id and review status are unchanged, so coverage still
compared as current, `qualifiedConclusion` added nothing, and the trail showed the objective as answered
and current beside a broken insight and finding.

**Repair (rule owner `src/lib/objectiveCoverage.ts`, support from `supportStatus.ts`; no second rule).**
- Every conclusion now carries the support of the insights it cites (`StoredCoverageRow.support`): the
  worst status among them by `worstSupportStatus`, read live by `loadObjectiveCoverage` through
  `loadInsightSupportOrUnchecked`, the same reader and labels as the insight cards and exports. A failed
  support check makes every citing conclusion "Support not checked", never current.
- One set of qualifications: `coverageSupportNote` (invalid: "Not supported now", stale: "Support changed",
  unknown: "Support not checked"), `coverageRowNote` (out-of-date inputs first, then support),
  `coverageRowCurrent`, `coverageNote` (the one line for the pane, stage status and tile), and
  `qualifiedConclusion` now uses `coverageRowNote`.
- Applied in: the coverage pane and selected-objective tile (a note and a "Support no longer valid" style
  chip beside the kept verdict), the objective verdict chip ("(not current)", was "(out of date)"), the
  stage status (needs you), the research assistant and both story exports (conclusion text), and the
  evidence trail (the objective is broken for invalid support, caution otherwise, with the note).
- The saved conclusion, its verdict and the objective's identity are kept as they were; nothing is rewritten.
- Re-check (`objectiveValidator.ts`): insights whose support is invalid are not offered to the model, so a
  re-check cannot cite them; changed or unchecked support is offered marked, with the instruction that it
  cannot alone make an item resolved, and the reader qualifies any conclusion that cites it. With no
  supported insight left the re-check refuses with that reason and keeps the last check, shown as not
  supported. The fingerprint still records every accepted insight.

**Why the tests missed it.** Every coverage fixture inserted synthesized insights with no finding behind
them, so support never entered the coverage tests, and the trail fixture's insight had no recorded support.
The fixtures now build insights the way synthesis does (finding, pre-insight, link with
`finding_support_parts`; `helpers/supportedInsight.ts` and `e2e/ui/helpers/supportedInsight.mjs`).

## Impact checklist

1. Rule: CE-1 coverage (rules-registry row updated), support status (FND-001 owner `supportStatus.ts`), used
   not copied.
2. Inputs: a cited insight with invalid, stale or unchecked support qualifies the conclusion; a failed check
   is "not checked"; a conclusion citing nothing (a gap) carries no support qualification.
3. Persistence: read-only change, except the validator's refusal (nothing written, earlier rows kept).
   Support is read in its own snapshot (the support reader opens one), so a review committed between the
   coverage read and the support read is seen on the next load.
4. Freshness: coverage conclusions, the trail and both exports are qualified live; human wording, verdicts
   and objective identity are kept.
5. Screens: server-rendered note and chip (mounted test); browser check with reload.
6. Proof: below.

## Tests (each fails with the support read removed, passes with it)

- `objectiveCoverageFreshness.db.test.ts`: Codex's repro through the actual `setFindingStatus`: inputs still
  current, both citing conclusions invalid, the gap unqualified, `qualifiedConclusion`, `coverageNote`, stage
  status; healthy control; changed wording (stale) and recovery; support lookup failure (unknown) and
  recovery; re-check cites only the supported insight (prompt and links); all rejected: refused, last check
  kept, still qualified.
- `evidenceTrail.db.test.ts`: the objective node broken with the note after rejection; healthy control now
  fully current; a re-check refuses and the trail still says so.
- `objectiveReview.db.test.ts`: both story exports (Word and PowerPoint) carry "Answered. (Not supported
  now: ...)" after rejection, and nothing extra before it.
- `objectiveCoverageDegraded.test.tsx` (mounted): the note and chip on the pane and with the selected
  objective, only on the conclusion concerned.
- `objective-coverage-stale.check.mjs` (browser, disposable stack): step 4 rejects the cited finding;
  note, chip, verdict chip "(not current)" and the tile, after a reload.
- Fixture updates: `objectiveValidationDuplicates`, `objectiveValidationQualification`,
  `objective-coverage-degraded.check.mjs`, `evidence-trail.check.mjs`.

## Gates

On worktree b47, commit 2b518f5 (code; this docs commit follows):
- `npx tsc --noEmit` ok; `npx eslint src e2e --quiet` ok; `python3 scripts/crosstab_selftest.py` all checks passed.
- Full library `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: **250 files passed, 1 skipped;
  1,866 passed, 78 skipped, 0 failed** (real disposable PostgreSQL and the local engine; storage, model and request
  context mocked).
- Full browser suite on the disposable stack: **119 passed, 1 skipped** (the live-model check); smoke **1 passed**.
  The three coverage checks (stale with the new rejection step, degraded, evidence trail) passed first.
- Failing without the fix: with the support read removed (support forced to "cites nothing"), the three new
  coverage tests, the trail test and the exports test fail; with the validator's exclusion removed, the re-check
  test fails.
- Not run here: Windows.

## Limits

- The objective evidence lane's results are still not part of coverage freshness (stated in CE-1 before).
- Support is checked per cited insight; an objective's coverage is not re-judged automatically when support
  changes. The researcher updates coverage, which now cannot cite unsupported insights.
