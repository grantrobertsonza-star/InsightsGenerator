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
