import type { ArchiveReason } from "./findingArchive";
import { publishTableFindings } from "./tableFindingPublication";
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
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {},
): Promise<{ kept: number; discarded: number }> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } =
    options;

  const documentTable = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      headers: unknown;
      rows: unknown;
      ingestion_type: "raw" | "aggregated";
      banner_columns: unknown;
      stub_columns: unknown;
    }>(
      "select headers, rows, ingestion_type, banner_columns, stub_columns from document_tables where id = $1 and run_id = $2",
      [documentTableId, runId],
    );
    return result.rows[0];
  });

  if (!documentTable) {
    throw new Error("Table not found for this run");
  }

  if (documentTable.ingestion_type !== "raw") {
    throw new Error(
      "This table isn't flagged as raw data, so it has no banner plan to compute against.",
    );
  }

  const rows = documentTable.rows as Record<string, string | number | null>[];
  const bannerColumns = Array.isArray(documentTable.banner_columns)
    ? (documentTable.banner_columns as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];
  const stubColumns = Array.isArray(documentTable.stub_columns)
    ? (documentTable.stub_columns as unknown[]).filter(
        (c): c is string => typeof c === "string",
      )
    : [];

  if (bannerColumns.length === 0 || stubColumns.length === 0) {
    throw new Error(
      "Save a banner plan (at least one banner column and one stub column) before computing.",
    );
  }

  const patterns = computeBannerPlanPatterns(rows, bannerColumns, stubColumns);

  let kept = 0;
  const discarded = 0;

  // EF-FND-F03: replaced through the shared table publication rule (tableFindingPublication.ts), so a
  // reviewed, annotated or cited finding survives recomputation exactly as it does for a summary table.
  // The table row is locked and its plan re-read under the lock: a plan or rows changed since the read
  // above stops this run rather than publishing findings computed from the older version.
  await withTenant(tenantId, async (client) => {
    const locked = await client.query<{ rows: unknown; banner_columns: unknown; stub_columns: unknown }>(
      "select rows, banner_columns, stub_columns from document_tables where id = $1 and run_id = $2 and tenant_id = $3 for update",
      [documentTableId, runId, tenantId],
    );
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    if (
      locked.rows.length !== 1 ||
      !same(locked.rows[0].banner_columns, documentTable.banner_columns) ||
      !same(locked.rows[0].stub_columns, documentTable.stub_columns) ||
      !same(locked.rows[0].rows, documentTable.rows)
    ) {
      throw new Error("This table or its banner plan changed (or it was removed) while findings were being computed, so nothing was changed. Try again.");
    }
    const published = await publishTableFindings(client, {
      tenantId,
      runId,
      tableId: documentTableId,
      patterns,
      onlyReplacePending,
      archiveReason,
    });
    kept = published.inserted + published.unchanged;
  });

  return { kept, discarded };
}
