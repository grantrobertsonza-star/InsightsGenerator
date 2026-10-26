// Whether the saved report narrative was written for the project as it now stands (CE-3, evidence chain,
// 26 October 2026). The narrative's framing (executive summary, situation, complication, governing
// thought) is written against the business problem, the objectives, the decisions and the accepted
// insights. Their fingerprints are stored with it (migration 0121) and compared with the current ones,
// using the same fingerprints as objective coverage (objectiveCoverage.ts) plus the business problem.
// A difference qualifies the narrative wherever it is shown or exported; the narrative itself and any
// wording in it are left as they are until the researcher regenerates the report.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { coverageFingerprint, readCoverageInputs, type CoverageFingerprint } from "./objectiveCoverage";

export type NarrativeFingerprint = CoverageFingerprint & { businessProblem: string };

const LABEL: Record<keyof NarrativeFingerprint, string> = {
  businessProblem: "the business problem",
  objectives: "the objectives",
  decisions: "the decisions",
  projectText: "the project's objective or decision text",
  insights: "the accepted insights",
};

export async function narrativeFingerprint(client: PoolClient, runId: string): Promise<NarrativeFingerprint> {
  const coverage = coverageFingerprint(await readCoverageInputs(client, runId));
  const run = await client.query<{ business_problem: string | null }>("select business_problem from runs where id = $1", [runId]);
  return { ...coverage, businessProblem: createHash("sha256").update(JSON.stringify(run.rows[0]?.business_problem ?? "")).digest("hex") };
}

async function inputsColumn(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_name = 'deck_narratives' and column_name = 'inputs') as ok",
  );
  return r.rows[0]?.ok === true;
}

/** Records what the saved narrative was written against; a no-op before migration 0121. */
export async function recordNarrativeInputs(client: PoolClient, runId: string, inputs: NarrativeFingerprint): Promise<void> {
  if (!(await inputsColumn(client))) return;
  await client.query("update deck_narratives set inputs = $2 where run_id = $1", [runId, JSON.stringify(inputs)]);
}

/**
 * The qualification for the saved narrative, or null when it was written for the current inputs or
 * there is no narrative. Before migration 0121, or for a narrative saved before it, the answer is
 * unknown, and said so.
 */
export async function narrativeFreshnessNote(client: PoolClient, runId: string): Promise<string | null> {
  if (!(await inputsColumn(client))) return null;
  const r = await client.query<{ inputs: unknown }>("select inputs from deck_narratives where run_id = $1", [runId]);
  if (r.rows.length === 0) return null;
  const stored = r.rows[0].inputs as Partial<NarrativeFingerprint> | null;
  const keys = Object.keys(LABEL) as (keyof NarrativeFingerprint)[];
  if (!stored || !keys.every((k) => typeof stored[k] === "string")) {
    return "Not known to be current: this report narrative was written before the app recorded what it was written for. Regenerate the report to be sure it reflects the current objectives and decisions.";
  }
  const now = await narrativeFingerprint(client, runId);
  const changed = keys.filter((k) => stored[k] !== now[k]).map((k) => LABEL[k]);
  if (changed.length === 0) return null;
  const list = changed.length === 1 ? changed[0] : `${changed.slice(0, -1).join(", ")} and ${changed[changed.length - 1]}`;
  return `Written for an earlier version of the project: ${list} changed after this report narrative was generated, and it is shown as it was written. Regenerate the report to update it.`;
}
