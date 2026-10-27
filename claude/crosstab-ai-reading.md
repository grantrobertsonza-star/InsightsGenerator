# Cross tabs: the AI Insights reading of one table

Grant, 2026-10-22: a 40-question starter table came back as "No clear pattern". Codex M-B4-01
asked for this contract; B4-F01 corrected the cut-off rule.

## What it is

The AI Insights button on a table in Cross tabs (All tables and the other tabs) asks the model for
one headline and one to four cards describing the table. Server action
`summarizeCrosstabAction` (crosstabActions.ts) loads the saved result and calls
`summarizeCrosstabTable` (crosstabInsights.ts). The reading is shown in `CrosstabInsightsPanel`
and is not stored: no finding, export or table changes.

Separate from SemanticTabs (crosstabAsk.ts, `claude/crosstab-ask-statistics.md`), which plans a
table from words, and from the Research assistant, which builds tables through tools.

## Input: `insightTableText(result)`

- Every question in order, whole: its label, the column names, the base row, each category with
  its percentages, means and score rows. A cell the engine flagged against the rest of its banner
  variable carries "(higher)" or "(lower)". The correction the table used is stated once.
- Limit `MAX_TABLE_CHARS = 30,000`. Questions are added until the next would pass it; a question is
  never cut part way. Returns `{ text, questionsShown, questionsTotal }`.
- When fewer questions fit than the table has, the request says "the first N of its M questions;
  the rest did not fit" and the result carries `partial`, which the panel shows. `partial` describes
  omitted input questions only.
- A first question that does not fit at all: an error asking for a smaller table.
- The same text is used by the Research assistant's `build_table` result.

## Output and failure policy

- Forced tool `record_insights` (headline, cards). Cards without a title or body are dropped; at
  most four.
- A response with `stop_reason: "max_tokens"` is an error ("The AI reading was cut off before it
  finished. Try again."), whatever it contains: a cut-off answer may have a headline and still be
  incomplete (B4-F01). An empty or blank headline is an error ("came back empty"). Neither is ever
  shown as a "no pattern" reading. The panel shows the error, and the button reads again.
- The system prompt tells the model to call a difference significant only when it is marked.

## Tests

`src/lib/__tests__/crosstabInsights.test.ts` (model mocked): whole-question payload with bases,
means and flags; the 30,000-character limit with whole questions and the count; a healthy reading
with `partial`; empty answer, blank cut-off, and a cut-off answer with a headline and cards all
refused; a healthy retry after a refusal. Native: Codex's continuation exercised an empty reading
and recovery in the browser.

## Batch 47 (27 October 2026)

Grant asked why a table read as "No clear pattern". Two causes, both repaired:

- The reading saw only the cell flags. A question whose answers differ across a banner variable as a
  whole, but thinly in every cell, had no flag to lead with. Each question now carries its whole-table
  test against every banner variable (chi-square p, Cramer's V, and a plain 95% verdict) and, for a coded
  single choice question, the mean, standard deviation and base of its codes. The prompt says a question
  can differ overall when no cell is marked, and that no single cell is to be called significant for it.
- A reading with a headline and no cards was shown as complete. It is now refused like an empty one
  ("The AI reading came back without any patterns described. Try again.").

The cell flags themselves changed too (pooled test, `claude/table-method.md`), which removed the false
"lower" on a 0% cell that the reading had been led by. Tests: `crosstabInsights.test.ts` batch 47 cases
(both fail on the old code).

## Limits

The hosted model's judgment is not tested. The correction note covers only the table's own tests.
