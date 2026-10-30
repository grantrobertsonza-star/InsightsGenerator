import { anthropic, CLAUDE_MODEL } from "./anthropic";
import { finishedToolInput, UnfinishedModelResultError } from "./modelToolResult";
import { logApiUsage } from "./apiUsage";
import { withTenant } from "./db";
import { isPlainTableFileName, parseTableDocument } from "./parseTable";
import { resolveAuthoritativeSheet } from "./crosstabs";
import { parseStatsFile, isStatsFileName } from "./parseStatsFile";
import { extractDocumentText } from "./extractFindings";
import { generateFindingsFromTable } from "./generateFindingsFromTable";
import { mapWithConcurrency } from "./concurrency";
import type { ArchiveReason } from "./findingArchive";
import { loadDataSetupWithStatus, transposeTable } from "./dataSetup";
import { setCell, type TableCell } from "./rowCells";
import { joinAcrossParts, shapeTable, type ShapedTable } from "./documentTableShape";

type ExtractedTable = {
  label: string | null;
  sourcePage: number | null;
  headers: string[];
  rows: Record<string, TableCell>[];
  /** A table read from a document's pages: what its reading adjusted (documentTableShape.ts). */
  notes?: string[];
};

/** How an engine-read table was read, stored on document_tables.read_provenance (migration 0116). */
export type TableReadProvenance = {
  reader: string;
  sheet: string;
  layout: "rows_are_cases" | "columns_are_cases";
  encoding: string | null;
  dateColumns: string[];
  /** Absent on tables read before it was recorded: unknown, so no warning is shown for them. */
  naCodeColumns?: string[];
  /** Title rows set aside above the header (decision 9); absent on tables read before it was recorded. */
  titleRows?: string[];
  /** The header row choice the file was read under (DataSetup.headerRowsSkipped; decision 9, second part): null when
   * detected automatically. Absent on tables read before it was recorded, which were all read with detection, so
   * absent is read as null (importPreviewIdentity.ts). */
  headerRowsSkipped?: number | null;
};

