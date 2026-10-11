"use server";

import { revalidatePath } from "next/cache";
import {
  editEvidenceQuestion,
  evaluatePending,
  generateEvidenceQuestions,
  listObjectiveEvidence,
  retryEvidence,
  rollUp,
  type EvidenceQuestion,
  type ItemEvidence,
} from "./objectiveEvidence";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type Fail = { ok: false; error: string };

function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/objective_evidence/.test(message) && /(does not exist|relation)/.test(message))
    return "This needs migration 0066 applied first (npx.cmd supabase migration up).";
  if (/objective_evidence_results/.test(message) && /(does not exist|relation)/.test(message))
    return "This needs migration 0069 applied first (npx.cmd supabase migration up).";
  if (/document_tables_crosstab_status_check/.test(message))
    return "This needs migration 0066 applied first (npx.cmd supabase migration up).";
  return message;
}

export async function loadObjectiveEvidenceAction(
  runId: string,
): Promise<{ ok: true; questions: EvidenceQuestion[]; items: ItemEvidence[] } | Fail> {
  try {
    const questions = await listObjectiveEvidence(TENANT_ID, runId);
    return { ok: true, questions, items: rollUp(questions) };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Step 1: write the evidence questions for every stated objective and decision. */
export async function generateObjectiveEvidenceAction(
  runId: string,
): Promise<{ ok: true; created: number; items: number; skippedInferred: number; datasets: number } | Fail> {
  try {
    const r = await generateEvidenceQuestions(TENANT_ID, runId);
    return { ok: true, ...r };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

/** Step 2: answer a couple of questions. The caller repeats until none remain. */
export async function evaluateObjectiveEvidenceAction(
  runId: string,
): Promise<{ ok: true; done: number; remaining: number } | Fail> {
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
  try {
    await editEvidenceQuestion(TENANT_ID, runId, id, patch);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}

export async function retryObjectiveEvidenceAction(runId: string, id?: string): Promise<{ ok: true } | Fail> {
  try {
    await retryEvidence(TENANT_ID, runId, id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: explain(error) };
  }
}
