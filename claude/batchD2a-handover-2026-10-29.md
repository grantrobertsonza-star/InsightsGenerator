# Batch D2a handover: dashboard configuration, raw-file recognition, D1-F01 (29 October 2026)

Status: **implemented, ready for independent review.** Tier A (engine reader, persistence, migrations 0131 and
0132). Not wired to a screen yet (D3). Base: laptop `c58372886cc0af7cbde9bec647749e36fdc3496c`.

## Findings and requests

- **D1-F01 (Codex, S2 before integration):** a 1 to 10 or 6 to 10 recommend scale was offered as 0 to 10. Fixed:
  the recogniser uses `isZeroToTenScale` (new export of `src/lib/descriptiveFindings.ts`, the exact predicate
  `computeNps` already used, now shared): eleven or more answer codes below the non-answer codes, including 0 and
  10. A list labelling only some points (0 and 10 among them) is asked about ("csm:recommend-scale:<name>"); in a
  raw file the wording must state "0 to 10"; no endpoint is inferred. `computeNps` behaviour is unchanged (same
  predicate, moved).
- **Grant, 29 October:** settings per programme; weighted by default when the file has a weight; inputs are
  mostly raw files (SPSS, Excel, text, R, Python), a JSON codebook is unlikely.

## Changed behaviour

1. **Codebook reader** (`api/parse-stats-file.py`): keeps question number, question type and MR set columns by
   header name (a question column only when its cells are short codes; an unknown type kept as written, never
   mapped). A column headed universe, filter, base, asked of, routing, condition, derivation, selected value or
   unit is never the answer list (Grant's tracker codebooks: attribute items had read "aware_b01=1" as an answer,
   and "All eligible respondents" as a note). A JSON codebook's separate `labels` list gives answers.
   Stored in `instrument_items.question_meta` (migration 0131); before it the read reports "not saved: needs
   migration 0131" on the codebook card and everything else is unchanged.
2. **Engine action `value_labels`**: every variable's answer labels after the overlay, by the engine's own rule.
   Worker protocol 6.
3. **Recogniser input** (`src/lib/trackerInput.ts`, `trackerRoleVariables.ts`): dictionary + answer labels +
   strongest confirmed codebook question fields; reader sets give the question group by name stem; short lists
   of repeated text answers are categories. The default weight is `defaultWeight`.
4. **Raw files** (`src/lib/trackerNameFamilies.ts`, `trackerRoles.ts`): brands from the item list shared by the
   most families of names; grids from families named after one brand; lists of their own; new stages trial and
   frequent use; CSM roles from names and stated scales; a file whose brands are only numbered asks for the
   codebook. Contract: `claude/tracker-roles.md` rules 8 to 12.
5. **Dashboard choices** (`trackerDashboard.ts` pure, `trackerDashboards.ts` persistence,
   `trackerDashboardActions.ts` server actions; migration 0132 `tracker_dashboards`): per programme (or project),
   compare-and-swap on `revision`, checked on the server, carried by identity, Reset to suggested keeps the old
   choices. Contract: `claude/d2-design-2026-10-29.md`.

## Impact checklist

- Rule owners: registry rows added (tracker roles extended; recogniser input; codebook question fields; dashboard
  configuration). `isZeroToTenScale` is the one 0 to 10 rule.
- Inputs: a failed dictionary, set-up, file, overlay or confirmed-link read refuses (never an empty role list);
  unknown codebook type kept as written; a brand list is never guessed from numbered names.
- Persistence: one transaction per save; project row locked (`for update`), file checked in the run, tenant on
  every statement and RLS; revision compare-and-swap; first save `on conflict do nothing` against the scope's
  unique index; a refused save returns current revision and choices and writes nothing.
- Freshness: nothing derived yet consumes the choices (D3). Codebook rereads update `question_meta` with the item.
- Screens: none yet beyond the codebook card's read message.

## Files

Engine: `api/parse-stats-file.py`, `scripts/parse_stats_local.py`, `scripts/parse_stats_worker.py`,
`scripts/crosstab_selftest.py`. Library: `src/lib/instruments.ts`, `instrumentActions.ts`, `parseStatsFile.ts`,
`descriptiveFindings.ts`, `trackerRoles.ts`, new `trackerNameFamilies.ts`, `trackerRoleVariables.ts`,
`trackerInput.ts`, `trackerDashboard.ts`, `trackerDashboards.ts`, `trackerDashboardActions.ts`. Screen:
`src/app/runs/[id]/InstrumentCard.tsx` (message only). Migrations: `0131_codebook_question_meta.sql`,
`0132_tracker_dashboards.sql`. Tests: `trackerRoles.test.ts` (+6 D1-F01), `trackerRolesRaw.test.ts`,
`trackerDashboard.test.ts`, `trackerInput.db.test.ts`, `trackerInputPre0131.db.test.ts`,
`trackerDashboards.db.test.ts`, `trackerDashboardsPre0132.db.test.ts`. Fixtures: `fixtures/tracker-packs/bmw_car`,
`fixtures/tracker-raw`, `fixtures/indicator-data/Chart_Data_RH_ANCC_W_IRN_reference.json`. Docs:
`claude/tracker-roles.md`, `claude/d2-design-2026-10-29.md`, `claude/rules-registry.md`,
`claude/plan-auto-dashboards-2026-10-28.md` (D6), `claude/indicators-dashboard-design-handoff-2026-10-29.md`,
`docs/design/Unified_Indicators_Visual_Plan-2026-10-29.pdf`.

## Checks

All on the tested tree `7c4d6bcc` (worktree b84), real disposable PostgreSQL 16:
- `npx tsc --noEmit -p .`: clean. `npx eslint src e2e --quiet`: clean.
- `python3 scripts/crosstab_selftest.py`: all checks passed (six new "D2" checks).
- `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 310 files passed, 2 skipped; 2,358 tests
  passed, 91 skipped, 0 failed.
- Disposable stack, `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 140 passed, 1 skipped
  (27.7 minutes). Smoke `npx playwright test`: 1 passed.
- Documents added after the gates (no code): this handover, the decisions record, the D6 multi-indicator design
  files, the security backlog, the status file.

Shown failing without the change: the codebook DB tests fail on the original engine reader (question fields null);
the dashboard DB tests fail (4 of 7) with the revision check removed; the D1-F01 tests fail (4 of 6) with the
old top-only predicate. Real disposable PostgreSQL and the real engine throughout; storage is an in-memory
stand-in; the model is stubbed and asserted never called.

## Migrations

Apply after a backup, in order: **0131** (`instrument_items.question_meta`, additive, check constraint) and
**0132** (`tracker_dashboards`, additive, RLS). Verify:
`select column_name from information_schema.columns where table_name='instrument_items' and column_name='question_meta';`
`select to_regclass('tracker_dashboards');`
Before them: codebooks read as before (fields not saved, card says so); dashboard choices cannot be saved.

## Limits

Not wired to a screen (D3). Names separated other than by "_" are not read as families; the mobile and channel
CSM packs are not in the tests; a code like "m1" used for two different lists has no label (it is then not
taken as a brand). Deleting a programme deletes its dashboard choices. Why D1 tests missed D1-F01: they only had
genuine 0 to 10 lists; negative scale controls are now in the suite.
