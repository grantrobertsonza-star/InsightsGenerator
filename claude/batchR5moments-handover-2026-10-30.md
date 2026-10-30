# Batch R5moments handover (30 October 2026)

Status: **implemented, ready for independent review.** Page 02 "Moments & needs" of the brand tracking dashboard:
the "Moment profile" view of the moment by brand card and the "Moment reach" card (Grant's approved design, 30
October 2026). Branch `claude/r5moments`. Local history (laptop worktree `/home/claude/b118`, base `b3e230f`):
`b22a42f` (feature, engine row item, contracts, tests, browser check) and `256228d` (Codex reference comparison,
contract and registry references, this handover). On GitHub that work is the checkpoint `6ad110a` (laptop tree at
`256228d` on top of the cloud snapshot `6e42ca0`), followed by the cloud close-out commits listed under "Cloud
close-out" below. No migration. Tier A (engine `api/parse-stats-file.py`, loaders in `src/lib`, server
actions) with tier B screens.

## What the researcher sees

- **Moment by brand card** gets a toggle "Recall table" | "Moment profile". "Recall table" is today's card and the
  default. "Moment profile": for each brand, among respondents aware of that brand, the share linking the brand to
  each moment. Moments: all (default), the six most relevant, or a chosen set; the x axis ordered by category
  relevance (unrounded, by moment identity; unknown relevance last; the grid's order, said, when relevance is not
  available). Up to five brands: the client's brand first, thicker and blue, always shown; the others from page 02's
  Compare selection; at five the other brand buttons are disabled with the reason. Dots joined by straight segments
  (no smoothing); an n/a value has no dot and breaks the line. Value and base on hover and keyboard focus; the figures
  as an accessible table; each drawn brand's aware base (and effective base when weighted) listed under the chart.
  The view is remembered per browser and per data file (localStorage in try/catch; the card works without it).
  The word "fingerprint" is not used.
- **Moment reach card** (our name; "Brand Moment Strength" is not used): per brand, moments per person, moment
  penetration, moments per linker and share of moment links. Ranked horizontal bars of moments per person by default,
  a toggle to rank by any of the four, a one-line headline for the client's brand (form: "Toyota: 1.8 moments per person,
  4th of 10; linked to at least one moment by 42%"; rank from unrounded values), a note that moments per person =
  penetration x moments per linker, the respondents left out of a brand's base when there are any (no moment
  answered, some unanswered), and the four measures with bases in an accessible table.

## Impact checklist

1. **Rule.** Two new rules with registry rows and contracts: "A tracker dashboard's Moment profile" and "A tracker
   dashboard's Moment reach" (`claude/rules-registry.md`; contracts `claude/d2-design-2026-10-29.md`, D3c, "Moment
   profile" and "Moment reach", where the research sources are cited, in the contract only; the screen names the
   measures in plain words).
   Owners reused, never a second version: the aware-base rule of page 03
   (`trackerAssociations.awarenessForBases`, `awareBrandTables`, `associationCellsFromResult`, `gridVarsOf`; the D3d
   row now names page 02 as a second user), the selected code (`trackerFigures.selectedAnswerOf`), category relevance
   order and the six most relevant (`trackerMoments.RECALL_MOMENTS`), `computeCrosstab`. New engine row item
   `linkCount` (`api/parse-stats-file.py`, `crosstab`): per respondent the count of selected links, weighted, in one
   table for all brands.
2. **Inputs.** Awareness unmapped or claimed twice: profile "Mapping needed", never all respondents (reach needs no
   awareness and is unaffected). No moments grid or no brand list: "Not measured". A brand whose awareness was not
   asked, whose aware code cannot be told, or nobody is aware of: n/a with the reason. Unweighted base under 10:
   suppressed with the base shown (profile cell; reach (1) and (2)); fewer than 10 linkers: (3) suppressed. A blank,
   declared missing or don't know link: outside that profile cell's base; for reach, the respondent's count is
   unknown, so they are outside that brand's base and counted apart ("no moment answered", "some unanswered"), never
   "not linked". A brand nobody links: (1) and (2) a known 0, (3) n/a ("Nobody links this brand to a moment"). Share
   of moment links: over the full brand list; withheld for every brand, with the reason, when any brand's count is
   unknown or the bases differ (never a partial sum). A file that cannot be read: the loader rejects with the reason
   and the card shows it with "Try again", never an empty profile.
