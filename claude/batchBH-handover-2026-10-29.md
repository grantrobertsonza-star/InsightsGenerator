# Batch BH: handover (29 October 2026)

Status: implemented, ready for independent review. Branch `bhmr` (worktree b99), from `f7228f4`. Tier A
(calculation, persistence, findings caveats); the panel change is tier B. Not pushed, not deployed, no live database
touched.

## Grant's request

29 October 2026, about the BMW car tracker, which has no single "brand used most often" variable: "make Brand
variable accept a set such as owner_b. The brands would then be the set's 10 brands, and 'Our brand' one of them.
Wherever a figure splits people by brand, a household owning two brands would count in both brand groups. So the
groups overlap, and that would be stated on the dashboard."

## Changed behaviour

- **Brand variable accepts a set.** The Brand variable select lists multiple-response sets ("Multiple-response sets
  (one member per brand)") above the plain variables. A mapping now carries `brandSet` beside `brandVar`; exactly one
  is named. Our brand, with a set, is a member variable (for example `owner_b08`), shown by its brand label (BMW).
- **Brands.** The set's members, in set order. Identity is the member variable; the label is the member label without
  the variable-name prefix and without the words all members share ("Current household ownership Toyota" gives
  "Toyota").
- **Figures that split people by brand.** A plain question used as a funnel stage, attribute, moment or positioning
  axis, and loyalty (NPS), is read within each brand's group: with a set, brand X's group is the respondents who gave
  member X's selected code. One engine call per member (`runDistributionAction` / `runNpsAction` with the member as
  the banner, the selected column kept), with the file's weight and design, so a respondent who selected two brands is
  in both figures. Per-brand sets (aware_b and the like) are read as before and are not affected.
- **Overlap stated.** Next to the selector once a set is chosen, at the top of the dashboard, and on each card whose
  figures split by brand groups: "Brands come from a multiple-response question (owner_b): a respondent in more than
  one brand's group is counted in each, so groups overlap and do not sum to the total." The set's label is used (in
  the SPSS file of the pack it is "Current household ownership"; in the CSV with metadata.json it is "owner_b").
- **Withheld for overlapping groups.** Tests across brand groups (significance between brands, the NPS tool's
  brand-versus-rest test adjusted across the groups) and any brand share meant to add up to the total. The groups are
  not separate samples, so such a figure would count some respondents twice. The dashboard did not compute or show
  any of these before either; with a set it lists them under "Not shown" with that reason, so their absence is
  explained.
- **Not shown, generally.** An attribute, moment, loyalty question or positioning map that cannot be computed is now
  listed under "Not shown" with the reason instead of disappearing silently (both brand sources). Listed separately
  here because it also changes the brand variable path: the figures are unchanged, only the list is new.
- **Findings.** A posted section that splits by overlapping groups carries the overlap sentence in its text and the
  caveat tag `brand_groups_overlap` (label in `caveatLabels.ts`; its own sentence in `findingBasis.provenanceNotes`;
  added to the export allow-list, so DOCX/PPTX show it). `stated_stats.brandSet` is recorded.
- **Save errors shown.** A refused save now shows its reason under the buttons; before, a failed save went back to
  "Save mapping" with no message. An unreadable saved mapping is shown as a load error.

## Impact checklist

1. **Rule.** New registry row "The hand-mapped Brand Health tool's brand source and its by-brand figures" (owner
   `brandHealthMetrics.normaliseBrandHealthMapping`, `brandSetMembers`, `sectionSplitsByBrandGroups`,
   `brandGroupsOverlapNote`, and the actions in `brandHealthActions.ts`); contract `claude/brand-health.md` (new: the
   registry had no Brand Health row or contract before). Calculations use the existing owners
   (`runDistributionAction`, `runNpsAction`); the selected code uses the tracker rule's owner
   `trackerFigures.selectedCode`. No second calculation was written.
