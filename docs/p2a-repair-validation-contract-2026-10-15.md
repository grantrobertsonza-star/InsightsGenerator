# P2a final repair and validation contract — 2026-10-15

One bounded package: IMP-002/IMP-SHIP-001 raw and cached preview authority, plus IMP-005 saved
override picker hydration. Preserve all earlier passing parser/calculation/provenance fixtures
and closed packages. User authorizes completing this repair, verification, validation setup and
a local Git checkpoint; no push/deployment or general audit.

Frozen acceptance:

1. Actual raw preview confirms its choice, adopts/reparses a competing authoritative winner and
   returns visible recovery rather than an unconfirmed table on persistence failure.
2. Cached workbook preview with a missing/unconfirmed/unreadable selected sheet is withheld with
   actionable recovery. No empty-table signal may trigger an automatic reread. Because stored
   tables have no sheet provenance, verify their preview values/count against the unchanged parser
   on the current selected sheet; a mismatch is likewise withheld. Quality/correction displays
   derived from that unsafe cache are withheld. Apply the same rule to the stored-source viewer.
3. Native save/reload/reselect shows the persisted document/canonical override; siblings and other
   documents remain independent. New pending/failed local intent wins over stale props. Preserve
   existing clear/save calculation behavior and canonical naming.

Implementation uses importPreviewIdentity.ts (server-side) and existing page/preview/Import panels.
No migration, engine/parser rewrite, dependency install or TranscriptSetup redesign. Reusing the
existing parser avoids a second sheet-selection algorithm. It reads each affected workbook once
per page load; this bounded correctness tradeoff is explicit, not a measured performance claim.

Validation: retained actual-function and mounted tests for all three repairs, affected parser/
strict-caller/data-quality/routing regressions and full-project typecheck. Reuse existing disposable
P2a PostgreSQL/storage/browser infrastructure only for the affected race/fault, cached missing-sheet
recovery and native picker save/reload cases, under existing synthetic-only P2a authorization and
this verification request. Retain failures/source hashes; no live data/credentials/external model.
No completed unrelated integration matrix needs repeating.

Small automated gate: type generation + typecheck + retained unit tests with existing dependencies;
CI workflow prepared locally for review, no remote execution claimed. Security remains separately
required before public release. Missing evidence is an unexecuted acceptance check, not a defect.

Checkpoint: dedicated local branch, reviewed explicit source/config/migration/test/document list.
Preserve existing application work needed for a usable checkpoint; label unverified broader work
truthfully. Exclude credentials, snippets, generated builds/archives/dumps/logs/profiles, scratch
traces and disposable runtime data. Keep retained integration evidence locally. Consolidate the
43-row release baseline once after final results; no new issue IDs or optional improvements.
