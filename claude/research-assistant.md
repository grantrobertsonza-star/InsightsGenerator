# Research assistant: data tools, sample size calculator and method advice

Grant, 2026-10-22: "the research assistant should be our expert. Not only on the imported study,
its data, findings, insights etc, but also give general advice, like ... what should a minimum
sample size be if I want to generalise my finding nationally, or if I want a 5% MOE". Tables the
assistant builds are "saved as drafts" (Grant's choice).

## Behaviour

- One chat per project (Tools, Research assistant). Context per message: project fields, report
  narrative, accepted insights (60), accepted recommendations (40), objective coverage statuses,
  accepted findings rated robust or use_with_caution (80), and the last 20 messages.
- Four jobs: answer from that evidence; answer data questions through tools; give method advice,
  with `sample_size` for every number; `revise_narrative` for report edits (unchanged).
- Tool loop, at most `MAX_TOOL_ROUNDS = 8` model calls per message. `revise_narrative` is
  terminal. Running out of rounds gives "I stopped after 8 steps without a final answer..." plus
  the tables built so far; it is never shown as a complete answer.
- A code-appended line lists every table built for the reply:
  `Tables built for this answer (drafts under Cross tabs, All tables): "label" from file.`
  It comes from the tool results, not the model's text.

## Tools (`src/lib/researchAssistantTools.ts`)

| Tool | What it does | Failure |
|---|---|---|
| `list_data_files` | This run's `documents` of kind `table` that are stats files or raw case tables | none: "no data files" text |
| `find_variables` | `searchVariables(dict, query)` from crosstabAsk.ts (shared with SemanticTabs) | dictionary read failure is an error result |
| `build_table` | `checkTablePlan` (the SemanticTabs validator), then `buildCrosstab(... source: "assistant")` | validation errors returned for the model to fix; set-up read failure stops the table |
| `sample_size` | `sampleSizeForMargin` / `marginForSample` | invalid input throws, returned as an error result |

- Ownership: `data_file_id` must be one of this run's data files (tenant-scoped read); anything
  else is refused before any read.
- Weight: `defaultWeight(dict)` unless `weighted: false`. Design: `loadDataSetupWithStatus` then
  `resolveSurveyDesign(dict, effectiveDesignChoice(...))`, as Objectives evidence does. A failed
  set-up read returns an error; it is not treated as "no design".
- `MAX_TABLES_PER_MESSAGE = 4`; the fifth `build_table` returns an error asking the model to
  answer from the tables built.
- The result text the model sees is `insightTableText(result)` (bases, significance marks) plus
  notes: label and id, weighted or not, design used or not, plan `unclear` lines, skipped
  variables, and a truncation note.

## Persistence

- Tables are ordinary `document_tables` drafts; `crosstab.source = "assistant"`. `listCrosstabs`
  maps the source, and All tables shows a "Research assistant" badge
  (`data-testid="crosstab-assistant-badge"`). Commit and delete work as for any draft.
- No new table, column or migration.

## Sample size method (`src/lib/sampleSize.ts`)

Cochran (1977, ch. 4) for a proportion: n0 = z^2 p(1-p) / e^2 (p = 0.5 by default); finite
population correction n0 / (1 + (n0 - 1)/N); times design effect (Kish, 1965); rounded up;
divided by response rate for the number to approach. Reverse: e = z sqrt(deff p(1-p)/n), times
sqrt((N-n)/(N-1)) with N. z for 90/95/99 only. Invalid inputs (margin outside (0, 50), p outside
(0, 100), deff outside [1, 10], N not an integer >= 2, n > N) throw.

Limits stated in code and in the knowledge base: probability-sample proportion only; for quota or
opt-in samples the figure describes a random sample of that size; deff is the user's estimate,
not estimated from data; the margin is whole-sample, subgroups need their own.

## Tests

- `src/lib/__tests__/sampleSize.test.ts` (6): reference values 385, 1068, 278, 577, 664 (99%),
  246 (p = 20%), margins 3.1 (n = 1000), 4.9 (n = 400), 3.8 (n = 500 of N = 2000), and every
  invalid input.
- `src/lib/__tests__/researchAssistantTools.db.test.ts` (6, real disposable PostgreSQL for the
  run, documents and stored messages; model, dictionary, build and set-up mocked): a data question
  through the full loop (assistant source, default weight, figures with bases and marks, the
  code-written table line, the cached system block); another project's file and an unknown
  variable refused with nothing built; a failed dictionary or set-up read stops the table; an
  unweighted request; sample sizes from the calculator; the four-table cap and eight-round stop.
- `e2e/ui/research-assistant-tools.check.mjs` (native browser, scripted model replay): a data
  question builds an assistant draft (checked in the database, `crosstab->>'source' =
  'assistant'`), the reply lists it, the sample size reply quotes 385, and All tables shows the
  badge.

## Not covered

- A live-model run: the browser check uses a scripted replay, so the model's tool choices and
  wording on real questions are unverified.
- The model's sentence can still misstate a figure from a table it built; nothing compares the
  reply text with the table.