3. **Persistence.** None. Both loaders compute through the engine without saving a table (the db test asserts the
   `document_tables` count is unchanged); the server actions re-check run ownership (`runAccessible`) before
   loading. The remembered view is a per-browser convenience only.
4. **Freshness.** No derived result (findings, insights, recommendations, narratives, exports) reads these figures;
   they are recomputed from the current file and the dashboard's current choices (weight, awareness mapping) on each
   view.
5. **Screens.** Late responses: a request is tagged with its data file; an answer for an earlier file never replaces
   the newer file's profile (mounted test). Switching file re-reads the remembered view for that file. Loading,
   failure with "Try again", and the toggle are explicit states. Nothing is saved, so no "saved" state.
6. **Proof.** Below. The engine fix in `b22a42f` (a filtered weighted 100% share made the standard error's sqrt fail
   the whole table): the repro from `scripts/crosstab_selftest.py` against the base engine (`b3e230f`) prints
   "FAILED: math domain error", against this branch "built; 100% answer present: True". The `linkCount` self-test
   cases fail on the base engine with `KeyError: 'linkCount'` (the item did not exist).

## Independent references

- **Our pandas reference** (`src/lib/__tests__/helpers/moment_profile_reference.py`, written from the pack's
  specification and the D3c contracts, not from the app): `trackerMomentProfile.db.test.ts`, values to 1e-6.
- **Codex's independent reference** (read-only task of 30 October 2026, `bmw-independent-reference.json`, computed from
  the raw BMW wave CSVs without reading the app; the moment measures extracted unchanged, with source hashes and
  method text, into `fixtures/tracker-packs/bmw_car/codex_moment_reference_w1_w2.json`):
  `trackerMomentCodexReference.db.test.ts`, through the actual loaders on the labelled SPSS files of waves 1 and 2,
  weighted and unweighted: all 120 profile values and bases, every aware base, and every brand's four reach measures,
  eligible base, linker count and effective base, 330 values per wave and weighting.
  Stated tolerances: percentages and moments per person or per linker 1e-6 absolute; bases and linker counts exact;
  Kish effective bases 0.05.
- **Disagreement, with evidence, not adjusted away:** none in the measures. The first run used 1e-6 relative for the
  effective bases and failed: the app gave 916.4 for Toyota's wave 1 aware base where Codex gives 916.3746 (wave 2:
  915.1 vs 915.0683). Cause: the engine reports every effective base rounded to one decimal place
  (`api/parse-stats-file.py`, `"nEff": round(n_eff, 1)`), a display precision, not a different method. The tolerance
  was set to half that unit (0.05) and the reason written in the test; every effective base then agrees within it.
- **The two references against each other** (scratch comparison): all 160 compared values per wave and weighting
  agree to 1.4e-14, with no base mismatch.

## Files

Commit `b22a42f`:
- Engine: `api/parse-stats-file.py` (`linkCount` row item; the filtered 100% share fix); `scripts/crosstab_selftest.py`
  ("moment reach" hand-computed cases and the 100% share repro).
- Loaders and rules: `src/lib/trackerMomentProfile.ts` (new), `src/lib/trackerMomentReach.ts` (new),
  `src/lib/trackerAssociations.ts` (aware-base rule factored into `awarenessForBases`, `awareBrandTables` for reuse;
  page 03 behaviour unchanged), `src/lib/parseStatsFile.ts` (the `linkCount` item and result types),
  `src/lib/trackerDashboardActions.ts` (`loadMomentProfileAction`, `loadMomentReachAction`).
- Display rules: `src/lib/momentProfileView.ts` (new).
- Screens: `src/app/runs/[id]/MomentProfileView.tsx` (new), `src/app/runs/[id]/MomentReachCard.tsx` (new),
  `src/app/runs/[id]/TrackerDashboardPanel.tsx` (the toggle on the moment by brand card; the reach card on page 02).
