# StarterTabs: the starter set and its columns to split by

`planStarterTables` (`src/lib/starterTables.ts`) plans a starter set: one draft table per banner
(column to split by), with the file's other suitable questions down the side. Nothing is built until
the researcher presses Build starter tables, and nothing becomes a finding until a commit.

**Banners.** A candidate is categorical (`isCategorical`), with 2 to 10 answers and at least 90%
answering. Recognised banners match, on the label or the name read as words (`nameAsWords`:
"CustomerTier" is "Customer Tier"), one per kind, in this order: gender, age, province or region,
urban or rural, population group, education, employment, income, household life stage (these two
added 30 October 2026, R5 segment), then customer and sample groupings
(segment, cohort, tier, customer type, member type, channel, branch, store, site). Grant,
2026-10-22: csm_Wave1_Baseline.xlsx, split only by Segment, got none. The list is the one recognition
of demographic and profile questions (`demographicKindOf`): the tracker dashboard's Segment picker
offers the same kinds (`trackerSegment.segmentQuestionsOf`).

**Text categories.** A text column with no value labels whose answers repeat within a short list
("Segment1", "Yes"/"No") counts as categorical, by the shared rule `isStringCategory`
(`variableKinds.ts`). Before, every such column was left out, so a spreadsheet storing answers as
words had no banners and few questions. Free text stays out.

**Rating scales.** A question with numeric answers and 10 or 11 distinct values (a 1 to 10 or 0 to 10
rating, `isTenPointScale` in `meanRow.ts`) gets a mean row above its answers (`meanGroupFor`, the
same row SemanticTabs builds), the distribution kept (Grant, 2026-10-22: the starter set gave only
counts for 10 point scales). The panel says how many planned questions have it.

This is a broad heuristic, by count of distinct values only. The engine qualifies the mean row's
label ("mean of the answer codes, which may not be in order") only when its ordered-scale rule
(`_is_ordered_scale`) says the codes are not a scale: a column declared nominal, labelled codes that
are not a scale, or codes that are not whole numbers. An unlabelled column of whole numbers with 10
or more distinct values is read as a numbered scale (the engine looks at the codes when there are
no value labels), so a spreadsheet's 0 to 10 rating gets an unqualified mean, and so does an
unlabelled count or code list with 10 or 11 distinct whole numbers: the codes are not checked to be
consecutive or a rating. Controls kept by the tests: nominal, labelled non-scale, fractional, fewer
than 10 distinct values, and ordinary 0 to 10 and 1 to 10 ratings.

**Chosen banners.** The panel lists every candidate (recognised first) under "Columns to split by";
it opens by itself when nothing is recognised. A choice replaces the recognised banners (at most 4,
or 3 for a file of more than 100 variables), is kept with its data file in the open workspace, and
"Use the recognised ones" returns to them. `buildStarterTablesAction` checks the choice on the server
(`chosenBannersProblem`: strings only, at least one, no repeats, within the limit, each a candidate of
this file) before building anything.

**Tests.** `starterTables.test.ts` (recognition order, Segment, camel case, text categories, candidates,
a chosen set, the server check), `starterMeanScaleEngine.test.ts` (the planned mean row through the actual engine, hand-computed),
`starterBannersAction.test.ts` (the action builds one table per chosen
banner and refuses a bad choice without building; dictionary and build mocked), browser
`e2e/ui/starter-banners.check.mjs` (a Segment file and a file with nothing recognised, built through
the real engine).

**Limits.** A rating scale is recognised by its count of distinct values: a 0 to 10 question on which
fewer than 10 values were given has no mean row. Recognition of banners is by words in names and labels; a grouping named otherwise needs choosing.
The choice is not remembered after a reload.
