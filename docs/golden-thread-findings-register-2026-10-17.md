# Golden-thread findings register, 2026-10-17

Shared by Claude and Codex for the full researcher-journey assessment Grant requested (11:54 SAST). One row per finding; never delete or rewrite a row: close it with evidence, or mark it a test failure, and keep failed-run history.

**Scope.** Raw-file upload through setup, objectives, business decisions, analysis, evidence, insights, recommendations, narrative and every export format. Numerical accuracy against independent references, evidence traceability, reload consistency, screen-versus-export agreement. Change and failure probes: edits, rejection, regeneration, source replacement and deletion, duplicate evidence, failed saves, interrupted requests, retries; downstream invalidation or qualification with reviewed work preserved.

**Environment rules.** Separate working copies and disposable databases only. Synthetic fixtures only. Model calls are not authorised: model output is scripted replay, so these checks establish orchestration, numbers, provenance, persistence and qualification, never AI quality. Nothing pushed or deployed.

**Starting point.** The recommendation-context defect is already repaired and independently accepted (`8fa326c`, Codex `ca951b8`). Claude's assessment starts from application commit `19b3d54` (tidy-ups, under Codex review at the time of writing).

## Severity

- **S1** wrong number or verdict shown as valid
- **S2** lost provenance, or stale or invalid support reaching an output or export unqualified
- **S3** lost human work
- **S4** visible failure with a recovery path, or a misleading message
- **S5** cosmetic or wording

**Kind:** `app` (application defect), `test` (harness or test failure, not the application), `limit` (documented limitation or unsupported case), `obs` (observation, no defect).

## Findings

| ID | Stage | Kind | Sev | Summary | Reproduction | Expected | Actual | Affected outputs | Evidence | Found by / commit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GT-001 | Analysis | obs | S5 | Column test note did not name the unpooled SE | Engine notes for any banner table | Note names the method applied | "two-proportion z-test on effective bases" | Table notes | deep check 2026-10-17 | Claude / `8fa326c` | Repaired in `19b3d54`, awaiting Codex |
| GT-002 | Decisions, objectives | obs | S5 | Accepted items with equal `created_at` had no fixed order | Two accepted decisions with the same timestamp | Fixed numbering | Order arbitrary between syncs | Decision statement, research objective, evidence item order | deep check 2026-10-17 | Claude / `8fa326c` | Repaired in `19b3d54`, awaiting Codex |
| GT-003 | Setup | limit | n/a | Columns-as-cases workbook with weights or MR sets declared in a separate codebook sheet is refused | Upload golden-thread-2 `columns-as-cases.xlsx` | Explicit refusal (documented) | Refused with an actionable message, no analysis produced | Import | `goldenReferenceFixtures.test.ts` | Claude / `8fa326c` | Known limitation |

## Run log (append only)

| When (UTC) | Who | Commit | What ran | Result | Notes |
|---|---|---|---|---|---|
| 2026-10-17 08:5x | Claude | `8fa326c` | Deep check: reference fixtures, 30 UI, smoke, adapter, objective acceptance, integrity audit | All pass; 0 integrity violations | `claude/deep-golden-thread-check-2026-10-17.md` |


## Codex parallel baseline checkpoint

Baseline9190928 (application19b3d54), isolated copy/database. GT-001 and GT-002 independently accepted in9190928:59 focused passes, original implementation fails the two order assertions and note. Existing rows retained; this is their appended disposition. Claude test-only follow-up a4792b4/f2fc03a received; independent verification pending. Recommendation-context closure8fa326c/ca951b8 remains preserved and its original cases are included in the new assessment.

Independent full strict baseline:124 files,875 passes,42 explicit skips; all required actual PostgreSQL/Python suites ran. Independent oracle:GT1 all31,GT2 all15,16 x7 invariants,50 base/type checks pass; no numerical app defect found. Reported test-harness coverage failure remains distinct from engine results. Replay only as Grant selected; fresh model quality unverified.17 export route/format combinations inventoried. Native/journey/export/failure probes running. Detailed Codex ledger:parallel-golden-thread-findings-2026-10-17.md; local artifacts:scripts/workflow-tenant-review/parallel-golden-20261017/. No canonical row/count change.

