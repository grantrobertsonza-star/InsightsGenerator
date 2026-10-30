# Batch 62 handover: how sources become Findings (28 October 2026)

**Status: implemented, ready for independent review.** Worktree `/home/claude/b72`, branch
`evidence-flow`, base `d2a321d`. Code commits (not for push): `d6dadac` (F02), `bf6beb4` (F01),
`2e6a303` (F03 and SEC-F01), `f7e9537` (F04), `feeb4dc` (F05); docs in the commit that adds this file.
Tier A throughout (`node scripts/change-tier.cjs --base d2a321d`). No migration; nothing pushed,
no cloud, storage or real model call, browser stack not run.

Contract: `claude/evidence-flow-findings.md` (all six rules). Registry: six new rows in
`claude/rules-registry.md`.

## Findings repaired

| ID | What was wrong | What it does now |
|---|---|---|
| EF-SEC-F01 | Unpaginated reports cut every 25,000 characters with no overlap; a sentence across a cut was seen whole by no call | Cuts at a paragraph, line or sentence boundary (shared `splitSentences`, not edited); each later part repeats up to 1,500 characters from a sentence start (paginated: the last page's closing sentences under its marker); a finding in the repeated text whose quote the previous part already produced is published once, its citations resolved to the earlier finding; page-attributed quotes verify against neighbouring pages read together |
| EF-FND-F01 | Discovery examined the first 15 columns only, silently | Every column examined or omitted with a reason (`excluded`, `too_few_values`, `single_value`, `too_many_categories`); Benjamini-Hochberg across every test run, kept only when q < 0.05; `scan` returned and traced (`table_findings_scan`); the 25-pattern cap reported as `capped`, separate from "nothing found" |
| EF-FND-F02 | Pearson returned null p for r of exactly +-1 or a floating-point overshoot | r within 1e-12 of +-1 is exact: p = 0 (the limit), `exact: true`; constancy decided exactly (values shifted by their first element); undefined r still gives no p |
| EF-FND-F03 | Generate findings archived every finding of the table, notes included | Shared replacement policy (`planReplacement`, `claimIdentityKey`, moved to `findingReplacement.ts`) through `publishTableFindings`: unchanged findings keep id and all human work; changed or vanished ones that a researcher acted on are kept on their old figures and tagged `superseded_by_recomputation` (linked to the new finding) or `not_reproduced_on_recomputation`; untouched ones archived; pre-0094 rows withhold with a message. Banner-plan route uses the same rule |
| EF-FND-F04 | Export showed only the file name | Findings sheet adds Table, Source state, Finding ID; new Evidence sheet: file and table ids, table, sheet, page, quote, rows, variables, Cross tab filters and layer, weight; "Not recorded" or "Not applicable", never blank. Shared rule in `sourceAttribution.ts` |
| EF-FND-F05 | Two commits read the same drafts and both inserted | Ownership check on the data file; drafts `for update` in table order; each claimed by a conditional update; a draft with findings from its own table id gets none again; retry returns 0 |

## Impact checklist

1. **Rule:** owners as in the table; new rows and contract added. The replacement policy was moved,
   not copied (extractFindings re-exports it). Mirror noted: `crosstabs.ts` and `researchQualityRules.ts`
   each keep a `canonicalJson`; not touched.
2. **Inputs:** empty report part = genuine empty; malformed = failed part (unchanged, regressed across
   parts). Unclassifiable columns are omitted with a reason, never silently. Constant data: no r, no p.
   A table or data file missing or in another project: an error, nothing written. Pre-0094 table
   findings: replacement withheld with an actionable message.
3. **Persistence:** table regeneration and banner plans: one transaction, table row locked by id,
   project and tenant, findings read `for update`, any failure rolls back findings, archive and tags.
   Cross tab commit: claim inside the write transaction, idempotent retry. Report publication unchanged
   (document lock), plus overlap deduplication inside it.
4. **Freshness:** see "Existing findings" below. A tagged finding's support fingerprint changes, so
   insights and recommendations built on it read stale ("figures changed"); notes, themes, statuses,
   edits and links survive.
5. **Screens:** no screen changed. Generate findings returns the same `{kept, discarded}` plus `scan`
   and `publication`; the scan is not yet shown (limit).
6. **Proof:** below.

## Checks run

- `npx next typegen` (0), `npx tsc --noEmit` (0 errors), `npx eslint .` (0 errors, 44 warnings, none
  new in changed files), `python3 scripts/crosstab_selftest.py` ("All checks passed").
- New regressions, each run alone with
  `TEST_DATABASE_URL=postgres://postgres@localhost:55432/postgres npx vitest run <file> --pool=forks`,
  on the base code (source reverted, tests kept) and after:

| File | Base | After |
|---|---|---|
| `perfectRelationship.test.ts` | 9 failed, 6 passed | 15 passed |
| `tableScanCoverage.test.ts` | 7 failed, 1 passed | 8 passed |
| `reportChunkBoundaries.db.test.ts` | 4 failed, 3 passed | 7 passed |
| `tableRegeneration.db.test.ts` | 6 failed, 2 passed | 8 passed |
| `crosstabCommitConcurrency.db.test.ts` | 3 failed, 1 passed | 4 passed |
| `findingsExportLocator.db.test.ts` | 5 failed | 5 passed |

  The cases passing on base are controls (undefined r, the textbook near-perfect value, one-part
  reports, rollback on failure, ownership refusal).
- Existing affected files (43, every test importing a changed module), one at a time: 353 passed,
  22 skipped (each file's own "no database" placeholder), 1 failed: `driverLabelCollision.db.test.ts`
  counted a finding's text across all sheets and found it twice once the Evidence sheet repeated the
  wording. The Evidence sheet now carries Finding ID only; that file, `exportAttribution.db.test.ts`
  and the locator file then passed (5, 4 + 1 skipped, 5).
- Mocks: the model (all extraction tests), storage, the PDF reader in the paginated case. Real:
  PostgreSQL (disposable, one file as a role without RLS bypass), the Python engine for Cross tabs.

## Codex replay (180 scenarios)

Copies of the four retained tests, root moved to a scratch folder by `CODEX_ROOT`, the export route's
`@/lib` imports mapped as the repo's export tests do, run one at a time, then deleted. The ten
concurrent-commit inputs (`crosstab-independent5000-.../CT101-*.json`) were not in this container;
equivalent drafts were built with the real `buildCrosstab` and engine (two banner groups, a rating and
a yes/no question) and placed at the path the test reads.

| File | Base | After |
|---|---|---|
| independentPerfectRelationship | 8 failed, 2 passed | 10 passed |
| independentSecondaryFlow | 10 failed, 90 passed | 100 passed |
| independentFindingFlow | 40 failed, 20 passed | 60 passed |
| independentCodedEvidence | 10 passed | 10 passed |
| **Total** | **58 failed, 122 passed** | **180 passed** |

No Codex assertion was edited.

## Column scan measurements (`computeTablePatterns`, mean of 3, this container)

| Table | Before (first 15 columns) | After (every column) |
|---|---|---|
| 15 numeric x 200 rows | 68 ms | 29 ms |
| 60 numeric x 200 | 53 ms (15 examined) | 134 ms (1,770 tests) |
| 100 numeric x 200 | 45 ms | 134 ms (4,950 tests) |
| 60 numeric x 2,000 | 3,707 ms | 1,364 ms |
| 100 numeric x 2,000 | 2,530 ms | 2,230 ms |
| 20 categorical + 40 numeric x 500 | 2.8 ms, 0 patterns (no numeric column in the first 15) | 141 ms, 800 + 780 tests |

The old cost was the outlier pass (every value against every other). The one-pass screen flags exactly
what the direct pass flagged on 300 generated columns (1,350 flags, scratch equivalence check).

## Existing findings

- Table findings computed before this batch: the wording now carries q and the test count, and some
  p < 0.05 patterns no longer pass the false discovery rate. On the next Generate findings, untouched
  old findings are archived and replaced; those a researcher reviewed, edited, annotated or built an
  insight on are kept on their old figures and tagged (superseded or not reproduced), so their insights
  read stale once. Nothing changes until a table is computed again.
- Report findings: unchanged until re-read; a re-read may add claims that sat on a cut.
- Committed Cross tabs and exports: no stored change; the export gains columns and a sheet.

## Limits

- Extraction recall is not measured: every part was sent and answered is not "every claim read".
- No screen shows scan coverage or sets `excludedColumns`; no confirmation flow for pre-0094 table
  findings (review first).
- Recomputation tags are not on the export caveat allow-list (a counter-review decision); proposed for
  Grant. A tagged finding's stale reason reads "figures changed".
- An oversized single page is still one part; a sentence over half the budget can still be cut inside.
- Overlap duplicates do not merge a later stated insight's citations into the earlier reading.

## Proposed capture and selection contract per source route (for Grant to approve; not implemented)

For every route: record what was captured (whole source or which part), what was examined, what was
selected and by which rule and cap, and report "captured in full / in part / failed" separately from
"examined: nothing found / capped".

1. **Report (stated):** capture every page or part with overlap; record parts sent, answered, failed
   and partly read; selection is the model's, so state "recall not evaluated" until an evaluation set
   exists; quotes verified per finding.
2. **Imported summary table (generated):** capture every column; record examined and omitted columns
   with reasons, the test family and correction; cap reported; researcher exclusions recorded with the
   table.
3. **Raw data, Cross tabs:** capture is the researcher's request (saved with the table); selection by
   significance, correction and per-question and per-table caps, each recorded on the table and shown
   when a cap dropped tested results.
4. **Banner plan (legacy raw):** the saved plan is the capture; record plan version with findings and
   mark findings stale when the plan changes.
5. **Scatter and driver analysis:** one posted result per request; record cases used of cases in file,
   weight, and variables by code (already largely done); no hidden selection.
6. **Coded transcripts:** capture every segment; record coded versus uncoded segments and which codes
   became findings and why others did not.
7. **Wave comparison:** record which waves and variables were compared and the comparisons omitted.
