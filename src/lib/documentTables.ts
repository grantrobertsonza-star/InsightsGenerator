import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { parseTableDocument } from "./parseTable";
import { resolveAuthoritativeSheet } from "./crosstabs";
import { parseStatsFile, isStatsFileName } from "./parseStatsFile";
import { extractDocumentText } from "./extractFindings";
import { generateFindingsFromTable } from "./generateFindingsFromTable";
import { mapWithConcurrency } from "./concurrency";
import type { ArchiveReason } from "./findingArchive";
import { loadDataSetup, transposeTable } from "./dataSetup";

type ExtractedTable = {
  label: string | null;
  sourcePage: number | null;
  headers: string[];
  rows: Record<string, string | number | null>[];
};

const PAGES_PER_TABLE_DETECTION_CALL = 5;
const TABLE_DETECTION_CONCURRENCY = 3;

/**
 * Finds and structures every genuine data table across a document's pages.
 * Only used for Word and PDF documents uploaded as "Table" kind, where the
 * file itself isn't a spreadsheet but contains one or more tables worth
 * running the same statistical pattern-detection pass against. Reuses the
 * page text already extracted for Report documents (extractDocumentText),
 * so a Word file goes through the same docx-to-PDF conversion either way;
 * this only adds a further pass over that same text looking for tables
 * instead of prose claims.
 */
