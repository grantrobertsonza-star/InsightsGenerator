# Independent parallel golden-thread assessment — 2026-10-17

Disposition: **repair required; final repaired-commit assessment pending**. This report covers frozen baseline `9190928852496d02306c3a6834023670908d0f06`, application `19b3d54`, and test-only follow-up `a4792b4` released in `f2fc03a`. It does not certify a future Claude repair. All 425 application/engine/migration paths are equivalent across these checkpoints; explicit Git-blob/working-copy CRLF differences are recorded, not described as byte-identical. Final report must name the subsequent exact application commit and repeat affected checks.

## Confirmed application failures

Authoritative append-only register: [golden-thread findings](golden-thread-findings-register-2026-10-17.md).

| Finding | Actual behavior | Disposition |
|---|---|---|
| GT-004 | Native decision A-to-C edit/reload shows a screen warning, but recommendation XLSX omits qualification and PPTX presents old Action A under current Decision C | Confirmed S2; Claude repair; Codex verify original actual-generator case plus earlier/unknown/current/human controls |
| GT-005 | Actual rendered crosstab PDF clips Total base200/50%/50%; PPTX table geometry ends beyond the slide boundary | Confirmed S2; Claude repair; independent PDF/PPTX rendering plus wide-banner/long-label controls |
| GT-006 | After native finding rejection, derived pre-insight XLSX remains Robust without support warning; findings/synthesis workbooks correctly record rejection/invalid support | Confirmed S2; Claude repair; independent affected workbook plus unchanged/changed/deleted/unknown support controls |

GT-004/006 map once to existing FND-001/REP-OUT-001. That row is Confirmed defect: **36 Closed /1 Confirmed /6 Blocked=43**, priorities34/9/0 unchanged. The prior bounded panel/currentness and other passing repair mechanisms remain accepted evidence. GT-005 adds no canonical row; it is an explicit export-rendering blocker in the broader requested assessment. No unrelated closure is reopened merely because a harness changed.

## Independent execution

Evidence root: `scripts/workflow-tenant-review/parallel-golden-20261017/`.

| Boundary | Executed result | Evidence / practical limit |
|---|---|---|
| Baseline full strict gate |124 files,875 passed,42 explicit skips; actual PostgreSQL/Python required suites ran; type generation/typecheck pass|baseline-strict-validation.log|
| Exact reference-test follow-up |124 files,879 passed,42 explicit skips; actual required suites ran|final-strict-validation.log; final-review-manifest.json|
| Reference harness counterexamples |All three externally mutated wrong-z, wrong-ID and unsupported-statistic assertions now fail as expected; canonical/new negative controls pass|final-reference-positive.log and final-reference-negative.log; no engine changes|
| Production build |Pass on frozen baseline|baseline-production-build.log; offline-font compile boundary, retained existing unpdf warning|
| Released browser suite |30/30 pass|baseline-native-primary.log/report/output; actual local storage stand-in, restricted DB role, scripted provider|
| Continuous native projects |Generate and Validate projects plus unchanged golden smoke3/3 pass|baseline-continuous-primary.log/report/output; raw upload, setup, objectives, business decisions, saved computed evidence, analysis, findings, insights, recommendations, narrative, rejection, downloads and reload|
| Interrupted response after commit |Committed objective B survives interrupted browser response; explicit recovery boundary, reload and retry preserve one candidate|after-commit-primary.log/report; native/after-commit-observation.json|
| Objective review |3/3 lifecycle assertions pass|baseline-objective-acceptance.log; both presentations, edit/status/regeneration/reload/rejected exclusion/original brief|
| Adapter |2/2 pass|baseline-adapter-check.log; means/raw-code selectors/refusal|
| Independent arithmetic |All31 GT1,15 GT2,16 weight-x7 invariants,50 base/type checks pass|independent-numbers/; actual engine IDs0001/0200, supported exclusion refusal; no numerical application defect found|
| Persisted integrity |41 runs/498 links/30 relationship checks: no orphan/cross-run/cross-tenant/unanchored recommendations; accepted statements agree|independent-numbers/integrity-*.json; snapshot precedes later coding fixtures|
| Quantitative exports |16 route/format combinations inventoried;13 meaningful quantitative formats downloaded/parsed; exact semantic checks reveal GT-005|exports-continuous-generate/ and export-audit/semantic-results.json; HTTP200/content observed alone is not an assertion pass|

Quantitative export coverage includes crosstab XLSX/PPTX/PDF, findings XLSX/PPTX, pre-insights XLSX/PPTX, synthesis XLSX/PPTX, recommendations XLSX/PPTX, narrative DOCX/PPTX. Coding XLSX/DOCX and finding-history CSV require their separate meaningful transcript/history fixtures; missing-fixture404 and empty history from a quantitative project are explicitly not passes. Their continuation results are appended below.

