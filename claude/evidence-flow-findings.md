# How sources become Findings: parts, scans, identity, commits and locators (batch 62, 28 October 2026)

Codex evidence-flow review, findings EF-SEC-F01 and EF-FND-F01 to F05. Each section states the rule,
its owner, what happens on missing or failed input, and the tests that pin it.

## 1. A long report is read in overlapping parts (EF-SEC-F01)

Owner: `src/lib/extractFindings.ts` `buildChunks`, `splitTextIntoParts`; deduplication in
`publishReplacement`.

- A report that fits in 25,000 characters is one part, as before.
- Text without pages is cut at the last paragraph break, else line break, else sentence start (the
  shared rule, `sentences.ts` `splitSentences`), else space, inside the second half of the budget. A
  single sentence longer than half the budget is the only thing that can still be cut inside.
- Every part after the first begins with up to 1,500 characters repeated from the end of the previous
  part, starting at a sentence start (`overlapText`). With pages, that is the closing sentences of the
  previous part's last page, under its own `[[PAGE n]]` marker. A page is still never split; a single
  page over the budget is its own oversized part, as before.
- The prompt tells the model a part may begin with repeated sentences.
- Deduplication is deterministic: a finding whose quote lies in a part's repeated text, and whose
  normalised quote (case and whitespace folded) the previous part already produced, is not inserted;
  anything in its part citing it resolves to the earlier finding. A quote the previous part did not
  produce (missed, or that part failed) is kept. Nothing outside the repeated text is deduplicated by
  this rule (two places in a report that say the same thing stay two readings).
- A quote attributed to a page is verified against that page, then against the previous, same and
  next pages read together, so a sentence crossing a page break verifies.
- Unchanged: an explicit empty list is a genuine empty reading; a missing or malformed list fails the
  part; a part with some unusable records is read in part; partial readings never retire findings.
- Not claimed: that a reading is semantically complete. Every part was sent and answered; whether the
  model extracted every claim it was shown is extraction recall, which needs its own evaluation set.

Pinned by `reportChunkBoundaries.db.test.ts`; Codex `independentSecondaryFlow.db.test.ts`.

## 2. Imported-table discovery examines every column (EF-FND-F01)

Owner: `src/lib/tableComputation.ts` `computeTablePatterns`.

- Every column is classified: numeric (all present values numbers, at least 5), categorical (2 to 10
  distinct values, at least 10 present), or omitted with a reason: `too_few_values`, `single_value`,
  `too_many_categories`, or `excluded` when the caller names it in `excludedColumns`.
- Tests: the two largest groups of every categorical column on every numeric column (Welch t), and
  every numeric pair (Pearson, section 3). The family is every test that produced a p-value.
- Multiple comparisons: Benjamini-Hochberg across the family; a tested pattern is kept only when its
  q is below 0.05 (and, for a relationship, |r| is at least 0.3 and p below 0.05). Each kept pattern
  records `qValue`, `testsInFamily` and the caveat `fdr_controlled_within_table`, and its wording names
  q and the number of tests. Outliers stay a descriptive heuristic outside the family.
- At most 25 patterns per table are kept (strongest of each kind, taking turns). This cap is reported
  separately: `scan.patternsFound`, `patternsKept`, `capped`.
- `scan` (columns examined and omitted with reasons, tests run, cap) is returned by
  `generateFindingsFromTable` and recorded in the trace event `table_findings_scan`, so "nothing
  found" (examined, no test passed), "capped" and "not examined" are distinguishable.
- Performance (measured, batch 62 handover): the old capped scan took 3.7 s on 15 columns by 2,000
  rows because the outlier pass compared every value with every other; outliers are now screened in
  one pass with a closed-form leave-one-out z and confirmed by `stats.ts` `flagOutlier` (same flags,
  checked on 300 generated columns), and columns are read once for correlations.

Pinned by `tableScanCoverage.test.ts`; Codex `independentFindingFlow.db.test.ts` (wide and reordered).

## 3. The Pearson test on exact relationships (EF-FND-F02)

Owner: `src/lib/stats.ts` `pearsonCorrelation`. Consumers: `tableComputation.ts`, `scatter.ts`
`scatterFinding` (unweighted), `scatterActions.ts`.

- Undefined (no r, no p): a variable that does not vary, decided exactly on values shifted by their
  first element; fewer than 3 pairs throws.
- A computed r within 1e-12 of +1 or -1 is taken as exactly +1 or -1 (floating point lands just
  above, on, or just below 1 for an affine series). Then p is 0, the limit of the t-test, and the
  result carries `exact: true`; table discovery words it "an exact linear relationship". Any other r
  gets the t-test on n - 2 degrees of freedom as before.
