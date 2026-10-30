# Batch R5moments handover (30 October 2026)

Status: **implemented, ready for independent review.** Page 02 "Moments & needs" of the brand tracking dashboard:
the "Moment profile" view of the moment by brand card and the "Moment reach" card (Grant's approved design, 30
October 2026). Branch `r5moments`, base `b3e230f`, worktree `/home/claude/b118`. Commits: `b22a42f` (feature, engine
row item, contracts, tests, browser check) and COMMIT_2 (Codex reference comparison, contract and registry
references, this handover). No migration. Tier A (engine `api/parse-stats-file.py`, loaders in `src/lib`, server
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
   profile" and "Moment reach", where Romaniuk and Sharp are cited; the screen names the measures in plain words).
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

COMMIT_2:
- `src/lib/__tests__/trackerMomentCodexReference.db.test.ts` (new), `fixtures/tracker-packs/bmw_car/codex_moment_reference_w1_w2.json`
  (new), `claude/d2-design-2026-10-29.md` and `claude/rules-registry.md` (the second reference cited),
  this handover.

Callers and consumers checked: `TrackerDashboardPanel` (only caller of both cards), page 03
(`loadBrandAssociations`, through the refactored owner; its db test is in the library run below), the Cross tab
engine's other row items (self-test).

## Gates (worktree b118)

GATES_PLACEHOLDER

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
- Not run: the full browser suite and the smoke suite.
