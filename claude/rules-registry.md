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
| How a CSV/TSV/Excel file is read (cells as written, one typing rule, both layouts) | `api/parse-stats-file.py` `_read_plain`, `_excel_sheet_grid`, `_typed_series`, `read_table` | `claude/one-reader-import.md` | `oneReaderImport.db.test.ts` (incl. CAL-R1-F03), `engineTableReader.test.ts` |
| Which text is a number (strict decimal, codes stay text, one policy beyond 2^53) | `_STRICT_NUMBER`, `_as_numbers`, `_exact_decimal` | `claude/one-reader-import.md` | `exactNumberBoundary.db.test.ts` |
| Text encoding of plain files | `_decode_plain_text` | `claude/one-reader-import.md` | `oneReaderImport.db.test.ts` (IP1000-F03) |
| Variable names and duplicates | `_dedupe_header_names`, `_literal_text`. Mirror: `src/lib/dataSetup.ts` `allocateVariableNames` (tables found in Word/PDF text) | `claude/column-names-and-preview-identity.md` | `oneReaderImport.db.test.ts` (TP500-F02) |
| Whether a stored preview may be shown | `src/lib/importPreviewIdentity.ts` `loadImportPreviewIdentities`, reader id `TABLE_READER` = `ENGINE_TABLE_READER` | `claude/one-reader-import.md` | `importPreviewIdentity.test.ts`, `engineTableReader.test.ts` |
| When a cached dictionary is rebuilt | `DICTIONARY_VERSION` (engine), `crosstabs.minimumDictionaryVersion` | `claude/one-reader-import.md` | `dictionaryCacheUpgrade.db.test.ts` |
| Display of a stored cell | `src/lib/rowCells.ts` `cellText`, type `TableCell` | `claude/one-reader-import.md` | `cellText.test.ts` |
| Which layout an indicator file has, and what is refused (batch 54) | engine `indicator_observations`, `_indicator_layout`, `_ind_find_header`. Mirror: `src/lib/uploadPurposes.ts` `sampleLooksLikeIndicatorData` (the upload suggestion) | `claude/indicator-data.md` | `scripts/indicator_selftest.py`, `indicatorData.test.ts` (suggestion equals the engine on every fixture) |
| Indicator series identity, units never mixed, absent is never zero, proportions recorded not rescaled | engine `_IndicatorBuilder`, `_ind_sdmx`, `_ind_wdi`, `_ind_label_value`, `_ind_value` | `claude/indicator-data.md` | `scripts/indicator_selftest.py` |
| Indicator data limit: values, not rows (500,000, measured); the byte limit kept | engine `_IndicatorBuilder.add_obs`, `INDICATOR_VALUES_LIMIT_MESSAGE`; `api/import-limits.json` `maxIndicatorValues`. Mirror: `src/lib/importLimits.ts` `INDICATOR_VALUES_LIMIT_MESSAGE` | `claude/indicator-data.md` (measurement table) | `scripts/indicator_selftest.py`, `indicatorData.test.ts` (messages equal) |
| IMF data portal wide (SERIES_CODE identity, frequency a breakdown, SCALE the multiplier) and OECD SDMX-CSV (codes and labels paired by position, CURRENCY a breakdown, withheld values) | engine `_ind_imf`, `_ind_sdmx` with `_ind_label_columns`, `_ind_delimiter` | `claude/indicator-data.md` | `scripts/indicator_selftest.py`, `indicatorData.db.test.ts` |
| OECD reference notes: read in English, keyed by dimension codes ("~" any), stored by dataflow, shown with matching series of the same dataflow in the project | engine `_ind_oecd_notes`, `_ind_note_english`; `src/lib/indicatorData.ts` (`indicator_notes`, `loadIndicatorCatalogue`); `src/lib/indicatorDisplay.ts` `notesFor`, `noteText`, `indicatorCsv` | `claude/indicator-data.md` | `scripts/indicator_selftest.py`, `indicatorDisplay.test.ts`, `indicatorData.db.test.ts` |
| Marked statuses on the chart (not normal: own shape, legend naming the status) | `src/lib/indicatorDisplay.ts` `statusMarkers`, `isMarkedStatus`; `src/lib/indicatorChartOptions.ts` | `claude/indicator-data.md` | `indicatorChartOptions.test.ts` (real Plot, linkedom) |
| Indicator answer checked before storing; number rule | `src/lib/indicatorData.ts` `validateIndicatorResult`; `STRICT_NUMBER` mirrors engine `_STRICT_NUMBER` | `claude/indicator-data.md` | `indicatorData.test.ts` (reads the engine source) |
| Publishing an indicator read (one transaction, ownership under the row lock, stage then publish, failure kept beside the previous version) | `src/lib/indicatorData.ts` `publishIndicatorRead`, `recordIndicatorReadFailure`, `readIndicatorDocument` | `claude/indicator-data.md` | `indicatorData.db.test.ts`, `indicatorDataBeforeMigration.db.test.ts` |
| Indicator values as shown (proportion x 100, unit multiplier), time axis with gaps, CSV of what is shown | `src/lib/indicatorDisplay.ts` `shownNumber`, `periodAxis`, `chartPoints`, `indicatorCsv`; `src/lib/csvField.ts` `csvNumberField` | `claude/indicator-data.md` | `indicatorDisplay.test.ts`, `e2e/ui/indicator-data.check.mjs` |

