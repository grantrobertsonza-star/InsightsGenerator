# Batch D3aR2: handover (29 October 2026)

Status: implemented, ready for independent review. On top of `755e3c4d` (BatchD3aR). Repairs the two findings of
`docs/independent-d3ar-review-2026-10-29.md`. Tier A (dashboard figures).

## D3AR-F01: a non-answer below code 90 moved the scale and halved the box (S2)

- **Before.** `scaleTop` takes the highest labelled code below 90. On "Overall satisfaction (1 to 5)" with
  6 = Dont know it returned 6, so the box asked for codes 5 and 6. The engine had already dropped 6 as a
  non-answer, so only code 5 counted: 20% instead of 40%.
- **Rule owner used.** The engine's answer domain (`_non_answer_codes`, `claude/answer-domain.md`). No second
  non-answer pattern is added.
- **Change.** `boxScaleTop` (`src/lib/trackerCsmFigures.ts`):
  - For a question with an answer list, the top of the scale is the highest code in the engine's own distribution
    of that question. The engine keeps every declared answer, chosen or not (a declared 5 nobody chose is a 0%
    row), and drops non-answers. So the top is the scale's, never a non-answer's, and never just the highest
    answer a wave happened to hold.
  - Without an answer list, the range the wording or name states (`scaleTop`, unchanged). With neither, the tile
    is failed with the existing reason.
  - The box tile now reads the distribution first, then fixes its codes.
- **Unchanged.** `scaleTop` itself (its comment now says the dashboard box uses `boxScaleTop`). The explicit-scale
  and unknown-scale behaviour.

## D3AR-F02: a partial {0: No} label with codes 0 and 2 invented code 1 and showed 0% (S2)

- **Change.** The lone-No inference in `selectedCode` (`src/lib/trackerFigures.ts`) applies only when every
  observed code is 0 or 1.
- **Contradictory or unresolved codes.** Labels {0: No} with codes 0 and 2 give no selected code. The figure is
  unavailable with the existing reason, never 0%.
- **Kept.** {0: No} with codes 0 and 1, or only 0, still selects 1. Explicit labels, including reversed ones,
  are unchanged.

## Freshness

Nothing is stored: dashboard figures are computed on each load ("compute"). A reload shows the corrected figure.
No migration.

## Tests (each shown failing without its change)

| Test | Result | Without the change |
|---|---|---|
| `trackerCsmFigures.db.test.ts` "Codex D3AR-F01" (actual engine, real database, a generated .sav: 1 to 5 plus 6 = Dont know; 0 to 10 plus 11 = Refused; a weighted case) | passes: 40%; switching 30/110 = 27.27%; weighted 50% | fails (20 instead of 40) |
| `trackerD3aRepairs.test.ts` D3AR-F01 unit cases (declared unused top, stated range, unstated scale) and D3AR-F02 ({0: No} with 0/2, 0/1, only 0; reversed explicit labels; the figure path through `sharesFromResult` giving no share with the reason) | 18 passed | 2 failed |
| Affected tracker and CSM suites (12 files) | 126 passed | |

## Why the earlier tests missed them

The scale tests used 98/99 non-answers, which the below-90 cutoff removes anyway, and no 6/7 or 11 non-answer
next to the scale. The selection tests had no observed codes that contradicted a partial label. Both families now
include those cases.

## Limits

- A labelled question whose engine distribution is empty gives no scale top, so the tile fails with the reason.
- The box codes for each company use the all-customers scale top, so every company counts the same codes.

## Gates (tree `94dc80f`, laptop code plus D3aR2)

- `npx tsc --noEmit`: passed. `npx eslint src e2e --quiet`: 0 errors. `python3 scripts/crosstab_selftest.py`: all
  passed.
- Library: `TEST_DATABASE_URL=... npx vitest run src/lib/__tests__ --pool=forks`: 316 files, 2,413 passed, 91
  skipped, 0 failed, no errors.
  - The first run reported one unhandled rejection: `instrumentScope.db.test.ts` test 3 raced a confirmation
    against a codebook removal, and the refusal could arrive before the assertion was attached.
  - The test now settles the refusal at once (`94dc80f`). The counts above are from the rerun.
- Browser: `npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1`: 143 passed, 1 skipped, 1 failed.
  - The failure is `waves-in-project.check.mjs`. A wave label typed into a newly imported file was refused as
    "changed elsewhere" while the file's first-view acceptance was saving.
  - That is a race in the Setup form, not D3aR2 code. It passed in D3aR's run and failed only under load.
  - It is repaired in the next package.
- Smoke: `npx playwright test`: 1 passed.
- Real disposable PostgreSQL and the actual Python engine. Storage and the model are stand-ins.
