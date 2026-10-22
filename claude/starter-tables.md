# StarterTabs: the starter set and its columns to split by

`planStarterTables` (`src/lib/starterTables.ts`) plans a starter set: one draft table per banner
(column to split by), with the file's other suitable questions down the side. Nothing is built until
the researcher presses Build starter tables, and nothing becomes a finding until a commit.

**Banners.** A candidate is categorical (`isCategorical`), with 2 to 10 answers and at least 90%
answering. Recognised banners match, on the label or the name read as words (`nameAsWords`:
"CustomerTier" is "Customer Tier"), one per kind, in this order: gender, age, province or region,
urban or rural, population group, education, employment, then customer and sample groupings
(segment, cohort, tier, customer type, member type, channel, branch, store, site). Grant,
2026-10-22: csm_Wave1_Baseline.xlsx, split only by Segment, got none.

**Text categories.** A text column with no value labels whose answers repeat within a short list
("Segment1", "Yes"/"No") counts as categorical, by the shared rule `isStringCategory`
(`variableKinds.ts`). Before, every such column was left out, so a spreadsheet storing answers as
words had no banners and few questions. Free text stays out.

**Chosen banners.** The panel lists every candidate (recognised first) under "Columns to split by";
it opens by itself when nothing is recognised. A choice replaces the recognised banners (at most 4,
or 3 for a file of more than 100 variables), is kept with its data file in the open workspace, and
"Use the recognised ones" returns to them. `buildStarterTablesAction` checks the choice on the server
(`chosenBannersProblem`: strings only, at least one, no repeats, within the limit, each a candidate of
this file) before building anything.

**Tests.** `starterTables.test.ts` (recognition order, Segment, camel case, text categories, candidates,
a chosen set, the server check), `starterBannersAction.test.ts` (the action builds one table per chosen
banner and refuses a bad choice without building; dictionary and build mocked), browser
`e2e/ui/starter-banners.check.mjs` (a Segment file and a file with nothing recognised, built through
the real engine).

**Limits.** Recognition is by words in names and labels; a grouping named otherwise needs choosing.
The choice is not remembered after a reload.
