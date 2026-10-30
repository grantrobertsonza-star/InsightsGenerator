// The project's research objectives as the insight prompts state them (CE-2, evidence chain, 26 October
// 2026). Before this, insight generation and synthesis saw only the free-text research objective in a
// project with no decision yet, and no objective at all once a decision was confirmed ("validate"
// projects). Both now see the accepted objectives, or the free text when none is accepted.
//
// Context, not a filter: discovery stays open (objectiveValidator.ts explains why objectives are mapped
// deductively only at the end), so the prompts say a finding that fits no objective is still kept.
import type { PoolClient } from "pg";
import { parseNumberedItems } from "./text";

export async function loadObjectiveLines(client: PoolClient, runId: string, researchObjective: string | null): Promise<string[]> {
  const accepted = await client.query<{ candidate_text: string }>(
    "select candidate_text from objective_candidates where run_id = $1 and status = 'accepted' order by created_at, id",
    [runId],
  );
  return accepted.rows.length > 0 ? accepted.rows.map((r) => r.candidate_text) : parseNumberedItems(researchObjective);
}

/** One line for a prompt, or null with no objectives. */
export function objectivesFramingLine(lines: string[]): string | null {
  if (lines.length === 0) return null;
  return `This project's research objectives: ${lines.map((l, i) => `(${i + 1}) ${l.replace(/\s+/g, " ").trim()}`).join("; ")}.`;
}

export const OBJECTIVES_ARE_CONTEXT =
  "Use the objectives as context for what the project set out to learn, not as a filter: a finding or cluster that fits none of them is still kept, since what nobody asked about can matter most.";