- The weighted scatter correlation (`scatter.ts`) gives no p-value, as before.

Pinned by `perfectRelationship.test.ts` (reference: scipy for the near-perfect control);
Codex `independentPerfectRelationship.test.ts`.

## 4. Computing a table again keeps the researcher's work (EF-FND-F03)

Owners: `src/lib/findingReplacement.ts` `planReplacement`, `claimIdentityKey` (the replacement policy,
moved out of extractFindings.ts, which re-exports them) and `src/lib/tableFindingPublication.ts`
`publishTableFindings`, `tableFindingDefinitionKey`. Callers: `generateFindingsFromTable`,
`generateFindingsFromBannerPlan` (so "Generate findings", reprocess and saved banner plans).

- One transaction: the table row is locked `for update`, scoped by id, project and tenant (missing or
  another project's table: an error, nothing changed), its rows are read under the lock, the patterns
  computed, the current findings read `for update`.
- Unchanged: a finding whose definition (pattern type and the variables, groups or cell, by name) and
  claim (normalised wording, which carries every figure) equal a new pattern keeps its id, status,
  note, theme, edits, insights and links; nothing is inserted for it. A rejected one stays rejected.
- Everything else goes through `planReplacement`: protected (review, edit, non-default status, note,
  insight) is kept; untouched is archived to history; unknown provenance (before 0094) stops the whole
  replacement with an error asking for review first.
- A kept finding from that step is never re-pointed at new figures. The new computed fact is its own
  finding; the kept one is tagged in `stated_stats.caveats`: `superseded_by_recomputation` with
  `supersededByFindingId`, or `not_reproduced_on_recomputation` when the comparison yields nothing
  now. A later identical recomputation clears the tag.
- Freshness: the tag changes the finding's support fingerprint (`finding_support_parts`, 0096), so an
  insight or recommendation built on it reads as stale ("the figures changed").
- Failure anywhere rolls back: findings, archive rows and tags as before.

Pinned by `tableRegeneration.db.test.ts`; Codex `independentFindingFlow.db.test.ts` (human_note).

## 5. Findings spreadsheet locator (EF-FND-F04)

Owner: `src/lib/sourceAttribution.ts` `findingLocatorColumns`, `describeFindingLocator` (built on the
same join as `findingSourceSql`). Consumer: `src/app/api/runs/[id]/findings/export/route.ts`.

- The Findings sheet keeps Source (file name) and adds Table, Source state and Finding ID.
- A new Evidence sheet has one row per finding: Finding ID, Finding, Source state, File, File ID,
  Table (number and label, or "Cross tab: label"), Table ID, Sheet, Page, Quote, Rows (1-based),
  Variables, Filters (a Cross tab's filters and layer, or "No filter (all cases)"), Weight.
- Source state: Current; Source file removed from the project; Source file no longer exists; Source
  table no longer exists; Source not recorded. A field that applies but was never recorded reads "Not
  recorded"; one that does not apply to the source kind reads "Not applicable". Never blank.

Pinned by `findingsExportLocator.db.test.ts`; `exportAttribution.db.test.ts`; Codex
`independentFindingFlow.db.test.ts` (export_table_identity).

## 6. Committing Cross tabs claims each draft once (EF-FND-F05)

Owner: `src/lib/crosstabs.ts` `commitCrosstabs`.

- The data file must be in this project and tenant, else an error and nothing committed.
- Drafts are selected `for update` in table order; each is claimed by an update that requires it still
  to be a draft. A commit that waited re-reads the row under READ COMMITTED and finds it committed.
- A draft that already has findings from its own table id gets no second set. Identity is the table
  (`source_table_id`), never wording: two tables with the same text each keep their findings.
- A retry or second commit returns `{ tables: 0, findings: 0 }`. Failure rolls back the findings and
  the drafts' state together.

Pinned by `crosstabCommitConcurrency.db.test.ts`; Codex `independentFindingFlow.db.test.ts`
(concurrent_commit).

## Limits

- No screen shows the table scan coverage yet (it is in the return value and the trace); no screen
  sets `excludedColumns`.
- The recomputation tags are not on the export caveat allow-list (`caveatLabels.ts`
  `EXPORT_CAVEAT_ALLOWLIST`, a counter-review decision); downstream they act through support freshness.
- Table regeneration has no legacy-confirmation flow like report extraction's; findings from before
  0094 must be reviewed first.
- A stated insight dropped as an overlap duplicate does not merge its support links into the earlier
  reading (the earlier part saw the same sentence and its preceding context).
