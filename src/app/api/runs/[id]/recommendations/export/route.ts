import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportRow = {
  theme: string | null;
  insight_headline: string;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: "high" | "medium" | "low";
  assumptions_and_risks: string;
  alternatives_considered: string;
  status: "pending" | "accepted" | "rejected";
};

/**
 * Hands back a run's recommendations as a formatted .xlsx workbook, mirroring
 * the findings and insights exports. "Accepted" mirrors the findings export's
 * scope split (a rejected recommendation is noise once this is headed to a
 * client or a task board); "all" includes pending and rejected ones too,
 * tagged by status so they are never mistaken for ones that are actually
 * going ahead.
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
    const recommendationsResult = await client.query<ExportRow>(
      `select f.theme, i.headline as insight_headline, r.action_text, r.owner_role,
              r.owner_feasibility_note, r.timeline, r.metric, r.priority,
              r.assumptions_and_risks, r.alternatives_considered, r.status
       from recommendations r
       join insights i on i.id = r.insight_id
       join findings f on f.id = i.finding_id
       where r.run_id = $1${onlyAccepted ? " and r.status = 'accepted'" : ""}
       order by f.theme nulls last, r.created_at`,
      [runId]
    );
    return [runResult.rows[0], recommendationsResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const sheetRows = rows.map((row) => ({
    Theme: row.theme ?? "No theme",
    Priority: row.priority.charAt(0).toUpperCase() + row.priority.slice(1),
    Action: row.action_text,
    Owner: row.owner_role,
    "Owner feasibility": row.owner_feasibility_note,
    Timeline: row.timeline,
    Metric: row.metric,
    "Assumptions & risks": row.assumptions_and_risks,
    "Alternatives considered": row.alternatives_considered,
    Status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
    "From insight": row.insight_headline,
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 24 }, // Theme
    { wch: 10 }, // Priority
    { wch: 50 }, // Action
    { wch: 24 }, // Owner
    { wch: 45 }, // Owner feasibility
    { wch: 20 }, // Timeline
    { wch: 35 }, // Metric
    { wch: 45 }, // Assumptions & risks
    { wch: 45 }, // Alternatives considered
    { wch: 10 }, // Status
    { wch: 40 }, // From insight
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Recommendations");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const safeName = (run.project_name ?? run.decision_statement ?? "recommendations")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "recommendations";

  const suffix = onlyAccepted ? "accepted-recommendations" : "recommendations";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.xlsx"`,
    },
  });
}
