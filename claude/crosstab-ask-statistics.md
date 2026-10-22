# SemanticTabs: statistics in a plain-English table request

SemanticTabs (`CrosstabAsk.tsx`, `askCrosstabAction`, `crosstabAsk.ts planCrosstabFromText`) turns a
request into a plan the researcher checks before anything runs. The model searches the dictionary
and calls `submit_plan`; `validate` checks the plan at the server boundary.

**Why (Grant, 2026-10-22).** "Give me the mean overall satisfaction score" built a frequency table
while the plan's sentence, written by the model, said "Mean of...". The plan had no way to ask for a
statistic, and its summary was free text.

**Statistics.** `submit_plan` takes `statistics: [{ row, statistic }]`, with `statistic` one of
`PLAN_STATISTICS` (only `"mean"` today; net scores and NETs are not offered here). Validation:
an unsupported statistic, or a row that is not one of the plan's rows, is an error sent back to the
model. A repeated request for one row makes one mean row. Rows that cannot have a mean of codes keep
their answers and get a Check note saying why: a set (multiple-response, grid or battery), or a
variable with text answers. A row the engine already tabulates as an average only (`tabulatedAsAverage`:
numeric and set as discrete or continuous, or unlabelled with more than 25 distinct values, the
engine's `NUMERIC_AS_CATEGORIES_MAX`) gets no group; the plan lists it under `averageOnly` and says the
table shows its average with no list of answers. Reading the saved corrections can fail; that fails
the request (never a guessed type).

**Mapping.** Otherwise the row gets `meanGroupFor(label)`: `{ kind: "mean", place: "above", cats: [],
qualifyCodes: true }`. The engine's mean group (`api/parse-stats-file.py`, unchanged formula): the
mean of the numeric raw codes over the table's valid cases, weighted with the table's weight
(`sum(w*x)/sum(w)`), declared missing values removed by the decode, and codes whose label is a
non-answer (`_DK_RE`: don't know, refused, no answer, not applicable, not stated, unknown, missing)
left out even when don't know is otherwise shown. `cats` is not read for a mean. The row is
"Mean score: <label>", placed before the first answer, with the distribution kept below.

**Qualification.** Categorical variables can have the mean. With `qualifyCodes`, when the engine's
own ordered-scale rule (`_is_ordered_scale`: the file's measurement level; else a numbered scale of
10 or more points; else scale wording in the labels) says the answers are not an ordered scale, the
label becomes "Mean score: <label> (mean of the answer codes, which may not be in order)" and the row
carries `codesMayBeUnordered`. The qualification is in the label, so it reaches the screen and every
export that prints row labels. Groups without the flag (Builder nets) keep their label as before.
The plan's Check item states how the mean is worked out and quotes the qualification
(`UNORDERED_MEAN_NOTE`, same words as the engine's constant). The order decision is the engine's,
not duplicated in TypeScript, so the plan cannot say in advance whether a row will be qualified.

**Summary.** `describePlan` writes the plan sentence from the checked rows, columns, filters,
`means` and `averageOnly` ("A table of the mean and answers of Overall satisfaction (Satisfaction),
by Gender, for the people who meet 1 filter."). The model's `summary` is not shown.

**Tests.** `crosstabAskMean.test.ts` (validation and mapping through `planCrosstabFromText`; model and
data reads mocked). `crosstabAskMeanEngine.test.ts` (the actual engine, hand-computed unweighted and
weighted means with don't know and blanks excluded, weight rescaling, placement above the answers,
qualification for region codes and a file declared nominal, none for worded satisfaction, a Builder
group unchanged, and `tabulatedAsAverage` against the engine at 25 and 26 distinct values). Browser
`e2e/ui/crosstab-ask-mean.check.mjs` (plan text, table placement, text-answer refusal, model summary
ignored).

**Limits.** A bare-number 1 to 5 (or up to 9 point) list is not an ordered scale under the engine's
rule, so its mean row is qualified although many such lists are ratings; in an SPSS file,
an ordinal measurement level removes it. Tables built before this change keep their labels until
rebuilt. Only the mean is offered; median, NET and net score requests are refused and sent back.
