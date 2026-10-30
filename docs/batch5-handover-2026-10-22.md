# Handover: B4-F01, B3-01, M-B4-01, prompt caching and the Research assistant (main copy), 22 October 2026

Status: **implemented, ready for independent review.** Main copy. Follows
`docs/independent-batch4-review-main-2026-10-22.md` (frozen `73af0a5`), whose closures and
acceptances stand. No migration; nothing pushed or deployed; no development or live database
touched.

| Commit | What | Kind |
|---|---|---|
| `7c9c783` Prompt caching on the repeat-heavy model calls | Research quality assessment and checklist, qualitative negative cases, objectives decomposition and the Research assistant cache their stable system text and shared input (`promptCache.ts`); wording unchanged; `costOfUsage` prices cache writes 1.25 and reads 0.1; API usage page shows the part from cache. Brief `claude/prompt-caching.md` | cost |
| `1eda64b` Research assistant as the project's expert | Data tools (`list_data_files`, `find_variables`, `build_table` through the SemanticTabs checks and the engine, saved as assistant drafts with a badge), `sample_size` (Cochran 1977, finite population, design effect, response rate), method advice; failed dictionary or design read stops the table; code-written "Tables built" line. Knowledge base guide; brief `claude/research-assistant.md` | feature |
| `2b0868b` Floating Research assistant on every page | Ask the assistant button and drawer (`AssistantDrawer.tsx`); inside a project the saved conversation with all tools and the open section; elsewhere how-the-app and method questions, not saved; Knowledge base and Manual as tools from a generated index with a freshness test; guide links under replies; shared loop `assistantLoop.ts` | feature |
| `a67bf69` B4-F01, B3-01, M-B4-01 | A `max_tokens` AI reading is refused whatever it contains; Findings article correction paragraph and Does not line, Reports article limit, stated as the code applies correction; briefs `claude/crosstab-ai-reading.md` and the band columns section of `claude/pane-layout-recovery.md`; unused `SectionTabs` removed | correctness, documentation |
| this commit | Handover and status line | |

## B4-F01

`summarizeCrosstabTable` (`crosstabInsights.ts`) now checks `stop_reason === "max_tokens"` before
reading the headline, so a cut-off response with a headline and cards is an error ("The AI reading
was cut off before it finished. Try again."). Empty answers remain an error. The retained test adds
the nonempty cut-off case and a healthy retry after it; the whole-question payload, `partial` and
the healthy reading are unchanged.

## B3-01

- `findings.tsx`, the multiple comparisons paragraph: every cross table applies a correction by
  default (false discovery rate across the columns of each banner variable, row by row), whether
  from StarterTabs or built by hand; Bonferroni or none can be chosen; starter findings are also
  controlled table-wide (`crosstabFindings`, `result.starter`); no correction gives the
  uncorrected tag. Matches `crosstabs.ts` (default `correction ?? "fdr"`, caveats 464 to 474).
- Same article, Does not: "Correct for multiple comparisons across the many tables of a project
  (each table is corrected on its own)" replaces "in hand-built tables (only the starter set is
  corrected)", a second instance of the same contradiction.
- `reports.tsx`, "Verdicts do not travel as proof": the same correction. A sweep of all guides and
  manual pages for "by hand", "hand-built", "only the starter", "not yet to tables" finds no other
  instance.

## M-B4-01

- `claude/crosstab-ai-reading.md`: entry points, the input contract (`insightTableText`, 30,000
  characters, whole questions, flags, `partial` as omitted input only), the output and failure
  policy including B4-F01, tests and limits.
- `claude/pane-layout-recovery.md`, new section: `useBandColumns` keys
  (`objectives-band-columns:v1:2` and `:v1:3`, browser-wide, count-dependent), shares, invalid
  stored values, same-tab event and cross-tab invalidation, blocked storage, minimum width,
  keyboard, narrow stacking, and that the band's fold is the page ThreePane's (draft kept).
- `SectionTabs` (no caller) and its superseded comment removed from `RunShell.tsx`.

## Research assistant and drawer: contracts

See `claude/research-assistant.md` for the tools, ownership, weight and design rules, the loop
bound (8 rounds), table cap (4), the drawer's request ordering, the page context checks, the
history checks outside a project and the help index. Grant's choices: tables saved as drafts; the
drawer on every page; the same conversation as the Research assistant section; a side drawer.

## Checks run (cloud workspace, disposable PostgreSQL 16, real Python engine, production build, model replayed)

| Gate | Tree | Result |
|---|---|---|
| Full library | assistant and drawer tree (`3e5e806`, before B4-F01 and the docs) | 1,482 passed, 70 skipped (198 files passed, 1 skipped) |
| Full native browser suite | same | 87 passed, **1 failed**, 1 skipped: `objective-setup-review-identity` failed once early in the Setup edit step; it passed 7 of 7 re-runs (once in the final targeted set, six times with repeat) on the final tree. Cause not found; reported, not dismissed |
| Golden-thread smoke; objective acceptance | same | passed; passed |
| Library on caching and assistant tools tree (`3041231`) | earlier | 1,471 passed, 70 skipped; browser 87 passed, 1 skipped |
| `crosstabInsights`, `helpIndex`, `generalAssistant`, `researchAssistantTools.db`, `sampleSize`, `promptCache` | final | 27 passed, 1 skipped (the no-database placeholder) |
| Browser: objective-setup-review-identity, assistant-drawer, research-assistant-tools, sidebar, objectives-band-resize, crosstabs-entry, knowledge pages render (index, research assistant, findings, reports) | final | 7 of 7 |
| `npx tsc --noEmit` | final | pass |
| Lint on changed files | final | 0 errors added; 2 existing errors in `RunShell.tsx` (set-state-in-effect, unchanged lines) |

Mocks: the model everywhere (scripted replay in the browser, `vi.mock` in the library); the
dictionary, build and set-up reads in `researchAssistantTools.db.test.ts` (real database for the
run, documents and messages). Real: PostgreSQL, the Python engine in the browser checks, the
generated help index, the calculator.

## Limits

- The full suites were not run on the exact final tree: B4-F01, the article corrections, the briefs and the SectionTabs removal came after; their focused checks are above.

- No live model was used: the assistant's tool choices and wording, and the caching saving, are
  unmeasured. The usage page will show cache reads once live calls run.
- Outside a project the assistant's usage is in the server log only (`trace.run_id` is required).
- The drawer's late-reply protection (a reply after moving to another project) is reviewed, not
  browser-exercised.
- Guide search is word matching, not meaning.
- Earlier limits stand.
