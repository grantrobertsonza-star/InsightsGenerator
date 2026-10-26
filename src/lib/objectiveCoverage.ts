// Objective coverage (objective_validations) as stored, and whether it is still current (CE-1, evidence
// chain, 26 October 2026). The one owner for reading coverage: the project page, the exports, the stage
// status and the research assistant all read it here, so a stale or unknown state cannot be dropped by
// one reader and shown by another.
//
// What coverage was assessed against is recorded with it as fingerprints (migration 0119 `inputs`):
// the accepted synthesized insights, the accepted objectives and decisions (by id and wording) and the
// project's own objective and decision text, which stands in when no candidate is accepted. A reader
// compares them with the current inputs. Any difference means the verdicts were made against something
// that has since changed, whatever changed it (an insight accepted or rejected, a re-synthesis, an
// objective edited, an automatic re-check that failed), so the coverage is shown as out of date rather
// than as current. Rows written before migration 0119 carry no fingerprints: their freshness is unknown,
// and said so.
//
// Not in the fingerprint: the objective evidence lane's results. A conclusion may cite them, but they are
// recomputed by their own lane; a change there is not yet detected here (stated in claude/evidence-chain.md).
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ObjectiveValidation } from "./objectiveValidator";

export type CoverageInputs = {
  run: { research_objective: string | null; decision_statement: string | null };
  insights: { id: string }[];
  objectives: { id: string; candidate_text: string; source: string }[];
  decisions: { id: string; candidate_text: string; source: string }[];
};

export type CoverageFingerprint = { insights: string; objectives: string; decisions: string; projectText: string };

const PART_LABEL: Record<keyof CoverageFingerprint, string> = {
  insights: "the accepted insights",
  objectives: "the objectives",
  decisions: "the decisions",
  projectText: "the project's objective or decision text",
};

export type CoverageFreshness =
  | { state: "none" }
  | { state: "current" }
  | { state: "stale"; changed: (keyof CoverageFingerprint)[] }
  | { state: "unknown" };

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Fingerprints of the inputs; order-independent, so only a real change of set or wording differs. */
export function coverageFingerprint(inputs: CoverageInputs): CoverageFingerprint {
  const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
  return {
    insights: hash(byId(inputs.insights).map((i) => i.id)),
    objectives: hash(byId(inputs.objectives).map((c) => [c.id, c.candidate_text, c.source])),
    decisions: hash(byId(inputs.decisions).map((c) => [c.id, c.candidate_text, c.source])),
    projectText: hash([inputs.run.research_objective ?? "", inputs.run.decision_statement ?? ""]),
  };
}

/**
 * Reads what coverage is assessed against. `insights` carries the fields the validator's prompt uses;
 * the fingerprint uses only their ids (synthesized insight wording is not edited in place).
 */
export async function readCoverageInputs<I extends { id: string } = { id: string }>(
  client: PoolClient,
  runId: string,
  insightColumns = "si.id",
): Promise<Omit<CoverageInputs, "insights"> & { insights: I[]; runFound: boolean }> {
  const run = await client.query<{ research_objective: string | null; decision_statement: string | null }>(
    "select research_objective, decision_statement from runs where id = $1",
    [runId],
  );
  const insights = await client.query<I>(
    `select ${insightColumns} from synthesized_insights si
     where si.run_id = $1 and si.review_status = 'accepted'
     order by si.quality_score desc nulls last, si.created_at, si.id`,
    [runId],
  );
  const objectives = await client.query<{ id: string; candidate_text: string; source: string }>(
    "select id, candidate_text, source from objective_candidates where run_id = $1 and status = 'accepted' order by created_at, id",
    [runId],
  );
  const decisions = await client.query<{ id: string; candidate_text: string; source: string }>(
    "select id, candidate_text, source from decision_candidates where run_id = $1 and status = 'accepted' order by created_at, id",
    [runId],
  );
  return {
    runFound: run.rows.length > 0,
    run: run.rows[0] ?? { research_objective: null, decision_statement: null },
    insights: insights.rows,
    objectives: objectives.rows,
    decisions: decisions.rows,
  };
}

function isFingerprint(v: unknown): v is CoverageFingerprint {
  const o = v as Record<string, unknown> | null;
  return !!o && ["insights", "objectives", "decisions", "projectText"].every((k) => typeof o[k] === "string");
}

