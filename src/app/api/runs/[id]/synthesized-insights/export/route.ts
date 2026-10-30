import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";
import { loadInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { SUPPORT_STATUS_LABEL, summariseSupport } from "@/lib/supportStatusShared";
import { figureCheckLoadErrorNote, loadRunFigureChecksForExport } from "@/lib/figureChecks";
import { figureCheckNote } from "@/lib/numberTrace";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";

type ExportRow = {
  id: string;
  confidence_tier: "strong" | "moderate" | "exploratory" | null;
  quality_tier: "finding" | "partial" | "qualified" | null;
  quality_score: number | null;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  triangulation_count: number;
  /** INS-001: distinct independent evidence sources; null = not checked. */
  independent_source_count: number | null;
  source_theme_count: number;
  materiality_rationale: string | null;
  action_plan_status: "has_action" | "retained_no_action";
  review_status: "accepted" | "rejected";
  source_headlines: string[];
};

const confidenceLabel: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  exploratory: "Exploratory",
};

const qualityLabel: Record<string, string> = {
  qualified: "Qualified",
  partial: "Partial",
  finding: "Finding-level",
};

/**
 * Hands back every synthesized insight on a run as a formatted .xlsx
 * workbook, the same "take it into Excel" escape hatch findings,
 * recommendations, and (1:1) insights already have. Scoped by review
 * status the same way recommendations' export is: ?scope=accepted limits
 * to the ones the researcher actually kept, the default (all) includes
 * rejected ones too so the sheet can double as an audit record.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  // SEC1: another organisation's project answers exactly like a missing one, before anything is read.
  if (!(await runBelongsToTenant(TENANT_ID, runId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const { searchParams } = new URL(request.url);
  const onlyAccepted = searchParams.get("scope") === "accepted";

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1 and tenant_id = $2",
      [runId, TENANT_ID]
    );
    const insightsResult = await client.query<ExportRow>(
      `select si.id, si.confidence_tier, si.quality_tier, si.quality_score, si.headline, si.observation,
              si.tension, si.implication, si.triangulation_count, si.source_theme_count,
              -- INS-001: through to_jsonb so the export works before migration 0097.
              (to_jsonb(si)->>'independent_source_count')::int as independent_source_count,
              si.materiality_rationale, si.action_plan_status, si.review_status,
              coalesce(
                array_agg(pi.headline order by pi.created_at) filter (where pi.id is not null),
                '{}'
              ) as source_headlines
       from synthesized_insights si
       -- FND-001: left joins, so an insight whose every source was deleted is still exported (as
       -- "Support no longer valid") rather than silently vanishing from the audit sheet.
       left join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       left join insights pi on pi.id = s.pre_insight_id
       where si.run_id = $1${onlyAccepted ? " and si.review_status = 'accepted'" : ""}
       group by si.id
       order by si.quality_score desc nulls last, si.created_at`,
      [runId]
    );
    return [runResult.rows[0], insightsResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // FND-001: support status alongside review status (separate axes). A failed check reads
  // "Support not checked" with its reason, never current.
  const support = await loadInsightSupportOrUnchecked(TENANT_ID, runId, rows.map((row) => row.id));
  // Numerical traceability (0101): "All traced" only when a stored check says so; legacy rows say
  // "Not checked", and a failed read says so on every row.
  const figures = await loadRunFigureChecksForExport((fn) => withTenant(TENANT_ID, fn), runId);
  const traced = await withTenant(TENANT_ID, async (client) => {
    if (!figures.available) return new Set<string>();
    const r = await client.query<{ id: string }>(
      "select id from synthesized_insights where run_id = $1 and figure_check->>'status' = 'traced'",
      [runId],
    );
    return new Set(r.rows.map((x) => x.id));
  }).catch(() => new Set<string>());

  const sheetRows = rows.map((row) => ({
    // INS-001: an unassessed tier is said in words, never left blank.
    Confidence: row.confidence_tier
      ? confidenceLabel[row.confidence_tier] ?? row.confidence_tier
      : "Not assessed (sources not checked for independence)",
    Quality: row.quality_tier ? `${qualityLabel[row.quality_tier] ?? row.quality_tier} (${row.quality_score}/25)` : "Not yet scored",
    Status: row.review_status === "accepted" ? "Accepted" : "Rejected",
    Support: (() => {
      const s = support.statusOf(row.id);
      return s.status === "current" ? SUPPORT_STATUS_LABEL.current : summariseSupport(s);
    })(),
    Figures:
      figureCheckLoadErrorNote(figures) ??
      figureCheckNote(figures.synthesizedInsights[row.id]) ??
      (traced.has(row.id) ? "All traced to the cited evidence" : "Not checked"),
    Headline: row.headline,
    Observation: row.observation,
    Tension: row.tension,
    Implication: row.implication,
    "Independent sources": row.independent_source_count ?? "Not checked",
    "Linked pre-insights": row.triangulation_count,
    "Source themes": row.source_theme_count,
    "Materiality rationale": row.materiality_rationale ?? "",
    "Action plan": row.action_plan_status === "has_action" ? "Has action" : "Retained, no action yet",
    "Chain of evidence": row.source_headlines.join(" | "),
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 14 }, // Confidence
    { wch: 22 }, // Quality
    { wch: 10 }, // Status
    { wch: 60 }, // Support
    { wch: 50 }, // Figures
    { wch: 40 }, // Headline
    { wch: 60 }, // Observation
    { wch: 50 }, // Tension
    { wch: 50 }, // Implication
    { wch: 14 }, // Corroborating pre-insights
    { wch: 12 }, // Source themes
    { wch: 50 }, // Materiality rationale
    { wch: 20 }, // Action plan
    { wch: 70 }, // Chain of evidence
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Synthesized insights");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const safeName = (run.project_name ?? run.decision_statement ?? "synthesized-insights")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "synthesized-insights";
  const suffix = onlyAccepted ? "accepted-synthesized-insights" : "synthesized-insights";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.xlsx"`,
    },
  });
}
