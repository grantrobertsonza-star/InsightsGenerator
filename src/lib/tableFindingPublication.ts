import type { PoolClient } from "pg";
import { archiveAndReplaceFindings, type ArchiveReason } from "./findingArchive";
import { findingProvenanceAvailable } from "./findingProvenance";
import { claimIdentityKey, planReplacement, type CurrentFinding } from "./findingReplacement";

/**
 * EF-FND-F03 (batch 62): how a table's computed findings are replaced when the table is computed
 * again ("Generate findings", reprocess, a saved banner plan). It used to archive every finding of
 * the table and insert the new set, so a researcher's note, theme, status or an insight built on a
 * finding disappeared on an unchanged retry, and a report finding tied to it lost its link.
 *
 * The rule, inside the caller's transaction (which has locked the table row):
 *  1. A current finding whose definition (what was compared: tableFindingDefinitionKey) and claim
 *     (claimIdentityKey of its wording, which carries every figure) both equal a newly computed
 *     pattern is UNCHANGED: it is kept with its id, status, note, theme, edits, insights and links,
 *     and the pattern is not inserted again. Any recomputation tag from an earlier run is cleared.
 *  2. Every other current finding goes through the report replacement policy (planReplacement in
 *     findingReplacement.ts, the one owner): a finding with a recorded review or edit, a non-default
 *     status, a note or an insight is kept; an untouched one is retired to history; one whose
 *     researcher history is unknown (before migration 0094) withholds the whole replacement with an
 *     error, nothing changed, until it is reviewed.
 *  3. A kept finding from step 2 still describes the table as it was. It is never re-pointed at the
 *     new figures: the new computed fact is inserted as its own finding, and the kept one is tagged
 *     in stated_stats.caveats, "superseded_by_recomputation" (with supersededByFindingId) when the
 *     same comparison now gives different figures, or "not_reproduced_on_recomputation" when the
 *     comparison no longer yields a finding. The researcher's interpretation stays with the evidence
 *     it was written about, and the tag says that evidence is no longer current.
 * A failure anywhere rolls the whole transaction back: the previous findings stay as they were.
 */

export type TablePattern = {
  patternType: string;
  description: string;
  theme: string;
  statedStats: Record<string, unknown>;
  rowIndices: number[];
};

export const SUPERSEDED_TAG = "superseded_by_recomputation";
export const NOT_REPRODUCED_TAG = "not_reproduced_on_recomputation";
const RECOMPUTATION_TAGS = [SUPERSEDED_TAG, NOT_REPRODUCED_TAG];

const str = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? null : String(v));

/**
 * What a computed table finding compares, independent of the figures: its pattern type and the
 * variables, groups or cell it is about, by name (never by column position, so reordered headers
 * keep the identity). An outlier is identified by its column and row. Two findings with the same
 * definition and different wording are the same comparison computed on different data.
 */
export function tableFindingDefinitionKey(
  patternType: string | null,
  stats: Record<string, unknown> | null,
  rowIndices: readonly number[] | null,
): string {
  const s = stats ?? {};
  const pair = (a: unknown, b: unknown) => [str(a), str(b)].sort((x, y) => String(x).localeCompare(String(y)));
  return JSON.stringify([
    patternType,
    str(s.testType),
    str(s.bannerColumn),
    str(s.stubColumn),
    str(s.category),
    pair(s.group1Label, s.group2Label),
    pair(s.variable1, s.variable2),
    str(s.column),
    patternType === "outlier" ? (rowIndices?.[0] ?? null) : null,
  ]);
}

function patternIdentity(definitionKey: string, text: string): string {
  return JSON.stringify([definitionKey, claimIdentityKey(text, null, null)]);
}

type CurrentTableFinding = CurrentFinding & {
  pattern_type: string | null;
  stated_stats: Record<string, unknown> | null;
  source_cells: { rowIndices?: number[] } | null;
};

export type TablePublicationOutcome = {
  inserted: number;
  /** Unchanged findings kept with their ids (step 1). */
  unchanged: number;
  /** Changed or vanished findings kept because a researcher acted on them (step 2), now tagged. */
  keptAndTagged: number;
  retired: number;
};

