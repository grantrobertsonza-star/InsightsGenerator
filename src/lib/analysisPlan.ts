// CE-6, the analysis plan (evidence chain, 26 October 2026; migration 0123; contract claude/evidence-chain.md).
//
// The plan's lines are the objective evidence questions (objectiveEvidence.ts): each objective or
// decision broken into what to measure, for whom, and what result would support or undermine it,
// written before any table is seen. This module adds what makes them a plan the researcher owns:
//   - approval line by line, at a wording revision (an edit means approving again);
//   - the stated methodology the plan was written with, so a later change is visible;
//   - moving a line's table into Cross tabs with the line recorded on the table, so the findings
//     committed from it are "planned" and carry their objective;
//   - the route of every finding: planned (from a plan line's table), discovered (computed or coded
//     outside the plan) or stated (a report's own claim).
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { withTenant } from "./db";

export const PLAN_MIGRATION_MESSAGE =
  "The analysis plan needs database migration 0123_analysis_plan, which has not been applied. Apply it " +
  "(npx.cmd supabase migration up), then try again. Nothing was changed.";

const PLAN_COLUMNS: { table: string; column: string }[] = [
  { table: "objective_evidence", column: "approved_revision" },
  { table: "objective_evidence", column: "approved_at" },
  { table: "objective_evidence_generations", column: "methodology_state" },
  { table: "objective_evidence_generations", column: "methodology_sha" },
  { table: "document_tables", column: "plan_evidence_id" },
  { table: "document_tables", column: "plan_line" },
];

