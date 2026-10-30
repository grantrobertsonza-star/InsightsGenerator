/**
 * The one policy for what replacing a source's findings may retire and what it must keep (REP-IN-002),
 * and the deterministic identity of a claim. Used by report extraction (extractFindings.ts) and, since
 * EF-FND-F03 (batch 62), by table regeneration (tableFindingPublication.ts), so a researcher's review,
 * edit, note or dependent insight protects a finding the same way whichever route made it.
 * Pure: no database access.
 */

/** Case and whitespace folded: the quote half of claimIdentityKey, and the overlap deduplication key. */
export function normaliseQuote(q: string): string {
  return q.toLowerCase().replace(/\s+/g, " ").trim();
}

export type CurrentFinding = {
  id: string;
  status: string;
  researcher_note: string | null;
  source_quote: string | null;
  source_page: number | null;
  finding_text: string;
  cited_support_finding_ids: unknown;
  /** Null when no explicit researcher review is recorded (or before migration 0094). */
  human_reviewed_at: string | Date | null;
  /** Fields a researcher has explicitly edited; empty when none recorded (or before 0094). */
  human_edited_fields: string[];
  /** False when this row's researcher actions were never recorded (it predates 0094, or 0094 is not applied). */
  provenance_tracked: boolean;
  /** FND-001 probe B: the extracted wording when a researcher has since edited it (migration 0100);
   * null when never edited, or before 0100. Absent in callers that predate it. */
  original_finding_text?: string | null;
};

export function citedIds(f: CurrentFinding): string[] {
  return Array.isArray(f.cited_support_finding_ids)
    ? f.cited_support_finding_ids.filter((x): x is string => typeof x === "string")
    : [];
}

/**
 * REP-IN-002: which of a document's current findings a complete replacement keeps live and which
 * it retires to history, and whether a PARTIAL read may be published at all. Exported for direct
 * testing; the decision is pure.
 *
 * Regenerate rejected (`onlyReplacePending`): rejected findings are retired, everything else is
 * kept (unchanged contract).
 *
 * Full replace: a finding is PROTECTED (kept live with its id, wording, review state, note and
 * dependents) when it has any explicit researcher action or dependent work:
 *   - a recorded researcher review (`human_reviewed_at`, single or bulk, accept or otherwise),
 *   - a recorded researcher edit (`human_edited_fields`: theme, kind or note),
 *   - a status other than `accepted` (no insert writes another status, so it was a decision),
 *   - a non-blank researcher note, or at least one insight built on it,
 *   - or it is cited as support by another protected finding (dependency closure, so a kept
 *     stated insight never points at a retired finding).
 * An unprotected finding with recorded provenance (`provenance_tracked`) is retired. An unprotected
 * finding with UNKNOWN provenance is never retired on its own: it is retired only when its id is in
 * `confirmedLegacyIds`, the explicit, document-scoped confirmation for exactly those findings. If
 * any unknown-provenance finding is not confirmed, `legacyUnconfirmedIds` lists them and the caller
 * withholds the whole replacement. A confirmation can never retire a protected finding.
 */
export function planReplacement(
  current: CurrentFinding[],
  findingIdsWithInsights: ReadonlySet<string>,
  onlyReplacePending: boolean,
  confirmedLegacyIds: ReadonlySet<string> = new Set(),
): { retireIds: string[]; keep: CurrentFinding[]; partialPublishable: boolean; legacyUnconfirmedIds: string[] } {
  if (onlyReplacePending) {
    const retire = current.filter((f) => f.status === "rejected");
    return {
      retireIds: retire.map((f) => f.id),
      keep: current.filter((f) => f.status !== "rejected"),
      // Regenerate-rejected is additive by design: with nothing rejected to
      // retire, a partial read only adds findings next to kept ones.
      partialPublishable: retire.length === 0,
      legacyUnconfirmedIds: [],
    };
  }
  const directlyProtected = (f: CurrentFinding) =>
    f.human_reviewed_at !== null ||
    f.human_edited_fields.length > 0 ||
    f.status !== "accepted" ||
    (f.researcher_note !== null && f.researcher_note.trim() !== "") ||
    findingIdsWithInsights.has(f.id);

  const byId = new Map(current.map((f) => [f.id, f]));
  const protectedIds = new Set(current.filter(directlyProtected).map((f) => f.id));
  let frontier = [...protectedIds];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const cited of citedIds(byId.get(id)!)) {
        if (byId.has(cited) && !protectedIds.has(cited)) {
          protectedIds.add(cited);
          next.push(cited);
        }
      }
    }
    frontier = next;
  }

  const unprotected = current.filter((f) => !protectedIds.has(f.id));
  const retire = unprotected.filter((f) => f.provenance_tracked || confirmedLegacyIds.has(f.id));
  const retireSet = new Set(retire.map((f) => f.id));
  return {
    retireIds: retire.map((f) => f.id),
    keep: current.filter((f) => !retireSet.has(f.id)),
    partialPublishable: current.length === 0,
    legacyUnconfirmedIds: unprotected
      .filter((f) => !f.provenance_tracked && !confirmedLegacyIds.has(f.id))
      .map((f) => f.id),
  };
}

function normaliseClaim(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/[.!;:]+$/, "").trim();
}

/**
 * REP-IN-002: the deterministic identity of a claim for duplicate resolution. Two findings are
 * the same claim only when they say the same thing (normalised claim text) about the same
 * passage (normalised source quote) on the same page of the same document. A shared quote alone
 * never makes two findings duplicates: "Satisfaction is 80%" and "Loyalty is 40%" from one
 * sentence are two claims. No model or semantic similarity is involved; differently worded
 * restatements are kept as separate findings (conservative: nothing distinct is lost).
 * Normalisation only folds case, Unicode form, whitespace and trailing sentence punctuation.
 */
export function claimIdentityKey(text: string, quote: string | null, page: number | null): string {
  return JSON.stringify([normaliseClaim(text), quote ? normaliseQuote(quote) : "", page ?? null]);
}