/** Compares the stored fingerprints of every row with the current ones. */
export function coverageFreshness(stored: unknown[], current: CoverageFingerprint): CoverageFreshness {
  if (stored.length === 0) return { state: "none" };
  // A row without fingerprints (written before migration 0119, or malformed) cannot be checked.
  if (!stored.every(isFingerprint)) return { state: "unknown" };
  const changed = new Set<keyof CoverageFingerprint>();
  for (const s of stored as CoverageFingerprint[]) {
    for (const k of Object.keys(PART_LABEL) as (keyof CoverageFingerprint)[]) if (s[k] !== current[k]) changed.add(k);
  }
  return changed.size === 0 ? { state: "current" } : { state: "stale", changed: [...changed] };
}

/** What a reader is told when coverage is not known to be current; null when it is (or there is none). */
export function coverageFreshnessNote(f: CoverageFreshness): string | null {
  if (f.state === "stale") {
    const parts = f.changed.map((k) => PART_LABEL[k]);
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `Out of date: ${list} changed after this evidence check, so its verdicts may no longer hold. Update coverage to check again.`;
  }
  if (f.state === "unknown") {
    return "Not known to be current: this evidence check was made before the app recorded what it checked against. Update coverage to check again.";
  }
  return null;
}

export type StoredCoverageRow = ObjectiveValidation & {
  id: string;
  objective_candidate_id: string | null;
  decision_candidate_id: string | null;
};

async function columnExists(client: PoolClient, table: string, column: string): Promise<boolean> {
  const r = await client.query<{ exists: boolean }>(
    `select exists (select 1 from information_schema.columns where table_name = $1 and column_name = $2) as "exists"`,
    [table, column],
  );
  return r.rows[0]?.exists === true;
}

/** True once migration 0119 is applied; checked from the catalog, which cannot fail a transaction. */
export async function coverageIdentitySchema(client: PoolClient): Promise<boolean> {
  return columnExists(client, "objective_validations", "inputs");
}

/**
 * The stored coverage of a project with its freshness. Insights cited are read from the
 * objective_validation_insights link table (foreign keys, so a deleted insight is gone rather than a
 * dangling id); before migration 0119, from the legacy uuid[] column.
 */
export async function loadObjectiveCoverage(client: PoolClient, runId: string): Promise<{ rows: StoredCoverageRow[]; freshness: CoverageFreshness }> {
  const degraded = await columnExists(client, "objective_validations", "evidence_digest_degraded");
  const identity = await coverageIdentitySchema(client);
  const r = await client.query<StoredCoverageRow & { inputs?: unknown }>(
    `select ov.id, ov.item_kind, ov.item_order, ov.item_text, ov.status, ov.conclusion, ov.inferred,
            ${degraded ? "ov.evidence_digest_degraded" : "false as evidence_digest_degraded"},
            ${
              identity
                ? `ov.objective_candidate_id, ov.decision_candidate_id, ov.inputs,
                   coalesce((select array_agg(l.synthesized_insight_id order by l.position) from objective_validation_insights l where l.validation_id = ov.id), '{}') as synthesized_insight_ids`
                : "null::uuid as objective_candidate_id, null::uuid as decision_candidate_id, null::jsonb as inputs, ov.synthesized_insight_ids"
            }
     from objective_validations ov
     where ov.run_id = $1
     order by ov.item_kind, ov.item_order`,
    [runId],
  );
  const current = coverageFingerprint(await readCoverageInputs(client, runId));
  const freshness = coverageFreshness(r.rows.map((x) => x.inputs ?? null), current);
  return { rows: r.rows.map((row) => { delete row.inputs; return row; }), freshness };
}

/** Accepted insights no stated (non-inferred) objective or decision cites; empty when there is no coverage. */
export function insightsNoItemCites<T extends { id: string }>(rows: StoredCoverageRow[], accepted: T[]): T[] {
  const stated = rows.filter((r) => !r.inferred);
  if (stated.length === 0) return [];
  const cited = new Set(stated.flatMap((r) => r.synthesized_insight_ids));
  return accepted.filter((i) => !cited.has(i.id));
}

/**
 * The conclusion as it travels without the coverage panel (exports, the assistant): the inferred and
 * degraded qualifications the panel shows, in the wording the exports have used (OBJ-REV-005/012), and
 * an out-of-date or unknown freshness (CE-1), so no export presents a stale verdict as current.
 */
export function qualifiedConclusion(row: StoredCoverageRow, freshness: CoverageFreshness): string {
  const inferred = row.inferred ? "Inferred from this project's own evidence, not an independent test. " : "";
  const degraded = row.evidence_digest_degraded
    ? " (Evidence check degraded: generated while data-evidence retrieval was failing - may be missing evidence a working check would have cited.)"
    : "";
  const note = coverageFreshnessNote(freshness);
  return `${inferred}${row.conclusion}${degraded}${note ? ` (${note})` : ""}`;
}
