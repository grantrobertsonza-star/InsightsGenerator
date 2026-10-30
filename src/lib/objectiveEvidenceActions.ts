"use server";

import { revalidatePath } from "next/cache";
import { withTenant, withTenantRead } from "./db";
import {
  currentItemKey,
  editEvidenceQuestion,
  evaluatePending,
  generateEvidenceQuestions,
  loadObjectiveEvidenceWithCoverage,
  retryEvidence,
  rollUp,
  type EvidenceQuestion,
  type ItemEvidence,
} from "./objectiveEvidence";
import { requireTenantId } from "./requestContext";
import { RUN_NOT_AVAILABLE, runAccessible } from "./runOwnership";
import { planMethodologyNote, promoteApprovedPlanTables, promoteEvidenceTable, setPlanLineApproval } from "./analysisPlan";

type Fail = { ok: false; error: string };

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // OBJ-REV-001/002 Rule B: a missing origin column (migration 0095) must not fall into the generic
  // objective_evidence branch below, whose message names 0066.
  if (/origin_candidate_id|origin_recorded/.test(message) && /does not exist/.test(message))
    return "This needs migration 0095 applied first (npx.cmd supabase migration up): without it the origin of evidence cannot be recorded.";
  // objective_evidence_results's own name contains "objective_evidence" as a
  // substring, so the general check below would also match a missing
  // objective_evidence_results table and always win if it ran first,
  // permanently shadowing the 0069 branch (OBJ-REV-011). Checking the more
  // specific relation name first, and excluding it from the general check,
  // keeps both reachable regardless of check order.
  //
  // "does not exist" alone, not "relation" (OBJ-REV-012): Postgres's permission-denied
  // message - "permission denied for relation objective_evidence" - contains the table
  // name and the word "relation" without the table being missing at all, so matching on
  // "relation" turned a real permission failure into a false "needs this migration"
  // recommendation. "does not exist" is unique to the actual missing-relation error.
  if (/objective_evidence_results/.test(message) && /does not exist/.test(message))
    return "This needs migration 0069 applied first (npx.cmd supabase migration up).";
  // OBJ-REV-009 (third pass): objective_evidence_generations is a new relation this pass
  // introduced (migration 0092) - a database that has 0066/0069 but not 0092 yet would
  // otherwise fall into the generic 0066 branch below with a misleading "needs migration
  // 0066" message, even though 0066 is already applied and the real gap is 0092.
  if (/objective_evidence_generations/.test(message) && /does not exist/.test(message))
    return "This needs migration 0092 applied first (npx.cmd supabase migration up).";
  if (/objective_evidence\b(?!_results)/.test(message) && /does not exist/.test(message))
    return "This needs migration 0066 applied first (npx.cmd supabase migration up).";
  if (/document_tables_crosstab_status_check/.test(message))
    return "This needs migration 0066 applied first (npx.cmd supabase migration up).";
  return message;
}

export async function loadObjectiveEvidenceAction(
  runId: string,
): Promise<
  | {
      ok: true; questions: EvidenceQuestion[]; items: ItemEvidence[]; variablesTruncated: boolean | null; originAvailable: boolean; remaining: number;
      /** CE-6: whether line approval can be read (migration 0123), and the plan's methodology note. */
      planAvailable: boolean; planMethodologyNote: string | null;
    }
  | Fail
> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    // Counter-review on OBJ-REV-009: read back on every load, not only right after a fresh
    // "Gather evidence" click, so the warning survives a page reload instead of vanishing
    // the moment nobody is watching the action's one-shot response anymore.
    //
    // OBJ-REV-009 (fourth pass): questions and coverage used to come from two independent
    // withTenant() calls here (listObjectiveEvidence, then getLatestVariablesTruncated with its
    // own `.catch(() => null)`) - a publish committing between the two could leave this action
    // returning one generation's questions next to a DIFFERENT generation's coverage warning.
    // loadObjectiveEvidenceWithCoverage reads both from one consistent snapshot instead (see its
    // own comment in objectiveEvidence.ts), and already returns `null` - never `false` - for
    // "coverage could not be determined", preserving the distinction the second counter-review
    // required: a verified "not truncated" must never be indistinguishable from "unknown."
    //
    // OBJ-REV-001/002 Rule B: the current objectives/decisions come from the same snapshot as the
    // questions, and grouping/orphan classification here is pure over that returned data.
    // originAvailable = false (migration 0095 not applied) is passed through so the panel can say
    // so; a failed read throws into the catch below, never an empty or all-orphaned success.
    const { questions, variablesTruncated, currentItems, originAvailable, remaining, planMethodology } = await loadObjectiveEvidenceWithCoverage(TENANT_ID, runId);
    const currentKeys = new Set(currentItems.map(currentItemKey));
    return {
      ok: true, questions, items: rollUp(questions, currentKeys), variablesTruncated, originAvailable, remaining,
      planAvailable: planMethodology.state !== "unknown", planMethodologyNote: planMethodologyNote(planMethodology),
    };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Step 1: write the evidence questions for every stated objective and decision. */
