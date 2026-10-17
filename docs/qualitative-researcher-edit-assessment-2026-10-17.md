# Independent qualitative researcher-edit workflow — 2026-10-17

**Result: the tested workflow passes; no new application defect demonstrated.** This is additional coverage, not re-verification or closure of GT-004/005/006. Application source remained read-only. Claude retains ownership of its separate export repairs.

Tested the existing frozen production build at `9190928852496d02306c3a6834023670908d0f06`, application `19b3d54`. All531 frozen src/api/migration paths (including retained test source) match the original manifest. This does not test uncommitted Claude repairs or a future release. Dedicated restricted-role synthetic database on55523, app3241, local storage39129, explicit provider replay; no paid/model calls or development/live writes.

## Different workflow and new coverage

Earlier golden-thread coding coverage checked imported counts and exports. This run follows a researcher who manually changes coding and keeps analytic notes after the initial import. The plain-text focus-group fixture has one moderator, two participant speakers and three participant turns. Researcher XLSX coding is imported through native controls; supplied999 counts are ignored.

| New check | Actual result |
|---|---|
| Save analytic memo | One durable memo, exact wording retained after reload |
| Refused memo save | Disposable before-insert trigger rejects the actual native action; visible Synthetic memo outage, draft retained, zero durable insert |
| Retry memo save | After removing the fault, the same draft persists exactly once |
| Remove a theme from a turn | Durable researcher remove override; Safe delivery falls from2turns/2speakers to1/1 |
| Add existing theme to that turn | Checkout difficulty rises from1turn/1speaker to2turns/1speaker; two turns from P1 do not become two people |
| Save researcher turn note | Exact note survives reload and appears in actual XLSX and DOCX exports |
| Delete one memo | Selected memo disappears after reload; the other memo remains |
| Combined theme/speaker search | Checkout plus P2 returns no turns; Checkout plus P1 returns two; moderator is excluded |
| Create researcher theme | Delivery boundary exists once, applies to the selected turn and remains marked as researcher-authored after reload |
| Preserve unrelated assignments | Checkout2/1, Delivery boundary1/1, Safe delivery1/1; existing note remains |
| Export numeric/provenance cells |13 exact XLSX checks pass: code turn counts, P1/P2 respondent matrix, researcher assignment attribution and3 durable change-history records |

Execution: **9 main workflow checks**, **4 follow-on theme/filter checks**, **13 exact export assertions** pass, plus initial fixture/count assertions. These are grouped assertions, not a claim of a newly executed full unit/browser suite. Actual UI writes/reload and actual export routes are exercised; database reads establish durability. The only direct database mutations are the explicitly owned temporary failure trigger and its removal, never seeding the researcher state being asserted.

## Failed attempts retained

- Initial stack startup failed because this Supabase PostgreSQL image required authentication despite its launch flag. Only the labelled disposable cluster authentication was configured; its corrected startup passed. This is a test-environment prerequisite failure, not an application result.
- Primary workflow reached passing memo save/reload/failure/retry, then could not find Quotes by theme inside a collapsed Coding checks panel.
- First continuation hit a nested-summary selector ambiguity; second continuation matched a parent list containing three turn controls. Both are test selector failures, not application failures. Corrected nearest-turn and exact-summary continuation passes.
- The DOCX route was corrected in the harness before that assertion executed; no incorrect-route404 is reported as an app failure.
- An inspection script initially decoded UTF-8 evidence using the host default code page. Actual database UTF-8 bytes and JavaScript assertions preserve the not-equal sign and Greek character; this was inspection decoding, not a demonstrated application encoding defect.

All original scripts, logs, traces and screenshots retained. Final successful main run is `continuation3/fixture-results.json`; follow-on is `new-theme/fixture-results.json`; exact cells are `exact-export-checks.json`. Some reusable fixture metadata mentions a historical archive branch from its template: that branch was not executed here and is not claimed as new coverage.

## Scope and disposition

No re-apply/model coding quality, statistical agreement/calibration, survey-to-transcript respondent linkage, saturation, multi-transcript codebook reuse or simultaneous reviewer conflict claim. This test deliberately covers a different finite researcher-edit workflow. The previously recorded generic processing-error banner containing an informational imported-count notice remains a wording observation; it is not promoted to a new defect or treated as a failed coding import.

Canonical partition remains **36 Closed /1 Confirmed /6 Blocked=43**. GT-004/006 shared FND qualification repairs and GT-005 crosstab layout repair remain open pending independent verification of the exact repaired commit. Approved exclusions and deployment/security gates unchanged. Replay-only model-quality gap remains explicit. No overall acceptance claim and no push/deployment/author-history rewrite.

Evidence: `scripts/workflow-tenant-review/qual-workflow-20261017/`. Password-free synthetic dump, storage inventory/reads, replay log, source checks, actual edited exports and failed-run artifacts retained. Graceful shutdown removed owned runtime database/role; labelled cluster stopped;3241/39129/55523 listeners clear. No user service stopped.
