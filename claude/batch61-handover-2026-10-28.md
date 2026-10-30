# Batch 61 handover: coding stability (Codex STAB-F01 to STAB-F04)

Status: **implemented, ready for independent review.** Not pushed, not applied to any database.

- Worktree `/home/claude/b71`, branch `stability-fixes`, base `d2a321d3083a558ad04459c12aaa71db28981311`.
- Code commit `326d784fdf147332334a4990cc4b0bf67fcf1dc2` (tree `e007b3ca75277713b616ce4052993298d8662874`); docs commit follows it.
- Tier A (migration, persistence, calculations, export); the panel is tier B.
- Contract `claude/coding-stability.md` (new); registry rows added; `claude/coding-write-ownership.md` updated.

## What changed, by finding

**STAB-F01 (S2) incomplete reruns scored as negative coding.** The check now uses the one completeness rule,
`codingHasGap`. It was moved unchanged from `extractThemes.ts` to `codingBaseline.ts`. A pass with a failed or
partly omitted batch is left out whole. It is never compared and is named in the result, for example "pass 2
incomplete: 1 of 1 batches left some turns undecided". Passes not run because credit ran out are named too.
The original's coverage is checked as well: if the original is incomplete, the check refuses. With no complete
pass nothing is saved, and the previous result stays.

**STAB-F02 (S2) researcher edits changed the model baseline.** Migration 0128 adds `coding_model_baselines`.
It keeps the model's own decisions per turn, written in the same transaction as `coding_assignments` by every
model application (extract, re-apply, codebook-only import), and a trigger refuses updates. Run 1 of the check is
this original, never the current coding. Hand removals, additions, undo, majority settling and settled turns are
untouched. A new check now carries each turn's blind coding, settled time and changed flag forward (before, it
deleted them). Agreement with the researcher is reported separately as "themes added and removed since the
model's original". A coding with no kept original reads as **unknown**: the check refuses and offers a fresh
application. Snapshot: one REPEATABLE READ read. The save locks the transcript (share) and the codebook row
(for update), and checks that the original is still the latest and that the codes and turns are unchanged.

**STAB-F03 (S2) same method not established.** `baselineState` compares the original's model name, prompt hash
(which includes the input preparation version), each code's name, definition and criteria, and the turns' ids,
roles and text. Any difference refuses before any model call, and the message names what changed. Missing
migration, unknown original, incomplete original, changed method and a failed read are distinct states. The
model is read once per application (`codingApplyModel`), and a pass whose recorded model or prompt differs is
left out. The panel discloses that `claude-sonnet-5` is an alias, so "same model" means the same name.

**STAB-F04 (S3) minimum support silently relaxed.** `headlineCodeAgreement` keeps the ten-turn minimum. With no
eligible theme there is no figure, and the panel and export say so.

**Presentation (Grant, 28 October).** Pairwise agreement per theme (new `codePairwiseAgreement`, beside the
existing kappa; formulas unchanged elsewhere) and kappa are now the lead figures. They are shown per theme with
their denominator (turns times pairs) and averaged over eligible themes, with the eligible and left-out counts.
The all-runs figure is secondary, labelled "Consistent in every run (stricter)". Whole-turn agreement and overlap
are kept as further detail. The panel shows completeness (complete out of requested, excluded passes named) and
same-method status, and says these figures measure consistency, not correctness. The export's "Run reliability"
sheet carries the same columns and puts the check's completeness note on every row.

## Impact checklist

1. Rule: new registry rows (completeness, original, same method, running/saving, figures); `codingHasGap` moved, not duplicated.
2. Inputs: unknown, incomplete, changed or unreadable originals refuse with a stated reason. An omitted decision is never "no".
3. Persistence: the original is written with its assignments (one transaction). The check saves in one transaction with an ownership lock, a codebook row lock and a revision check. A retry replaces the result; a partial failure keeps the previous result.
4. Freshness: a result made against an earlier original is marked as such. Results from before batch 61 show "checked before completeness and method were recorded; method unknown" in the panel and the export, and cannot settle by majority. Coding, findings and human decisions are unchanged.
5. Screens: the button is disabled while the check cannot run; messages come from the server action. No new client state.
6. Proof: below.