## Codex confirmed broader export finding: GT-004

| ID | Stage | Kind | Sev | Summary | Reproduction | Expected | Actual | Affected outputs | Evidence | Found by / commit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GT-004 | Recommendation export after decision edit | app | S2 | Stale recommendation exported without the warning shown on screen; deck frames its old action with current decisions | Generate and accept Action framed for Decision A from a pre-decision insight; edit accepted decision to Decision C replaces Decision A; reload; export accepted recommendations | Preserve wording and qualify the old action consistently with the panel | Panel warns, XLSX has no qualification, PPTX prints current Decision C above old Action A with no qualification | Recommendation XLSX and PPTX | scripts/workflow-tenant-review/parallel-golden-20261017/native/decision-export-observation.json; decision-export-primary.log; decision-export-primary-report.json and output artifacts | Codex / frozen application19b3d54, unchanged through f2fc03a | Confirmed; Claude repair, Codex independent verification required |

GT-004 belongs to the existing FND-001/REP-OUT-001 downstream-handover requirement under the newly requested full journey/export scope. The earlier panel-only business-row acceptance and its disclosed limits remain historical bounded passes; they are not evidence that these exports were qualified. Actual generator/persistence plus native decision edit and reload executed with scripted provider replay. The expected-behavior assertion failed on application output, not on navigation or test prerequisites. Run8adefe08-3f09-48b5-b1bf-1cbce6f786b5; xlsxQualified=false, deckQualified=false, deckHasCurrentDecision=true, deckHasOldAction=true. No model-quality claim.

Codex releases GT-004 implementation to Claude under Grant's parallel repair instruction. Codex remains read-only on application source and continues separate-copy coverage. Please retain exact repair commit and regression evidence for independent replay, including current/earlier/unknown contexts and researcher-authored controls.


## Codex confirmed crosstab export finding: GT-005

| ID | Stage | Kind | Sev | Summary | Reproduction | Expected | Actual | Affected outputs | Evidence | Found by / commit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GT-005 | Crosstab exports | app | S2 | Native table extends past the slide boundary, clipping Total from the rendered PDF | Native upload golden-survey-documented.xlsx; save Purchase by Gender and Likelihood to recommend by Gender; GET crosstab/export?format=pdf and compare with XLSX and PPTX content | All answer/banner/Total cells fit inside each rendered page; Purchase Total base200 and both answers50% remain visible | PDF page1 shows Female/Male but only T from Total header at the far right, with Total200/50%/50% outside the page; page2 also loses Total. PPTX XML retains values but uses the same overflowing layout | Crosstab PDF and rendered PPTX | scripts/workflow-tenant-review/parallel-golden-20261017/exports-continuous-generate/crosstab-pdf.pdf; crosstab-pdf.text.txt; crosstab-pptx.pptx; crosstab-xlsx.xlsx; export-audit/crosstab-pdf-page1.png | Codex / frozen application19b3d54, unchanged through f2fc03a | Confirmed; Claude repair, Codex independent verification required |

Source: src/app/api/runs/[id]/crosstab/export/route.ts:293 sets column widths to3.4 +9.4 +1.0=13.8 inches; the table begins at x0.4 (line302), ending at14.2 on a13.333-inch LAYOUT_WIDE slide (line356). Supplying w12.5 at line304 does not constrain explicit column widths. PDF uses this same PPTX through convertOfficeDocToPdf. Independent unpdf and PyMuPDF extraction both miss Total; the rendered960x540 PDF page confirms actual clipping, so this is not an extractor-only failure. Reproduction run1c578b61-83fc-4622-a358-60386d3d4f12, two saved crosstabs, actual native project and actual HTTP downloads. Existing XLSX figures match the independently calculated source values.

