# Rules registry

Every rule that decides research meaning has one owner: the implementation every other part of the app
calls, a contract that states it, and a test that pins it. A change that touches a rule uses the owner
(AGENTS.md, "Change tiers and the impact checklist"); a new rule gets a row here and a contract in the
same change. "Mirror" marks a second implementation that exists for a stated reason and must stay equal
to the owner; mirrors are where drift has caused defects, so each names the test that keeps them equal.

Created 26 October 2026 from the code at batch 31. Keep it current: a row whose owner moves is updated
in the change that moves it.

## Reading files

| Rule | Owner | Contract | Pinned by |
|---|---|---|---|
| How a CSV/TSV/Excel file is read (cells as written, one typing rule, both layouts) | `api/parse-stats-file.py` `_read_plain`, `_typed_series`, `read_table` | `claude/one-reader-import.md` | `oneReaderImport.db.test.ts`, `engineTableReader.test.ts` |
| Which text is a number (strict decimal, codes stay text, one policy beyond 2^53) | `_STRICT_NUMBER`, `_as_numbers`, `_exact_decimal` | `claude/one-reader-import.md` | `exactNumberBoundary.db.test.ts` |
| Text encoding of plain files | `_decode_plain_text` | `claude/one-reader-import.md` | `oneReaderImport.db.test.ts` (IP1000-F03) |
| Variable names and duplicates | `_dedupe_header_names`, `_literal_text`. Mirror: `src/lib/dataSetup.ts` `allocateVariableNames` (tables found in Word/PDF text) | `claude/column-names-and-preview-identity.md` | `oneReaderImport.db.test.ts` (TP500-F02) |
| Whether a stored preview may be shown | `src/lib/importPreviewIdentity.ts` `loadImportPreviewIdentities`, reader id `TABLE_READER` = `ENGINE_TABLE_READER` | `claude/one-reader-import.md` | `importPreviewIdentity.test.ts`, `engineTableReader.test.ts` |
| When a cached dictionary is rebuilt | `DICTIONARY_VERSION` (engine), `crosstabs.minimumDictionaryVersion` | `claude/one-reader-import.md` | `dictionaryCacheUpgrade.db.test.ts` |
| Display of a stored cell | `src/lib/rowCells.ts` `cellText`, type `TableCell` | `claude/one-reader-import.md` | `cellText.test.ts` |

## Answers, bases and statistics

| Rule | Owner | Contract | Pinned by |
|---|---|---|---|
| Missing values (blank, declared tokens) | engine `_is_missing_cell`, `_NA_STRING_TOKENS`. Mirror: `src/lib/dataQuality.ts` `isMissing` (Data quality counts on stored previews) | `claude/one-reader-import.md` | `dataQuality.test.ts`; no test yet compares the two token lists (gap) |
| Answer domain: which codes are answers ("don't know", user-missing, unchosen scale points) | engine `_non_answer_codes` with `_DK_RE`; rows via `_ordered_categories_raw` | `claude/answer-domain.md` | `answerDomainScores.db.test.ts`, `scripts/crosstab_selftest.py` |
| Category identity is the raw code, not the label | engine `_raw_key`, `_ordered_categories_raw` | IMP-003 / ANA-BRAND-002 comments in the engine | `engineCodeIdentity.test.ts`, `engineLabelConflicts.test.ts` |
| Default weight variable | `src/lib/starterTables.ts` `defaultWeight` | `claude/starter-tables.md` | `starterTables.test.ts` |
| Effective base (Kish) | engine, computed inline in two places (row tables and descriptives) | engine comments | `goldenReferenceFixtures.test.ts`; the duplication is a known risk |
| Suppression of small bases | engine `MIN_BASE_SUPPRESS`, `MIN_EFFECTIVE_BASE` | table notes | `goldenReferenceFixtures.test.ts` |
| Survey design (strata, PSUs, Taylor variance, design t) | engine `_Design`, `_p_two_sided_t`; request side `src/lib/surveyDesign.ts` `resolveSurveyDesign` | `claude/crosstab-ask-statistics.md` | `scripts/crosstab_selftest.py`, `surveyDesign.test.ts` |
| Whether a design was applied (labels and caveats) | engine `notes.designApplied`; read by `crosstabs.crosstabFindings`, `npsActions`, `descriptiveFindings` | ANA-NPS-003 comments | `crosstabDesignLabel.test.ts` |
| Multiple-comparison correction | engine `_adjust_p` | table notes | `scripts/crosstab_selftest.py` |
| NPS | `src/lib/descriptiveFindings.ts` `computeNps` | descriptive findings comments | `goldenReferenceFixtures.test.ts` |
| CSM top box and mean | `src/lib/csmMetrics.ts` `summarizeSeries` | `claude/answer-domain.md` | `answerDomainScores.db.test.ts` |

