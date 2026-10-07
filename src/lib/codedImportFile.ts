// Turns an uploaded coding file (.xlsx, .xls, .csv or .docx with tables) into
// grids of text cells and hands them to the parser in codedImport.ts.
import * as XLSX from "xlsx";
import mammoth from "mammoth";
import { parseHTML } from "linkedom";
import {
  mergeParsed,
  parseCodingGrid,
  type ParsedCoding,
} from "./codedImport";

const GENERIC_SHEET = /^(sheet\s*\d*|quotations?|quotes|report|export|data|codes?|themes?|coding|summary|results?)$/i;

function sheetGrid(sheet: XLSX.WorkSheet): string[][] {
  // Merged cells hold their value only in the top-left cell; copy it into the
  // rest so a theme written once above several quotes applies to all of them.
  for (const merge of sheet["!merges"] ?? []) {
    const top = sheet[XLSX.utils.encode_cell(merge.s)];
    if (!top) continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (r === merge.s.r && c === merge.s.c) continue;
        sheet[XLSX.utils.encode_cell({ r, c })] = { ...top };
      }
    }
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}

function parseWorkbook(workbook: XLSX.WorkBook): ParsedCoding {
  const parts: ParsedCoding[] = [];
  for (const name of workbook.SheetNames) {
    const grid = sheetGrid(workbook.Sheets[name]);
    // ATLAS.ti's "group by codes" export makes one sheet per code, named
    // after it and with no code column. Use the sheet name as the code then.
    const fallback = GENERIC_SHEET.test(name.trim()) ? null : name.trim();
    let parsed = parseCodingGrid(grid);
    if (parsed.entries.length === 0 && fallback) {
      parsed = parseCodingGrid(grid, fallback);
    }
    if (parsed.entries.length > 0) parts.push(parsed);
  }
  return mergeParsed(parts);
}

async function parseDocx(buffer: Buffer): Promise<ParsedCoding> {
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const parts: ParsedCoding[] = [];
  for (const table of Array.from(document.querySelectorAll("table"))) {
    const grid: string[][] = [];
    const carry: Record<number, { text: string; left: number }> = {};
    for (const tr of Array.from(table.querySelectorAll("tr"))) {
      const row: string[] = [];
      let col = 0;
      const place = (text: string) => {
        row[col] = text;
        col += 1;
      };
      for (const cell of Array.from(tr.querySelectorAll("th,td"))) {
        // Fill cells covered by an earlier row's rowspan.
        while (carry[col] && carry[col].left > 0) {
          carry[col].left -= 1;
          place(carry[col].text);
        }
        const text = (cell.textContent ?? "").replace(/ /g, " ");
        // Keep paragraph breaks inside a cell: they separate quotes.
        const withBreaks = Array.from(cell.querySelectorAll("p"))
          .map((p) => (p.textContent ?? "").trim())
          .filter(Boolean)
          .join("\n");
        const value = withBreaks || text.trim();
        const rowspan = Number(cell.getAttribute("rowspan") ?? "1");
        const colspan = Number(cell.getAttribute("colspan") ?? "1");
        for (let k = 0; k < colspan; k++) {
          if (rowspan > 1) carry[col] = { text: value, left: rowspan - 1 };
          place(value);
        }
      }
      while (carry[col] && carry[col].left > 0) {
        carry[col].left -= 1;
        place(carry[col].text);
      }
      for (let i = 0; i < row.length; i++) row[i] = row[i] ?? "";
      grid.push(row);
    }
    const parsed = parseCodingGrid(grid);
    if (parsed.entries.length > 0) parts.push(parsed);
  }
  return mergeParsed(parts);
}

export async function readCodingFile(
  buffer: Buffer,
  filename: string,
): Promise<ParsedCoding> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return parseDocx(buffer);
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseWorkbook(
      XLSX.read(buffer.toString("utf8"), { type: "string" }),
    );
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseWorkbook(XLSX.read(buffer, { type: "buffer" }));
  }
  throw new Error(
    "That file type is not supported for a coding file. Use .xlsx, .csv or a Word (.docx) file with a table.",
  );
}
