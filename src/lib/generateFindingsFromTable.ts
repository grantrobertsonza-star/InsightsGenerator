import {
  archiveAndReplaceFindings,
  type ArchiveReason,
} from "./findingArchive";
import { withTenant } from "./db";
import { computeTablePatterns } from "./tableComputation";
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
): Promise<{ kept: number; discarded: number }> {
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

  const table = {
    headers: documentTable.headers as string[],
    rows: documentTable.rows as Record<string, string | number | null>[],
  };

  let kept = 0;
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

  // Runs against every row the table actually has, not a model-eyeballed
  // preview: there's no prompt size to budget for anymore, since no prompt
  // is involved in finding these patterns.
  const { patterns } = computeTablePatterns(table.headers, table.rows);

  await withTenant(tenantId, async (client) => {
    // Re-running generation on the same table replaces its previous
    // generated findings rather than duplicating them. onlyReplacePending
    // narrows that to findings nobody has reviewed yet, and either way
    // whatever is about to be deleted is snapshotted first, see the
    // matching comment in extractFindings.ts for the full reasoning.
    await archiveAndReplaceFindings(client, {
      documentColumn: "source_table_id",
      documentId: documentTableId,
      onlyRejected: onlyReplacePending,
      archiveReason,
    });

    // After a partial regenerate the accepted findings are still there: do not add a second copy of each.
    const existing = new Set<string>();
    if (onlyReplacePending) {
      const r = await client.query<{ finding_text: string }>("select finding_text from findings where source_table_id = $1", [documentTableId]);
      for (const row of r.rows) existing.add(row.finding_text);
    }

    for (const pattern of patterns) {
      if (existing.has(pattern.description)) continue;
      const sourceCells =
        pattern.rowIndices.length > 0
          ? JSON.stringify({ rowIndices: pattern.rowIndices })
          : null;
      // See the matching comment in extractFindings.ts: status starts at
      // 'accepted', not 'pending'.
      await client.query(
        `insert into findings (tenant_id, run_id, origin, finding_text, theme, pattern_type, stated_stats, source_table_id, source_cells, data_type, status)
         values ($1, $2, 'generated', $3, $4, $5, $6, $7, $8, 'quantitative', 'accepted')`,
        [
          tenantId,
          runId,
          pattern.description,
          pattern.theme,
          pattern.patternType,
          JSON.stringify(pattern.statedStats),
          documentTableId,
          sourceCells,
        ],
      );
      kept++;
    }
  });

  return { kept, discarded };
}