- Tests: `src/lib/__tests__/trackerMomentProfile.db.test.ts`, `src/lib/__tests__/momentProfileView.test.ts`,
  `src/lib/__tests__/momentProfileView.test.tsx`, `src/lib/__tests__/helpers/moment_profile_reference.py`,
  `e2e/ui/tracker-moment-profile.check.mjs`.
- Contracts: `claude/d2-design-2026-10-29.md` (D3c Moment profile, Moment reach; D3d computation owner note),
  `claude/rules-registry.md` (two new rows; D3d row names the shared owner).

`256228d`:
- `src/lib/__tests__/trackerMomentCodexReference.db.test.ts` (new), `fixtures/tracker-packs/bmw_car/codex_moment_reference_w1_w2.json`
  (new), `claude/d2-design-2026-10-29.md` and `claude/rules-registry.md` (the second reference cited),
  this handover.

Callers and consumers checked: `TrackerDashboardPanel` (only caller of both cards), page 03
(`loadBrandAssociations`, through the refactored owner; its db test is in the library run below), the Cross tab
engine's other row items (self-test).

## Cloud close-out (30 October 2026)

What was missing at the checkpoint and was done in the cloud worktree:

- **Tests added** (`src/lib/__tests__/momentProfileView.test.tsx`, mounted): the Moment profile when the load throws
  (the reason and "Try again", no lines and no table, "Try again" draws the five lines); the Moment reach card when
  the load is refused (`ok: false`: the reason and "Try again", no bars, "Try again" recovers); and the reach card's
  late answer: switching from file A to B with A's answer arriving last keeps B's figures. Shown failing without the
  guard: with the `id !== latest.current` check removed from the reach card's success path, the late-answer test
  fails (1 failed, 7 passed) and passes again once restored.
- **Browser check repaired** (`e2e/ui/tracker-moment-profile.check.mjs`): its first run failed at the reach headline
  ("No client brand is set, so there is no headline."). The check created its project without "BMW" in the name, so
  no client brand was pre-filled; the card was right and the check was wrong. It now names the project as
  `tracker-associations.check.mjs` does, asserts the client's brand (BMW, code 8) is one of the five lines, and
  asserts the whole headline against the reference (value to one decimal, rank by unrounded moments per person,
  penetration rounded): "BMW: 1.9 moments per person, 4th of 10; linked to at least one moment by 77%".
  Why the tests missed it: the mounted test sets a client brand itself, and the browser check had never been run.
- **Citations:** the research sources (Romaniuk and Sharp) are now named in the contract only
  (`claude/d2-design-2026-10-29.md`, D3c "Moment reach"); the registry row and the header comment of
  `src/lib/trackerMomentReach.ts` point to the contract instead.
- **Housekeeping:** the checkpoint had committed the disposable stack's output folder `e2e-results-r5mom/` (synthetic
  account passwords and grants of a stack that no longer exists); it is removed from git and `/e2e-results-*/` added to
  `.gitignore`. The registry row and header of `e2e/ui/tracker-moments.check.mjs` record its first run.
- **Screenshots** at 1440 x 900 from the production build, written by the browser check with `SCREENSHOT_DIR`:
  `docs/screenshots/r5moments/page02-recall-table-1440.png`, `page02-moment-profile-1440.png`,
  `page02-moment-profile-card.png`, `page02-moment-reach-1440.png`, `page02-moment-reach-card.png`.

## Gates (cloud worktree, final tree)