Independent numeric assertions compare actual saved/exported Purchase Female40%/Male60%/Total50%, bases100/100/200 and NPS25 plus uncertainty/source text against reference calculations. This native project does not request all31 reference tables; the full engine31-value check is a separate boundary. Replacement/duplicate/deletion support assertions executed through actual application callers and export routes in the full strict DB suites with disclosed scripted storage/model boundaries, not falsely described as every native permutation.

## Failed runs and limits

All originals retained. Oracle preliminary harness runs1/2, a raw-byte CRLF equivalence assumption, an integrity query using name instead of project_name, and a hidden-file selector are test/environment failures, not application arithmetic results. DOCX coding fixture continuation hit visible LibreOffice conversion failure; cause remains to be established. A supported plain-text continuation cannot turn that failed DOCX invocation into a pass. GT-004 expected-correct-behavior probe and GT-005 rendered/geometry assertions are genuine application failures. GT-006 is grounded in the actual native rejected finding and actual workbook row, not a model judgment.

Source layering/research contract review: GT-004/006 must reuse existing decision/support authoritative rules. The pre-insight export comment incorrectly assumes a finding remains verified once an insight exists; correct it with the repair (coding standard8). GT-005 is demonstrated geometry/content loss, not a speculative performance finding. No measured performance defect asserted. Reviewed wording/links must survive repairs.

Grant selected **replay only**. No paid/model calls; fresh interpretation/narrative/recommendation quality remains unverified. Cumulative retained spend remainsUS$3.817316/US$10. Approved SAS and flipped separate-Codebook exclusions remain explicit, not unresolved supported requirements. Six blocked canonical rows remain: separate IMP-001/016 deployed security plus SET004/005 and REV003/010/M03 archived definitions. Five archived definitions are deferrable evidence dispositions; deployed identity/storage/RLS/roles/schema/migration/backup process remains a separate public-release gate. No staging/live/development writes, push, deployment or author/history rewrite.

Claude owns confirmed repairs under Grant's parallel instruction. Codex remains read-only on application source. Local source, runtime adaptations, model replay, download files, traces, screenshots, observations and dumps retained separately. Final acceptance remains incomplete.

## Export continuation and inventory correction

The inventory is16, not the initially stated17: crosstab3, findings2, pre-insights2, synthesis2, recommendations2, narrative2, coding2 and history1. All16 were meaningfully requested across their appropriate projects. Quantitative semantic assertions:58 pass/3 fail for the two overflowing PPTX tables and missing PDF Total (GT-005). Original overly strict filename assertions are retained separately; indirect exact From finding/Chain of evidence traceability is not silently converted into a standalone source-filename requirement.

Native plain-text transcript plus researcher XLSX coding import passes:3 participant turns/1 moderator, Safe delivery2 turns/2 speakers, Checkout difficulty1/1; supplied999 ignored. Actual coding XLSX eight exact count/base/speaker cells pass; DOCX preserves3 quotes, both correct count statements and source filename, excluding moderator text. History's real native Regenerate rejected archive plus CSV quote/comma/status/reason assertions pass. One seeded rejected historical finding is explicit; archiving/export use actual app actions/routes. Evidence:export-audit/plain-native-history-continuation/, coding-exact-exports/ and history-exports/.

Failed hidden-file selection, initial DOCX conversion and subsequent wrong-panel history navigation remain retained. Coding plain-text continuation does not erase the DOCX conversion failure. User interface correctly disclosed conversion error; its cause and supported DOCX recovery remain narrower than a pass. No all-Office or fresh-model quality claim.

## Same-DOCX native recovery continuation

The exact previously failed DOCX project/file was retried using the real Import coding action. It now stores two codes, correct2+1turns/2+1speakers and processing_status=ready after reload. Evidence:export-audit/docx-native-retry-continuation/result.json,trace.zip,final.png. Original failed invocation preserved; cause still unproved. Unique-profile independent conversion succeeds separately and is not substituted for this actual recovery. A residual generic last-processing-error banner contains an informational successful-coding/ignored-count notice; record as a wording observation rather than claim the old conversion still fails. No broad converter concurrency certification.

## Evidence retention and shutdown

Synthetic password-free database dump, full storage inventory/reads, actual exports, replay log, traces/screenshots, source manifests and final182-file hashes retained under the evidence root. Graceful owned stack shutdown verified runtime DB/role absent;3240/39129/55522 listeners clear; labelled test container stopped and auto-removed; no owned isolated Node process remains. User services untouched. Cleanup evidence:cleanup-final.json. Final repaired application commit is not yet available, so final consolidation/closure is pending, not silently inferred from baseline passes.