2. **Inputs.** A set that does not exist, is not multiple-response (battery, grid; or without set kinds, any member
   not a yes/no flag), has under two members, or whose brand labels collide: refused with the reason. Our brand not a
   member: refused. Both a variable and a set: refused. A member whose selected code cannot be told: the build is
   refused naming the member. A failed read of the file's set-up: reported, never "no such set". A brand group with
   nobody answering: no figure on a base of 0, never 0. A group under 10 answering cases: suppressed by the engine,
   base still shown. Respondents who selected no member are in no group (stated in the contract).
3. **Persistence.** Same single-statement upsert into `brand_health_modules` as before (tenant from the request,
   row-level security). The set is validated before the write; a refused save writes nothing (the test compares the
   row and its `updated_at` before and after). No revision check existed and none was added: last write wins, as
   before (limit below). No migration: `mapping` is jsonb and `brandSet` is an optional field.
4. **Freshness.** Changing the brand source changes what a by-brand figure means. Findings posted before the change
   are not marked stale (no freshness tracking exists for Brand Health findings); posting the section again refreshes
   its text and caveats, and a hand-edited theme is kept (REP-IN-002, unchanged). The overlap qualification survives
   downstream through the caveat tag.
5. **Screens.** The Our brand options follow the brand source; a late answer for an earlier source is dropped
   (`active` flag), so it cannot replace the current one's brands. Changing the source clears our brand. Reload
   restores the set and our brand (browser check, written). "Saved" still shows only after the save succeeds.
6. **Proof.** Below.

## Files

Code commit `b3b6d511e63f9cd7ed161a3942846336d7a2c33c` (parent `f7228f4b71e4d45f64d4c41a544c043e6445cc5a`):

| File | Blob |
|---|---|
| `src/lib/brandHealthActions.ts` | `9cb028c4747721819de3c9fc89b04ef134a7ddd6` |
| `src/lib/brandHealthMetrics.ts` | `c27e06ea1eaa4ef89445f1c7f28cf1a4f650246f` |
| `src/app/runs/[id]/BrandHealthAnalyticsPanel.tsx` | `877f40d55b04179d7d352f1cfdad3bf45d2630e7` |
| `src/lib/caveatLabels.ts` | `32d74019f5b274ceaee6a77f13b557c6a84dfb03` |
| `src/lib/findingBasis.ts` | `5a3cc67f0dec4d407812fb72601679b4e3dafc5d` |
| `src/lib/__tests__/brandHealthSetBrand.test.ts` (new) | `c1ee32baab48e58682ea2d29148247dec4376da7` |
| `src/lib/__tests__/brandHealthSetBrand.db.test.ts` (new) | `d1f3cba5ae98c5d7c66dfd744d74e8185a9453dd` |
| `e2e/ui/brand-health-set-brand.check.mjs` (new) | `31641d116a3fef762f7293f225bb5148c9bd883b` |
| `src/lib/__tests__/caveatLabels.test.ts` (allow-list now five tags) | `5bd5b8274cdf139bb9fb78de3d47753dfbbe6fbe` |

Docs (separate commit): `claude/brand-health.md` (new), `claude/rules-registry.md` (one row), this handover.

Callers and consumers checked: `BrandHealthAnalyticsPanel.tsx` (the only caller of the actions);
`buildBrandHealthWaveDashboardsAction` (runs the same mapping per wave file, each validated against its own file);
findings written by `addBrandHealthFindingAction` and read by `findingBasis.provenanceNotes`, `caveatLabels` and the
export allow-list; `exactDerivedFigures.test.ts` (Brand Health category average, unchanged). `BrandHealthDashboard`
changed shape: `brandVar` is now `string | null`, and `brandSet`, `ourBrandVariable`, `brandMembers`,
`groupsOverlap`, `overlapNote`, `withheld` were added; the only stored copy is inside a posted finding's
`stated_stats.dashboard`, which nothing reads back as a dashboard.

