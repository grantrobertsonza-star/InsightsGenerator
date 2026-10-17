import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { safeFileStem } from "@/lib/deckSlides";
import { exportFields, loadMainRecommendations, parseScope, scopeLabel } from "@/lib/mainRecommendationExport";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

/**
 * GT-007: the main Recommendations list (recommendations on synthesized insights, AI-suggested and
 * researcher-written) as a workbook. ?scope=all (default, every review status) or ?scope=accepted.
 * Each row states its decisions, its insight's support and its chain of evidence (see
 * mainRecommendationExport.ts); an "About" sheet names the scope. A failed read is an error
 * response, never an empty workbook.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const scope = parseScope(new URL(request.url).searchParams.get("scope"));
  const data = await loadMainRecommendations(TENANT_ID, runId, scope);
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const fields = data.rows.map((row) => exportFields(row, data.supportOf(row)));
  const header = (fields[0] ?? exportFields(placeholderRow, { status: "current", reasons: [] })).map(([name]) => name);
  const body = fields.length > 0
    ? fields.map((f) => f.map(([, value]) => value))
    : [["No recommendations in this scope.", ...header.slice(1).map(() => "")]];
  const sheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  sheet["!cols"] = header.map((name) => ({ wch: ["Action", "Decisions written for", "Support", "Chain of evidence", "Assumptions & risks", "Alternatives considered", "Owner feasibility"].includes(name) ? 50 : name.endsWith("ID") || name.endsWith("IDs") ? 38 : 18 }));
  const about = XLSX.utils.aoa_to_sheet([
    ["Scope", scopeLabel(scope)],
    ["Recommendations", fields.length],
    ["Project", data.run.project_name ?? ""],
    ["Current decisions", data.run.decision_statement ?? "None accepted"],
    ["Exported at", new Date().toISOString()],
    ["Not included", "Recommendations on pre-insights (the per-pre-insight list has its own export)."],
  ]);
  about["!cols"] = [{ wch: 20 }, { wch: 100 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Recommendations");
  XLSX.utils.book_append_sheet(book, about, "About");
  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const stem = safeFileStem(data.run.project_name ?? data.run.decision_statement ?? "recommendations", "recommendations");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${stem}-main-recommendations-${scope}.xlsx"`,
    },
  });
}

/** Only for the header row of an empty workbook. */
const placeholderRow = {
  id: "", synthesized_insight_id: "", insight_headline: "", insight_review_status: "accepted", action_text: "", owner_role: "",
  owner_feasibility_note: "", timeline: "", metric: "", priority: "low", assumptions_and_risks: "", alternatives_considered: "",
  status: "pending", edited: false, evidence_headlines: [], evidence_finding_ids: [], source: "ai_suggested", decision_context: null, decision_state: null,
} as const satisfies Parameters<typeof exportFields>[0];
