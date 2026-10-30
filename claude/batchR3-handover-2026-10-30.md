# Batch R3: handover (30 October 2026)

Status: implemented, ready for independent review. Branch `r3bh` (worktree b107), from `55bcfa5` (on top of the
security packages). Tier A (calculation, persistence, the NPS calculation owner); the loyalty card change is tier B.
Not pushed, not deployed, no live database or storage touched.

Repairs three findings from Codex's independent reviews: D3E-F01 (`docs/independent-d3e-review-2026-10-30.md`, high),
BH-F01 and BH-F02 (`docs/independent-d3c-review-2026-10-30.md`, medium). D6-F01 and D6-F02 from the D3e review are
not in this batch.

Commits (one per finding, code, tests and docs together):

| Finding | Commit |
|---|---|
| D3E-F01 | `07a2aeea351ae95a04edcff32e583f70c6ae08e3` |
| BH-F01 | `b1493da570e6a49c690f222b32a7a532ea7c3ef1` |
| BH-F02 | `bd498739b9040c3fc16650e43501c72d82a44bfa` |
| This handover | the commit after `bd49873` |

## D3E-F01: unknown awareness became Unaware (high)

**What changed.** `womFromResult` (`src/lib/trackerAdvertising.ts`) counted every awareness code that was not the aware
code as Unaware. Awareness codes are now sorted by a new owner beside `selectedCode`, `trackerFigures.answerSides`:

- aware: `selectedCode` (unchanged);
- explicitly not aware: a code whose label is the opposite of selected ("No", "Not selected", "Not mentioned", ...,
  the pattern `selectedCode` already used, now one constant `NOT_SELECTED_LABEL`), or code 0 of an unlabelled
  variable holding only 0 and 1;
- unknown: everything else, with its kind: a non-answer label by the engine's rule (`nonAnswerLabel.isNonAnswerLabel`,
  don't know, refused, ...; no new regex), a code the answer list does not label, or any other label.

Unaware is now the weighted sum of the explicitly not aware codes only. When anyone gave an unknown awareness answer,
that brand's exclusive-group bar is withheld (`groups: null`) with the reason and each answer's count, for example:
`10 respondents gave an awareness answer that is neither aware nor unaware ("Dont know" (code 99): 10 respondents).
They cannot be counted as Unaware, so the exclusive groups are not shown.` A listed unknown code nobody gave changes
nothing. The exclusivity check now reads each banner column as aware or explicitly not aware; any other non-empty
column is refused. The page already lists a withheld brand's reason under the card ("n/a: ..."), so the screen is
unchanged. Missing awareness (respondents without an answer) was already withheld with its count and still is.

**Acceptance criteria.**

1. Classify negative awareness explicitly from the owning response-code rules: met, `answerSides` reuses
   `selectedCode` and its not selected label rule, and `nonAnswerLabel.ts` for non-answers.
2. Preserve or withhold unknowns with an explanation: met, the bar is withheld with each unknown answer and its count.
3. Check exclusivity against those categories: met, banner columns are aware or explicitly not aware; another column
   is refused.
