# Coding stability: the original, completeness, same method and the figures

Batch 61 (28 October 2026), Codex STAB-F01 to STAB-F04, with Grant's presentation direction of the same
day. Owner: `src/lib/codingBaseline.ts`, `src/lib/codingAnalysis.ts` (`runStabilityCheck`,
`saveStabilityResult`, `applyMajorityCoding`, the stability part of `getCodingAnalysis`), figures in
`src/lib/qualAudit.ts`. Migration 0128.

## What the check measures

Within-model repeatability, the analogue of intra-coder agreement: the same model applies the same
codebook to the same turns again, and each new pass is compared with the model's own original
application. It measures consistency, not correctness; correctness needs the researcher's audit sample.

## The original (STAB-F02)

- `coding_model_baselines` keeps, per model application of a codebook (extract, re-apply, codebook-only
  import), the model's own codes per turn (`decisions`, segment id to code ids) before any researcher
  change, with its model, prompt hash (`APPLY_PROMPT_HASH`, which includes `APPLY_INPUT_VERSION`), a
  fingerprint of each code's name, definition and criteria, a fingerprint of the turns (id, index, role,
  text) and the apply's batch counts.
- Written by `recordModelBaselineTx` inside `writeCodebookAndFindings`'s transaction, the one that writes
  the same assignments to `coding_assignments`, so both describe one application. A trigger refuses
  updates. A researcher-coded import writes none.
- The stability check never rebuilds the original from `coding_assignments` (which holds hand changes and
  majority settling). With no kept original (coded before 0128, or imported) the original is **unknown**
  and the check refuses, offering a fresh application.
- Agreement with the researcher is a separate measure: `changesSinceBaseline` counts themes added and
  removed in the coding in force relative to the original (hand changes and settling by majority).

## Completeness (STAB-F01)

- One rule, `codingHasGap` (moved from `extractThemes.ts` to `codingBaseline.ts`, unchanged): an
  application with a failed batch or a batch that omitted requested decisions is incomplete. An omitted
  decision is unknown, never "does not meet the code". It decides the document status after coding, the
  original's completeness and each pass.
- An incomplete original refuses the check. An incomplete pass is left out whole and named
  (`coding_stability_checks.excluded`). Passes not run because credit ran out are named too.
- With no complete pass, nothing is saved and the previous result stays.

## Same method (STAB-F03)

- `baselineState` / `compareMethod`: ready only when a new pass would use the original's model name,
  prompt hash, code fingerprints (no theme added, removed or redefined) and turn fingerprint. Otherwise
  the check refuses before any model call and names each change. Missing migration, unknown original,
  incomplete original and changed method are distinct states; a failed read of them shows as
  unavailable, never as "no original".
- The model is read once per application (`codingApplyModel`), so the calls, manifest rows and the
  original name the same model. A pass whose recorded model or prompt differs from the original's is
  left out.
- Limit: a model alias (a name without a release date, such as `claude-sonnet-5`) can be moved by the
  provider to a newer release; "same model" then means the same name. `modelIsPinned` drives the panel's
  disclosure.

## Snapshot and save

- The codebook, codes, turns and the original are read in one REPEATABLE READ transaction.
- `saveStabilityResult`, one transaction: transcript ownership (`lockOwnedTranscript`, share), the
  codebook row locked `for update` (must exist), then the original must still be the latest one for the
  codebook and the code and turn fingerprints unchanged; otherwise it refuses and the previous result
  stays. It replaces `coding_turn_stability` for the codebook, carries over each turn's blind coding,
  settled time and changed flag, and upserts `coding_stability_checks` (requested, complete, excluded,
  the original used). Retrying gives the same rows (replace, not append).
- Settling by majority requires a recorded check (`coding_stability_checks`); an older result may have
  counted an incomplete pass as votes against a theme.

## The figures (STAB-F04 and Grant's direction)

Formulas unchanged; only which lead and how they are labelled.

- **Lead:** per theme, pairwise agreement (`codePairwiseAgreement`: over every participant turn and every
  pair of runs, the share with the same yes or no decision; denominator turns times pairs) and kappa
  (`codeKappas`, averaged over pairs). Averages over eligible themes only.
- **Eligible:** a theme that came up in at least `MIN_TURNS_TO_JUDGE` (10) turns. Themes below are
  marked too few and counted as left out. With none eligible there is no average.
- **Secondary, stricter:** `headlineCodeAgreement`, per eligible theme the share of the turns it came up in
  where every run gave it, averaged. Counts consistent positive codings only, falls as runs are added. Its
  former fallback to every used theme is removed.
- Further detail: whole-turn exact agreement and overlap, as before.
- The export's "Run reliability" sheet carries the same figures, the eligible and left-out counts, and the
  check's completeness note on every row.

## Tests

`codingStability.db.test.ts` (real database, restricted role, fake model answering from a key),
`codingStabilityPre0128.db.test.ts` (database without 0128), `stabilityMethod.test.ts` (hand-computed
values).