## Answers, bases and statistics

| Rule | Owner | Contract | Pinned by |
|---|---|---|---|
| Missing values (blank, declared tokens) | engine `_is_missing_cell`, `_NA_STRING_TOKENS`. Mirror: `src/lib/dataQuality.ts` `isMissing` (Data quality counts on stored previews) | `claude/one-reader-import.md` | `dataQuality.test.ts`; no test yet compares the two token lists (gap) |
| Answer domain: which codes are answers ("don't know", user-missing, unchosen scale points) | engine `_non_answer_codes` with `_DK_RE`; rows via `_ordered_categories_raw`. Drifting copy: `src/lib/descriptiveFindings.ts` `DK` (wording of level findings; does not recognise run-together labels, gap) | `claude/answer-domain.md` | `answerDomainScores.db.test.ts`, `scripts/crosstab_selftest.py` |
| Column tests and letters (pooled shares; design cells at 0%/100% untested) | engine `_pooled_prop_se` in `crosstab` | `claude/table-method.md` | `scripts/crosstab_selftest.py` (batch 47 cases) |
| Table method version and its freshness | engine `TABLE_METHOD`; `src/lib/tableMethod.ts`; support reason `method_changed` in `supportStatusShared.ts` | `claude/table-method.md` | `tableMethod.test.ts`, `supportStatus.test.ts` |
| Mean row above rating-scale questions (the Mean tick) | engine `crosstab` with `meanRows` and `_is_ordered_scale`; export filter `src/lib/crosstabMeanRows.ts` | `claude/mean-tick.md` | `scripts/crosstab_selftest.py` (batch 48), `meanTick.db.test.ts`, `mean-tick.check.mjs` |
| Which candidate findings a question keeps (summary rows before answers, then by gap) | `src/lib/crosstabs.ts` `crosstabFindings` | `claude/mean-tick.md` | `meanTick.db.test.ts` |
| A questionnaire question linked through the codebook (identical wording, basis held) | `instrumentMatch.codebookWordingMatches`; written by `suggestInstrumentLinks`; held by `CODEBOOK_BASIS_HOLDS` | `claude/codebook-import.md` (batch 49) | `codebookWordingMatch.test.ts`, `codebookWordingLinks.db.test.ts` |
| Category identity is the raw code, not the label | engine `_raw_key`, `_ordered_categories_raw` | IMP-003 / ANA-BRAND-002 comments in the engine | `engineCodeIdentity.test.ts`, `engineLabelConflicts.test.ts` |
| Which waves of a tracker are in the analysis, and their order | `src/lib/waves.ts` `projectWaves`; `src/lib/dataSetupShared.ts` `normaliseWaveDate` | `claude/waves.md` | `projectWaves.test.ts`, `projectWaves.db.test.ts`, `waves-in-project.check.mjs` |
| Waves of one tracker are one independent source (0124) | SQL `finding_evidence_key` | `claude/waves.md` | `waveStudyIndependence.db.test.ts` |
| Renaming and deleting a program | `src/lib/programs.ts` | `claude/waves.md` | `programs.db.test.ts`, `program-controls.check.mjs` |
| Where a project opens | `src/app/runs/[id]/RunShell.tsx` `reloadOfThisPage`; `ProjectOverview.tsx` | `claude/waves.md` | `project-opens-overview.check.mjs` |
| Which data file a codebook or questionnaire is matched to (never a default among several) | `src/lib/instruments.ts` `chooseMatchTarget`, `InstrumentSummary.linkedDataDocumentIds` | `claude/codebook-import.md` | `codebookImport.db.test.ts`, `codebook-waves.check.mjs` |
| Codebooks and spreadsheet questionnaires (reading, by variable name) | engine `codebook_items`, `instrument_sheet`; `src/lib/instruments.ts` `readClaimedInstrument` | `claude/codebook-import.md` | `codebookImport.db.test.ts`, `codebook.check.mjs` |
| A wide codebook's answer list and names: codes as written, text codes, unread lists reported (IS-F02/F04/F05) | engine `_cb_list` (codes through `_cb_code`), `_cb_name`, `_cb_sheet_items`; `instruments.ts` `rowsFromEngineItems` | `claude/codebook-import.md` (batch 51) | `codebookWideLists.db.test.ts` |
| A link counts only while both its files are active in its project; every link write locks and rechecks them (IS-F03) | `src/lib/instruments.ts` `LINK_ENDS_ACTIVE`, `lockLinkDocuments` | `claude/codebook-import.md` (batch 51) | `instrumentScope.db.test.ts`, `instrumentConfirmCollision.db.test.ts` |
| Several columns with an item's code once case and separators are set aside: the literal one wins, else a choice (IS-F06) | `src/lib/instrumentMatch.ts` `exactCodeVariables`, `AMBIGUOUS_CODE_CONFIDENCE` | `claude/codebook-import.md` (batch 51) | `instrumentMatch.test.ts`, `instrumentScope.db.test.ts` |
| The separator of a delimited data file (IS-F01) | engine `_sniff_delimiter`, `_csv_grid` | `claude/one-reader-import.md` | `delimiterChoice.db.test.ts`, `dataFileFormats.db.test.ts` |
| Which document labels a variable, and one confirmation per variable per document (LBL-01, IR-04) | `src/lib/labelOverlay.ts` `buildLabelOverlay`, `LABEL_SOURCE_ORDER`; `src/lib/instruments.ts` `variableTakenBy`, `getConfirmedItemsForData` | `claude/codebook-import.md` | `labelOverlay.test.ts`, `instrumentTwoSources.db.test.ts`, `instrumentConfirmCollision.db.test.ts` |
| Analysis plan: lines, approval, the methodology they follow, planned tables, and every finding's route (CE-6) | `src/lib/analysisPlan.ts` (`setPlanLineApproval`, `readStatedMethodology`, `promoteApprovedPlanTables`, `findingRoute`, `readFindingRoutes`); lines written by `objectiveEvidence.ts` `generateEvidenceQuestions` | `claude/evidence-chain.md` | `analysisPlan.db.test.ts`, `evidenceTrail.db.test.ts`, `analysis-plan.check.mjs` |
| Objective coverage: which objective a verdict judges, the insights it cites, and whether it is current (CE-1), including the support of what it cites (B37-F01) | `src/lib/objectiveCoverage.ts` `loadObjectiveCoverage`, `coverageFingerprint`, `coverageRowNote`, `coverageNote`, `qualifiedConclusion` (support from `supportStatus.ts`); written by `objectiveValidator.ts` `generateObjectiveValidation` | `claude/evidence-chain.md` | `objectiveCoverageFreshness.db.test.ts`, `objectiveCoverageDegraded.test.tsx`, `evidenceTrail.db.test.ts`, `objectiveReview.db.test.ts`, `objective-coverage-stale.check.mjs` |
| Which decision a recommendation serves (CE-2) | `src/lib/recommendationDecisions.ts` `loadDecisionItems`, `storeRecommendationDecisions`, `loadRecommendationDecisions`, `servedDecisionsText`; written by `recommendationAgent.ts` `insertOncePerAnchor` | `claude/evidence-chain.md` | `recommendationDecisions.db.test.ts` |
| The objectives an insight prompt is given (CE-2) | `src/lib/projectObjectives.ts` | `claude/evidence-chain.md` | `insightObjectiveFraming.db.test.ts` |
| Whether the report narrative is written for the project as it now stands (CE-3) | `src/lib/narrativeFreshness.ts` `narrativeFingerprint`, `narrativeFreshnessNote`; recorded by `storyNarrative.ts` `generateStoryNarrative` | `claude/evidence-chain.md` | `narrativeWrongGroup.db.test.ts` (CE-3 case) |
| The evidence trail of a recommendation (CE-5) | `src/lib/evidenceTrail.ts` `loadEvidenceTrail`, `loadObjectiveTrail` (stored links only; breaks shown); deck `evidenceTrailSlides.ts` | `claude/evidence-chain.md` | `evidenceTrail.db.test.ts`, `evidenceTrailSlides.test.ts`, `objectiveReview.db.test.ts`, `evidence-trail.check.mjs` |
| The brief or proposal passage behind an objective (CE-4) | `src/lib/briefIntake.ts` `extractBriefFields` (passages, checked by `quoteMatch.quoteAppearsIn`); `src/lib/briefPassages.ts` | `claude/evidence-chain.md` | `briefPassages.db.test.ts`, `evidence-trail.check.mjs` |
| Default weight variable | `src/lib/starterTables.ts` `defaultWeight` | `claude/starter-tables.md` | `starterTables.test.ts` |
| Effective base (Kish) | engine, computed inline in two places (row tables and descriptives) | engine comments | `goldenReferenceFixtures.test.ts`; the duplication is a known risk |
| Suppression of small bases | engine `MIN_BASE_SUPPRESS`, `MIN_EFFECTIVE_BASE` | table notes | `goldenReferenceFixtures.test.ts` |
| Survey design (strata, PSUs, Taylor variance, design t) | engine `_Design`, `_p_two_sided_t`; request side `src/lib/surveyDesign.ts` `resolveSurveyDesign` | `claude/crosstab-ask-statistics.md` | `scripts/crosstab_selftest.py`, `surveyDesign.test.ts` |
| Whether a design was applied (labels and caveats) | engine `notes.designApplied`; read by `crosstabs.crosstabFindings`, `npsActions`, `descriptiveFindings` | ANA-NPS-003 comments | `crosstabDesignLabel.test.ts` |
| Multiple-comparison correction | engine `_adjust_p` | table notes | `scripts/crosstab_selftest.py` |
| NPS | `src/lib/descriptiveFindings.ts` `computeNps` | descriptive findings comments | `goldenReferenceFixtures.test.ts` |
| Reverse-coded battery items: suggestion, confirmation, the derived variable and its dependencies (import step 3) | `src/lib/reverseCoding.ts` (`confirmReversal`, `reversalsOf`, `applyReversals`); engine `_reversal_suggestions`, `_apply_reversals`; `supportStatusShared.ts` `correctionsFor` | `claude/codebook-import.md` | `reverseCoding.db.test.ts`, `supportNetInputs.test.ts`, `reversed-items.check.mjs` |
| Respondent-level quality (straightlining, non-answers, speeders, interviewers) | engine `respondent_quality`, `_rq_grids`; loaded by `src/lib/respondentQuality.ts` | `claude/respondent-quality.md` | `respondentQuality.db.test.ts`, `respondent-quality.check.mjs` |
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
| Remove, restore and erase of a file, links between files | `src/lib/documentBin.ts` | `claude/document-deletion-contract.md` | `documentBin.db.test.ts`, `documentBinIntegrity.db.test.ts`; indicator rows (no run_id, cascade): `indicatorData.db.test.ts` |
| "Source document removed" marker | `src/lib/candidateSourceDocuments.ts` `ALL_SOURCES_ACTIVE` | `claude/document-deletion-contract.md` | `documentBinIntegrity.db.test.ts` |
| Tenant and project isolation | `src/lib/db.ts` `withTenant`/`withTenantRead`, row-level security in migrations, app role | `docs/database-roles.md` | `tenantIsolation.db.test.ts`, `scripts/check-tenant-isolation.mjs` |
| Stage and module status | `src/lib/sectionStatus.ts` | `claude/stage-status.md` | `stage-status.check.mjs` |
| Which engine code answers a request locally | `scripts/parse_stats_worker.py` (restarts when changed, refuses unknown actions); `src/lib/parseStatsFile.ts` `WORKER_PROTOCOL` replaces a worker started by older code (B31-F01) | the worker's docstring | `statsWorkerFreshness.test.ts` |
| "Saved" after a save that remounts its panel | `src/app/runs/[id]/remountConfirmation.ts` (Codebook) | its header comment | `codebookSaveConfirmation.test.tsx` |

## Standing benchmarks (trust that the app does what it says)

- **Reference projects.** `fixtures/golden-thread-*` with `expected.json`, run by the smoke check and
  `goldenReferenceFixtures.test.ts`: a change that moves a figure in a reference project fails.
- **AI evaluation set** (release programme family 8): real reports with Grant's answer key
  (marking guide and workbook in the project). Run on staging with the real model whenever prompts,
  model choice or grounding code change, and before each release; thresholds agreed in advance.
- **Seeded defects** (release programme Phase 2): repeated every few months to check the tests still
  catch what they should.
