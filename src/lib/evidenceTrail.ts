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
//
// loadObjectiveTrail reads the same links the other way, from one objective down (see its comment).
import { parsePlanLine, planColumnsAvailable, readFindingRoutes, ROUTE_LABEL, type FindingRouteInfo, type PlanLineSnapshot } from "./analysisPlan";
import type { PoolClient } from "pg";
import { findingSourceSql, formatFindingSource, SOURCE_NOT_RECORDED, type FindingSource } from "./sourceAttribution";
import { coverageFreshnessNote, coverageRowCurrent, coverageRowNote, readObjectiveCoverage, withCoverageSupport, type ObjectiveCoverage } from "./objectiveCoverage";
import { withTenantRead } from "./db";
import { loadRecommendationDecisions, servedDecisionNote, type RecommendationDecisionsByRec } from "./recommendationDecisions";
import { loadInsightSupportOrUnchecked, type InsightSupportResult } from "./supportStatus";
import { describeSupportReason, summariseSupport, SUPPORT_STATUS_LABEL, supportReasonStatus } from "./supportStatusShared";
import { loadBriefPassages, passageSourceText } from "./briefPassages";

export type TrailNodeKind = "passage" | "decision" | "objective" | "coverage" | "recommendation" | "insight" | "pre_insight" | "finding" | "plan" | "data" | "source";
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

/**
 * What a trail reads on connections of its own (B39-F01, Codex): the project's coverage with the support
 * of the insights it cites, and every insight's support, from the one support reader. Loaded before the
 * trail's own connection is opened (the support reader opens others, and holding one while waiting for
 * another can exhaust the pool), and one context serves every trail of a project (the report appendix).
 */
export type TrailContext = {
  coverage: ObjectiveCoverage;
  support: InsightSupportResult;
  /**
   * EC10K-P01: what a report with many trails reads once instead of once per trail: the decisions served
   * by the recommendations named when the context was loaded (the bulk reader, so the project's accepted
   * decisions and decision statement are read once), and the project's brief passages. Absent for a
   * context loaded for one trail on screen, which reads them itself.
   */
  shared?: {
    recommendationIds: ReadonlySet<string>;
    served: RecommendationDecisionsByRec;
    passages: BriefPassagesByObjective;
  };
};
type BriefPassagesByObjective = Awaited<ReturnType<typeof loadBriefPassages>>;

/**
 * `recommendationIds`: the recommendations whose trails will be read with this context (an export's
 * appendix). Their served decisions and the brief passages are then read here, in the coverage read's
 * transaction, and a failure fails the context, which each trail then states as unreadable (the
 * export's existing rule for a failed context). A trail for a recommendation not named reads its own.
 */
export async function loadTrailContext(tenantId: string, runId: string, recommendationIds?: string[]): Promise<TrailContext> {
  const { read, shared } = await withTenantRead(tenantId, async (client) => ({
    read: await readObjectiveCoverage(client, runId),
    shared:
      recommendationIds && recommendationIds.length > 0
        ? {
            recommendationIds: new Set(recommendationIds),
            served: await loadRecommendationDecisions(client, runId, recommendationIds),
            passages: await loadBriefPassages(client, runId),
          }
        : undefined,
  }));
  const support = await loadInsightSupportOrUnchecked(tenantId, runId);
  return { coverage: await withCoverageSupport(tenantId, runId, read, support), support, ...(shared ? { shared } : {}) };
}

