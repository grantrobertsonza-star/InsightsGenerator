// The evidence trail of one recommendation (CE-5, Grant, 26 October 2026: "a tree diagram showing how a
// recommendation links to an insight, to a finding or group of findings, to a data point, to an objective
// and/or business decision"). Read only, from stored links:
//
//   decisions it serves      recommendation_decisions (CE-2)
//   objectives it answers    coverage rows citing its insight, by objective id (CE-1), with coverage freshness
//   recommendation → insight recommendations.synthesized_insight_id (or insight_id for a pre-insight one)
//   insight → pre-insights   synthesized_insight_sources
//   pre-insight → finding    insights.finding_id
//   finding → data point     the finding's latest verdict, its stated figures, quote, table and cells
//   data point → source      the source file through source_document_id or source_table_id (sourceAttribution.ts)
//
// A link that is not recorded, out of date or no longer valid is a node that says so (state), never left
// out: a break in the trail is part of the evidence. Nothing is inferred from wording.
import type { PoolClient } from "pg";
import { findingSourceSql, formatFindingSource, SOURCE_NOT_RECORDED, type FindingSource } from "./sourceAttribution";
import { coverageFreshnessNote, coverageRowCurrent, coverageRowNote, loadObjectiveCoverage } from "./objectiveCoverage";
import { loadRecommendationDecisions } from "./recommendationDecisions";
import { loadInsightSupportOrUnchecked } from "./supportStatus";
import { SUPPORT_STATUS_LABEL } from "./supportStatusShared";
import { loadBriefPassages, passageSourceText } from "./briefPassages";

export type TrailNodeKind = "passage" | "decision" | "objective" | "recommendation" | "insight" | "pre_insight" | "finding" | "data" | "source";
/** current: stored and current. caution: stored, with a qualification. broken: not recorded, gone or no longer valid. */
export type TrailState = "current" | "caution" | "broken";

export type TrailNode = {
  kind: TrailNodeKind;
  /** Stable id of the record, when the node is one. */
  id: string | null;
  label: string;
  /** Short facts shown under the label (a verdict, a base, a page). */
  details: string[];
  state: TrailState;
  /** Why the state is not current, in words. */
  note: string | null;
  children: TrailNode[];
};

export type EvidenceTrail = {
  /** What the recommendation is for: decisions served, objectives answered. */
  purpose: TrailNode[];
  /** The recommendation, with its evidence beneath it. */
  root: TrailNode;
};

const node = (kind: TrailNodeKind, id: string | null, label: string, extra: Partial<TrailNode> = {}): TrailNode => ({
  kind, id, label, details: [], state: "current", note: null, children: [], ...extra,
});

const MAX_STAT_FACTS = 6;
/** The scalar facts a finding states (base, value, test...), as "key: value"; nested values are left to the finding's own view. */
function statFacts(stats: unknown): string[] {
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return [];
  return Object.entries(stats as Record<string, unknown>)
    .filter(([, v]) => typeof v === "number" || typeof v === "string" || typeof v === "boolean")
    .slice(0, MAX_STAT_FACTS)
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
}

