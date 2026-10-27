# Batch 43 handover: evidence trail extras (27 October 2026)

Base: Batch 42. Status: implemented, ready for review. Tier A. No migrations. Contract:
`claude/evidence-chain.md`, CE-2 and CE-5.

## What it does

- **The researcher chooses the decisions a recommendation serves** ("Change" under "Serves" on the card),
  for generated and researcher-written recommendations. Chosen from the current decisions only, at least
  one; the recommendation is locked and what is stored compared with what the researcher saw, so a change
  made meanwhile (or by regeneration) is refused with nothing saved. Stored with origin "researcher";
  regeneration does not overwrite it. A decision since reworded starts ticked (same decision by id).
- **Trace from this objective**: the trail read from an objective down (`loadObjectiveTrail`): its brief
  passages, the coverage conclusion about it (by id), each insight the conclusion cites with the
  recommendations acting on it and the evidence beneath, and the findings planned for it (CE-6) under their
  plan line, plus current plan lines with no finding yet. Coverage never checked, or no row for this
  objective, is a break. The recommendation trail and this one now share the insight and finding builders.
- **The trail in the story deck**: an appendix with each recommendation's trail as indented lines, every
  break and caution in words, colour only repeating them. A long trail continues on further slides, never
  cut short. Recommendations left out of the deck have no trail; an unreadable trail is stated.

- **Repair found by the gates (affects the CE-5 trail already on your laptop since Batch 37):** a finding
  whose part of an insight's support changed after the insight was drafted (its figures, wording, verdict
  or the data corrections behind it) was shown in the trail with no qualification, and the insight node
  carried only the "Support changed since drafted" label without the reason. The insight node now gives
  the same sentence as its card, and each affected finding says "Support changed since drafted: ..." (or
  "no longer valid") where it stands, so a deck page that holds the finding without its insight still
  qualifies it. Found by browser journey C5 once the deck carried trails; the Word appendix passed only
  because its document is checked as one part. `evidenceTrail.db.test.ts` case fails without the repair.
  The same applies to a pre-insight written from such a finding: it carries the same qualification, so a
  deck page that holds the pre-insight line on its own is qualified too (journey C5 found the gap when that
  line fell on a separate page).
- "Trace from this objective" also works when the objective was picked from the stated list (which
  selects by wording): the trace uses the id the matching coverage row records.

## Impact checklist

1. Rules: CE-2 decisions served (`recommendationDecisions.ts` `setServedDecisions`), CE-5 trail
   (`evidenceTrail.ts`), deck appendix (`evidenceTrailSlides.ts`, new, registry row updated).
2. Inputs: stale view, unknown key, empty choice, another project's recommendation: refused, nothing
   saved. Before 0120 choosing is refused naming the migration; before 0123 planned findings say so.
3. Persistence: `setServedDecisions` locks the recommendation (run and tenant on the lock), compares the
   stored list, replaces it in one transaction; an identical choice changes nothing.
4. Freshness: the trail and cards show "chosen by the researcher"; reworded and gone decisions qualified
   as in Batch 40.
5. Screens: "Saved" only after the action returns; the objective trail is opened by id, so switching
   objectives cannot show another's; a late answer for another subject is dropped.
6. Proof: `recommendationDecisions.db.test.ts` (choice case), `evidenceTrail.db.test.ts` (two objective
   cases), `objectiveReview.db.test.ts` (deck through the real route and database, fails without the
   wiring), `evidenceTrailSlides.test.ts` (pagination keeps every line whole), `evidence-trail.check.mjs`
   (objective trace and chooser in the browser); deck rendered with LibreOffice and inspected.

## Gates

Batches 41 to 46 form one straight stack on Batch 44 and are applied together, so the full gates
were run on the top of the stack (Batch 46, worktree `878cd00`) and the library on each batch's own top:

- Top of the stack: `npx tsc --noEmit` passed; `npx eslint src e2e --quiet` 0 errors;
  `python3 scripts/crosstab_selftest.py` all checks passed;
  `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks` 258 files, 1,908 passed, 82 skipped;
  `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1` 124 passed, 1 skipped, 1 failed;
  `npx playwright test` (smoke) 1 passed.
- The one browser failure was in the new `codebook-waves` check, not the app: it looked for the
  questionnaire line on the data file's Preview tab, while the app shows it on the Labels and
  documentation tab (as `import-file-detail` already reads it). The check now opens that tab; rerun on
  the same stack: 1 passed. The full browser suite will be rerun on Batch 47, which sits on top.
- Each batch's own top, library and typecheck: Batch 41 251 files, 1,874 passed; Batch 42 252 files,
  1,880 passed; Batch 43 254 files, 1,891 passed; Batch 45 254 files, 1,894 passed (all with tsc and lint
  passing, 78 or 79 skipped).
- Real infrastructure: disposable PostgreSQL 16 and local stack for the library database tests and the
  browser suite; the model is replayed from recorded fixtures (scripted model boundary) and storage is the
  local disposable store. Nothing ran against cloud Supabase.

## Limits

Links from a trail node to its table or transcript, and objective evidence in the exports, are not done.