/** Must run inside withTenant with the table row already locked (`for update`) by the caller. */
export async function publishTableFindings(
  client: PoolClient,
  params: {
    tenantId: string;
    runId: string;
    tableId: string;
    patterns: TablePattern[];
    onlyReplacePending: boolean;
    archiveReason: ArchiveReason;
  },
): Promise<TablePublicationOutcome> {
  const { tenantId, runId, tableId, patterns, onlyReplacePending, archiveReason } = params;
  const provenance = await findingProvenanceAvailable(client);
  const current = await client.query<CurrentTableFinding>(
    `select id, status, researcher_note, source_quote, source_page, finding_text, cited_support_finding_ids,
            pattern_type, stated_stats, source_cells, null::text as original_finding_text,
            ${provenance
              ? "human_reviewed_at, human_edited_fields, provenance_tracked"
              : "null::timestamptz as human_reviewed_at, '{}'::text[] as human_edited_fields, false as provenance_tracked"}
       from findings where source_table_id = $1 and run_id = $2 order by created_at, id for update`,
    [tableId, runId],
  );

  const newByIdentity = new Map<string, TablePattern>();
  for (const p of patterns) {
    const def = tableFindingDefinitionKey(p.patternType, p.statedStats, p.rowIndices);
    newByIdentity.set(patternIdentity(def, p.description), p);
  }

  const unchanged: CurrentTableFinding[] = [];
  const rest: CurrentTableFinding[] = [];
  const covered = new Set<TablePattern>();
  for (const f of current.rows) {
    const def = tableFindingDefinitionKey(f.pattern_type, f.stated_stats, f.source_cells?.rowIndices ?? null);
    const match = newByIdentity.get(patternIdentity(def, f.finding_text));
    if (match && !covered.has(match)) {
      covered.add(match);
      unchanged.push(f);
    } else {
      rest.push(f);
    }
  }

  const withInsights = new Set<string>();
  if (rest.length > 0) {
    const deps = await client.query<{ finding_id: string }>(
      "select distinct finding_id from insights where finding_id = any($1::uuid[])",
      [rest.map((f) => f.id)],
    );
    for (const d of deps.rows) withInsights.add(d.finding_id);
  }
  const plan = planReplacement(rest, withInsights, onlyReplacePending);
  if (plan.legacyUnconfirmedIds.length > 0) {
    const n = plan.legacyUnconfirmedIds.length;
    throw new Error(
      `${n} finding${n === 1 ? "" : "s"} on this table ${n === 1 ? "predates" : "predate"} review tracking` +
        (provenance ? "" : " (database migration 0094 is not applied)") +
        `, so whether a researcher accepted or edited ${n === 1 ? "it" : "them"} cannot be established. Nothing was replaced. ` +
        `Review ${n === 1 ? "it" : "them"} first (accepting, rejecting or editing a finding keeps it), then generate findings again.`,
    );
  }

  await archiveAndReplaceFindings(client, {
    documentColumn: "source_table_id",
    documentId: tableId,
    ids: plan.retireIds,
    onlyRejected: onlyReplacePending,
    archiveReason,
  });

  const insertedByDefinition = new Map<string, string>();
  let inserted = 0;
  for (const pattern of patterns) {
    if (covered.has(pattern)) continue;
    const sourceCells = pattern.rowIndices.length > 0 ? JSON.stringify({ rowIndices: pattern.rowIndices }) : null;
    // Status starts at 'accepted', not 'pending': a researcher reviews by exception (see extractFindings.ts).
    const r = await client.query<{ id: string }>(
      `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, source_cells, data_type, status)
       values ($1, $2, 'generated', $3, $4, $5, $6, $7, $8, 'quantitative', 'accepted') returning id`,
      [tenantId, runId, pattern.description, pattern.theme, pattern.patternType, JSON.stringify(pattern.statedStats), tableId, sourceCells],
    );
    inserted++;
    insertedByDefinition.set(tableFindingDefinitionKey(pattern.patternType, pattern.statedStats, pattern.rowIndices), r.rows[0].id);
  }

  const setTags = async (f: CurrentTableFinding, tag: string | null, supersededBy: string | null) => {
    const stats = f.stated_stats ?? {};
    const caveats = Array.isArray(stats.caveats) ? stats.caveats.filter((c): c is string => typeof c === "string") : [];
    const base = caveats.filter((c) => !RECOMPUTATION_TAGS.includes(c));
    const nextCaveats = tag ? [...base, tag] : base;
    const { supersededByFindingId: previous, ...withoutLink } = stats as Record<string, unknown> & { supersededByFindingId?: unknown };
    const same = nextCaveats.length === caveats.length && nextCaveats.every((c, i) => c === caveats[i]) && (previous ?? null) === supersededBy;
    if (same) return;
    const next = { ...withoutLink, caveats: nextCaveats, ...(supersededBy ? { supersededByFindingId: supersededBy } : {}) };
    await client.query("update findings set stated_stats = $1 where id = $2 and run_id = $3", [JSON.stringify(next), f.id, runId]);
  };

  // The current finding for a comparison: a newly inserted one, or an unchanged one kept from before.
  for (const f of unchanged) {
    const def = tableFindingDefinitionKey(f.pattern_type, f.stated_stats, f.source_cells?.rowIndices ?? null);
    if (!insertedByDefinition.has(def)) insertedByDefinition.set(def, f.id);
    await setTags(f, null, null);
  }
  const keptRest = new Set(plan.keep.map((f) => f.id));
  let keptAndTagged = 0;
  for (const f of rest) {
    if (!keptRest.has(f.id)) continue;
    const def = tableFindingDefinitionKey(f.pattern_type, f.stated_stats, f.source_cells?.rowIndices ?? null);
    const successor = insertedByDefinition.get(def) ?? null;
    await setTags(f, successor ? SUPERSEDED_TAG : NOT_REPRODUCED_TAG, successor);
    keptAndTagged++;
  }

  return { inserted, unchanged: unchanged.length, keptAndTagged, retired: plan.retireIds.length };
}
