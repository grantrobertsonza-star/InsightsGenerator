# Batch 41 handover: CE-6, the analysis plan (27 October 2026)

Base: Batch 44 (`40276df5`). Status: implemented, ready for review. Tier A. **Migration 0123** (run
`npm run backup`, then `npx.cmd supabase migration up`). Contract: `claude/evidence-chain.md`, CE-6;
rule owner `src/lib/analysisPlan.ts` (registry row added).

## What it does

- The analysis plan is the objective evidence questions already written for each objective and decision
  (no second plan store). The plan is written with the project's stated methodology in the instructions,
  and the generation records whether it was stated (with a sha of its text), none was stated, or it was
  never read. A plan written before the methodology changed, or before it was recorded, says so.
- The researcher approves plan lines one by one, at a wording revision. An edit makes an approved line
  "changed since approval"; excluding withdraws approval; an excluded line cannot be approved; a stale
  revision refuses the whole call and saves nothing. Approved lines are kept when the plan is rewritten.
  Approval is acceptance only: who wrote the wording stays in `source`.
- "Add approved tables to Cross tabs" moves each approved line's evidence table into the Cross tabs drafts,
  recording the line on the table (`plan_evidence_id` and a `plan_line` snapshot). Safe to repeat.
- Every finding has a route: planned, discovered, stated, or unknown when the plan record cannot be read
  (never "discovered" by default). Shown as a chip on findings, in the findings export (Route, Plan line)
  and in the evidence trail (a plan line node under the finding).

## Impact checklist

1. Rule: new rule (analysis plan and finding route), owner `analysisPlan.ts`; objective evidence stays the
   owner of the questions (`objectiveEvidence.ts`).
2. Inputs: before 0123, approval reads "unknown", approving and moving are refused naming the migration,
   routes read "unknown". Methodology "not read" is never shown as "none stated". A malformed plan_line is
   treated as no plan line, so the route is unknown or discovered by the same rule, not planned.
3. Persistence: approval locks the line (`for update`, run and tenant checked on the write) and compares
   the revision shown; moving tables runs in one transaction per call, ownership checked on each update;
   repeat calls move nothing twice.
4. Freshness: an edited line loses its approval; a plan written for an earlier methodology is qualified;
   the route snapshot survives the line being edited or removed. Human wording, edits and exclusions are
   kept on regeneration.
5. Screens: approve and withdraw show the result only after the action returns; failures shown in place.
6. Proof: `analysisPlan.db.test.ts` (6 cases, real database and engine), the trail's planned-finding case
   in `evidenceTrail.db.test.ts`, `e2e/ui/analysis-plan.check.mjs` (screenshots supplied).

## Files

Migration `supabase/migrations/0123_analysis_plan.sql`; `src/lib/analysisPlan.ts` (new),
`objectiveEvidence.ts`, `objectiveEvidenceActions.ts`, `evidenceTrail.ts`; screens `ObjectiveEvidence.tsx`,
`FindingsTable.tsx`, `EvidenceTrailDialog.tsx`, `page.tsx`; findings export route; tests and fakes listed in
the package.

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

Checking discovered and stated findings against the objectives one by one is not done (coverage does it at
the insight level, CE-1). The plan is not yet its own exportable document.