## Checks run (worktree /home/claude/b99)

- `npx next typegen` (once), then `npx tsc --noEmit`: 0 errors.
- `npx eslint src e2e --quiet`: 1 error, in `src/lib/__tests__/keptOpenWorkspace.test.tsx:32` (react-hooks/globals),
  a file this batch does not touch (last changed in `adc417c`); 0 errors in the files of this batch.
- `python3 scripts/crosstab_selftest.py`: 551 PASS, 0 FAIL, "All checks passed".
- `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false npx vitest run src/lib/__tests__/brandHealthSetBrand.test.ts src/lib/__tests__/brandHealthSetBrand.db.test.ts src/lib/__tests__/caveatLabels.test.ts src/lib/__tests__/findingBasis.test.ts src/lib/__tests__/exactDerivedFigures.test.ts --pool=forks`:
  5 files, 40 tests, 40 passed (brandHealthSetBrand.test.ts 8, brandHealthSetBrand.db.test.ts 5, caveatLabels 9,
  findingBasis and exactDerivedFigures the rest). No database role error occurred. Also run:
  `npx vitest run src/lib/__tests__/findingBasis.test.ts src/lib/__tests__/storyExportSupport.test.ts --pool=forks`:
  2 files, 12 passed.
- Failing without the change: with `brandHealthActions.ts` and `brandHealthMetrics.ts` restored to `f7228f4` and the
  new tests kept, `brandHealthSetBrand.db.test.ts` fails 5 of 5: "loadBrandSetMembersAction is not a function";
  the split figure and the finding tests fail with "Map the brand variable first" (a set could not be the brand
  source); the failure case fails because a missing set was saved ("expected { ok: true } to deeply equal
  { ok: false, ... }"); the boundary case fails only on the reloaded mapping lacking `brandSet: null` (its figures
  are the old path).
- Not run: the full vitest library, the full browser suite and the smoke suite. The browser check
  `e2e/ui/brand-health-set-brand.check.mjs` is written and not run (as instructed). Its option and note texts were
  taken from the pack's SPSS file read through the app's own dictionary in a throwaway probe (set label "Current
  household ownership", ten members, BMW = `owner_b08`).

## Mocks versus real

- Real: a disposable PostgreSQL database built from `supabase/migrations`, the Python engine (`api/parse-stats-file.py`
  through the actions), the codebook import (`readInstrumentItems`, `suggestInstrumentLinks`,
  `confirmInstrumentLinks`), the actions `saveBrandHealthModuleAction`, `loadBrandHealthModuleAction`,
  `loadBrandSetMembersAction`, `buildBrandHealthDashboardAction`, `addBrandHealthFindingAction`.
- Mocked: storage (in-memory map), the request context (the seeded tenant), `next/cache`, `next/server`, API usage
  logging, and the model (must not be called).
- Expected values in the database test are computed in the test from the CSV rows: weighted means, NPS, Kish bases,
  awareness shares; Toyota's group includes 01000008 (who also owns Volkswagen) and its mean differs without them;
  Volkswagen's base counts 01000008 too; Suzuki's group holds three respondents who own another brand.

## Limits

- No revision or compare-and-swap on the mapping save (none existed): two tabs saving the same file's mapping keep
  the later one. Also pre-existing: the upsert's conflict update does not re-check that the document belongs to the
  run.
- With a set, each split figure costs one engine call per brand plus one per brand to read its selected code; the
  60-row pack built in about 3 to 5 seconds locally. Not measured on a full-size file.
- Findings posted before a brand source change are not marked stale.
- Brand labels from member labels rely on the members sharing their leading and trailing words; a set whose labels
  have no shared wording keeps the full label as the brand name (still unique, or refused).
- The set label is shown in the overlap note; where a file's set label is the stem (owner_b) the note says owner_b,
  where it is the question wording it says that.
- Browser check written but not run; no screenshot was taken.