let readProvenanceColumn: boolean | null = null;
/** Migration 0116's document_tables.read_provenance. Before it, no read provenance is stored or read. */
export async function readProvenanceAvailable(client: import("pg").PoolClient): Promise<boolean> {
  if (readProvenanceColumn) return true;
  const r = await client.query<{ n: number }>(
    "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'document_tables' and column_name = 'read_provenance'",
  );
  readProvenanceColumn = r.rows[0]?.n === 1;
  return readProvenanceColumn;
}

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
        "otherwise. When a group row spans several columns above the column headers (a banner such as " +
        "Wave 1 over Yes and No), give each column's group in column_groups, in the same order. " +
        "Skip anything with fewer than 2 data rows. Do not summarize, reformat, or invent " +
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
                    column_groups: {
                      type: "array",
                      items: { type: ["string", "null"] },
                      description: "Each column's group from a row spanning several columns above the headers, or null.",
                    },
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

    // EC10K-F02: only a finished call is used; a cut-off, refused or missing answer for any part fails
    // the read (below, after every part has answered) instead of reading as "these pages have no tables".
    let finished: Record<string, unknown>;
    try {
      finished = finishedToolInput(response, "record_tables", "The reading of the document's tables");
    } catch (error) {
      if (error instanceof UnfinishedModelResultError) return { unfinished: error.message };
      throw error;
    }
    const rawTables = finished.tables;
    // An answer without its list of tables is not an answer that there are none (batch 57, conformance B-04): it
    // fails the read like any other unfinished part.
    if (!Array.isArray(rawTables)) return { unfinished: "The reading of the document's tables returned no list of tables." };

    const pages = new Set(chunk.map((p) => p.pageNumber));
    const tables = (rawTables as Record<string, unknown>[]).map((raw) => shapeTable(raw, pages)).filter((t): t is ShapedTable => t !== null);
    return { firstPage: chunk[0].pageNumber, lastPage: chunk[chunk.length - 1].pageNumber, tables };
  });

  const unfinished = chunkResults.flatMap((r) => ("unfinished" in r ? [r.unfinished] : []));
  if (unfinished.length > 0) {
    throw new Error(`${unfinished.length} of ${chunks.length} part(s) of this document could not be read for tables, so no tables were stored: ${unfinished[0]}`);
  }
  return joinAcrossParts(chunkResults.flatMap((r) => ("unfinished" in r ? [] : [r])));
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
  let provenance: TableReadProvenance | null = null;

  // The layout decides how the file is read (a columns-as-cases file is flipped by the reader), and the header row
  // choice which row names the variables. A setting that cannot be read fails the read: guessing an orientation or a
  // header would store the wrong table.
  let layout: TableReadProvenance["layout"] = "rows_are_cases";
  let headerRowsSkipped: number | null = null;
  if (document.ingestion_type === "raw") {
    const setup = await loadDataSetupWithStatus(tenantId, documentId);
    if (!setup.ok) {
      throw new Error(`This file's layout setting could not be read (${setup.error}), so it was not read. Try again.`);
    }
    layout = setup.setup.layout;
    headerRowsSkipped = setup.setup.headerRowsSkipped;
  }
  // Only CSV, TSV, text and Excel files have a header row. A choice saved for another format is refused, as every
  // calculation refuses it (_read_raw_uncached), rather than ignored here and the table stored a different way.
  if (headerRowsSkipped !== null && !isPlainTableFileName(lowerName)) {
    throw new Error(
      "This file's header row is set, but only CSV, TSV, text and Excel files have a header row. Set the header row " +
        "back to detected automatically for this file.",
    );
  }

  if (isPlainTableFileName(lowerName)) {
    // The one reader (parseTable.ts): the engine reads the file, applying the layout, so the stored
    // table is exactly what every calculation reads. Nothing is flipped or retyped here.
    let parsed = await parseTableDocument(document.storage_path, document.source_filename, { selectedSheet: document.selected_sheet, layout, headerRowsSkipped });
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
      parsed = await parseTableDocument(document.storage_path, document.source_filename, { selectedSheet: authoritative, layout, headerRowsSkipped });
    }
    extracted = [{ label: null, sourcePage: null, headers: parsed.headers, rows: parsed.rows }];
    provenance = { reader: parsed.reader, sheet: parsed.sheetName, layout, encoding: parsed.encoding, dateColumns: parsed.dateColumns, naCodeColumns: parsed.naCodeColumns, titleRows: parsed.titleRows, headerRowsSkipped };
    // Codex round 3, "preserve the qualification through extraction": an identifier column whose
    // Excel format the engine cannot reproduce is blank in preview and calculation alike, and is
    // recorded so the Import screen shows a recovery message instead of importing it silently.
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
    // SPSS/Stata/SAS: the engine's converter (api/parse-stats-file.py), which also
    // resolves variable labels and decodes value-labeled codes, so what
    // comes back needs no different handling than a CSV/Excel upload.
    // These files declare their own case structure and every calculation refuses a columns-as-cases
    // layout for them (_read_raw_uncached), so the stored table refuses it too rather than showing a
    // flip that nothing else uses.
    if (layout === "columns_are_cases") {
      throw new Error(
        "This file's layout is set to \"columns_are_cases\", but SPSS, Stata and SAS files declare their own " +
          "case and variable structure, so that flip is not supported for them. Set the layout back to rows are cases.",
      );
    }
    const parsed = await parseStatsFile(document.storage_path, document.source_filename);
    const { headers, rows } = parsed;
    extracted = [{ label: null, sourcePage: null, headers, rows }];
    // B40-F01: recorded, so a table read before an engine fix is known as such (importPreviewIdentity.ts).
    if (parsed.reader) provenance = { reader: parsed.reader, sheet: "", layout, encoding: null, dateColumns: [] };
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
    // Pages with no text at all are images (a scanned PDF): refused here, before any model call, rather than sent
    // to the model and reported as having no tables (batch 57, conformance B-07).
    if (pages.length === 0 || pages.every((p) => p.text.trim() === "")) {
      throw new Error(
        "No page text could be extracted from this file, so no tables could be found in it. If it's a " +
          "scanned or image-based PDF, table extraction from scans isn't supported yet."
      );
    }
    extracted = await detectTablesAcrossPages(tenantId, runId, pages);
    // A table found in a document's text has no engine read. A raw one laid out with variables in rows
    // is flipped here, so everything downstream reads one row per case, with the engine's naming rules
    // (transposeTable).
    if (layout === "columns_are_cases") {
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
    // read_provenance (migration 0116) records that a table came from the engine's one reader. It is
    // written with the table, and cleared for a table read any other way, so a replaced table never
    // keeps an earlier read's provenance. Before 0116 nothing is recorded, and the table is checked
    // against a fresh read when shown (importPreviewIdentity.ts).
    const withProvenance = await readProvenanceAvailable(client);
    const ids: string[] = [];
    for (let index = 0; index < extracted.length; index++) {
      const t = extracted[index];
      const params: unknown[] = [
        tenantId,
        runId,
        documentId,
        index,
        t.label,
        t.sourcePage,
        JSON.stringify(t.headers),
        JSON.stringify(t.rows),
        document.ingestion_type,
      ];
      if (withProvenance) params.push(provenance ? JSON.stringify(provenance) : null);
      const result = await client.query<{ id: string }>(
        withProvenance
          ? `insert into document_tables (tenant_id, run_id, document_id, table_index, label, source_page, headers, rows, ingestion_type, read_provenance)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             on conflict (document_id, table_index)
             do update set label = excluded.label, source_page = excluded.source_page,
                            headers = excluded.headers, rows = excluded.rows, ingestion_type = excluded.ingestion_type,
                            read_provenance = excluded.read_provenance
             returning id`
          : `insert into document_tables (tenant_id, run_id, document_id, table_index, label, source_page, headers, rows, ingestion_type)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             on conflict (document_id, table_index)
             do update set label = excluded.label, source_page = excluded.source_page,
                            headers = excluded.headers, rows = excluded.rows, ingestion_type = excluded.ingestion_type
             returning id`,
        params,
      );
      ids.push(result.rows[0].id);
    }
    // What the reading of a document's tables adjusted (documentTableShape.ts: groups named, a table joined across
    // parts, a page the document lacks, rows longer or shorter than the columns), recorded with the tables, in the
    // same transaction, for the Import screen and review.
    const adjusted = extracted.flatMap((t, index) => (t.notes && t.notes.length > 0 ? [{ tableId: ids[index], label: t.label, notes: t.notes }] : []));
    if (adjusted.length > 0) {
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'document_table_reading_notes', $3)`, [
        tenantId,
        runId,
        JSON.stringify({ documentId, tables: adjusted }),
      ]);
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
