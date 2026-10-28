// Whether the saved report narrative was written for the project as it now stands (CE-3, evidence chain,
// 26 October 2026). The narrative's framing (executive summary, situation, complication, governing
// thought, recommendations intro) is written against the business problem, the objectives, the
// decisions, the accepted insights and the accepted recommendations. Their fingerprints are stored with
// it (deck_narratives.inputs, migration 0121) and compared with the current ones, using the same
// fingerprints as objective coverage (objectiveCoverage.ts) plus the business problem and the accepted
// recommendations (EF-REP-F01, batch 63). A difference qualifies the narrative wherever it is shown or
// exported; the narrative itself and any wording in it are left as they are until the researcher
// regenerates the report.
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { coverageFingerprint, readCoverageInputs, type CoverageFingerprint } from "./objectiveCoverage";

export type NarrativeFingerprint = CoverageFingerprint & { businessProblem: string; recommendations: string };

/** An accepted recommendation as the report generator gives it to the model. */
export type FramingRecommendation = {
  id: string;
  action_text: string;
  owner_role: string;
  timeline: string;
  priority: "high" | "medium" | "low";
  synthesized_insight_id: string;
  synthesized_insight_headline: string;
};

const LABEL: Record<keyof NarrativeFingerprint, string> = {
  businessProblem: "the business problem",
  objectives: "the objectives",
  decisions: "the decisions",
  projectText: "the project's objective or decision text",
  insights: "the accepted insights",
  recommendations: "the accepted recommendations",
};

// Recorded by every narrative since 0121. Missing any of these, nothing about the record can be trusted.
const CORE_KEYS: (keyof NarrativeFingerprint)[] = ["businessProblem", "objectives", "decisions", "projectText", "insights"];
// Added in batch 63. A narrative saved before then has the core keys but not this one: its
// recommendations part is unknown, never read as current or as changed.
const LATER_KEYS: (keyof NarrativeFingerprint)[] = ["recommendations"];

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/**
 * The accepted recommendations a report narrative is framed with: accepted, anchored to a synthesized
 * insight, in the order the generator lists them. The one reader for both the generator and its
 * fingerprint, so what is fingerprinted is what the model is given. The generator then leaves out a
 * recommendation whose anchor insight's support is invalid (FND-001); the fingerprint keeps it, so a
 * change to such a recommendation qualifies the narrative too (over-cautious, never under).
 */
export async function readFramingRecommendations(client: PoolClient, runId: string): Promise<FramingRecommendation[]> {
  const r = await client.query<FramingRecommendation>(
    `select r.id, r.action_text, r.owner_role, r.timeline, r.priority,
            si.id as synthesized_insight_id, si.headline as synthesized_insight_headline
       from recommendations r
       join synthesized_insights si on si.id = r.synthesized_insight_id
      where r.run_id = $1 and r.status = 'accepted' and r.synthesized_insight_id is not null
      order by si.quality_score desc nulls last, r.created_at, r.id`,
    [runId],
  );
  return r.rows;
}

/**
 * Identity and every field the model is given, as a set: sorted by id, so listing the same
 * recommendations in another order is not a change. Wording, owner, timing, priority and anchor
 * changes are; so is acceptance (a rejected or deleted recommendation leaves the set, a newly
 * accepted one joins it).
 */
function recommendationsFingerprint(recs: FramingRecommendation[]): string {
  return hash(
    [...recs]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((r) => [r.id, r.action_text, r.owner_role, r.timeline, r.priority, r.synthesized_insight_id, r.synthesized_insight_headline]),
  );
}

export async function narrativeFingerprint(client: PoolClient, runId: string): Promise<NarrativeFingerprint> {
  const coverage = coverageFingerprint(await readCoverageInputs(client, runId));
  const run = await client.query<{ business_problem: string | null }>("select business_problem from runs where id = $1", [runId]);
  return {
    ...coverage,
    businessProblem: hash(run.rows[0]?.business_problem ?? ""),
    recommendations: recommendationsFingerprint(await readFramingRecommendations(client, runId)),
  };
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

const listed = (labels: string[]) => (labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`);

/**
 * The qualification for the saved narrative, or null when it was written for the current inputs or
 * there is no narrative. Before migration 0121, or for a narrative saved before it, the answer is
 * unknown, and said so. A narrative recorded before the recommendations were part of the record is
 * compared on what was recorded and says the recommendations part is unknown; it is never null.
 */
export async function narrativeFreshnessNote(client: PoolClient, runId: string): Promise<string | null> {
  // B37-F03 (Codex): before migration 0121 an existing narrative used to get no note at all, the same
  // null as "current". With the column missing, whether a narrative exists is still read (deck_narratives
  // predates 0121), and an existing one is unknown, said so; no narrative is still null.
  const recorded = await inputsColumn(client);
  const r = await client.query<{ inputs: unknown }>(`select ${recorded ? "inputs" : "null::jsonb as inputs"} from deck_narratives where run_id = $1`, [runId]);
  if (r.rows.length === 0) return null;
  const stored = r.rows[0].inputs as Partial<Record<keyof NarrativeFingerprint, unknown>> | null;
  if (!stored || typeof stored !== "object" || !CORE_KEYS.every((k) => typeof stored[k] === "string")) {
    return recorded
      ? "Not known to be current: this report narrative was written before the app recorded what it was written for. Regenerate the report to be sure it reflects the current objectives, decisions and recommendations."
      : "Not known to be current: what this report narrative was written for cannot be checked until a database update (migration 0121) is applied. Apply it, then regenerate the report to be sure it reflects the current objectives, decisions and recommendations.";
  }
  const unknown = LATER_KEYS.filter((k) => typeof stored[k] !== "string");
  const now = await narrativeFingerprint(client, runId);
  const changed = [...CORE_KEYS, ...LATER_KEYS].filter((k) => !unknown.includes(k) && stored[k] !== now[k]).map((k) => LABEL[k]);
  const unknownText = unknown.map((k) => LABEL[k]);
  if (changed.length === 0 && unknown.length === 0) return null;
  if (changed.length === 0) {
    return `Not known to be current: this report narrative was generated before the app recorded ${listed(unknownText)} it was written for, so a change to them since cannot be ruled out. Regenerate the report to be sure it reflects them.`;
  }
  const written = `Written for an earlier version of the project: ${listed(changed)} changed after this report narrative was generated, and it is shown as it was written. Regenerate the report to update it.`;
  return unknown.length === 0
    ? written
    : `${written} Whether ${listed(unknownText)} also changed is not known: they were not recorded when it was generated.`;
}