Codex releases GT-005 implementation to Claude under Grant's parallel repair instruction. Smallest repair must keep the native table within the available page width, or explicitly split wide banners while repeating answer/base/source context. Closing checks: render both actual PDF and PPTX and verify the complete Total column and independent figures on the two-column fixture; add a wider-banner boundary plus long-label/multi-page continuation controls so a fix does not merely move the clipping to another column. Preserve original failed PDF and evidence. This finding is under the newly requested complete export scope and adds no canonical release row.

## Codex confirmed rejected-support workbook finding: GT-006

| ID | Stage | Kind | Sev | Summary | Reproduction | Expected | Actual | Affected outputs | Evidence | Found by / commit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GT-006 | Insight export after finding rejection | app | S2 | Pre-insight workbook retains rejected support as Robust without support qualification | Continuous native journey creates Purchase finding and insight, accepts downstream work, rejects that finding, reloads and exports insights workbook | Qualify or exclude the affected insight while preserving reviewed wording and current controls | Findings XLSX records Purchase finding Rejected; pre-insights XLSX exports its derived insight as Robust with no Support field or qualification; synthesis workbook correctly qualifies the same chain | Pre-insights XLSX | exports-continuous-generate/insights-xlsx.xlsx, findings-xlsx.xlsx, synthesized-insights-xlsx.xlsx and database-snapshot.json under parallel-golden-20261017; native journey report | Codex / frozen application19b3d54 unchanged through f2fc03a | Confirmed; Claude repair released, independent verification required |

GT-006 is another actual consumer of existing FND-001/REP-OUT-001. Source: src/app/api/runs/[id]/insights/export/route.ts selects old verdict_tier and decision context but never loads/checks support currentness; its comment assumes findings stay verified once insights exist. Original native rejection executed; no seeded rejection or parser-only inference. Run1c578b61-83fc-4622-a358-60386d3d4f12. Closure: original rejected-support workbook reproduction qualifies/excludes affected row, leaves unchanged support eligible and reviewed wording intact; inspect equivalent changed/deleted-source/unknown support handling and reload at affected route boundary. Reuse authoritative support rules rather than implement a separate predicate. This consumer was not established by the prior bounded passing matrices. No new canonical row. Claude may repair alongside GT-004/005; Codex verifies exact final commit.

## Claude journey findings (2026-10-17, renumbered GT-007 to GT-010)

Claude's first copy of this register numbered these GT-004 to GT-007 before Codex's rows above existed; an overwrite of the shared file at about 10:45 UTC was undone from git (`3c989e8`), so Codex's rows stand as committed and these are appended under new IDs. Claude's checks: `e2e/ui/journey-exports.check.mjs`, `e2e/ui/journey-changes.check.mjs` (working copy, not yet released), application `19b3d54`, model replay.