export async function loadEvidenceTrail(client: PoolClient, tenantId: string, runId: string, recommendationId: string): Promise<EvidenceTrail> {
  const rec = await client.query<{ id: string; action_text: string; status: string; synthesized_insight_id: string | null; insight_id: string | null }>(
    "select id, action_text, status, synthesized_insight_id, insight_id from recommendations where id = $1 and run_id = $2",
    [recommendationId, runId],
  );
  const r = rec.rows[0];
  if (!r) throw new Error("That recommendation is not in this project.");

  // Purpose: decisions served (CE-2) and objectives answered through its insight's coverage (CE-1).
  const purpose: TrailNode[] = [];
  const served = await loadRecommendationDecisions(client, runId, [r.id]);
  const decisions = served?.get(r.id) ?? [];
  if (decisions.length === 0) {
    purpose.push(node("decision", null, "Decision served: not recorded", { state: "broken", note: served === undefined ? "A database update is missing." : "No decision was recorded for this recommendation." }));
  }
  for (const d of decisions) {
    purpose.push(node("decision", d.candidateId, d.text, { state: d.current ? "current" : "caution", note: d.current ? null : "No longer a current decision.", details: [d.origin === "model" ? "Named when the recommendation was written" : "Chosen by the researcher"] }));
  }
  if (r.synthesized_insight_id) {
    const coverage = await loadObjectiveCoverage(client, runId, tenantId);
    const freshness = coverageFreshnessNote(coverage.freshness);
    // B37-F01: whether each answering conclusion stands is its own note: out-of-date inputs, or cited support
    // that is no longer current (the same note the coverage pane and exports show).
    const answering = coverage.rows.filter((row) => row.item_kind === "objective" && !row.inferred && row.synthesized_insight_ids.includes(r.synthesized_insight_id!));
    if (answering.length === 0) {
      purpose.push(
        node("objective", null, coverage.rows.length === 0 ? "Objective answered: not checked yet" : "Answers no stated objective", {
          state: coverage.rows.length === 0 || freshness ? "broken" : "caution",
          note: coverage.rows.length === 0 ? "Coverage has not been checked against the objectives." : (freshness ?? "The last coverage check found no objective this insight answers."),
        }),
      );
    }
    const passages = await loadBriefPassages(client, runId);
    for (const o of answering) {
      const objective = node("objective", o.objective_candidate_id, o.item_text, {
        details: [`Coverage: ${o.status === "resolved" ? "answered" : o.status === "partial" ? "partly answered" : "gap"}`],
        state: coverageRowCurrent(o, coverage.freshness) ? "current" : o.support?.status === "invalid" ? "broken" : "caution",
        note: coverageRowNote(o, coverage.freshness),
      });
      // CE-4: the brief or proposal passage it came from; a typed objective has none, and says so.
      const found = o.objective_candidate_id ? passages?.objectives.get(o.objective_candidate_id) : undefined;
      for (const p of found ?? []) {
        objective.children.push(node("passage", null, `"${p.quote}"`, { details: [passageSourceText(p)], state: p.verified ? "current" : "caution", note: p.verified ? null : "Not found word for word in the document." }));
      }
      if (!found || found.length === 0) objective.details.push(passages === undefined ? "Brief passage: not recorded (a database update is missing)" : "Brief passage: none recorded (typed, or filled before passages were kept)");
      purpose.push(objective);
    }
  } else {
    purpose.push(node("objective", null, "Objective answered: not recorded", { state: "broken", note: "Written from a single pre-insight; coverage is checked for synthesized insights." }));
  }

  const root = node("recommendation", r.id, r.action_text, { details: [`Status: ${r.status}`] });

  // Evidence: the insight, its pre-insights, their findings and data points, and the source files.
  const src = findingSourceSql("f");
  type FindingRow = FindingSource & {
    pre_insight_id: string; pre_headline: string; finding_id: string | null; finding_text: string | null; origin: string | null;
    finding_status: string | null; source_quote: string | null; stated_stats: unknown; verdict_tier: string | null;
  };
  const findingRows = async (where: string, arg: string) =>
    (
      await client.query<FindingRow>(
        `select pi.id as pre_insight_id, pi.headline as pre_headline, f.id as finding_id, f.finding_text, f.origin, f.status as finding_status,
                f.source_quote, f.stated_stats, v.verdict_tier, ${src.columns}
         from insights pi
         left join findings f on f.id = pi.finding_id
         ${src.join}
         left join lateral (select lv.verdict_tier from verdicts lv where lv.finding_id = f.id order by lv.created_at desc, lv.id desc limit 1) v on true
         where ${where}
         order by pi.created_at, pi.id`,
        [arg],
      )
    ).rows;

  const preInsightNode = (row: FindingRow): TrailNode => {
    const pre = node("pre_insight", row.pre_insight_id, row.pre_headline);
    if (!row.finding_id) {
      pre.children.push(node("finding", null, "Finding no longer exists", { state: "broken", note: "The finding this pre-insight was written from was deleted." }));
      return pre;
    }
    const finding = node("finding", row.finding_id, row.finding_text ?? "", {
      details: [`Origin: ${row.origin}`, `Verdict: ${row.verdict_tier ? row.verdict_tier.replace(/_/g, " ") : "not verified"}`],
      state: row.finding_status === "rejected" ? "broken" : row.verdict_tier === "robust" ? "current" : "caution",
      note: row.finding_status === "rejected" ? "Rejected by the researcher." : row.verdict_tier === "robust" ? null : row.verdict_tier === "use_with_caution" ? "Verified with caution." : "Not verified as robust.",
    });
    const facts = statFacts(row.stated_stats);
    const quote = row.source_quote?.trim();
    if (facts.length > 0 || quote) {
      finding.children.push(node("data", null, quote ? `"${quote.length > 220 ? `${quote.slice(0, 217).trimEnd()}...` : quote}"` : "Figures stated", { details: facts }));
    } else {
      finding.children.push(node("data", null, "Data point not recorded", { state: "broken", note: "No figures or quote are stored with this finding." }));
    }
    const where = formatFindingSource(row);
    (finding.children[0] ?? finding).children.push(node("source", null, where ?? SOURCE_NOT_RECORDED, where ? {} : { state: "broken", note: "The finding names no source file." }));
    pre.children.push(finding);
    return pre;
  };

  if (r.synthesized_insight_id) {
    const insight = await client.query<{ id: string; headline: string; review_status: string }>(
      "select id, headline, review_status from synthesized_insights where id = $1",
      [r.synthesized_insight_id],
    );
    const i = insight.rows[0];
    const support = (await loadInsightSupportOrUnchecked(tenantId, runId, [r.synthesized_insight_id])).statusOf(r.synthesized_insight_id);
    const insightNode = node("insight", r.synthesized_insight_id, i?.headline ?? "Insight no longer exists", {
      details: i ? [`Review: ${i.review_status}`, SUPPORT_STATUS_LABEL[support.status]] : [],
      state: !i || support.status === "invalid" ? "broken" : support.status === "current" && i.review_status === "accepted" ? "current" : "caution",
      // The support status is already a detail; the note adds only what the details do not say.
      note: !i ? "The insight was deleted." : i.review_status !== "accepted" ? `Insight ${i.review_status}.` : null,
    });
    const rows = await findingRows("pi.id in (select s.pre_insight_id from synthesized_insight_sources s where s.synthesized_insight_id = $1)", r.synthesized_insight_id);
    if (rows.length === 0) insightNode.children.push(node("pre_insight", null, "No supporting pre-insights remain", { state: "broken" }));
    insightNode.children.push(...rows.map(preInsightNode));
    root.children.push(insightNode);
  } else if (r.insight_id) {
    root.children.push(...(await findingRows("pi.id = $1", r.insight_id)).map(preInsightNode));
  } else {
    root.children.push(node("insight", null, "Insight not recorded", { state: "broken" }));
  }
  return { purpose, root };
}

