import { archiveAndReplaceFindings, type ArchiveReason } from "./findingArchive";
import { withTenant } from "./db";
import { computeBannerPlanPatterns } from "./bannerPlanComputation";

/**
 * The raw-data counterpart to generateFindingsFromTable.ts: runs the
 * pre-specified banner x stub comparisons (see bannerPlanComputation.ts)
 * against a raw document_tables row's parsed rows, and writes whatever
 * comes out the same way generateFindingsFromTable.ts does -- structured,
 * code-computed findings, nothing model-authored.
 *
 * Only meaningful once a banner plan has actually been saved
 * (saveBannerPlanAction, in the run page) for this table; called with an
 * empty banner_columns or stub_columns, computeBannerPlanPatterns simply
 * returns nothing; the caller should guard the UI on that instead of
 * treating a no-op call as an error.
 */
export async function generateFindingsFromBannerPlan(
  tenantId: string,
  runId: string,
  documentTableId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {}
): Promise<{ kept: number; discarded: number }> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } = options;

  const documentTable = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      headers: unknown;
      rows: unknown;
      ingestion_type: "raw" | "aggregated";
      banner_columns: unknown;
      stub_columns: unknown;
    }>(
      "select headers, rows, ingestion_type, banner_columns, stub_columns from document_tables where id = $1 and run_id = $2",
      [documentTableId, runId]
    );
    return result.rows[0];
  });

  if (!documentTable) {
    throw new Error("Table not found for this run");
  }

  if (documentTable.ingestion_type !== "raw") {
    throw new Error("This table isn't flagged as raw data, so it has no banner plan to compute against.");
  }

  const rows = documentTable.rows as Record<string, string | number | null>[];
  const bannerColumns = Array.isArray(documentTable.banner_columns)
    ? (documentTable.banner_columns as unknown[]).filter((c): c is string => typeof c === "string")
    : [];
  const stubColumns = Array.isArray(documentTable.stub_columns)
    ? (documentTable.stub_columns as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  if (bannerColumns.length === 0 || stubColumns.length === 0) {
    throw new Error("Save a banner plan (at least one banner column and one stub column) before computing.");
  }

  const patterns = computeBannerPlanPatterns(rows, bannerColumns, stubColumns);

  let kept = 0;
  const discarded = 0;

  await withTenant(tenantId, async (client) => {
    // Same reasoning as generateFindingsFromTable.ts: re-running this
    // replaces its own previous findings rather than duplicating them.
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: documentTableId,
      onlyPending: onlyReplacePending,
      archiveReason,
    });

    for (const pattern of patterns) {
      const sourceCells = pattern.rowIndices.length > 0 ? JSON.stringify({ rowIndices: pattern.rowIndices }) : null;
      await client.query(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, source_cells, data_type, status)
         values ($1, $2, 'generated', $3, $4, $5, $6, $7, $8, 'quantitative', 'pending')`,
        [
          tenantId,
          runId,
          pattern.description,
          pattern.theme,
          pattern.patternType,
          JSON.stringify(pattern.statedStats),
          documentTableId,
          sourceCells,
        ]
      );
      kept++;
    }
  });

  return { kept, discarded };
}
