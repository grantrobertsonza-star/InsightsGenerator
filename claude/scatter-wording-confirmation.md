# Scatter findings: researcher wording over changed figures

A scatter correlation posted from Analytics is one finding per file, pair of variable names and
weight (`src/lib/scatterActions.ts`). Each post, repost or revival recomputes the figures on the
server and updates that row in place; the id never changes.

**Wording the researcher edited** (`human_edited_fields` contains `finding_text`, migration 0094)
is never replaced by a post. With the same figures nothing but the basis changes. With changed
figures the stored figures update, the wording stays, and `stated_stats.wording_review =
{ reason: "figures_changed", suggested_text }` records that it was written for earlier figures.
Wording nobody edited is regenerated as before.

**Resolving the review** (`resolveScatterWordingReviewAction`, offered on the Analytics card):
- *Keep my wording*: text and provenance unchanged, the flag cleared,
  `stated_stats.wording_confirmed_for` records the figures it was kept for. A repost with those
  figures does not raise the flag again; changed figures do.
- *Use the current wording*: the offered sentence replaces the text; the previous wording is
  appended to `stated_stats.wording_history` (text, human edit fields and time, replaced at, reason,
  replaced with) and `finding_text` leaves `human_edited_fields`, as `revertFindingWordingTx` marks
  text no longer the researcher's. Later reposts regenerate it; the history stays.
- Concurrency: the document row (id, run, tenant) then the finding row are locked; either lock
  finding nothing refuses. A suggestion that differs from the stored one, or no flag, is
  `{ ok: false, stale: true }` with nothing written, and the card reads the status again. Repeating
  a decision already made is `{ ok: true, changed: false }`. Refused without migration 0094. Each
  decision writes a trace row. Figures, theme and status never change.
- Every repost carries `wording_confirmed_for` and `wording_history` forward.

**File identity** (`documentContentSha`): a missing column (42703, before 0098) reads as no recorded
hash; any other failure refuses the post and gives status unknown, never current.

**Tests.** `scatterFindingPersistence.db.test.ts` (real PostgreSQL; only the file read mocked) and
the browser check `e2e/ui/scatter-wording-review.check.mjs`.

**Limit.** The Findings card does not mark a finding whose wording was kept over changed figures;
the decision is made on the Analytics card.