| ID | Stage | Kind | Sev | Summary | Reproduction | Expected | Actual | Affected outputs | Evidence | Found by / commit | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| GT-007 | Recommendations, exports | obs | S4 | The main Recommendations list (synthesized-insight recommendations, including the researcher's own) has no Excel or Slides export of its own | Researcher recommendation on a synthesized insight; download Recommendations Excel/Slides (Working data tab) | The researcher's recommendation list can be exported | Those exports cover only the per-pre-insight list (by design, page.tsx comment); the main list reaches exports only through the narrative docx/pptx | Recommendation exports | journey-exports runs 1-2: `recommendations_export_scope_all.xlsx` has the 9 pre-insight rows, no researcher row | Claude / `19b3d54` | Open: product decision for Grant |
| GT-008 | Any server action | app | S5 | A save lost in transit shows the browser's raw "Failed to fetch" as the only message | Recommendation edit with the server-action POST dropped (`route.abort("connectionreset")`) | A plain message: not saved, check the connection, try again | Alert "Failed to fetch"; nothing stored, draft kept, retry saves once (behaviour correct) | Recommendation edit (likely every action on the shared failure path) | journey-changes C3 observations | Claude / `19b3d54` | Open: wording repair candidate, not released |
| GT-009 | Narrative deck | obs | S5 | The deck's "Evidence qualifications" slide restates a stale insight with only its design caveat | Data correction behind an accepted finding after the narrative exists; export the deck | Each slide restating the stale insight carries its support status | Slide 16 lists it with "Survey design not modelled" only; staleness is tagged on slides 12 and 14 ("SUPPORT CHANGED") and disclosed on slide 17 ("Evidence status: needs review") | Story pptx | journey-changes C5 | Claude / `19b3d54` | Open: minor presentation |
| GT-010 | Import, delete | obs | S4 | The "Delete document" confirmation does not say reviewed findings, researcher notes and the support of insights built on them go too | Delete the data file after findings are accepted and annotated | The confirmation names what reviewed work goes with the file | "Delete this document and any findings extracted from it? This can't be undone." Downstream is then correctly qualified ("Support no longer valid", left out of exports); researcher recommendation kept | Findings, notes, insights | journey-changes C1 | Claude / `19b3d54` | Open: wording repair candidate, not released |

Passed in Claude's runs (no finding): full journey with all 13 export routes (19 requests) readable and agreeing with the screen; crosstab XLSX figures 40/60/50 and chi-square 8 equal the reference; reload identical; deleting the source qualifies downstream and keeps the researcher's recommendation; a duplicate upload is refused and named, corroboration unchanged; a dropped recommendation save stores nothing and a retry saves once; an interrupted narrative generation leaves one narrative and the retry works; a data correction marks dependants "Support changed since drafted" (screen, banner, docx, deck per-item tags); a rejected insight is left out of accepted exports and of the regenerated narrative; an edited AI recommendation survives re-synthesis once and reaches the report.

### Claude run log

| When (UTC) | Commit | What ran | Result | Notes |
|---|---|---|---|---|
| 10:0x | `19b3d54` | journey-exports run 1 | 1 failed (test) | JSON-escaped matching; coding 404 treated as an error; recommendations export assumed to cover synthesized recommendations. Corrected |
| 10:1x | `19b3d54` | journey-exports runs 2-3 | Passed | 19 export requests; crosstab export numbers checked |
| 10:2x | `19b3d54` | journey-changes C1-C4 | C2 failed (test) | Adapter upload helper assumes each upload adds a file; the app refuses duplicates by design and says so. Rerun passed |
| 10:3x | `19b3d54` | C5 | Failed (test) | Qualifier pattern missed "SUPPORT CHANGED"; slide 16 recorded as GT-009. Rerun C1-C5 plus journey: 6 passed |
| 10:4x | `19b3d54` | C6-C8 | C6, C7 passed; C8 failed (test) | C8 assumed a not-yet-accepted finding; rewritten to drop a Reject (rerun pending) |

Same-DOCX native recovery continuation: exact previously failed project/file now imports coding successfully via the actual control;2codes/correct counts and processing_status=ready survive reload. Original LibreOffice failure retained, causeunproved; uniqueprofileconversion is separate diagnostic evidence. Artifacts export-audit/docx-native-retry-continuation/. Residual generic error-banner phrasing for an informational count notice is a separate wording observation. No relabelling of failed invocation.

## Codex additional qualitative workflow — 2026-10-17

Different workflow completed against frozen application19b3d54: native analytic memo save/reload, injected failed save/draft preservation/retry, manual theme remove/add, researcher turn-note reload/XLSX/DOCX, memo deletion isolation, theme/speaker intersection filtering, new researcher theme and durable attribution.9mainchecks/4follow-onchecks/13exactexportassertions pass, independent turn-versus-speaker counts agree. No new application defect demonstrated. Initial DB auth and selector/decoding harness failures retained separately; successful continuation does not erase them. Report:qualitative-researcher-edit-assessment-2026-10-17.md; artifacts: scripts/workflow-tenant-review/qual-workflow-20261017/. No provider call; application source read-only; owned stack/DB/role removed,3241/39129/55523 clear. Claude export repair ownership unchanged; GT004/005/006 still open,36Closed/1Confirmed/6Blocked=43; no overallacceptance or push.


## Claude repair of GT-004, GT-005 and GT-006 (2026-10-17; commit `ffa7adc`)

Implemented, ready for Codex's independent verification of the exact commit. Rows above are unchanged; this is their appended disposition.

| ID | Repair | Retained regression | Original failure shown on the previous code |
|---|---|---|---|
| GT-004 | Recommendation XLSX adds "Decisions written for" (earlier: "Written for earlier decisions (the accepted decisions have changed since): <decisions>"; no record: "Not recorded ..."; researcher-written: "Written by the researcher") and "Support" (the pre-insight's support). PPTX cards carry "WRITTEN FOR EARLIER DECISIONS" / "DECISIONS NOT RECORDED" and the decisions they were written for; accepted scope leaves out recommendations whose support is no longer valid and lists them on a closing slide. Shared rules: `recommendationDecisionStateSql` (0102), `recommendationQualification.ts` (one wording for both formats) | `exportQualification.db.test.ts` (actual routes, real DB: earlier, unknown, current after revert, researcher control); Codex's `decision-export-context.check.mjs` passes on the repaired production build | Workbook column missing (`expected undefined`) |
| GT-005 | Crosstab PPTX/PDF layout planned to fit `LAYOUT_WIDE`: answer 3.0 in + banner columns + Total 1.0 in = 12.53 in within 0.4 in margins; banner columns never below 0.85 in, wider banners split into column groups (each repeats answer, Total, base); rows paged by estimated wrapped height; continuation slides repeat the question heading and base row; source note on every slide (`src/lib/crosstabSlides.ts`) | `crosstabSlides.test.ts`: golden two-column table (actual engine) inside the slide with Total and the reference figures; 25-column banner (each column once, fits); long labels (height budget, continuation context); LibreOffice render: every word inside its page, Total on every page, "Yes 40% 60% 50%" | Previous layout: right edge 14.2 in on a 12.94 in limit; rendered PDF word "T" beyond the page (Total clipped) |
| GT-006 | Pre-insights record their finding's fingerprint when drafted (migration `0103`, read in the same statement as the prompt text); `loadPreInsightSupport` feeds the same `classifyInsightSupport` rule. Pre-insights XLSX gains "Support" and uses the latest verdict (it joined every verdict); its comment no longer assumes findings stay verified. Pre-insights deck leaves out invalid support (listed with the reason) and tags changed/unchecked support. The pre-insight cards show the same status | `exportQualification.db.test.ts` (actual generator records the snapshot; unchanged = current, rejected = no longer valid, reworded in place = changed, legacy = not checked; wording kept); `preInsightDeck.db.test.ts` still passes | Snapshot null; workbook support column missing |

Migration: `0103_insight_support_snapshot.sql` (additive, idempotent) must be applied where the app runs; without it pre-insights read "not recorded" (unknown), rejection and settings changes are still detected. Not applied to any live or development database.

Checks on the final tree (cloud workspace, disposable PostgreSQL 16, real Python, model replay only): `npx tsc --noEmit -p .` pass; changed-file ESLint 0 errors (6 pre-existing warnings); `vitest run src/lib/__tests__ --pool=forks` 126 files, 886 passed, 0 failed, 43 skipped; production `next build --webpack` pass; browser suite on that build: 39/39 (30 UI, journey with crosstab PDF render, C1-C7, Codex's GT-004 probe `decision-export-context.check.mjs`); smoke 1, adapter 2, objective acceptance passed.

Failed invocations this round (retained): the reference-test-only tree's journey PDF step returned 500 because the disposable stack had no `LIBREOFFICE_PATH` (Windows default path); rerun with it set. `preInsightDeck.db.test.ts` and `decisionRefreshReconciliation.db.test.ts` first failed on missing `@/lib` alias mocks (test harness); mocks added. The mocked insight model first used "Headline 0", which the app's figure check correctly refused. Claude's C8 probe (finding review action dropped in transit) timed out on a locator for the finding card (test harness, cause not established); removed from the retained check, not counted as a pass.

## Codex independent disposition of ffa7adc — 2026-10-17

Exact commitffa7adc09203fc8754ab849feb63f7f74a88da8f, release2318d5b; report:export-repair-independent-review-2026-10-17.md. GT-004 original native actual-generator/edit/reload/XLSX/PPTX failure now passes and closes at that finite boundary. GT-006 original native rejection/workbook plus unchanged NPS control pass; retain those repaired subcases. GT-005 original Total/base/reference figures and ordinary25-column controls pass.

Two material remainders are independently confirmed, not missing evidence: GT-006/FND latest not_supported or insufficient_information BEFORE drafting is bypassed by an olderrobust verdict; actualgenerator records the refusal snapshot and actualXLSX says Support current. Reverse latestrobust recovery passes. GT-005 supported85,947byte/360case/three-banner/30answer(max228chars) actualengine fixture renders8pages but loses7unique answer endings and crosses pagebottom/footer. Both remain open under existing identities, no new canonical row. Exact portable probes and artifacts in scripts/workflow-tenant-review/export-repair-20261017/.

Focused actualDB/Python5files20passes2independentappfailures5explicit-skips; native5/5, separateoriginalGT006, actualnativecrosstabPDF and build/TypeScript pass. Allfailedinvocations retained; suppliedPOSIXrendercheck skippedonWindows is not countedgreen because independentLO rendering ran. GT007 productdecision pendingGrant (questionraised), GT008 rawfetchwording independentlyreproducedbutretrycorrect; GT009 qualificationsslide consistency and GT010 deletionwarning wording remainopen/deferrable/unrepaired. No approved exclusion inferred. Counts36Closed/1Confirmed/6Blocked=43 unchanged; prior finite closures/exclusions/security/provider limits preserved. Claude owns only bounded latestverdict/layout repairs and affectedregressions/comments; finalacceptance incomplete.

## GT-007 owner decision — 2026-10-17

Grant selected **Add dedicated Excel and Slides exports** for the main Recommendations list, including researcher-written recommendations. Claude is authorised to implement this bounded feature; the appended handoff defines screen/reload/export scope, provenance, shared qualifications and original-case/failure-retry acceptance. Earlier pending-decision and no-implementation statements are superseded at GT-007 only. Status: authorised, not implemented or independently verified. No new canonical row or count change; GT-008–GT-010 and the two material repair remainders remain as recorded.

## Claude repair of the GT-005 and GT-006 remainders (2026-10-17; commit `7d12593`)

| ID | Repair | Retained regression | Previous code |
|---|---|---|---|
| GT-006 (latest verdict) | Generator eligibility, prompt verdict and rationale and snapshot use one latest verdict (`created_at desc, id desc`) | `exportQualification.db.test.ts`: both refusal tiers draft nothing and export nothing; older refusal + latest robust drafts one current insight from the latest rationale; three qualifying verdicts draft once; same-instant tie follows the larger id | 4 of the 5 new cases fail |
| GT-005 (vertical) | Per-style measured wrapping, oversized rows split (figures once, "(cont.)"), column key for tall banner headings, short repeated context, title and footer fitting, `CrosstabLayoutError` refused as a named 422 | `crosstabSlides.test.ts`: plan completeness for every shape; LibreOffice render of golden, 25-column, 30 long answers, the reviewer's dense, oversized and long-header engine shapes: page and footer bounds, every part and heading in the PDF, all sentinels | END_03/07/13/17/20/24/28 and the oversize sentinel missing; words over the footer |

Status: implemented, awaiting Codex verification of `7d12593`. Counts unchanged.

## Claude implementation of GT-007 (2026-10-17; commit `c00e5d1`)

Main Recommendations list exports: `synthesized-recommendations/export` (Excel) and `export-deck` (Slides), both scopes, through "Main list Excel" / "Main list Slides" controls; shared decision and support qualification, ids and chain of evidence; one recommendation per slide, long text continued; invalid support left out of the accepted Slides and listed. Retained checks: `mainRecommendationExport.db.test.ts`, `e2e/ui/main-recommendation-exports.check.mjs`, `journey-exports.check.mjs` (four new routes). Status: implemented, awaiting Codex verification. Counts unchanged.
