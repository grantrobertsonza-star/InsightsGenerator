// GT-007 (authorised by Grant, 2026-10-17): Excel and Slides exports of the MAIN Recommendations
// list, the recommendations anchored to synthesized insights (AI-suggested and researcher-written),
// which until now reached a file only through the narrative. The per-pre-insight exports
// (recommendations/export and export-deck) are unchanged and still cover only that list.
//
// What every row carries, so nothing reaches a file looking more current than it is:
//   - identity: the recommendation's id and its insight's id, never matched by wording;
//   - the reviewed wording and status exactly as stored, who wrote it, and whether it was edited;
//   - the decisions it was written for, by the shared rule (decisionContext.ts, worded by
//     recommendationQualification.ts, as the GT-004 exports and the screen say it);
//   - the support of the insight it rests on, by the shared FND-001 rule (supportStatus.ts), the
//     same status the card shows;
//   - the chain of evidence: the insight's pre-insights and the findings behind them.
// Scope is explicit and named in the file: "all" (every status, an audit view) or "accepted".
// Order is the screen's: insight quality score (highest first), then creation time, then id.
//
// Reading only. A failed read throws (the route answers with an error), never an empty file that
// looks like "no recommendations"; a failed support check reads "Support not checked (reason)".
import { withTenantRead } from "./db";
import { recommendationDecisionContextAvailable, recommendationDecisionStateSql } from "./decisionContext";
import { decisionsWrittenFor, decisionTag, type RecommendationDecisionRow } from "./recommendationQualification";
import { loadInsightSupportOrUnchecked } from "./supportStatus";
import { SUPPORT_STATUS_LABEL, summariseSupport, type InsightSupport } from "./supportStatusShared";

export type MainRecommendationScope = "all" | "accepted";

export function parseScope(value: string | null): MainRecommendationScope {
  return value === "accepted" ? "accepted" : "all";
}

export type MainRecommendationRow = RecommendationDecisionRow & {
  id: string;
  synthesized_insight_id: string;
  insight_headline: string;
  insight_review_status: string;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  assumptions_and_risks: string;
  alternatives_considered: string;
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  evidence_headlines: string[];
  evidence_finding_ids: string[];
};

export type MainRecommendationExport = {
  run: { project_name: string | null; decision_statement: string | null; audience: string | null };
  scope: MainRecommendationScope;
  rows: MainRecommendationRow[];
  supportOf: (row: MainRecommendationRow) => InsightSupport;
};

/** The run and its main-list recommendations in scope, or null when the run does not exist. */
export async function loadMainRecommendations(tenantId: string, runId: string, scope: MainRecommendationScope): Promise<MainRecommendationExport | null> {
  const loaded = await withTenantRead(tenantId, async (client) => {
    const run = await client.query<MainRecommendationExport["run"]>("select project_name, decision_statement, audience from runs where id = $1", [runId]);
    if (!run.rows[0]) return null;
    const recorded = await recommendationDecisionContextAvailable(client);
    const rows = await client.query<MainRecommendationRow>(
      `select r.id, r.synthesized_insight_id, si.headline as insight_headline, si.review_status as insight_review_status,
              r.action_text, r.owner_role, r.owner_feasibility_note, r.timeline, r.metric, r.priority,
              r.assumptions_and_risks, r.alternatives_considered, r.source, r.status, r.edited,
              ${recorded ? "r.decision_context" : "null::text as decision_context"},
              ${recommendationDecisionStateSql("r", "run.decision_statement", recorded)} as decision_state,
              coalesce((select array_agg(pi.headline order by pi.created_at, pi.id)
                          from synthesized_insight_sources s join insights pi on pi.id = s.pre_insight_id
                         where s.synthesized_insight_id = si.id), '{}') as evidence_headlines,
              coalesce((select array_agg(pi.finding_id::text order by pi.created_at, pi.id)
                          from synthesized_insight_sources s join insights pi on pi.id = s.pre_insight_id
                         where s.synthesized_insight_id = si.id), '{}') as evidence_finding_ids
       from recommendations r
       join runs run on run.id = r.run_id
       join synthesized_insights si on si.id = r.synthesized_insight_id
       where r.run_id = $1 and r.synthesized_insight_id is not null${scope === "accepted" ? " and r.status = 'accepted'" : ""}
       order by si.quality_score desc nulls last, r.created_at, r.id`,
      [runId],
    );
    return { run: run.rows[0], rows: rows.rows };
  });
  if (!loaded) return null;
  const support = await loadInsightSupportOrUnchecked(tenantId, runId, Array.from(new Set(loaded.rows.map((r) => r.synthesized_insight_id))));
  return { ...loaded, scope, supportOf: (row) => support.statusOf(row.synthesized_insight_id) };
}

/** Support in words: "Support current", or the status with its reasons. */
export function supportText(support: InsightSupport): string {
  return support.status === "current" ? SUPPORT_STATUS_LABEL.current : summariseSupport(support);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Who wrote it, in the words the card uses, with the edit mark. */
export function authorship(row: MainRecommendationRow): string {
  const who = row.source === "ai_suggested" ? "AI-suggested" : "Researcher-written";
  return row.edited ? `${who}, edited before accepting` : who;
}

/** One export row's fields, in order; the workbook columns and the slide rows both use these. */
export function exportFields(row: MainRecommendationRow, support: InsightSupport): [string, string][] {
  return [
    ["Action", row.action_text],
    ["Status", cap(row.status)],
    ["Written by", authorship(row)],
    ["Priority", cap(row.priority)],
    ["Owner", row.owner_role],
    ["Owner feasibility", row.owner_feasibility_note],
    ["Timeline", row.timeline],
    ["Metric", row.metric],
    ["Assumptions & risks", row.assumptions_and_risks],
    ["Alternatives considered", row.alternatives_considered],
    ["Decisions written for", decisionsWrittenFor(row)],
    ["Support", supportText(support)],
    ["From insight", row.insight_headline],
    ["Insight review", cap(row.insight_review_status)],
    ["Chain of evidence", row.evidence_headlines.length > 0 ? row.evidence_headlines.join(" | ") : "No supporting pre-insights remain"],
    ["Supporting finding IDs", row.evidence_finding_ids.join(", ")],
    ["Recommendation ID", row.id],
    ["Insight ID", row.synthesized_insight_id],
  ];
}

/** Short words for a slide title tag; empty when nothing qualifies the recommendation. */
export function qualificationTags(row: MainRecommendationRow, support: InsightSupport): string {
  const supportTag: Record<InsightSupport["status"], string> = {
    current: "",
    stale: " · SUPPORT CHANGED",
    unknown: " · SUPPORT NOT CHECKED",
    invalid: " · SUPPORT NO LONGER VALID",
  };
  const statusTag = row.status === "accepted" ? "" : row.status === "rejected" ? " · REJECTED" : " · PENDING REVIEW";
  const insightTag = row.insight_review_status === "accepted" ? "" : ` · INSIGHT ${row.insight_review_status.toUpperCase()}`;
  return `${statusTag}${decisionTag(row)}${supportTag[support.status]}${insightTag}`;
}

export function scopeLabel(scope: MainRecommendationScope): string {
  return scope === "accepted"
    ? "Accepted recommendations from the main Recommendations list (recommendations on synthesized insights)"
    : "All recommendations from the main Recommendations list (recommendations on synthesized insights), every review status";
}