async function detectTablesAcrossPages(
  tenantId: string,
  runId: string,
  pages: { pageNumber: number; text: string }[]
): Promise<ExtractedTable[]> {
  const chunks: { pageNumber: number; text: string }[][] = [];
  for (let i = 0; i < pages.length; i += PAGES_PER_TABLE_DETECTION_CALL) {
    chunks.push(pages.slice(i, i + PAGES_PER_TABLE_DETECTION_CALL));
  }

  const chunkResults = await mapWithConcurrency(chunks, TABLE_DETECTION_CONCURRENCY, async (chunk) => {
    const pagesBlock = chunk.map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`).join("\n\n");

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system:
        "You find genuine data tables in the document pages below: rows and columns of actual values, " +
        "not decorative layout (a table of contents, a form, a single-row banner). For each real table " +
        "you find, extract it exactly as printed: give a short label if the page has a caption or title " +
        "for it (otherwise omit the label), the column headers in order, and every data row as an array " +
        "of cell values in that same column order, using numbers where a cell is numeric and strings " +
        "otherwise. Skip anything with fewer than 2 data rows. Do not summarize, reformat, or invent " +
        "values; the numbers in your rows must match what's on the page exactly, since a statistical " +
        "check runs against them afterward.",
      tool_choice: { type: "tool", name: "record_tables" },
      tools: [
        {
          name: "record_tables",
          description: "Records every genuine data table found on these pages.",
          input_schema: {
            type: "object",
            properties: {
              tables: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    page_number: { type: "integer", description: "The page this table appears on." },
                    label: {
                      type: "string",
                      description: "The table's caption or title, if the page has one.",
                    },
                    headers: { type: "array", items: { type: "string" } },
                    rows: {
                      type: "array",
                      items: { type: "array", items: { type: ["string", "number", "null"] } },
                    },
                  },
                  required: ["page_number", "headers", "rows"],
                },
              },
            },
            required: ["tables"],
          },
        },
      ],
      messages: [{ role: "user", content: `Pages:\n\n${pagesBlock}` }],
    });

    await logApiUsage(tenantId, runId, "extract_document_tables", response.usage);

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return [];

    const rawTables = (toolUse.input as { tables?: unknown }).tables;
    if (!Array.isArray(rawTables)) return [];

    const tables: ExtractedTable[] = [];
    for (const raw of rawTables as Record<string, unknown>[]) {
      const pageNumber = typeof raw.page_number === "number" ? raw.page_number : null;
      const label = typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label.trim() : null;
      const headers = Array.isArray(raw.headers)
        ? raw.headers.filter((h): h is string => typeof h === "string")
        : [];
      const rawRows = Array.isArray(raw.rows) ? raw.rows : [];

      if (headers.length === 0 || rawRows.length === 0) continue;

      const rows = rawRows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) => {
          const record: Record<string, string | number | null> = {};
          headers.forEach((header, index) => {
            const cell = row[index];
            record[header] = typeof cell === "string" || typeof cell === "number" ? cell : null;
          });
          return record;
        });

      if (rows.length === 0) continue;

      tables.push({ label, sourcePage: pageNumber, headers, rows });
    }
    return tables;
  });

  return chunkResults.flat();
}

/**
 * Populates document_tables for one document: for a CSV/Excel file, a
 * single row representing the whole file (matching how "Table" documents
 * have always worked); for a Word or PDF file, one row per table actually
 * found in it. Upserts by (document_id, table_index) rather than
 * delete-then-insert, so a table's id, and therefore any finding a
 * researcher has already reviewed against it, stays stable across a
 * re-extraction (see 0023_document_tables.sql). If this run now finds
 * fewer tables than a previous run did, the extra old rows are left alone
 * rather than deleted: a finding built against a table that has since
 * disappeared from the source file simply stops getting fresh findings
 * generated against it, rather than being orphaned by a cascade delete.
 */
export async function extractAndStoreDocumentTables(
  tenantId: string,
  runId: string,
  documentId: string
): Promise<string[]> {
  const document = await withTenant(tenantId, async (client) => {
    const result = await client.query<{
      storage_path: string;
      source_filename: string;
      ingestion_type: "raw" | "aggregated" | null;
      selected_sheet: string | null;
    }>(
      "select storage_path, source_filename, ingestion_type, selected_sheet from documents where id = $1 and run_id = $2",
      [documentId, runId]
    );
    return result.rows[0];
  });

  if (!document) {
    throw new Error("Document not found for this run");
  }

  // Required by a DB constraint for kind='table' documents (see
  // 0038_table_ingestion_type.sql), so this should never actually be null;
  // checked again here with a clearer message in case a pre-migration
  // document somehow reaches this path without it.
  if (!document.ingestion_type) {
    throw new Error(
      "This document has no raw/aggregated data type set, so its tables can't be processed. " +
        "Re-upload it and specify whether it's raw case-level data or an already-aggregated table."
    );
  }

  const lowerName = document.source_filename.toLowerCase();
  let extracted: ExtractedTable[];

  if (lowerName.endsWith(".csv") || lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
    let parsed = await parseTableDocument(document.storage_path, document.selected_sheet);
    // IMP-SHIP-001 (Codex round 2, "a losing publisher must adopt that choice and reparse
    // before returning, caching or saving data"): find out which sheet is ACTUALLY
    // authoritative after attempting to persist this read's own choice. If a dictionary
    // load (or another extraction) won the race for this document between our own read of
    // document.selected_sheet above and now, re-parse against the sheet that actually won
    // before storing anything - otherwise this could save findings extracted from a sheet
    // nothing else agrees is the document's data sheet.
    const authoritative = await resolveAuthoritativeSheet(
      tenantId,
      documentId,
      document.selected_sheet,
      parsed.sheetName,
    );
    if (authoritative !== parsed.sheetName) {
      parsed = await parseTableDocument(document.storage_path, authoritative);
    }
    extracted = [{ label: null, sourcePage: null, headers: parsed.headers, rows: parsed.rows }];
    // Codex round 3, "preserve the qualification through extraction": parseTableDocument
    // already detects an id-like column whose Excel format this pipeline can't guarantee
    // matches between preview and calculation (see parseTable.ts's
    // unsupportedIdentifierColumns). Extraction used to just read .headers/.rows off
    // `parsed` and drop this flag on the floor, so nothing downstream of this function
    // ever learned about it. Recorded the same way wide_file_trimmed already is, so the
    // Import screen can show a recovery message instead of silently importing a column
    // whose identifier values aren't cross-reader-verified.
    if (parsed.unsupportedIdentifierColumns.length > 0) {
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'unsupported_identifier_format', $3)`,
          [
            tenantId,
            runId,
            JSON.stringify({ documentId, columns: parsed.unsupportedIdentifierColumns }),
          ]
        );
      });
    }
  } else if (isStatsFileName(lowerName)) {
    // SPSS/Stata/SAS: no JS reader exists for these, so this hands off to
    // the Python conversion function (api/parse-stats-file.py), which also
    // resolves variable labels and decodes value-labeled codes, so what
    // comes back needs no different handling than a CSV/Excel upload.
    const parsed = await parseStatsFile(document.storage_path, document.source_filename);
    const { headers, rows } = parsed;
    extracted = [{ label: null, sourcePage: null, headers, rows }];
    if (parsed.totalVariables && parsed.keptVariables) {
      // Very wide file: only the usable variables were kept so the table
      // fits in storage. Recorded so the cut is never silent.
      await withTenant(tenantId, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'wide_file_trimmed', $3)`,
          [
            tenantId,
            runId,
            JSON.stringify({ documentId, totalVariables: parsed.totalVariables, keptVariables: parsed.keptVariables }),
          ]
        );
      });
    }
  } else {
    // .docx, .pptx, .pdf: not a spreadsheet, but may contain one or more
    // tables worth finding. extractDocumentText already converts Word and
    // PowerPoint to PDF and reads any PDF page by page (see
    // extractFindings.ts), so this reuses exactly that, then looks for
    // tables in the resulting page text instead of prose claims.
    const { pages } = await extractDocumentText(document.storage_path, document.source_filename, documentId);
    if (pages.length === 0) {
      throw new Error(
        "No page text could be extracted from this file, so no tables could be found in it. If it's a " +
          "scanned or image-based PDF, table extraction from scans isn't supported yet."
      );
    }
    extracted = await detectTablesAcrossPages(tenantId, runId, pages);
  }

  // A raw file laid out with variables in rows and cases in columns is
  // flipped once, here, so everything downstream (banner plans, cross-tabs,
  // digests) reads the usual one-row-per-case shape.
  if (document.ingestion_type === "raw") {
    const setup = await loadDataSetup(tenantId, documentId);
    if (setup.layout === "columns_are_cases") {
      extracted = extracted.map((t) => {
        const flipped = transposeTable(t.headers, t.rows);
        return { ...t, headers: flipped.headers, rows: flipped.rows };
      });
    }
  }

  // A CSV/Excel/SPSS-Stata-SAS read always pushes exactly one table object, even when the
  // source file turned out to have no columns and no data at all - a genuinely empty upload
  // used to still "succeed" here, inserting a table with empty headers and empty rows that
  // every downstream step (dictionary, crosstab, findings) would then have to treat as a
  // special case instead of this step simply refusing it. A table with neither headers nor
  // rows carries nothing to extract, so it is dropped before the found-nothing check below,
  // which then reports the same clear error a .docx/.pptx/.pdf with no tables already gets.
  extracted = extracted.filter((t) => t.headers.length > 0 || t.rows.length > 0);

  if (extracted.length === 0) {
    throw new Error(
      "No tables were found in this document. If it's a Word or PDF file, check that it actually " +
        "contains a data table rather than only narrative text, a bulleted list, or a scanned image. " +
        "If it's a CSV, Excel or SPSS/Stata/SAS file, check that it isn't empty."
    );
  }

  return withTenant(tenantId, async (client) => {
    const ids: string[] = [];
    for (let index = 0; index < extracted.length; index++) {
      const t = extracted[index];
      const result = await client.query<{ id: string }>(
        `insert into document_tables (tenant_id, run_id, document_id, table_index, label, source_page, headers, rows, ingestion_type)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (document_id, table_index)
         do update set label = excluded.label, source_page = excluded.source_page,
                        headers = excluded.headers, rows = excluded.rows, ingestion_type = excluded.ingestion_type
         returning id`,
        [
          tenantId,
          runId,
          documentId,
          index,
          t.label,
          t.sourcePage,
          JSON.stringify(t.headers),
          JSON.stringify(t.rows),
          document.ingestion_type,
        ]
      );
      ids.push(result.rows[0].id);
    }
    return ids;
  });
}

/**
 * Full "Table" pipeline for one document: (re)extract its table(s), then
 * run the statistical pattern-detection pass against each one in turn.
 * This is the entry point processRunAction and the per-document "Generate
 * findings" button both call now, replacing the old assumption that a
 * document was always exactly one table.
 */
export async function processTableDocument(
  tenantId: string,
  runId: string,
  documentId: string,
  options: { onlyReplacePending?: boolean; archiveReason?: ArchiveReason } = {}
): Promise<{ kept: number; discarded: number }> {
  const tableIds = await extractAndStoreDocumentTables(tenantId, runId, documentId);

  let kept = 0;
  let discarded = 0;
  for (const tableId of tableIds) {
    const result = await generateFindingsFromTable(tenantId, runId, tableId, options);
    kept += result.kept;
    discarded += result.discarded;
  }
  return { kept, discarded };
}

// Re-exported so call sites only need to import from this file for the
// "process a table document end to end" use case; ArchiveReason is part of
// that function's public options type.
export type { ArchiveReason };
