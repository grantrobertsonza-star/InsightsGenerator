import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";
import { EARLIER_DECISIONS_LABEL, writtenForEarlierDecisionsSql } from "@/lib/decisionContext";
import { loadPreInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { SUPPORT_STATUS_LABEL, summariseSupport } from "@/lib/supportStatusShared";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";

type ExportRow = {
  id: string;
  theme: string | null;
  verdict_tier: string | null;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  decision_context: string | null;
  written_for_earlier_decisions: boolean;
  finding_text: string;
};

const tierLabel: Record<string, string> = {
  robust: "Robust",
  use_with_caution: "Use with caution",
  not_supported: "Not supported",
  insufficient_information: "Insufficient information",
};

/**
 * Hands back every pre-insight on a run as a formatted .xlsx workbook, the same "take it into
 * Excel" escape hatch the findings section already has. Every pre-insight is listed (an audit
 * list, no accepted/all split), with its finding's latest verdict and its support status: a
 * pre-insight is drafted from a verified, unrejected finding, but that finding can be rejected,
 * re-verified or changed later, so the workbook states the current support rather than assuming
 * it held (golden-thread GT-006).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  // SEC1: another organisation's project answers exactly like a missing one, before anything is read.
  if (!(await runBelongsToTenant(TENANT_ID, runId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1 and tenant_id = $2",
      [runId, TENANT_ID]
    );
    const insightsResult = await client.query<ExportRow>(
      // The LATEST verdict per finding (joining every verdict repeated a pre-insight once per
      // re-verification and could show a superseded tier), as the pre-insights deck does.
      `select i.id, f.theme, v.verdict_tier, i.headline, i.observation, i.tension, i.implication,
              i.decision_context, f.finding_text,
              ${writtenForEarlierDecisionsSql("i.decision_context", "r.decision_statement")} as written_for_earlier_decisions
       from insights i
       join runs r on r.id = i.run_id
       join findings f on f.id = i.finding_id
       left join lateral (
         select vv.verdict_tier from verdicts vv
         where vv.finding_id = f.id
         order by vv.created_at desc, vv.id desc
         limit 1
       ) v on true
       where i.run_id = $1
       order by f.theme nulls last, i.created_at`,
      [runId]
    );
    return [runResult.rows[0], insightsResult.rows] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // GT-006 (FND-001 for pre-insights): support status from the shared rule, beside the verdict.
  // A rejected finding reads "Support no longer valid" on its row (this workbook is the audit list,
  // so the row stays, qualified); changed or uncheckable support is said in words, never blank.
  const support = await loadPreInsightSupportOrUnchecked(TENANT_ID, runId, rows.map((row) => row.id));
  const sheetRows = rows.map((row) => ({
    Theme: row.theme ?? "No theme",
    Robustness: row.verdict_tier ? tierLabel[row.verdict_tier] ?? row.verdict_tier : "No verdict",
    Support: (() => {
      const s = support.statusOf(row.id);
      return s.status === "current" ? SUPPORT_STATUS_LABEL.current : summariseSupport(s);
    })(),
    Headline: row.headline,
    Observation: row.observation,
    Tension: row.tension,
    Implication: row.implication,
    // The qualification travels with the exported row (see decisionContext.ts).
    "Decision this serves": row.written_for_earlier_decisions
      ? `${EARLIER_DECISIONS_LABEL} (the accepted decisions have changed since): ${row.decision_context}`
      : row.decision_context ?? "",
    "From finding": row.finding_text,
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 24 }, // Theme
    { wch: 16 }, // Robustness
    { wch: 60 }, // Support
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
