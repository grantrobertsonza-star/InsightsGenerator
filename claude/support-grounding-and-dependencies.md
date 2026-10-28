# Insight support: grounding, dependencies and the snapshot it is read from

`src/lib/supportStatus.ts` decides whether each synthesized insight (and pre-insight) rests on
current support: `current`, `stale`, `invalid` or `unknown`, with reasons
(`src/lib/supportStatusShared.ts`). Exports, recommendations and the narrative inherit it: accepted
exports leave `invalid` out with the reason; all-scope exports include it qualified; `stale` and
`unknown` go in qualified. Unknown is never reported as current.

**One snapshot.** `loadInsightSupport` and `loadPreInsightSupport` each read their catalogue check,
support rows, quotes and report texts inside one `withTenantRepeatableRead` transaction
(`src/lib/db.ts`), so a concurrent deletion or a reread that replaces a quote and its source text
together is seen whole or not at all (Codex GTR-02). Limits: the settings lookups in `classifyRows`
run afterwards on their own connections, and the two loaders are separate snapshots, so an export
that calls several loaders is not one atomic read.

**Quote grounding** (Codex GT100-F02). A report finding (origin `stated`, no source table) with a
quote is checked live against its report's current `documents.extracted_text`, using the
extraction's own rule (`src/lib/quoteMatch.ts`). Quote present: no reason. Quote absent:
`quote_missing`, treated as a deleted source (invalid). Text missing or shorter than 50 characters:
not checked (unknown), never invalid. A reread whose download fails changes nothing; a reread that
stored new text and then failed at the model is judged against the stored text. A later reread with
the quote back returns to current without a duplicate finding. Finding id, wording, review decision
and the original quote are never changed by this check.

**Calculation dependencies** (Codex GT100-F03). `tableVariablesFromSavedRequest` returns every
variable the engine reads for a saved table, in engine order and deduplicated: banner columns, row
item variables (batteries included), NET members (`nets[].vars`), filter variables and the older
`layer` filter, the weight, and the design's PSU and strata when named. A correction to any of them
makes dependent insights `stale` with `corrections_changed`; an unrelated correction does not;
clearing it restores current. It returns null (compare the whole file's corrections, the cautious
path) for no saved request, a multiple-response banner `set:<key>` (members resolved from the file,
not recorded in the request) and any shape the engine would not read; never an empty list.

**Drafted-from support across synthesis** (Codex EC10K-F03, batch 64). A synthesized insight reframes
its pre-insights' wording, so each source link records the support its pre-insight was drafted from
(`insights.support_snapshot`, 0103), not the finding's fingerprint at synthesis time. Before, a finding
corrected after its pre-insight was drafted (a withdrawn claim) was stamped current around the older
wording and read "Support current" through recommendations, coverage and both exports. The reader
(`loadInsightSupport`) prefers the pre-insight's snapshot, so links written before batch 64 are
qualified too, without rewriting any row; a pre-insight with no snapshot gives a link written null
("Support not checked"); a legacy link whose pre-insight recorded none keeps what it stored (limit). The
qualification stays until the finding is back to what was drafted from (or the pre-insight is written
again from it); a fingerprint is never refreshed around old wording. No pre-insight regeneration exists
yet, so a corrected finding's synthesized insight stays "changed since drafted" until the researcher
reviews it, keeping its wording and review decision. Pinned by `synthesisDraftedFrom.db.test.ts`
(correction before clustering and while the model answers, unchanged control, recovery, legacy link,
no snapshot, both story exports).

**Tests.** `supportQuoteGrounding.db`, `supportQuoteSnapshot.db` (actual `deleteDocument` and the
actual Slides route, interleaved between the reads), `supportReplacementDuplicates.db`,
`supportNetInputs` and `supportNetInputs.db`, all on real disposable PostgreSQL.

**Limits.** The findings Excel "Quote verified" column shows the value recorded at extraction, not
the live check.