/** Whether migration 0123 is applied. A catalogue query, so it never aborts the caller's transaction. */
export async function planColumnsAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and (table_name || '.' || column_name) = any($1::text[])`,
    [PLAN_COLUMNS.map((c) => `${c.table}.${c.column}`)],
  );
  return (r.rows[0]?.n ?? 0) === PLAN_COLUMNS.length;
}

async function assertPlanAvailable(client: PoolClient): Promise<void> {
  if (!(await planColumnsAvailable(client))) throw new Error(PLAN_MIGRATION_MESSAGE);
}

/**
 * A line's approval: approved at its current wording, approved at an earlier wording ("changed",
 * which must be approved again before it counts), not approved ("proposed"), or "unknown" when the
 * approval could not be read (migration 0123 missing). Unknown is never shown as proposed.
 */
export type PlanApproval = "approved" | "changed" | "proposed" | "unknown";

export function approvalOf(questionRevision: number, approvedRevision: number | null | undefined, available: boolean): PlanApproval {
  if (!available) return "unknown";
  if (approvedRevision === null || approvedRevision === undefined) return "proposed";
  return approvedRevision === questionRevision ? "approved" : "changed";
}

export type LineApproval = { approved_revision: number | null; approved_at: string | null };

/** Approval of every line of the run, or null before migration 0123. Read through the caller's snapshot. */
export async function readPlanApprovals(client: PoolClient, runId: string): Promise<Map<string, LineApproval> | null> {
  if (!(await planColumnsAvailable(client))) return null;
  const r = await client.query<{ id: string; approved_revision: number | null; approved_at: Date | null }>(
    "select id, approved_revision, approved_at from objective_evidence where run_id = $1",
    [runId],
  );
  return new Map(r.rows.map((row) => [row.id, { approved_revision: row.approved_revision, approved_at: row.approved_at ? new Date(row.approved_at).toISOString() : null }]));
}

// ---- The stated methodology the plan is written with ----

export type StatedMethodology =
  | { state: "stated"; text: string; sha: string }
  | { state: "none_stated" }
  | { state: "not_read" };

/** The sha of a methodology's text, whitespace and case aside, so a re-save of the same text is the same. */
export function methodologySha(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * The project's stated methodology as it stands (runs.methodology, read from the brief, proposal or
 * report by methodologyExtractor.ts). Saved text is "stated", even if a later reading failed (the saved
 * text is kept). With none saved: "none_stated" when the last reading finished and found none, and
 * "not_read" when it was never read or its last reading failed, so a methodology nobody has looked
 * for is never reported as absent.
 */
export async function readStatedMethodology(client: PoolClient, runId: string): Promise<StatedMethodology> {
  const run = await client.query<{ methodology: string | null }>("select methodology from runs where id = $1", [runId]);
  if (run.rows.length === 0) throw new Error("Project not found");
  const text = run.rows[0].methodology?.trim();
  if (text) return { state: "stated", text, sha: methodologySha(text) };
  const last = await client.query<{ event: string }>(
    `select event from trace where run_id = $1 and event in ('methodology_extraction_done', 'methodology_extraction_error')
      order by occurred_at desc, id desc limit 1`,
    [runId],
  );
  return last.rows[0]?.event === "methodology_extraction_done" ? { state: "none_stated" } : { state: "not_read" };
}

/** The part of the plan instructions that carries the stated methodology; empty when there is none. */
export const MAX_METHODOLOGY_CHARS = 1500;
export function methodologyInstruction(m: StatedMethodology): string {
  if (m.state !== "stated") return "";
  const text = m.text.length > MAX_METHODOLOGY_CHARS ? `${m.text.slice(0, MAX_METHODOLOGY_CHARS - 3).trimEnd()}...` : m.text;
  return (
    "\n\nThe project's stated methodology, from its brief, proposal or report. Where it names the groups to compare, " +
    "the measures, or the population, write the questions to follow it; never contradict it, and never invent " +
    `a comparison or a threshold it does not state:\n${text}`
  );
}

/**
 * Whether the current plan was written with the methodology that is stated now. "current": same text
 * (or none either time); "changed": written with other text, or before one was stated; "not_recorded":
 * written before migration 0123 or never generated; "unknown": could not be read.
 */
export type PlanMethodologyFreshness = { state: "current" | "changed" | "not_recorded" | "unknown"; planState: StatedMethodology["state"] | null; nowState: StatedMethodology["state"] | null };

export async function readPlanMethodologyFreshness(client: PoolClient, runId: string): Promise<PlanMethodologyFreshness> {
  if (!(await planColumnsAvailable(client))) return { state: "unknown", planState: null, nowState: null };
  const now = await readStatedMethodology(client, runId);
  const gen = await client.query<{ methodology_state: StatedMethodology["state"] | null; methodology_sha: string | null }>(
    "select methodology_state, methodology_sha from objective_evidence_generations where run_id = $1 and is_current = true limit 1",
    [runId],
  );
  const row = gen.rows[0];
  if (!row || row.methodology_state === null) return { state: "not_recorded", planState: null, nowState: now.state };
  const same =
    row.methodology_state === "stated" ? now.state === "stated" && now.sha === row.methodology_sha : now.state !== "stated";
  return { state: same ? "current" : "changed", planState: row.methodology_state, nowState: now.state };
}

export function planMethodologyNote(f: PlanMethodologyFreshness): string | null {
  if (f.state === "changed")
    return f.planState === "stated"
      ? "The project's stated methodology has changed since this plan was written. Write the plan again to follow it; approved and edited lines are kept."
      : "A methodology has been stated since this plan was written. Write the plan again to follow it; approved and edited lines are kept.";
  if (f.state === "current" && f.planState === "not_read")
    return "The plan was written from the objectives and the data alone: the brief and proposal have not been read for a methodology yet.";
  if (f.state === "not_recorded") return "Whether this plan followed a stated methodology was not recorded (it was written before that was kept).";
  return null;
}

// ---- Approval ----

/**
 * Approves (or withdraws approval of) plan lines at the wording the researcher saw. Each line is
 * locked; a line that no longer exists, or whose wording changed since it was shown
 * (expectedRevision), is refused and nothing in the call is saved. An excluded line cannot be approved.
 * Withdrawing approval needs no revision. All lines in one transaction.
 */
export async function setPlanLineApproval(
  tenantId: string,
  runId: string,
  lines: { id: string; expectedRevision: number }[],
  approve: boolean,
): Promise<{ changed: number }> {
  if (lines.length === 0) return { changed: 0 };
  return withTenant(tenantId, async (client) => {
    await assertPlanAvailable(client);
    let changed = 0;
    for (const line of lines) {
      const r = await client.query<{ question_revision: number; excluded: boolean; approved_revision: number | null }>(
        "select question_revision, excluded, approved_revision from objective_evidence where id = $1 and run_id = $2 and tenant_id = $3 for update",
        [line.id, runId, tenantId],
      );
      const row = r.rows[0];
      if (!row) throw new Error("A plan line no longer exists (it was removed or written again). Reload to see the current plan. Nothing was saved.");
      if (approve) {
        if (row.excluded) throw new Error("An excluded line cannot be approved. Include it first. Nothing was saved.");
        if (row.question_revision !== line.expectedRevision)
          throw new Error("A plan line was changed since you opened it. Reload to see its current wording, then approve it. Nothing was saved.");
        if (row.approved_revision === row.question_revision) continue;
        await client.query("update objective_evidence set approved_revision = question_revision, approved_at = now() where id = $1", [line.id]);
      } else {
        if (row.approved_revision === null) continue;
        await client.query("update objective_evidence set approved_revision = null, approved_at = null where id = $1", [line.id]);
      }
      changed++;
    }
    return { changed };
  });
}

/** An excluded line is not part of the plan, so excluding it withdraws its approval (same transaction as the exclusion). */
export async function withdrawApprovalOnExclusion(client: PoolClient, runId: string, id: string): Promise<void> {
  if (!(await planColumnsAvailable(client))) return;
  await client.query("update objective_evidence set approved_revision = null, approved_at = null where id = $1 and run_id = $2 and excluded = true", [id, runId]);
}

// ---- Plan tables into Cross tabs ----

export type PlanLineSnapshot = {
  evidenceId: string;
  revision: number;
  /** The revision approved when the table was moved; null when the line was not approved then. */
  approvedRevision: number | null;
  question: string;
  itemKind: "objective" | "decision";
  itemText: string;
  objectiveCandidateId: string | null;
  decisionCandidateId: string | null;
};

type LineRow = {
  id: string; question_revision: number; approved_revision: number | null; question: string;
  item_kind: "objective" | "decision"; item_text: string; objective_candidate_id: string | null; decision_candidate_id: string | null;
};

const snapshotOf = (l: LineRow): PlanLineSnapshot => ({
  evidenceId: l.id,
  revision: l.question_revision,
  approvedRevision: l.approved_revision,
  question: l.question,
  itemKind: l.item_kind,
  itemText: l.item_text,
  objectiveCandidateId: l.objective_candidate_id,
  decisionCandidateId: l.decision_candidate_id,
});

/**
 * Moves one evidence table into the Cross tabs draft set, recording the plan line it answers (when the
 * table is one of a line's answers). Before migration 0123 the move happens without the record, as it
 * always did. Returns false when the table is not an evidence table of this run (already moved, or not
 * one). Runs in the caller's transaction.
 */
export async function promoteEvidenceTable(client: PoolClient, runId: string, tableId: string): Promise<boolean> {
  if (!(await planColumnsAvailable(client))) {
    const r = await client.query("update document_tables set crosstab_status = 'draft' where id = $1 and run_id = $2 and crosstab_status = 'evidence' returning id", [tableId, runId]);
    return r.rows.length > 0;
  }
  const line = await client.query<LineRow>(
    `select e.id, e.question_revision, e.approved_revision, e.question, e.item_kind, e.item_text, e.objective_candidate_id, e.decision_candidate_id
       from objective_evidence_results r join objective_evidence e on e.id = r.evidence_id
      where r.table_id = $1 and r.run_id = $2
      order by r.evaluated_at desc nulls last limit 1`,
    [tableId, runId],
  );
  const l = line.rows[0];
  const r = await client.query(
    `update document_tables set crosstab_status = 'draft', plan_evidence_id = $3, plan_line = $4
      where id = $1 and run_id = $2 and crosstab_status = 'evidence' returning id`,
    [tableId, runId, l?.id ?? null, l ? JSON.stringify(snapshotOf(l)) : null],
  );
  return r.rows.length > 0;
}

/**
 * Every approved line's table for one data file, moved into Cross tabs as drafts with their line
 * recorded; committing them there makes planned findings. Only lines approved at their current
 * wording, not excluded, and belonging to a current objective or decision. A line with no table for
 * this file (not answered yet, the data is silent, or the answer failed) is counted, not moved. Safe to
 * repeat: a table already moved is left alone, with the plan line it was moved with.
 *
 * Codex B41-F01: "current" is the plan's own rule, the one the screen counts with (planCounts, rollUp):
 * the line's identity (evidenceIdentity) must match a current item (readCurrentEvidenceItems,
 * currentItemKey). A line whose objective was unaccepted or deleted, or whose origin is unknown or
 * conflicting, is not part of the plan: it is counted as notCurrent and its table is not touched. The
 * run and its accepted objectives and decisions are locked (for share) before they are read, so they
 * cannot change between the check and the move; the whole call is one transaction.
 */
export async function promoteApprovedPlanTables(
  tenantId: string,
  runId: string,
  documentId: string,
): Promise<{ moved: number; alreadyInCrossTabs: number; withoutTable: number; approved: number; notCurrent: number }> {
  return withTenant(tenantId, async (client) => {
    await assertPlanAvailable(client);
    const owner = await client.query("select id from documents where id = $1 and run_id = $2 and tenant_id = $3", [documentId, runId, tenantId]);
    if (owner.rows.length === 0) throw new Error("That data file was not found in this project.");
    const { readCurrentEvidenceItems, currentItemKey, evidenceIdentity } = await import("./objectiveEvidence");
    const run = await client.query("select id from runs where id = $1 and tenant_id = $2 for share", [runId, tenantId]);
    if (run.rows.length === 0) throw new Error("Project not found");
    await client.query("select id from objective_candidates where run_id = $1 and status = 'accepted' for share", [runId]);
    await client.query("select id from decision_candidates where run_id = $1 and status = 'accepted' for share", [runId]);
    const currentKeys = new Set((await readCurrentEvidenceItems(client, runId)).map(currentItemKey));
    const lines = await client.query<LineRow & { item_order: number; origin_candidate_id: string | null; origin_recorded: boolean | null; table_id: string | null; crosstab_status: string | null }>(
      `select e.id, e.question_revision, e.approved_revision, e.question, e.item_kind, e.item_order, e.item_text, e.objective_candidate_id, e.decision_candidate_id,
              e.origin_candidate_id, e.origin_recorded,
              r.table_id, dt.crosstab_status
         from objective_evidence e
         left join objective_evidence_results r on r.evidence_id = e.id and r.document_id = $2
         left join document_tables dt on dt.id = r.table_id
        where e.run_id = $1 and e.excluded = false and e.approved_revision = e.question_revision
        order by e.item_kind desc, e.item_order, e.created_at
        for update of e`,
      [runId, documentId],
    );
    let moved = 0, alreadyInCrossTabs = 0, withoutTable = 0, notCurrent = 0;
    const current = lines.rows.filter((l) => {
      if (currentKeys.has(evidenceIdentity(l).key)) return true;
      notCurrent++;
      return false;
    });
    for (const l of current) {
      if (!l.table_id) { withoutTable++; continue; }
      if (l.crosstab_status !== "evidence") { alreadyInCrossTabs++; continue; }
      const r = await client.query(
        `update document_tables set crosstab_status = 'draft', plan_evidence_id = $3, plan_line = $4
          where id = $1 and run_id = $2 and crosstab_status = 'evidence' returning id`,
        [l.table_id, runId, l.id, JSON.stringify(snapshotOf(l))],
      );
      if (r.rows.length > 0) moved++; else alreadyInCrossTabs++;
    }
    return { moved, alreadyInCrossTabs, withoutTable, approved: current.length, notCurrent };
  });
}

// ---- The route of a finding ----

/**
 * planned: computed from a table moved from the plan (the line is on the table, CE-6).
 * discovered: computed from a table or coded from transcripts outside the plan.
 * stated: a report's or transcript's own claim.
 * unknown: the origin is not one of these, or the table's plan record could not be read.
 */
export type FindingRoute = "planned" | "discovered" | "stated" | "unknown";

export const ROUTE_LABEL: Record<FindingRoute, string> = {
  planned: "Planned",
  discovered: "Discovered",
  stated: "Stated",
  unknown: "Route unknown",
};

export function findingRoute(origin: string | null | undefined, planLine: PlanLineSnapshot | null | undefined, planReadable: boolean): FindingRoute {
  if (origin === "stated") return "stated";
  if (origin === "coded") return "discovered";
  if (origin === "generated") {
    if (planLine) return "planned";
    return planReadable ? "discovered" : "unknown";
  }
  return "unknown";
}

export function parsePlanLine(raw: unknown): PlanLineSnapshot | null {
  const v = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.evidenceId !== "string" || typeof o.question !== "string" || (o.itemKind !== "objective" && o.itemKind !== "decision")) return null;
  return {
    evidenceId: o.evidenceId,
    revision: typeof o.revision === "number" ? o.revision : 0,
    approvedRevision: typeof o.approvedRevision === "number" ? o.approvedRevision : null,
    question: o.question,
    itemKind: o.itemKind,
    itemText: typeof o.itemText === "string" ? o.itemText : "",
    objectiveCandidateId: typeof o.objectiveCandidateId === "string" ? o.objectiveCandidateId : null,
    decisionCandidateId: typeof o.decisionCandidateId === "string" ? o.decisionCandidateId : null,
  };
}

export type FindingRouteInfo = { route: FindingRoute; planLine: PlanLineSnapshot | null };

/** Route of each finding of the run, by finding id, read through the caller's client. */
export async function readFindingRoutes(client: PoolClient, runId: string, findingIds?: string[]): Promise<Map<string, FindingRouteInfo>> {
  const readable = await planColumnsAvailable(client);
  const r = await client.query<{ id: string; origin: string | null; plan_line: unknown }>(
    `select f.id, f.origin, ${readable ? "dt.plan_line" : "null::jsonb as plan_line"}
       from findings f left join document_tables dt on dt.id = f.source_table_id
      where f.run_id = $1 ${findingIds ? "and f.id = any($2::uuid[])" : ""}`,
    findingIds ? [runId, findingIds] : [runId],
  );
  return new Map(r.rows.map((row) => {
    const planLine = parsePlanLine(row.plan_line);
    return [row.id, { route: findingRoute(row.origin, planLine, readable), planLine }];
  }));
}

/** One line for the trail, a card or an export: the route, and for a planned finding its line and objective. */
export function routeText(info: FindingRouteInfo): string {
  if (info.route !== "planned" || !info.planLine) return ROUTE_LABEL[info.route];
  const p = info.planLine;
  const approval = p.approvedRevision === p.revision ? "approved" : "not approved when its table was added";
  return `Planned: "${p.question}" (${approval}), for the ${p.itemKind} "${p.itemText}"`;
}
