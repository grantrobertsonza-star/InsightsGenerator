# Handover: design batch and repairs since the Import handover (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy only; 3001 holds the one-page
Objectives prototype separately. Nothing pushed or deployed; no development or live database
touched; **no migration**.

| Commit | What | Kind |
|---|---|---|
| `2e0ba53` | Research quality: Criteria tab folded into an Overview Show filter; Improvements as a dashboard list with the suggestion in the right pane; detail chip one decimal | design |
| `d10d28b` | Multiple-response heading questions link to their code family; exact code keeps digits apart | correctness |
| `5628913` | IR-01, IR-02, IR-03 repairs and the M-IMPORT-01 brief | correctness |
| `b78ceae` | SemanticTabs: a requested mean above the answers, engine qualification of unordered codes | correctness, statistics |
| `9af17ed` | SemanticTabs memory: this file's newest tables and the panel's last three requests | feature |
| `90e2753` | StarterTabs: customer groupings, text categories and columns the researcher chooses | feature |

Package hashes: `.fnd001/overnight/{m-rq,m-mr,m-ir,m-mean,m-mem,m-st}/hashes.txt`, zero committed-byte mismatches. Base check before applying: every
replaced file on the laptop matched the cloud base except `ResearchQualityReview.tsx` and
`research-quality.check.mjs`, which lacked the criteria-list bars (superseded: the Criteria tab is
removed in `m-rq`).

Briefs: `claude/crosstab-ask-statistics.md` (mean, memory), `claude/starter-tables.md` (new),
`claude/questionnaire-variable-linking.md`, `claude/objective-identity-and-import-lineage.md`,
`claude/import-screen-and-download.md`.

## Checks run (cloud workspace, disposable PostgreSQL 16, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| `npx tsc --noEmit -p .` | final | pass |
| Full native browser suite | `02dab45` (rq, mr, ir, mean) | 82 passed, 1 failed, 1 skipped; the failure was `crosstab-ask-mean` comparing two box reads across a layout shift, fixed (row order read from the table in one step) and passing since |
| Golden-thread smoke, objective review acceptance | `02dab45` | passed |
| Browser `crosstab-ask-mean`, `crosstab-ask-memory`, `crosstabs-entry`, `starter-banners` | final | 4 of 4 |
| Unit and database: `starterTables`, `starterBannersAction`, `crosstabAskMemory.db`, `crosstabAsk*`, `callerToBuilderStrictSetup` and the other crosstab tests | final | 52 passed, 1 skipped |
| Previous-code controls | | `crosstab-ask-memory` fails on `a0538b3`; `crosstab-ask-mean` fails on `170dd3a`; `starter-banners` fails on `b02d88f`; `questionnaire-family-link` fails on the code before it |
| `npx eslint` on changed files | | 0 errors |

**Not run:** the full unit and database library on the final tree, and the full browser suite on
the final tree (memory and StarterTabs came after the full run). Please run both.

## Limits

- SemanticTabs: the panel's requests are not kept across a reload (the tables are); a plan based on
  an earlier table takes its variables and filters only.
- StarterTabs: recognition is by words in names and labels; the chosen columns are not remembered
  after a reload.
- The `stats-src-*` temp-file leak in `runLocalStatsPython` remains a separate open item.