export async function generateObjectiveEvidenceAction(
  runId: string,
): Promise<{ ok: true; created: number; items: number; skippedInferred: number; datasets: number; variablesTruncated: boolean } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await generateEvidenceQuestions(TENANT_ID, runId);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/**
 * Step 2: answer a couple of questions. The caller repeats until none
 * remain - OBJ-REV-M04: in practice that's bounded, not unconditional:
 * ObjectiveEvidence.tsx's answerRest() caps itself at 60 calls (120
 * questions, 2 per call) as a runaway guard, so a project with more
 * pending questions than that is left with some unevaluated and the UI
 * says so rather than silently stopping as if finished.
 */
export async function evaluateObjectiveEvidenceAction(
  runId: string,
): Promise<{ ok: true; done: number; remaining: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const r = await evaluatePending(TENANT_ID, runId, 2);
    revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function editObjectiveEvidenceAction(
  runId: string,
  id: string,
  patch: { question?: string; request_text?: string; supports_if?: string; against_if?: string; excluded?: boolean },
): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await editEvidenceQuestion(TENANT_ID, runId, id, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function retryObjectiveEvidenceAction(runId: string, id?: string): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    await retryEvidence(TENANT_ID, runId, id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}


/** Moves an evidence table into the Cross tabs draft set, where it can be edited and committed into findings like any other. */
export async function promoteEvidenceTableAction(runId: string, tableId: string): Promise<{ ok: true } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    // CE-6: the plan line the table answers is recorded on it, so its findings are "planned".
    const moved = await withTenant(TENANT_ID, (client) => promoteEvidenceTable(client, runId, tableId));
    if (!moved) return { ok: false, error: "That table is already in Cross tabs." };
    revalidatePath(`/runs/${runId}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export type EvidenceTableListing = {
  table_id: string;
  question: string;
  objective: string;
  stance: string | null;
  /** "evidence" until promoted; then "draft" or "committed". */
  status: string;
};

/** The tables built from objectives for one data file, for the Cross tabs "ObjectiveTabs" view. */
export async function listEvidenceTablesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; tables: EvidenceTableListing[] } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  try {
    const tables = await withTenantRead(TENANT_ID, async (client) => {
      const r = await client.query<EvidenceTableListing>(
        `select r.table_id, e.question, e.item_text as objective, r.stance,
                coalesce(dt.crosstab_status, 'committed') as status
         from objective_evidence_results r
         join objective_evidence e on e.id = r.evidence_id
         join document_tables dt on dt.id = r.table_id
         where e.run_id = $1 and r.document_id = $2 and r.table_id is not null and e.excluded = false
         order by e.item_kind desc, e.item_order, e.created_at`,
        [runId, documentId],
      );
      return r.rows;
    });
    return { ok: true, tables };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

const isLineList = (v: unknown): v is { id: string; expectedRevision: number }[] =>
  Array.isArray(v) && v.length <= 500 && v.every((x) => x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" && Number.isInteger((x as { expectedRevision?: unknown }).expectedRevision));

/** CE-6: approves plan lines at the wording shown (or withdraws approval). All or nothing. */
export async function setPlanLineApprovalAction(runId: string, lines: unknown, approve: unknown): Promise<{ ok: true; changed: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (!isLineList(lines) || typeof approve !== "boolean") return { ok: false, error: "The plan lines to approve were not understood. Reload and try again." };
  try {
    return { ok: true, ...(await setPlanLineApproval(TENANT_ID, runId, lines, approve)) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** CE-6: moves every approved line's table for one data file into Cross tabs, with its line recorded. */
export async function promoteApprovedPlanTablesAction(
  runId: string,
  documentId: string,
): Promise<{ ok: true; moved: number; alreadyInCrossTabs: number; withoutTable: number; approved: number; notCurrent: number } | Fail> {
  const TENANT_ID = await requireTenantId();
  if (!(await runAccessible(TENANT_ID, runId))) return { ok: false, error: RUN_NOT_AVAILABLE };
  if (typeof documentId !== "string" || !documentId) return { ok: false, error: "Choose a data file." };
  try {
    const r = await promoteApprovedPlanTables(TENANT_ID, runId, documentId);
    if (r.moved > 0) revalidatePath(`/runs/${runId}`);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
