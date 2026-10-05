import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportRow = {
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution";
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  decision_context: string | null;
  finding_text: string;
};

const tierLabel: Record<string, string> = {
  robust: "Robust",
  use_with_caution: "Use with caution",
};

/**
 * Hands back every insight on a run as a formatted .xlsx workbook, the same
 * "take it into Excel" escape hatch the findings section already has.
 * Insights only exist once a finding has passed verification, so there is
 * no accepted/all scope split here the way there is for findings.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1",
      [runId]
    );
    const insightsResult = await client.query<ExportRow>(
      `select f.theme, v.verdict_tier, i.headline, i.observation, i.tension, i.implication,
              i.decision_context, f.finding_text
       from insights i
       join findings f on f.id = i.finding_id
       join verdicts v on v.finding_id = f.id
       where i.run_id = $1
       order by f.theme nulls last, i.created_at`,
      [runId]
    );
    return [runResult.rows[0], insightsResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const sheetRows = rows.map((row) => ({
    Theme: row.theme ?? "No theme",
    Robustness: tierLabel[row.verdict_tier] ?? row.verdict_tier,
    Headline: row.headline,
    Observation: row.observation,
    Tension: row.tension,
    Implication: row.implication,
    "Decision this serves": row.decision_context ?? "",
    "From finding": row.finding_text,
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 24 }, // Theme
    { wch: 16 }, // Robustness
    { wch: 40 }, // Headline
    { wch: 60 }, // Observation
    { wch: 50 }, // Tension
    { wch: 50 }, // Implication
    { wch: 40 }, // Decision this serves
    { wch: 60 }, // From finding
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Insights");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const safeName = (run.project_name ?? run.decision_statement ?? "insights")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "insights";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-insights.xlsx"`,
    },
  });
}
