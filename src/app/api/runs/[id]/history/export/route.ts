import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportRow = {
  finding_text: string;
  finding_kind: string | null;
  theme: string | null;
  status: string;
  archived_reason: string;
  archived_at: string;
  insight_headline: string | null;
  insight_quality_tier: string | null;
};

const reasonLabel: Record<string, string> = {
  regenerate_unreviewed: "Regenerate unreviewed",
  full_reprocess: "Reprocess all documents",
  manual_reextract: "Manual re-extract",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

/**
 * Escapes one CSV field per RFC 4180: wraps in quotes and doubles any
 * internal quote whenever the value contains a comma, quote, or newline,
 * so a finding's own text (which can contain any of those) can't break
 * the file's column structure for whoever opens it afterward.
 */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Hands back this run's finding_history audit trail as a CSV, the same
 * data the "History" section's "Removed findings" table shows on screen.
 * This exists for the governance/board-reporting use case the app is
 * actually for: "why did this number change between drafts" is a question
 * a plain export answers better than asking someone to go open the app
 * and scroll to a collapsed section.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1",
      [runId]
    );
    const historyResult = await client.query<ExportRow>(
      `select
         fh.finding_text,
         fh.finding_kind,
         fh.theme,
         fh.status,
         fh.archived_reason,
         fh.archived_at,
         ih.headline as insight_headline,
         ih.quality_tier as insight_quality_tier
       from finding_history fh
       left join insight_history ih on ih.original_finding_id = fh.original_finding_id
       where fh.run_id = $1
       order by fh.archived_at desc`,
      [runId]
    );
    return [runResult.rows[0], historyResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const header = ["Finding", "Status when removed", "Insight it fed", "Removed by", "Archived"];
  const lines = [header.map(csvField).join(",")];

  for (const row of rows) {
    const insight = row.insight_headline
      ? `${row.insight_headline}${row.insight_quality_tier ? ` (${row.insight_quality_tier})` : ""}`
      : "";
    lines.push(
      [
        row.finding_text,
        statusLabel[row.status] ?? row.status,
        insight,
        reasonLabel[row.archived_reason] ?? row.archived_reason,
        new Date(row.archived_at).toLocaleString(),
      ]
        .map((value) => csvField(value))
        .join(",")
    );
  }

  const csv = lines.join("\r\n") + "\r\n";

  const safeName = (run.project_name ?? run.decision_statement ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "run";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-history.csv"`,
    },
  });
}