Run on the cloud worktree `/home/claude/r5moments-own` (Node 22.22.0, Python 3 with pandas, numpy, scipy and
pyreadstat, PostgreSQL 16 on port 55432, local and disposable only), after `npm ci` and `npx next typegen`. The
container was shared with several other sessions (load average about 10 on 2 cores, little free memory, and the disk
full for a time), which is why some commands needed a heap cap or a second attempt; no result below is from a run that
hit a dead database or a full disk.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `NODE_OPTIONS=--max-old-space-size=1800 npx tsc --noEmit` | exit 0 (earlier attempts without the cap were killed for memory, exit 137) |
| Lint | `NODE_OPTIONS=--max-old-space-size=1200 npx eslint src e2e --quiet` | exit 0, 0 errors; the four files changed afterwards linted again, exit 0 |
| Engine self-test | `python3 scripts/crosstab_selftest.py` | 564 PASS, 0 FAIL, "All checks passed" (includes the "moment reach" cases and the filtered 100% share repro) |
| Library | `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run src/lib/__tests__ --pool=forks` | Test files 372 passed, 3 failed, 2 skipped (377); tests 2863 passed, 0 failed, 92 skipped (2955); 4005 s |
| Library, the 3 failed files again | same command with `dictionaryCacheUpgrade.db.test.ts objectiveEvidenceReference.db.test.ts tenantIsolation.db.test.ts` | 3 files passed; 14 tests passed, 2 skipped |
| Production build | `next build --webpack` with the disposable stack's public values (`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:39457`, the font mock, a disposable migrated database) | exit 0 |
| Browser, this feature | `SCREENSHOT_DIR=docs/screenshots/r5moments GOLDEN_SMOKE_TARGET_MANIFEST=e2e-results/target-manifest.json npx playwright test -c e2e/ui/ui-check.config.mjs --workers=1 e2e/ui/tracker-moment-profile.check.mjs`, stack `E2E_NEXT_START=<worktree> E2E_STORAGE_PORT=39457 E2E_APP_PORT=3457 node scripts/e2e/local-stack.mjs` | 1 passed (2.8 min) |
| Browser, page 02 recall | the same with `e2e/ui/tracker-moments.check.mjs` | 1 passed (2.6 min), its first run |

The 3 failed library files failed in a setup or clean-up hook ("Hook timed out in 10000ms"), not in a test: every one
of their tests that ran passed, they touch nothing in this batch, and run on their own they pass. Recorded as a failed
full-suite run, not explained away: a clean single full run on an unloaded machine is still to be done.

Feature tests inside the library run: `trackerMomentProfile.db.test.ts` 6 passed, `trackerMomentCodexReference.db.test.ts`
4 passed, `momentProfileView.test.ts` 16 passed, `momentProfileView.test.tsx` 8 passed (3 new), `trackerMoments.db.test.ts`
5 passed, `trackerMoments.test.ts` 15 passed.

Before the browser checks passed, two runs failed for the environment, not the app: one when the disk filled
(ENOSPC from the stack and Playwright), one when an orphaned server of the first stack still held the port and the
machine was overloaded (the Analytics file choice did not settle within the check's 2 minute retry; one browser page
crashed). Disposable databases and roles of every stack started here were dropped and checked gone.

## Mocks and real

Real: disposable PostgreSQL per db test file, the Python engine, the BMW pack files, both independent references,
and, for the browser check, a production build (`next start`) on the disposable stack (non-owner application role,
storage stand-in, model replay). Mocked or stand-ins in the db tests: object storage (in-memory), the request context,
the model client (stubbed, never called), `revalidatePath` and `after`. The mounted tests mock the two server actions
(the loaders are covered by the db tests).

## Limits

- No significance test between brands or moments in either view (said on screen); the share of moment links is
  withheld rather than computed over a partial brand set.
- The six most relevant moments follow the recall table's count (`RECALL_MOMENTS`); a chosen moment set is not saved
  across browsers.
- The Codex reference covers the BMW pack only (waves 1 and 2, every respondent eligible, no blanks); the blank,
  small-base, nobody-links and unmapped-awareness cases rest on our own pandas reference and the boundary variants.
- Effective bases are compared to the engine's one-decimal reporting precision.
- The x axis labels of the Moment profile are rotated and truncated; at 1440 wide the first label is clipped at the
  chart's left edge (visible in `page02-moment-profile-1440.png`). The full wording is in each label's tooltip and the
  table. Not changed here.
- The headline's rank counts every listed brand with a known value; ties keep the brand list's order.
- Not run: the full browser suite and the smoke suite (only the two page 02 checks were run).
