import { readFindingRoutes, ROUTE_LABEL, routeText } from "@/lib/analysisPlan";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { withTenant } from "@/lib/db";
import { findingSourceSql, SOURCE_NOT_RECORDED } from "@/lib/sourceAttribution";
import { findingOriginalAvailable } from "@/lib/findingWording";
import { routeRequestContext } from "@/lib/requestContext";

type ExportRow = {
  id: string;
  origin: "stated" | "generated" | "coded";
  data_type: "qualitative" | "quantitative" | null;
  finding_text: string;
  finding_kind: string | null;
  pattern_type: string | null;
  theme: string | null;
  status: string;
  source_filename: string | null;
  source_wave: string | null;
  source_page: number | null;
  quote_verified: boolean | null;
  duplicate_group_id: string | null;
  researcher_note: string | null;
  /** FND-001 probe B: the extracted wording when a researcher edited it; null otherwise (or before 0100). */
  original_finding_text: string | null;
};

const kindLabel: Record<string, string> = {
  fact: "Fact",
  own_finding: "Own finding",
  external_citation: "External citation",
  hypothesis: "Hypothesis",
  methodology: "Methodology",
  recommendation: "Recommendation",
  stated_insight: "Stated insight",
};

const patternLabel: Record<string, string> = {
  segment_difference: "Segment difference",
  trend: "Trend",
  outlier: "Outlier",
  relationship: "Relationship",
};

/**
 * Hands back every finding in a run as a formatted .xlsx workbook, so a
 * researcher can work the review list in Excel (filter, pivot, hand it to
 * someone who isn't going to open the app) rather than being limited to
 * what's on screen here.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  // "accepted" exports only findings you've reviewed and accepted; anything
  // else (including no param at all, to keep old links working) exports
  // every finding regardless of review status.
  const onlyAccepted = searchParams.get("scope") === "accepted";

  const [run, rows] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{ project_name: string | null; decision_statement: string | null }>(
      "select project_name, decision_statement from runs where id = $1",
      [runId]
    );
    const originals = await findingOriginalAvailable(client);
    const findingsResult = await client.query<ExportRow>(
      // Golden-thread repair: source_table_id points at document_tables, not documents, so the
      // old documents-on-source_table_id join never matched and every computed finding exported a
      // blank Source. Resolved through the shared definition (sourceAttribution.ts).
      `select c.id, c.origin, c.finding_text, c.finding_kind, c.pattern_type, c.theme, c.status,
              ${findingSourceSql("c").columns},
              c.quote_verified, c.duplicate_group_id, c.researcher_note, c.data_type,
              ${originals ? "c.original_extraction->>'finding_text'" : "null::text"} as original_finding_text
       from findings c
       ${findingSourceSql("c").join}
       where c.run_id = $1${onlyAccepted ? " and c.status = 'accepted'" : ""}
       order by c.theme nulls last, c.created_at, c.id`,
      [runId]
    );
    // CE-6: planned, discovered or stated, read in the same transaction as the findings.
    const routes = await readFindingRoutes(client, runId);
    return [runResult.rows[0], findingsResult.rows.map((r) => ({ ...r, route: routes.get(r.id) ?? { route: "unknown" as const, planLine: null } }))] as const;
  });

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const sheetRows = rows.map((row) => ({
    Theme: row.theme ?? "No theme",
    Origin:
      row.origin === "generated"
        ? "Generated (from data)"
        : row.origin === "coded"
          ? "Coded (from transcript)"
          : "Stated (from report)",
    Route: ROUTE_LABEL[row.route.route],
    "Plan line": row.route.planLine ? routeText(row.route) : "",
    "Data type": row.data_type === "qualitative" ? "Qualitative" : row.data_type === "quantitative" ? "Quantitative" : "",
    Kind: row.finding_kind
      ? (kindLabel[row.finding_kind] ?? row.finding_kind)
      : row.pattern_type
        ? (patternLabel[row.pattern_type] ?? row.pattern_type)
        : "",
    Finding: row.finding_text,
    // FND-001 probe B: an edited report finding shows the researcher's wording above and the
    // extracted wording here, so the export never passes an edit off as the report's own words.
    "Edited by researcher": row.original_finding_text !== null ? "Yes" : "No",
    "Original wording": row.original_finding_text ?? "",
    Status: row.status.charAt(0).toUpperCase() + row.status.slice(1),
    Source: row.source_filename ?? SOURCE_NOT_RECORDED,
    Wave: row.source_wave ?? "",
    Page: row.source_page ?? "",
    "Quote verified": row.quote_verified === null ? "" : row.quote_verified ? "Yes" : "No",
    "Possible duplicate": row.duplicate_group_id ? "Yes" : "No",
    Note: row.researcher_note ?? "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  worksheet["!cols"] = [
    { wch: 24 }, // Theme
    { wch: 20 }, // Origin
    { wch: 14 }, // Route
    { wch: 60 }, // Plan line
    { wch: 14 }, // Data type
    { wch: 18 }, // Kind
    { wch: 80 }, // Finding
    { wch: 12 }, // Edited by researcher
    { wch: 60 }, // Original wording
    { wch: 10 }, // Status
    { wch: 30 }, // Source
    { wch: 14 }, // Wave
    { wch: 6 },  // Page
    { wch: 14 }, // Quote verified
    { wch: 16 }, // Possible duplicate
    { wch: 40 }, // Note
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Findings");

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const safeName = (run.project_name ?? run.decision_statement ?? "findings")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "findings";

  const suffix = onlyAccepted ? "accepted-findings" : "findings";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.xlsx"`,
    },
  });
}