## Findings, insights and trust

| Rule | Owner | Contract | Pinned by |
|---|---|---|---|
| What kind of discovery a finding is | `src/lib/discoveryClassification.ts` `classifyFindingDiscovery` | `claude/trust-milestone-contract.md` | `discoveryClassification.test.ts` |
| What a finding rests on (basis, provenance notes) | `src/lib/findingBasis.ts` `findingBasis` | `claude/trust-milestone-contract.md` | `findingBasis.test.ts` |
| Caveat labels, including in exports (unknown tags never dropped) | `src/lib/caveatLabels.ts` `caveatLabel`, `exportCaveatLabels` | `claude/trust-milestone-contract.md` | `exportQualification.db.test.ts` |
| Support freshness of insights and recommendations | `src/lib/supportStatusShared.ts` `classifyInsightSupport`, `worstSupportStatus` | `claude/support-grounding-and-dependencies.md` | `supportStatus.db.test.ts` |
| Written for earlier decisions | `src/lib/decisionContext.ts` | `claude/recommendation-edits.md` | `recommendationDecisionContext.db.test.ts` |
| Human wording survives regenerate, retry and re-accept | `src/lib/findingWording.ts` (`editFindingWordingTx`, `revertFindingWordingTx`) | `claude/finding-edit-failure.md` | `findingWording.db.test.ts`, `findingEditContract.db.test.ts` |
| Researcher corrections to variables | `src/lib/variableOverrides.ts` `saveVariableOverride` (row lock) | `claude/column-names-and-preview-identity.md` | `oneReaderImport.db.test.ts` (TP500-F03) |
| Data setup saves (compare and swap) | `src/lib/dataSetup.ts` `saveDataSetup` | `claude/setup-loading-guard.md` | `dataSetupStatus.test.ts` |

## Files, projects and tenancy

| Rule | Owner | Contract | Pinned by |
|---|---|---|---|
| Remove, restore and erase of a file, links between files | `src/lib/documentBin.ts` | `claude/document-deletion-contract.md` | `documentBin.db.test.ts`, `documentBinIntegrity.db.test.ts` |
| "Source document removed" marker | `src/lib/candidateSourceDocuments.ts` `ALL_SOURCES_ACTIVE` | `claude/document-deletion-contract.md` | `documentBinIntegrity.db.test.ts` |
| Tenant and project isolation | `src/lib/db.ts` `withTenant`/`withTenantRead`, row-level security in migrations, app role | `docs/database-roles.md` | `tenantIsolation.db.test.ts`, `scripts/check-tenant-isolation.mjs` |
| Stage and module status | `src/lib/sectionStatus.ts` | `claude/stage-status.md` | `stage-status.check.mjs` |
| Which engine code answers a request locally | `scripts/parse_stats_worker.py` (restarts when changed, refuses unknown actions) | the worker's docstring | `statsWorkerFreshness.test.ts` |

## Standing benchmarks (trust that the app does what it says)

- **Reference projects.** `fixtures/golden-thread-*` with `expected.json`, run by the smoke check and
  `goldenReferenceFixtures.test.ts`: a change that moves a figure in a reference project fails.
- **AI evaluation set** (release programme family 8): real reports with Grant's answer key
  (marking guide and workbook in the project). Run on staging with the real model whenever prompts,
  model choice or grounding code change, and before each release; thresholds agreed in advance.
- **Seeded defects** (release programme Phase 2): repeated every few months to check the tests still
  catch what they should.
