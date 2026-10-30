# Batch 63 handover, 28 October 2026

Status: implemented, ready for independent review. Branch `narrative-recs`, worktree `b73`. Not pushed.

## Finding

EF-REP-F01 (S2, Codex): an accepted action plan could change while its report narrative stayed
apparently current. The generator gives the model each accepted recommendation's action, owner,
timeline and priority, but the narrative fingerprint (CE-3) held no recommendation at all, so an edit,
rejection or deletion left `narrativeFreshnessNote` null and both exports paired the old narrative with
a freshly read action list. Why the tests missed it: the CE-3 test only changed the project framing
(business problem, objectives), never anything else the prompt is given; the new file covers every
recommendation field and acceptance path.

## Impact checklist

1. Rule: CE-3, owner `src/lib/narrativeFreshness.ts`. Extended, not duplicated. The recommendations
   the generator gives the model are now read by one function, `readFramingRecommendations`, used by
   both the generator and the fingerprint, so the snapshot covers exactly what the model sees.
2. Inputs: the fingerprint covers identity, action, owner, timeline, priority, anchor insight id and
   headline, as a set sorted by id (reordering is not a change). Metric is not given to the model and
   is not fingerprinted. A narrative recorded before this change has the five older parts but no
   `recommendations`: the older parts are still compared, the recommendations part reads "not known"
   (never current, never changed). A missing or malformed record, or a database without 0121, reads
   "Not known to be current" as before.
3. Persistence: no migration. `deck_narratives.inputs` is jsonb (0121) and holds the new key. The
   fingerprint is still read before the model is asked and written in the same transaction as the
   narrative; a failed generation writes neither.
4. Freshness: qualifies the preserved narrative on the Insights report screen (`page.tsx`), for the
   assistant (`researchAssistant.ts`) and in the Word and Slides exports, all through
   `narrativeFreshnessNote`. The narrative and any researcher revision are not rewritten.
5. Screens: no client change; the screen shows the note it already shows.
6. Proof: below.

## Files

- `src/lib/narrativeFreshness.ts`: `recommendations` part, `readFramingRecommendations`, partial legacy
  comparison and wording.
- `src/lib/storyNarrative.ts`: uses the shared reader; unused `EvidenceRecommendation` type (and the
  unused `metric` column) removed.
- `src/lib/__tests__/narrativeRecommendationFreshness.db.test.ts` (new).
- `src/lib/__tests__/generatorSupport.test.ts`: scripted recommendation rows given an `id`.
- `claude/evidence-chain.md` (CE-3), `claude/rules-registry.md` (CE-3 row).

Callers unchanged: `page.tsx`, `researchAssistant.ts`, `story/export/route.ts`,
`story/export-docx/route.ts`.

## Commands and counts

`TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run <file> --pool=forks`, one
file at a time:

- `narrativeRecommendationFreshness.db.test.ts`: base 10 failed, 1 passed (unchanged and reordered
  control), 1 skipped; after 11 passed, 1 skipped. Covers action, owner, timeline, priority, rejection,
  deletion, addition (note, preserved summary, both export XMLs), the assistant prompt, a change during
  generation, regeneration recovery, a failed regeneration keeping the report, inputs and note, and the
  legacy unknown part.
- `narrativeWrongGroup.db` 6 passed 1 skipped; `figureTraceability.db` 5 passed 1 skipped;
  `storyExportSupport` 3; `storyExportDiscovery` 5; `narrativeFigureTrace` 22; `generatorSupport` 5
  (3 failed before its fixture got ids); `dataIntegrityDI.db` 14; `historyCsvFormula.db` 2;
  `latestVerdictReaders.db` 6 passed 1 skipped; `objectiveReview.db` 6 passed 1 skipped; `changeTier` 7.
- `npx next typegen` ok; `npx tsc --noEmit` 0 errors; `npx eslint .` 0 errors, 44 warnings (none in
  changed files); `python3 scripts/crosstab_selftest.py` all checks passed.

Real infrastructure: disposable PostgreSQL, the real generator, freshness reader, assistant and both
export routes. Mocked: the model, usage logging, scorers, contradiction refresh, storage, Next cache,
discovery data and chart images.

## Codex replay

`independentRecommendationNarrative.db.test.ts`, copied temporarily, with its observation path set by
`REPLAY_OUT` to a scratch folder and the export routes' `@/lib` imports mapped as the repo's export
tests do; then deleted. Base: 5 failed (action, owner, timeline, reject, delete), 7 passed (including
the unchanged control), 1 skipped. After: 12 passed, 1 skipped.

## Limits

- The fingerprint is read before the generator's support filter (FND-001): a change to a
  recommendation left out for invalid support also qualifies the narrative (over-cautious).
- The fingerprint and the generator's read are separate transactions, as before: a change between
  them reads as changed although the model saw it (over-cautious, never "current").
- Browser rendering of the note was not run (per instructions); the screen reads the same function.