export async function loadEvidenceTrail(client: PoolClient, tenantId: string, runId: string, recommendationId: string, context: TrailContext): Promise<EvidenceTrail> {
  const rec = await client.query<{ id: string; action_text: string; status: string; synthesized_insight_id: string | null; insight_id: string | null }>(
    "select id, action_text, status, synthesized_insight_id, insight_id from recommendations where id = $1 and run_id = $2",
    [recommendationId, runId],
  );
  const r = rec.rows[0];
  if (!r) throw new Error("That recommendation is not in this project.");

  // Purpose: decisions served (CE-2) and objectives answered through its insight's coverage (CE-1).
  const purpose: TrailNode[] = [];
  // The shared read is used only for a recommendation it was loaded for, and only after the query above
  // has confirmed that recommendation is in this project.
  const shared = context.shared;
  const served = shared?.recommendationIds.has(r.id) ? shared.served : await loadRecommendationDecisions(client, runId, [r.id]);
  const decisions = served?.get(r.id) ?? [];
  if (decisions.length === 0) {
    purpose.push(node("decision", null, "Decision served: not recorded", { state: "broken", note: served === undefined ? "A database update is missing." : "No decision was recorded for this recommendation." }));
  }
  for (const d of decisions) {
    purpose.push(node("decision", d.candidateId, d.text, { state: d.current ? "current" : "caution", note: d.current ? null : `${servedDecisionNote(d).replace(/^./, (c) => c.toUpperCase())}.`, details: [d.origin === "model" ? "Named when the recommendation was written" : "Chosen by the researcher"] }));
  }
  if (r.synthesized_insight_id) {
    const coverage = context.coverage;
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
    const passages = shared ? shared.passages : await loadBriefPassages(client, runId);
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
  if (r.synthesized_insight_id) {
    root.children.push(await synthesizedInsightNode(client, runId, r.synthesized_insight_id, context));
  } else if (r.insight_id) {
    root.children.push(...(await preInsightTrees(client, runId, "pi.id = $1", r.insight_id)));
  } else {
    root.children.push(node("insight", null, "Insight not recorded", { state: "broken" }));
  }
  return { purpose, root };
}

// The evidence beneath an insight, shared by the recommendation trail and the objective trail so the two
// can never describe the same finding differently.
type FindingFields = FindingSource & {
  finding_id: string; finding_text: string | null; origin: string | null; finding_status: string | null;
  source_quote: string | null; stated_stats: unknown; verdict_tier: string | null;
};
type PreInsightRow = Omit<FindingFields, "finding_id"> & { pre_insight_id: string; pre_headline: string; finding_id: string | null };

const FINDING_COLUMNS = (src: { columns: string }) =>
  `f.id as finding_id, f.finding_text, f.origin, f.status as finding_status, f.source_quote, f.stated_stats, v.verdict_tier, ${src.columns}`;
const LATEST_VERDICT = "left join lateral (select lv.verdict_tier from verdicts lv where lv.finding_id = f.id order by lv.created_at desc, lv.id desc limit 1) v on true";

/** A plan line (CE-6) as the trail shows it: approved at the wording its table was added under, or not. */
function planLineNode(p: PlanLineSnapshot, extraDetails: string[] = []): TrailNode {
  const approved = p.approvedRevision === p.revision;
  return node("plan", p.evidenceId, p.question, {
    details: [...extraDetails, approved ? "Approved in the analysis plan" : "Not approved when its table was added"],
    state: approved ? "current" : "caution",
    note: approved ? null : "The plan line was not approved at this wording when its table was moved into Cross tabs.",
  });
}

/**
 * One finding, its data point and source file. `showPlan` hangs a planned finding's plan line beneath it
 * (the recommendation trail); the objective trail already shows the line above its findings.
 */
function findingNode(row: FindingFields, route: FindingRouteInfo, showPlan: boolean): TrailNode {
  const finding = node("finding", row.finding_id, row.finding_text ?? "", {
    details: [`Origin: ${row.origin}`, `Verdict: ${row.verdict_tier ? row.verdict_tier.replace(/_/g, " ") : "not verified"}`, `Route: ${ROUTE_LABEL[route.route]}`],
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
  finding.children[0].children.push(node("source", null, where ?? SOURCE_NOT_RECORDED, where ? {} : { state: "broken", note: "The finding names no source file." }));
  // After the data point, so the data point stays the finding's first child (its source hangs off it).
  if (showPlan && route.route === "planned" && route.planLine) {
    finding.children.push(planLineNode(route.planLine, [`For the ${route.planLine.itemKind}: ${route.planLine.itemText}`]));
  }
  return finding;
}

const UNKNOWN_ROUTE: FindingRouteInfo = { route: "unknown", planLine: null };

/** Pre-insights matching `where` (on alias pi, one parameter), each with its finding beneath it. */
async function preInsightTrees(client: PoolClient, runId: string, where: string, arg: string): Promise<TrailNode[]> {
  const src = findingSourceSql("f");
  const rows = (
    await client.query<PreInsightRow>(
      `select pi.id as pre_insight_id, pi.headline as pre_headline, ${FINDING_COLUMNS(src)}
       from insights pi
       left join findings f on f.id = pi.finding_id
       ${src.join}
       ${LATEST_VERDICT}
       where ${where}
       order by pi.created_at, pi.id`,
      [arg],
    )
  ).rows;
  const ids = rows.map((row) => row.finding_id).filter((x): x is string => !!x);
  const routes = ids.length > 0 ? await readFindingRoutes(client, runId, ids) : new Map<string, FindingRouteInfo>();
  return rows.map((row) => {
    const pre = node("pre_insight", row.pre_insight_id, row.pre_headline);
    if (!row.finding_id) {
      pre.children.push(node("finding", null, "Finding no longer exists", { state: "broken", note: "The finding this pre-insight was written from was deleted." }));
    } else {
      pre.children.push(findingNode({ ...row, finding_id: row.finding_id }, routes.get(row.finding_id) ?? UNKNOWN_ROUTE, true));
    }
    return pre;
  });
}

/** A synthesized insight with its review and support status, and the pre-insights it was built from. */
async function synthesizedInsightNode(client: PoolClient, runId: string, insightId: string, context: TrailContext): Promise<TrailNode> {
  const insight = await client.query<{ id: string; headline: string; review_status: string }>(
    "select id, headline, review_status from synthesized_insights where id = $1 and run_id = $2",
    [insightId, runId],
  );
  const i = insight.rows[0];
  const support = context.support.statusOf(insightId);
  const insightNode = node("insight", insightId, i?.headline ?? "Insight no longer exists", {
    details: i ? [`Review: ${i.review_status}`, SUPPORT_STATUS_LABEL[support.status]] : [],
    state: !i || support.status === "invalid" ? "broken" : support.status === "current" && i.review_status === "accepted" ? "current" : "caution",
    // The note says why support is not current (the same sentence as the insight card), and the review status.
    note: !i ? "The insight was deleted." : [i.review_status !== "accepted" ? `Insight ${i.review_status}.` : null, summariseSupport(support) || null].filter(Boolean).join(" ") || null,
  });
  const pres = await preInsightTrees(client, runId, "pi.id in (select s.pre_insight_id from synthesized_insight_sources s where s.synthesized_insight_id = $1)", insightId);
  // Each finding whose part of the support changed since the insight was drafted says so where it stands,
  // so a finding is never shown unqualified on its own (a deck page can hold a finding without its insight).
  const changed = new Map<string, string[]>();
  for (const reason of support.reasons) {
    const status = supportReasonStatus(reason);
    if (!reason.findingId || status === "current") continue;
    changed.set(reason.findingId, [...(changed.get(reason.findingId) ?? []), `${SUPPORT_STATUS_LABEL[status]}: ${describeSupportReason(reason)}`]);
  }
  // The pre-insight written from such a finding says so too: on a deck page the pre-insight line can sit
  // on one slide and its finding on the next (journey C5), and neither may read as unqualified.
  const qualify = (n: TrailNode) => {
    const findingId = n.kind === "finding" ? n.id : n.kind === "pre_insight" ? (n.children.find((c) => c.kind === "finding")?.id ?? null) : null;
    const why = findingId ? changed.get(findingId) : undefined;
    if (why) {
      if (n.state === "current") n.state = "caution";
      n.note = [n.note, `${why.join("; ")}.`].filter(Boolean).join(" ");
    }
    n.children.forEach(qualify);
  };
  pres.forEach(qualify);
  if (pres.length === 0) insightNode.children.push(node("pre_insight", null, "No supporting pre-insights remain", { state: "broken" }));
  insightNode.children.push(...pres);
  return insightNode;
}

/**
 * The trail read the other way, from one objective (evidence trail extras, Grant, 26 October 2026): the
 * brief passages it came from, the coverage conclusion about it, the insights that conclusion cites (each
 * with the recommendations acting on it and the evidence beneath it), and the findings planned for it in
 * the analysis plan (CE-6). Same nodes as the recommendation trail; the conclusion is the root.
 *
 * Planned findings are found through the plan line recorded on their table when it was moved into Cross
 * tabs (document_tables.plan_line, a snapshot), so a plan line since reworded or excluded still shows
 * what the finding was planned for. A current plan line with no finding yet is shown as such. Before
 * migration 0123 nothing can be said about planned findings, and the trail says so.
 */
export async function loadObjectiveTrail(client: PoolClient, runId: string, objectiveId: string, context: TrailContext): Promise<EvidenceTrail> {
  const obj = await client.query<{ id: string; candidate_text: string; status: string }>(
    "select id, candidate_text, status from objective_candidates where id = $1 and run_id = $2",
    [objectiveId, runId],
  );
  const o = obj.rows[0];
  if (!o) throw new Error("That objective is not in this project.");

  const objective = node("objective", o.id, o.candidate_text, {
    details: [`Status: ${o.status}`],
    state: o.status === "accepted" ? "current" : "caution",
    note: o.status === "accepted" ? null : "Not an accepted objective.",
  });
  const passages = await loadBriefPassages(client, runId);
  const found = passages?.objectives.get(o.id) ?? [];
  for (const p of found) {
    objective.children.push(node("passage", null, `"${p.quote}"`, { details: [passageSourceText(p)], state: p.verified ? "current" : "caution", note: p.verified ? null : "Not found word for word in the document." }));
  }
  if (found.length === 0) objective.details.push(passages === undefined ? "Brief passage: not recorded (a database update is missing)" : "Brief passage: none recorded (typed, or filled before passages were kept)");

  // The coverage conclusion about this objective, by its id; never matched by wording.
  const coverage = context.coverage;
  const row = coverage.rows.find((c) => c.item_kind === "objective" && c.objective_candidate_id === o.id);
  const freshness = coverageFreshnessNote(coverage.freshness);
  const root = row
    ? node("coverage", row.id, row.conclusion, {
        details: [`Coverage: ${row.status === "resolved" ? "answered" : row.status === "partial" ? "partly answered" : "gap"}`],
        state: coverageRowCurrent(row, coverage.freshness) ? "current" : row.support?.status === "invalid" ? "broken" : "caution",
        note: coverageRowNote(row, coverage.freshness),
      })
    : node("coverage", null, coverage.rows.length === 0 ? "Coverage not checked yet" : "No coverage conclusion for this objective", {
        state: "broken",
        note: coverage.rows.length === 0 ? "Coverage has not been checked against the objectives." : (freshness ?? "The last coverage check has no row for this objective (added since, or the check was run before objectives were kept by id)."),
      });

  if (row) {
    if (row.synthesized_insight_ids.length === 0) root.children.push(node("insight", null, "No insight cited", { state: row.status === "gap" ? "caution" : "broken", note: "The conclusion cites no insight." }));
    const recs = await client.query<{ id: string; action_text: string; status: string; synthesized_insight_id: string }>(
      "select id, action_text, status, synthesized_insight_id from recommendations where run_id = $1 and synthesized_insight_id = any($2::uuid[]) order by created_at, id",
      [runId, row.synthesized_insight_ids],
    );
    for (const insightId of row.synthesized_insight_ids) {
      const insight = await synthesizedInsightNode(client, runId, insightId, context);
      const acting = recs.rows.filter((rec) => rec.synthesized_insight_id === insightId).map((rec) => node("recommendation", rec.id, rec.action_text, { details: [`Status: ${rec.status}`] }));
      // Recommendations first: what was done with the insight, then what it rests on.
      insight.children.unshift(...(acting.length > 0 ? acting : [node("recommendation", null, "No recommendation acts on this insight", { state: "caution" })]));
      root.children.push(insight);
    }
  }

  root.children.push(...(await plannedForObjective(client, runId, o.id)));
  return { purpose: [objective], root };
}

/** Plan lines for one objective, each with the findings from its tables (CE-6). */
async function plannedForObjective(client: PoolClient, runId: string, objectiveId: string): Promise<TrailNode[]> {
  if (!(await planColumnsAvailable(client))) {
    return [node("plan", null, "Planned findings: not recorded", { state: "broken", note: "A database update is missing (migration 0123)." })];
  }
  const src = findingSourceSql("f");
  const findings = await client.query<FindingFields & { plan_line: unknown }>(
    `select ${FINDING_COLUMNS(src)}, src_dt.plan_line
       from findings f
       ${src.join}
       ${LATEST_VERDICT}
      where f.run_id = $1 and src_dt.plan_line ->> 'objectiveCandidateId' = $2
      order by f.created_at, f.id`,
    [runId, objectiveId],
  );
  const lines = await client.query<{ id: string; question: string; question_revision: number; approved_revision: number | null; item_text: string }>(
    `select id, question, question_revision, approved_revision, item_text from objective_evidence
      where run_id = $1 and item_kind = 'objective' and objective_candidate_id = $2 and not excluded
      order by item_order, created_at, id`,
    [runId, objectiveId],
  );
  const routes = findings.rows.length > 0 ? await readFindingRoutes(client, runId, findings.rows.map((f) => f.finding_id)) : new Map<string, FindingRouteInfo>();
  const byLine = new Map<string, TrailNode>();
  for (const f of findings.rows) {
    const p = parsePlanLine(f.plan_line);
    if (!p) continue;
    let line = byLine.get(p.evidenceId);
    if (!line) byLine.set(p.evidenceId, (line = planLineNode(p)));
    line.children.push(findingNode(f, routes.get(f.finding_id) ?? UNKNOWN_ROUTE, false));
  }
  for (const l of lines.rows) {
    if (byLine.has(l.id)) continue;
    const approved = l.approved_revision === l.question_revision;
    byLine.set(l.id, node("plan", l.id, l.question, {
      details: [approved ? "Approved in the analysis plan" : "Not approved"],
      state: "caution",
      note: "No finding from this plan line yet.",
    }));
  }
  return [...byLine.values()];
}

const KIND_WORD: Record<TrailNodeKind, string> = {
  passage: "Brief passage",
  objective: "Objective",
  coverage: "Coverage conclusion",
  plan: "Plan line",
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
