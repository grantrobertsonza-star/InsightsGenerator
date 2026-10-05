import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportRow = {
  confidence_tier: "strong" | "moderate" | "exploratory" | null;
  quality_tier: "finding" | "partial" | "qualified" | null;
  quality_score: number | null;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  triangulation_count: number;
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
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const onlyAccepted = searchParams.get("scope") === "accepted";

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1",
      [runId]
    );
    const insightsResult = await client.query<ExportRow>(
      `select si.confidence_tier, si.quality_tier, si.quality_score, si.headline, si.observation,
              si.tension, si.implication, si.triangulation_count, si.source_theme_count,
              si.materiality_rationale, si.action_plan_status, si.review_status,
              array_agg(pi.headline order by pi.created_at) as source_headlines
       from synthesized_insights si
       join synthesized_insight_sources s on s.synthesized_insight_id = si.id
       join insights pi on pi.id = s.pre_insight_id
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

  const sheetRows = rows.map((row) => ({
    Confidence: row.confidence_tier ? confidenceLabel[row.confidence_tier] ?? row.confidence_tier : "",
    Quality: row.quality_tier ? `${qualityLabel[row.quality_tier] ?? row.quality_tier} (${row.quality_score}/25)` : "Not yet scored",
    Status: row.review_status === "accepted" ? "Accepted" : "Rejected",
    Headline: row.headline,
    Observation: row.observation,
    Tension: row.tension,
    Implication: row.implication,
    "Corroborating pre-insights": row.triangulation_count,
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
