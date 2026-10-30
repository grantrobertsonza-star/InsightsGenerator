# Brand Health Analytics: brand source and figure contract

The hand-mapped Brand Health tool (`src/lib/brandHealthActions.ts`, screen
`src/app/runs/[id]/BrandHealthAnalyticsPanel.tsx`). Written 29 October 2026 with the brand set change (Grant: "make
Brand variable accept a set such as owner_b ... a household owning two brands would count in both brand groups. So
the groups overlap, and that would be stated on the dashboard").

## The brand source

A mapping (`BrandHealthMapping`, saved per data file in `brand_health_modules.mapping`) names exactly one of:

- `brandVar`: a categorical variable whose categories are the brands. Our brand (`ourBrand`) is one category label.
  The brand groups are exclusive: each respondent is in at most one.
- `brandSet`: a multiple-response set (dictionary `sets[].key`, kind `multi`) with one yes/no member per brand, for
  example `owner_b01..owner_b10` (key `owner`). Our brand (`ourBrand`) is one member variable's name. The brand
  groups overlap: a respondent is in brand X's group when they gave member X's selected code, so a household owning
  two brands is in both groups.

Rules (owner `brandHealthMetrics.normaliseBrandHealthMapping`, `brandHealthMetrics.brandSetMembers`):

- A mapping saved before 29 October 2026 has no `brandSet`; it reads as `brandSet: null`, otherwise unchanged.
- Both named, or a field of the wrong type: refused with the reason. An unreadable saved mapping is reported on load,
  never replaced by an empty one.
- The object fields `positioning` and `funnel` (Codex BH-F01, 30 October 2026): absent or null (a legacy mapping) reads
  as empty (no axes, no stages); a plain object is read field by field, and a plain object without an axis is a valid
  empty choice. Any other supplied value (a boolean, a number, a string, an array) is refused with the reason: on
  save before any write (the saved mapping and its `updated_at` stay as they were), on load as a load error.
- At the server-action boundary (save, build, the brand list for the picker) the set is checked against the file's
  dictionary: it must exist, be a multiple-response set (a dictionary without set kinds: every member a yes/no flag),
  have at least two members, and our brand, when picked, must be one of its members. Each failure is refused with
  the reason and nothing is saved. A failed read of the file's set-up is reported, never read as "no such set".
- Brand identity is the member variable. The brand label is the member's label without the variable-name prefix
  ("owner_b01. ") and without the words every member shares at the start and end ("Current household ownership"),
  keeping at least one word. Two members with the same brand label are refused (figures and other per-brand sets
  are matched to brands by label).
- The selected code of each member is read once per build, by code, through `trackerFigures.selectedCode` (the
  tracker rule: an answer labelled Selected/Yes/Mentioned, or code 1 of a 0/1 variable; otherwise refused).
- Changing the brand source on the screen clears our brand.

## Figure contract

Weighting: every figure uses the file's default weight (`starterTables.defaultWeight`) and the file's survey design,
through the calculation owners `chartActions.runDistributionAction` and `npsActions.runNpsAction`. Rounding: scores
are rounded once from the unrounded engine shares (CT5K-F01).

| Figure | Numerator | Denominator (base) | With a brand variable | With a brand set |
|---|---|---|---|---|
| Score of a plain question by brand (funnel stage, attribute, moment, positioning axis): mean | sum of w x code over answering cases in the brand group | sum of w over answering cases in the group | groups = the brand variable's categories (one banner) | group X = respondents with member X selected (one banner per member, the selected column kept) |
| Same, top-N box | sum of w over answering cases in the group giving one of the top N codes | as above | as above | as above |
| NPS by brand (loyalty) | weighted share answering 9 or 10 minus weighted share answering 0 to 6, in the group | answering cases in the group | NPS tool segments of the brand variable | NPS tool, one run per member, the selected segment kept |
| Score of a per-brand set (eg aware_b01..b10) | per brand column: as for a plain question | everyone answering that column | unchanged | unchanged (not split by the brand groups) |
| Category average | mean of the brands' unrounded scores (each brand counts once) | number of brands with a score | | unchanged in definition |
| Stage-to-stage ratio | brand's later-stage score / earlier-stage score (marginal ratio, ANA-BRAND-001) | | | same, within each brand's own group |

Base reported per brand (`n`): the effective (Kish) base of answering cases in the group when weighted, as
`runDistributionAction` reports it. A group with fewer than 10 answering cases has no figure (engine suppression),
its base still reported. A brand group with nobody answering has no figure on a base of 0, never 0.

Loyalty groups without an NPS (Codex BH-F02, 30 October 2026): every brand group the NPS tool cannot score is kept in
`loyalty.unavailable` with its counts and the reason, and the loyalty card lists it under "Not shown"
(`LoyaltyGroups` in the panel). The counts come from the calculation owner (`npsActions.runNpsAction`
`unavailableSegments`: the banner column's respondents `groupN`, the group's unweighted valid answers `rawN` and their
weighted sum), never from rounded shares. Reasons, in this order: no respondents in the group (`groupN` 0); suppressed
for a small base (the engine shows no scale point below 10 valid answers, so no score; the count of valid answers is
stated); none of the group's respondents gave a valid answer; the valid answers carry no weight. A suppressed group
never carries a score. With a brand set, a member nobody selected (read unweighted when the members are resolved,
`hasRespondents`) is an empty group: the engine refuses a one-group banner, so no figure split by that member is
requested; its scores are null on a base of 0 and its loyalty row says no respondents, and the rest of the dashboard
is still built (before 30 October 2026 that member failed the whole loyalty card, or the whole dashboard for a split
funnel stage).

Overlap: with a brand set, brand groups overlap and their bases do not sum to the total; respondents who selected no
member are in no brand group. The dashboard states this (`overlapNote`) next to the brand selector, at the top of the
dashboard, and on every card whose figures split respondents by brand groups (`sectionSplitsByBrandGroups`: loyalty
always; a funnel, attribute, moment or positioning card when one of its scores has `brandSplit: "brand_groups"`).

Withheld for overlapping groups: any test across brand groups (significance between brands, the NPS tool's
brand-versus-rest test with its multiple-comparison adjustment across the groups) and any brand share meant to add up
to the total. The groups are not separate samples, so such a figure would count some respondents twice. The dashboard
computed none of these before the change either; with a brand set it lists them under "Not shown" with that reason.
Other figures the dashboard could not compute (an attribute, moment, loyalty or positioning map that failed) are also
listed there with the reason, instead of disappearing.

## Downstream

A posted finding (`addBrandHealthFindingAction`) whose section splits by overlapping brand groups carries the overlap
sentence in its text and the caveat tag `brand_groups_overlap` (label in `caveatLabels.ts`, a sentence in
`findingBasis.provenanceNotes`, allowed into DOCX/PPTX exports). `stated_stats` records `brandVar` and `brandSet`.

## Limits

- No revision check on save (`saveBrandHealthModuleAction` is a last-write-wins upsert, as before this change); two
  tabs saving the same file's mapping keep the later one.
- A finding posted before the brand source changed is not marked stale; posting the section again refreshes its text.
- A loyalty group under "Not shown" is not posted in the loyalty finding; the finding states our brand's NPS only
  when ours has one (unchanged).
- With a brand set, each split figure runs one engine call per brand (10 for owner_b), plus one per brand to read
  its selected code: the 60-row pack builds in about 4 seconds; larger files have not been timed.
