import type { ArchiveReason } from "./findingArchive";
import { withTenant } from "./db";
import { computeTablePatterns, type TableScanCoverage } from "./tableComputation";
import { publishTableFindings, type TablePublicationOutcome } from "./tableFindingPublication";
import { generateFindingsFromBannerPlan } from "./generateFindingsFromBannerPlan";

/**
 * Agent 0, per Section 7 of the engineering brief: runs only against a
 * single extracted table, looking for patterns nobody wrote a sentence
 * about.
 *
 * This used to work the other way around: the model proposed candidate
 * patterns and the exact numbers behind them, and the application then ran
 * the matching statistical check and kept only what cleared it. That order
 * can only ever reject a wrong guess; it can never surface a real pattern
 * the model didn't happen to propose, and whatever it did propose was still
 * a model's numbers until verification happened to agree with them. Now the
 * computation runs first, directly against the full parsed table (see
 * tableComputation.ts, not a truncated preview), and produces the patterns
 * outright -- nothing here asks a model to look at the data at all. Theme
 * names and descriptions are built from the real column names and numbers
 * in code, not written by a model, so a "generated" finding is structured
 * output end to end, distinctly from the LLM-authored prose a "stated"
 * finding (extractFindings.ts) is built from.
 *
 * Operates on a document_tables row (see 0023_document_tables.sql), not a
 * document directly: a CSV/Excel upload has exactly one, matching how this
 * always worked, but a Word or PDF document can hold several, each
 * requiring its own independent pass. extractAndStoreDocumentTables (in
 * documentTables.ts) is what populates these rows; processTableDocument in
 * the same file is the actual entry point a caller wants, looping this
 * function over every table a document turned out to contain.
 */
export async function generateFindingsFromTable(
  tenantId: string,
  runId: string,
  documentTableId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {},
): Promise<{ kept: number; discarded: number; scan?: TableScanCoverage; publication?: TablePublicationOutcome }> {
  const { onlyReplacePending = false, archiveReason = "manual_reextract" } =
    options;
  const documentTable = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      headers: unknown;
      rows: unknown;
      ingestion_type: "raw" | "aggregated";
    }>(
      "select headers, rows, ingestion_type from document_tables where id = $1 and run_id = $2",
      [documentTableId, runId],
    );
    return result.rows[0];
  });

  if (!documentTable) {
    throw new Error("Table not found for this run");
  }

  const discarded = 0;

  // Raw (case-level) data never runs through this scan, no exception, per
  // the 2026-10-04 decision: segment_difference/relationship here search
  // every column pair on whatever table they're given, which is an
  // acceptable, industry-standard pass over a handful of supplied
  // cross-tab columns (see tableComputation.ts's own
  // MULTIPLE_COMPARISONS_CAVEAT comment) but a much larger
  // multiple-comparisons problem on a raw file that can carry dozens of
  // columns and thousands of rows. Raw tables wait here for the dedicated,
  // banner-plan-driven statistical path instead of silently getting no
  // findings generated and looking indistinguishable from "processed,
  // nothing found" -- the trace row below is what tells those two states
  // apart.
  if (documentTable.ingestion_type === "raw") {
    // Raw data never runs the open scan, and no default plan is proposed
    // any more: case-level data is tabulated in the cross tab tool, where
    // the researcher chooses what to compare. A banner plan saved earlier
    // is still honoured; without one, the table waits for the tool.
    const saved = await withTenant(tenantId, async (client) => {
      const r = await client.query<{ banner_columns: unknown; stub_columns: unknown }>(
        "select banner_columns, stub_columns from document_tables where id = $1",
        [documentTableId],
      );
      return r.rows[0];
    });
    const asList = (v: unknown) =>
      Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
    const hasPlan = asList(saved?.banner_columns).length > 0 && asList(saved?.stub_columns).length > 0;
    const autoPlan = false;
    if (!hasPlan) {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'table_awaiting_cross_tab_tool', $3)`,
          [tenantId, runId, JSON.stringify({ documentTableId, reason: "use_cross_tab_tool" })],
        );
      });
      return { kept: 0, discarded: 0 };
    }
    const result = await generateFindingsFromBannerPlan(tenantId, runId, documentTableId, {
      onlyReplacePending,
      archiveReason,
    });
    await withTenant(tenantId, async (client) => {
      await client.query(
        `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'banner_plan_computed', $3)`,
        [tenantId, runId, JSON.stringify({ documentTableId, autoPlan, findings: result.kept })],
      );
    });
    return result;
  }

  // Runs against every row the table actually has, not a model-eyeballed preview. The rows are read
  // again, and the table row locked, inside the publication transaction (EF-FND-F03): two regenerations
  // of one table are serialised, the table must still belong to this project and tenant, and the
  // findings are computed from exactly the rows they are published against.
  const outcome = await withTenant(tenantId, async (client) => {
    const locked = await client.query<{ headers: unknown; rows: unknown; ingestion_type: string }>(
      "select headers, rows, ingestion_type from document_tables where id = $1 and run_id = $2 and tenant_id = $3 for update",
      [documentTableId, runId, tenantId],
    );
    if (locked.rows.length !== 1 || locked.rows[0].ingestion_type !== "aggregated") {
      throw new Error("This table is no longer in this project (or is no longer a summary table), so nothing was changed.");
    }
    const { patterns, scan } = computeTablePatterns(locked.rows[0].headers as string[], locked.rows[0].rows as Record<string, string | number | null>[]);
    const published = await publishTableFindings(client, {
      tenantId,
      runId,
      tableId: documentTableId,
      patterns,
      onlyReplacePending,
      archiveReason,
    });
    // EF-FND-F01: what the scan examined and omitted, and whether the per-table cap held findings back,
    // recorded with the outcome so "nothing found" is never confused with "not looked at" or "capped".
    await client.query(
      `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'table_findings_scan', $3)`,
      [tenantId, runId, JSON.stringify({ documentTableId, scan, published })],
    );
    return { scan, published };
  });

  return { kept: outcome.published.inserted + outcome.published.unchanged, discarded, scan: outcome.scan, publication: outcome.published };
}