4. Cover labelled don't know and refusal: `trackerAdvertising.test.ts` (the review's 60/30/10 example, exact reason;
   "Refused"), and the actual engine in `trackerAdvertising.db.test.ts` (code 99 labelled Don't know in the codebook).
5. An unexpected unlabelled code: pure test (code 7) and actual engine (code 99 with the pack's own codebook).
6. Missing awareness: pure test (10 respondents without an answer, withheld with the count).
7. Normal 0/1: pure test, labelled and unlabelled.
8. Reversed explicit coding: pure test ({0: Yes, 1: No}), including the exclusivity check against the code labelled No.
9. Weighted counts: pure test (shares from weighted counts, n unweighted; a weighted unknown answer withheld).
10. Recovery after a corrected mapping: pure test (the same table, the codebook now labels code 7 as Not selected:
    the groups return with code 7 in Unaware). See limits for the database path.
11. Preserve the BMW reference values: met, the existing BMW wave 1 weighted and unweighted (60 groups each) and
    boundary comparisons pass unchanged; in the new variant every other brand still equals the reference (54 groups).

**Test failing before, passing after.** With `src/lib/trackerAdvertising.ts` reverted to the parent (the new
`answerSides` left in place, unused): `npx vitest run trackerAdvertising.test.ts trackerAdvertising.db.test.ts`:
6 failed, 22 passed (28). Failing: the review's example, refusal, unlabelled code, weighted counts, recovery (pure),
and the actual-engine Don't know case. The controls (0/1, reversed coding, missing awareness, a listed code nobody
gave) pass before and after, as controls should. With the change: 28 passed.

**Files.** `src/lib/trackerFigures.ts` (`answerSides`, `UnknownAnswerKind`, `NOT_SELECTED_LABEL`),
`src/lib/trackerAdvertising.ts`, `src/lib/__tests__/trackerAdvertising.test.ts`,
`src/lib/__tests__/trackerAdvertising.db.test.ts`, `src/lib/__tests__/helpers/advertising_reference.py` (variant
`aware_dk`, and `unknown_aware` per brand, written from the pack's coding, not the app), contract
`claude/d2-design-2026-10-29.md` (D3e figure table and reference values), `claude/rules-registry.md` (D3e row).

Callers checked: `womFromResult` is used only by `loadBrandAdvertising`; `selectedCode` behaviour is unchanged (the
pattern moved into a constant). The screen (`TrackerDashboardPanel.tsx`) reads `groups === null` and `reason`.

Why the tests missed it: the BMW pack codes awareness 0/1 only, and the pure tests had no third awareness code.

## BH-F01: a malformed positioning silently erased saved axes (medium)

**What changed.** `normaliseBrandHealthMapping` (`src/lib/brandHealthMetrics.ts`) now refuses a supplied `positioning`
that is not a plain object ("the positioning map is not a pair of axes"); `funnel` uses the same plain-object check
(it already refused booleans and strings but its check is now the shared one). Absent or null still read as empty; a
plain object without an axis is a valid empty choice. The save action already returned the normaliser's refusal before
any database work, and the load action already returned it as an error; both now receive the refusal.

**Acceptance criteria.**

1. Distinguish absent/null legacy and a valid empty object from a supplied boolean, number, string or array: met
   (pure and database tests: false, true, 0, 1 or 7, "", "nps_main", [], ["nps_main", "age_band"]).
2. Refuse malformed shapes before any upsert: met; database test, the stored mapping and `updated_at` are equal before
   and after every refused save (positioning and funnel).
3. Report a load error for malformed stored data: met; database test stores false, a string and an array.
4. Valid empty and legacy controls: met; absent, null, `{}` and `{xVar: null, yVar: null}` save and reload as empty
   axes, and a stored record without positioning loads as empty axes.
5. Recovery after a valid retry: met; a valid save over the unreadable stored mapping saves and reloads.
6. Existing multiple-response mappings and overlap behaviour preserved: `brandHealthSetBrand.db.test.ts` passes.
7. A plain object is not rejected because an optional axis is absent: met (`{xVar: "q5"}` reads as q5 and null).

**Test failing before, passing after.** With `src/lib/brandHealthMetrics.ts` reverted:
`npx vitest run brandHealthMappingShape.db.test.ts brandHealthSetBrand.test.ts`: 3 failed, 10 passed (13). The save
returned `{ok: true}` for `positioning: false`, and the load returned a mapping for a stored false. With the change:
13 passed.

**Files.** `src/lib/brandHealthMetrics.ts`, `src/lib/__tests__/brandHealthMappingShape.db.test.ts` (new),
`src/lib/__tests__/brandHealthSetBrand.test.ts`, `claude/brand-health.md`, `claude/rules-registry.md`.

Callers: `buildBrandHealthDashboardAction`, `saveBrandHealthModuleAction`, `loadBrandHealthModuleAction`. The screen
always sends a positioning object, so ordinary use is unchanged.

Why the tests missed it: the refusal tests covered scalar fields and lists, not the object fields.

## BH-F02: suppressed loyalty groups disappeared (medium)

**What changed.**

- The NPS calculation owner (`runNpsAction`, `src/lib/npsActions.ts`) now reports every group it cannot score in
  `unavailableSegments`: name, code, the banner column's respondents (`groupN`), the group's unweighted valid answers
  (`rawN`), their weighted sum, and the reason (`no_valid_answers` or `suppressed`). The counts are the engine's for
  that column, not derived from shares. Scored segments are unchanged; the field is optional, so saved results and
  wave segments are unaffected, and the NPS finding's stored fields are listed explicitly and do not include it.
- `loyaltyByBrand` (`src/lib/brandHealthActions.ts`) keeps every unscored group in `loyalty.unavailable` with
  `groupN`, `validAnswers` and a reason, for both brand sources: "No respondents in this brand's group.";
  "Suppressed for a small base: 6 valid answers in this brand's group."; "None of the 15 respondents in this brand's
  group gave a valid answer."; "The valid answers in this brand's group carry no weight." A suppressed group never
  carries a score.
- An empty brand-set group: the engine refuses a banner with one group, so a member nobody selected failed the whole
  loyalty card (and, for a split funnel stage, the whole dashboard). `resolveBrandSetGroups` now reads each member
  unweighted (it only needs codes, labels and whether anyone gave the selected code; an unweighted share of exactly 0
  means nobody did) and records `hasRespondents`. For an empty member no split figure is requested: its scores are
  null on a base of 0 (the existing contract) and its loyalty row says no respondents.
- The loyalty card (`BrandHealthAnalyticsPanel.tsx`) renders through a new exported `LoyaltyGroups`: the scored
  brands as before, then a "Not shown" list of each unscored brand with its reason, group n and valid answers n (our
  brand marked "(ours)"). The overlap note on the card is unchanged.

**Acceptance criteria.**

1. Suppressed or empty groups kept as explicit unavailable rows with bases and reasons: met (`loyalty.unavailable`,
   shown under "Not shown" on the card).
2. Counts and suppression reasons from the calculation owner, not from rounded shares: met (`runNpsAction`
   `unavailableSegments`; the zero-owner state from the member's own unweighted reading).
3. Fewer than ten valid answers: actual engine, BMW first 60 rows, owner set: every brand under 10 (Volkswagen 6,
   BMW 5, ...) is an unavailable row with its group and valid-answer counts, computed independently from the CSV;
   every brand appears exactly once; also the brand variable path (`main_brand`).
4. Zero owners: variant with nobody owning Haval: "No respondents", counts 0, and the dashboard still builds (an
   attribute split by the same groups gives Haval null on a base of 0).
5. Owners with no valid NPS: variant with every Toyota owner's answer blank: "None of the 15 respondents ...".
6. A calculable group: Toyota and Suzuki equal the independently computed NPS.
7. Recovery after its base grows: variant where Volkswagen's group reaches 10 valid answers: its NPS equals the
   independent value and it is no longer listed as unavailable.
8. Suppressed values stay unavailable; overlap wording preserved: unavailable rows carry no score;
   `brandHealthSetBrand.db.test.ts` (overlap note, caveat, posted finding) passes.
9. The screen shows them: mounted render of `LoyaltyGroups` (`brandHealthLoyaltyGroups.test.tsx`), plus a dashboard
   built before the change (no `unavailable`) renders as before.

**Test failing before, passing after.** With `npsActions.ts`, `brandHealthActions.ts` and the panel reverted:
`npx vitest run brandHealthLoyaltyGroups.db.test.ts brandHealthLoyaltyGroups.test.tsx`: 6 failed (6). Before the fix
only Toyota and Suzuki were returned; the zero-owner variant withheld the whole loyalty card ("owner_b10 ... needs at
least two groups to compare across"); the recovery case fails before only on the every-brand-once check (Volkswagen's
NPS itself was already right once its base reached 10); the card had no Not shown list. With the change: 6 passed.

**Files.** `src/lib/npsActions.ts` (`NpsUnavailableSegment`, `unavailableSegments`), `src/lib/brandHealthActions.ts`
(`LoyaltyUnavailable`, `loyaltyByBrand`, `loyaltyUnavailableReason`, `resolveBrandSetGroups` `hasRespondents`,
`scoreByBrand` empty member), `src/app/runs/[id]/BrandHealthAnalyticsPanel.tsx` (`LoyaltyGroups`),
`src/lib/__tests__/brandHealthLoyaltyGroups.db.test.ts` (new), `src/lib/__tests__/brandHealthLoyaltyGroups.test.tsx`
(new), `claude/brand-health.md`, `claude/rules-registry.md`.

Callers of `runNpsAction` checked: the NPS tool, CSM, wave tracking and Brand Health read `segments`, which is
unchanged; the NPS finding stores named fields only.

Why the tests missed it: the loyalty assertions looked up available brands by name and never asserted that every
brand was represented.

## Impact checklist (all three)

- Inputs: unknown awareness is withheld, never Unaware; a malformed mapping field is refused, never empty; an unscored
  loyalty group is kept with its counts and reason, never dropped or scored.
- Persistence: only BH-F01 touches a write; the refusal happens before the transaction, so nothing is written. No new
  action or write: the tenant ownership scan passes unchanged (`tenantOwnershipCoverage.test.ts`).
- Freshness: Advertising & WOM and Brand Health are calculated on open, nothing saved. A Brand Health loyalty finding
  posted earlier is unchanged (it states our brand's NPS only when ours has one, as before).
- Screens: no new requests or state; the card renders what the build returned.

## Checks run (in /home/claude/b107)

- `npx next typegen`: exit 0.
- `npx tsc --noEmit`: exit 0, no errors.
- `npx eslint src e2e --quiet`: exit 0, 0 errors.
- `python3 scripts/crosstab_selftest.py`: exit 0, 555 PASS lines, 0 FAIL, "All checks passed".
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign
  GIT_CONFIG_VALUE_0=false npx vitest run <38 files> --pool=forks`: **38 files passed, 314 tests passed, 1 skipped**
  (315), 151 s. The skip is `weightScalePercentages.db.test.ts`'s placeholder that runs only without a test database.
  Files: every `src/lib/__tests__/trackerAdvertising*`, `brandHealth*` and `tracker*` file (28), `caveatLabels`,
  `findingBasis`, `tenantOwnershipCoverage`, and, because `runNpsAction` changed, every test that imports it:
  `npsGroupTests`, `waveTrackingNpsMetadata`, `tenantEntryOwnership.db`, `callerToBuilderStrictSetup`,
  `weightScalePercentages.db`, `csmCompanyIdentity`, `designLookupFailureSurfacing`.
- Not run: the full library, the browser suites and smoke (playwright not run in this batch, as instructed). No
  screenshot of the loyalty card was taken; the mounted render is the evidence for the screen.

## Mocks versus real

Real: disposable PostgreSQL (each database test creates and drops its own database), the actual Python engine
(`api/parse-stats-file.py`) for every figure, the module's public actions and loaders. Stand-ins: the request context
(test tenant), storage (an in-memory map of the uploaded files), the model (never called), `next/cache` and
`next/server`. The pure tests build engine-shaped results by hand. The loyalty card test renders the real component
to static markup with the server actions module stubbed (none is called when the card renders).

## Migrations and compatibility

No migration. `NpsResult.unavailableSegments` and `loyalty.unavailable` are optional: a result or dashboard built
before this batch reads and renders as before. Stored Brand Health mappings with absent or null positioning or funnel
load as before; a stored mapping with a malformed one (none is expected from the screen) now reports an error on load
instead of reading as empty, and saving a valid mapping replaces it.

## Limits

- D3E-F01 recovery after a corrected mapping is shown through the owner (`womFromResult` with the corrected answer
  list); the database test does not relink a corrected codebook to the same data file, because the app has no
  single action for editing one confirmed codebook entry's labels.
- An unknown awareness answer withholds that brand's bar; there is no separate "awareness unknown" group. A label
  that means not aware but is worded differently ("Not aware", "Unaware") is read as unknown, so the bar is withheld
  rather than guessed; the not selected wording is the one `selectedCode` already used.
- The Brand Health save still has no revision check (last write wins), and a posted finding is not marked stale when
  the brand source changes (both disclosed before, unchanged).
- With a brand set, `hasRespondents` reads the member's share among respondents with a valid member answer; a member
  whose selected code appears only with suppressed shares is treated as having respondents and goes to the engine.
- Independent review of this batch has not happened yet.
