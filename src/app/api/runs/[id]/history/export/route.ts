import { NextResponse } from "next/server";
import { withTenant } from "@/lib/db";
import { routeRequestContext } from "@/lib/requestContext";
import { csvField } from "@/lib/csvField";

type ExportRow = {
  finding_text: string;
  finding_kind: string | null;
  theme: string | null;
  status: string;
  archived_reason: string;
  archived_at: string;
  insight_headline: string | null;
  insight_quality_tier: string | null;
  researcher_note: string | null;
};

const reasonLabel: Record<string, string> = {
  regenerate_unreviewed: "Regenerate unreviewed",
  full_reprocess: "Reprocess all documents",
  manual_reextract: "Manual re-extract",
  wave_recompare: "Wave comparison re-run",
};

const statusLabel: Record<string, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Rejected",
};

/**
 * Hands back this run's finding_history audit trail as a CSV, the same
 * data the "History" section's "Removed findings" table shows on screen.
 * This exists for the governance/board-reporting use case the app is
 * actually for: "why did this number change between drafts" is a question
 * a plain export answers better than asking someone to go open the app
 * and scroll to a collapsed section.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
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
         ih.quality_tier as insight_quality_tier,
         -- Codex DI-F07 (migration 0114); read through to_jsonb so the export works before it.
         to_jsonb(fh)->>'researcher_note' as researcher_note
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

  const header = ["Finding", "Status when removed", "Insight it fed", "Removed by", "Archived", "Researcher note"];
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
        // Last, so the earlier columns keep their places for existing readers (Codex DI-F07).
        row.researcher_note ?? "",
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
