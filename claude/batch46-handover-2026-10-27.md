# Batch 46 handover: waves in one project, programs, where a project opens (27 October 2026)

Base: Batch 45. Status: implemented, ready for review. Tier A. **Migration 0124**
(`0124_wave_study_independence.sql`: run `npm run backup`, then `npx.cmd supabase migration up`).
Contract: `claude/waves.md`; registry rows added.

## What it does

Agreed with Grant: one study is one project, and its waves are data files added to it.

**Waves**
- Each wave's set-up (Import data) gains a fieldwork month and "Include this wave in wave tracking". Both
  are saved with the set-up's compare-and-swap.
- `projectWaves` (`waves.ts`) is the one place that orders them: by fieldwork date when every included
  wave has one, otherwise by upload with a note naming the undated waves. A label is never parsed.
- Wave tracking uses the included waves and shows the order basis and the waves left out.
- Cross tabs lists files as "Wave N: file" and opens the latest wave when none was used last.
- A finding names its wave, on the Findings list and in its source line (trail, exports). The findings
  spreadsheet has a Wave column.

**Waves count as one source (migration 0124).** `finding_evidence_key` keys every finding from a labelled
wave file as the project's study. An insight resting on two waves of one tracker is one source: the
result holding over time, not independent confirmation. The back-fill lowers existing counts and tiers
(never raises them) and traces each tier change.

**Programs** can be renamed and deleted. Deleting unlinks the projects and keeps them with their data, in
one transaction scoped to the tenant. The page explains that waves belong in one project.

**Where a project opens.** Always on a new Project overview: the four stages with state and headline, and
the next step. A `?section=` link and a reload of the page still open their section. Opening from the
dashboard is not a reload.

## Impact checklist

1. Rules: new owners `waves.ts`, `programs.ts`, SQL `finding_evidence_key` (0124), `RunShell`
   `reloadOfThisPage`.
2. Inputs:
   - an invalid fieldwork date is "not given";
   - a set-up saved before reads as undated and included;
   - an overview whose status cannot be read says so.
3. Persistence:
   - set-up saves keep their compare-and-swap;
   - program delete locks the program, unlinks and deletes in one transaction, tenant-scoped on every
     write;
   - the migration back-fill is lower-only and idempotent.
4. Freshness:
   - stored confidence falls where waves were counted twice, traced;
   - a later label change applies at the next synthesis.
5. Screens:
   - program rename and delete show the result only after the server answers;
   - a delete asks once, in place.
6. Proof:
   - `projectWaves.test.ts`, `projectWaves.db.test.ts` (real save and list);
   - `waveStudyIndependence.db.test.ts` (key and back-fill, rerun changes nothing);
   - `programs.db.test.ts` (rename, delete keeps the project, another tenant untouched);
   - `crosstabEntry.test.ts`;
   - browser checks `waves-in-project`, `program-controls`, `project-opens-overview`.

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

Not done:
- pooling waves into one table;
- choosing a subset of waves inside Cross tabs (one file at a time, as before);
- "holds across N waves" on insights.

A wave label added later changes counts only at the next synthesis.