const KIND_WORD: Record<TrailNodeKind, string> = {
  passage: "Brief passage",
  objective: "Objective",
  decision: "Decision",
  recommendation: "Recommendation",
  insight: "Insight",
  pre_insight: "Pre-insight",
  finding: "Finding",
  data: "Data point",
  source: "Source",
};

export type TrailLine = { depth: number; state: TrailState; text: string };

/**
 * The trail as indented lines, for files (the report's appendix): what it is for at depth 0, then the
 * recommendation and its evidence. A break or caution says so in words, so the file keeps every
 * qualification the screen shows.
 */
export function trailOutline(trail: EvidenceTrail): TrailLine[] {
  const line = (n: TrailNode, depth: number): TrailLine => {
    const facts = n.details.length > 0 ? ` (${n.details.join("; ")})` : "";
    const flag = n.state === "broken" ? ` [Break in the trail${n.note ? `: ${n.note}` : ""}]` : n.state === "caution" && n.note ? ` [Check: ${n.note}]` : "";
    return { depth, state: n.state, text: `${KIND_WORD[n.kind]}: ${n.label}${facts}${flag}` };
  };
  const walk = (n: TrailNode, depth: number): TrailLine[] => [line(n, depth), ...n.children.flatMap((c) => walk(c, depth + 1))];
  return [...trail.purpose.flatMap((n) => walk(n, 0)), ...walk(trail.root, 0)];
}

/** A trail that could not be read, for a file that must still say so (the report appendix). */
export function unreadableTrail(recommendation: string, reason: string): EvidenceTrail {
  return {
    purpose: [],
    root: node("recommendation", null, recommendation, { state: "broken", note: `The evidence trail could not be read: ${reason}` }),
  };
}