## Files

`supabase/migrations/0128_coding_model_baselines.sql` (new), `src/lib/codingBaseline.ts` (new),
`src/lib/codingAnalysis.ts`, `src/lib/extractThemes.ts`, `src/lib/qualAudit.ts`,
`src/app/runs/[id]/CodingAnalysisPanel.tsx`, `src/app/api/runs/[id]/coding/export/route.ts`. Tests:
`codingStability.db.test.ts`, `codingStabilityPre0128.db.test.ts`, `stabilityMethod.test.ts`. Not touched:
`sentences.ts`, `codingMeta.ts`, `qualCoding.ts`.

## Commands and counts (after the change)

- `npx next typegen`, `npx tsc --noEmit`: clean. `npx eslint .`: 0 errors, 44 warnings (the one in a changed file, `parseAssignments` in extractThemes.ts, is pre-existing).
- `python3 scripts/crosstab_selftest.py`: all checks passed.
- Each with `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run <file> --pool=forks`:
  - `codingStability.db.test.ts`: 14 passed.
  - `codingStabilityPre0128.db.test.ts`: 1 passed.
  - `stabilityMethod.test.ts`: 13 passed.
  - `qualAudit.test.ts`: 28 passed.
  - `qualAuditLooser.test.ts`: 6 passed.
  - `qualCoding.test.ts`: 49 passed.
  - `qualAnalysis.test.ts`: 27 passed.
  - `codingOwnership.db.test.ts`: 9 passed.
  - `tenantIsolation.db.test.ts`: 5 passed, 1 skipped.
- On the base (scratch worktree, same tests and migration file): `codingStability.db` 14 of 14 failed, `codingStabilityPre0128.db` 1 of 1 failed, and `stabilityMethod` could not load (the module did not exist).
- Mocks versus real: real PostgreSQL as a NOSUPERUSER, NOBYPASSRLS role, the real applyCodebook, real persistence and the real view. Only the model (a fake answering from a key, able to fail or omit), API usage logging and Next cache/server were mocked.
- Not run: the full library suite, the browser suites and screenshots (excluded by this batch's rules).

## Codex replay (copies run, then deleted; receipts written to the scratchpad)

| File | Base | After |
|---|---|---|
| independentApplyCoverage | 2 passed | 2 passed |
| independentStabilityMethod | 259 passed | 259 passed |
| independentStability.db | 3 passed, 5 failed | 5 passed, 3 failed |

The three that still fail (`complete_control`, `researcher_removed`, `rare_headline`) expect a successful check
on fixtures made by SQL with no kept original. Under STAB-F02's acceptance that original is unknown, so the check
refuses by design. The five that now pass also refuse for that reason, so they do not on their own show each
mechanism. `codingStability.db.test.ts` covers every scenario with an original made through the real write path:
complete, failed, incomplete, researcher removal, changed model, old prompt, unknown original and rare headline.

## Migration, backfill, compatibility

- Apply 0128 after 0126 and 0127. It is additive and idempotent, with no backfill (the original decisions of existing codings cannot be recovered).
- Before 0128 is applied: coding and the view work, the panel says the check needs migration 0128, and the check and majority settling refuse (tested).

## What existing projects will show

- Each coded transcript: "original coding unknown; apply the codebook again". This costs one application per transcript.
- Existing stability results stay visible, marked as checked before completeness and method were recorded.
- Majority settling is unavailable until the check is run again.

## Limits

- A model alias can change release without the name changing.
- Incomplete passes are left out, not retried at decision level.
- A theme added by hand blocks the check until the codebook is applied again.
- The original is not cross-checked against `coding_run_manifest` rows. Both get their values from the same `codingApplyModel` and `APPLY_PROMPT_HASH` read.
- No screenshots were taken.

## Next steps (out of scope, per Codex)

1. Codebook quality checks (duplicate definitions, empty inclusion and exclusion criteria).
2. Supply neighbouring codes' rules in each application call.
3. Compare discovery coverage with application coverage.
4. Retain ambiguity.
5. Build a researcher-adjudicated evaluation set.
