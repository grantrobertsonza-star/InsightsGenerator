// Saved crosstabs as PowerPoint slides (the crosstab export's pptx and pdf formats; the pdf is this
// deck converted). A plain working table, not the branded narrative deck: the point is the numbers,
// laid out as the workspace shows them, in native (editable) PowerPoint tables.
//
// Golden-thread GT-005: the table used fixed column widths of 3.4 + 9.4 + 1.0 = 13.8 inches from
// x = 0.4 on a 13.33-inch slide, so the Total column ran off the page (clipped in the PDF). The
// layout is now planned to fit:
//   - width: the answer column, the banner columns and Total always fit within the slide margins;
//     a banner column never gets narrower than MIN_DATA_COL, and a banner wider than one slide can
//     hold is split across slides, each repeating the answer column, Total and the base row;
//   - height: rows are paged by their estimated wrapped height, not a fixed count, so long answer
//     labels continue onto the next slide instead of running past the bottom;
//   - context: a continuation page repeats its question's heading and base row, and every slide
//     carries the weighting, base and source note.
// The estimates are deliberately cautious (average character width at the table's font size); the
// guarantee is the arithmetic in planCrosstabSlides, checked in crosstabSlides.test.ts.
import type PptxGenJS from "pptxgenjs";
import type { CrosstabResult } from "./parseStatsFile";

export const SLIDE_W = 13.333; // LAYOUT_WIDE
export const MARGIN_X = 0.4;
export const TABLE_W = SLIDE_W - 2 * MARGIN_X;
export const LABEL_COL = 3.0;
export const TOTAL_COL = 1.0;
export const MIN_DATA_COL = 0.85;
export const TABLE_TOP = 0.95;
export const TABLE_BOTTOM = 6.9; // the source note sits at 7.0
const FONT_PT = 9;
const CHAR_W = (FONT_PT / 72) * 0.55; // average character width in inches at the table font
const LINE_H = (FONT_PT / 72) * 1.25;
const CELL_PAD_W = 0.15;
const CELL_PAD_H = 0.1;

export type SlideLine = { label: string; cells: string[]; kind: "question" | "test" | "base" | "answer"; question: number };

/** Columns per slide, given the banner column count. */
export function columnGroups(columnCount: number): number[][] {
  const perSlide = Math.max(1, Math.floor((TABLE_W - LABEL_COL - TOTAL_COL) / MIN_DATA_COL));
  const groups: number[][] = [];
  for (let start = 0; start < columnCount; start += perSlide) {
    groups.push(Array.from({ length: Math.min(perSlide, columnCount - start) }, (_, i) => start + i));
  }
  return groups.length > 0 ? groups : [[]];
}

/** Column widths for one slide: answer, the group's banner columns, Total. Sum <= TABLE_W. */
export function columnWidths(groupSize: number): number[] {
  const dataW = groupSize > 0 ? (TABLE_W - LABEL_COL - TOTAL_COL) / groupSize : 0;
  return [LABEL_COL, ...Array.from({ length: groupSize }, () => dataW), TOTAL_COL];
}

function linesFor(text: string, width: number): number {
  const perLine = Math.max(1, Math.floor((width - CELL_PAD_W) / CHAR_W));
  return Math.max(1, ...String(text).split("\n").map((part) => Math.ceil(Math.max(part.length, 1) / perLine)));
}

/** Estimated height of a table row whose cells have these texts and widths. */
export function rowHeight(texts: string[], widths: number[]): number {
  const lines = Math.max(...texts.map((t, i) => linesFor(t, widths[i] ?? widths[widths.length - 1])));
  return CELL_PAD_H + lines * LINE_H;
}

export type SlidePlan = { columns: number[]; widths: number[]; header: string[]; rows: SlideLine[]; continued: boolean; groupIndex: number; groupCount: number };

/**
 * Plans every slide for one table: banner columns split into groups that fit the width, and each
 * group's rows paged so the estimated table height stays within TABLE_TOP..TABLE_BOTTOM. A page
 * that starts inside a question repeats that question's heading (marked continued) and base row.
 */
export function planCrosstabSlides(header: string[], lines: SlideLine[]): SlidePlan[] {
  const columnCount = header.length - 2; // Answer + banner columns + Total
  const groups = columnGroups(columnCount);
  const plans: SlidePlan[] = [];
  groups.forEach((group, groupIndex) => {
    const widths = columnWidths(group.length);
    const pick = (cells: string[]) => [...group.map((j) => cells[j] ?? ""), cells[cells.length - 1] ?? ""];
    const groupHeader = [header[0], ...group.map((j) => header[j + 1]), header[header.length - 1]];
    const project = (ln: SlideLine): SlideLine => ({ ...ln, cells: pick(ln.cells) });
    const heightOf = (ln: SlideLine) => rowHeight([ln.label, ...ln.cells], widths);
    const budget = TABLE_BOTTOM - TABLE_TOP - rowHeight(groupHeader, widths);
    let page: SlideLine[] = [];
    let used = 0;
    let continued = false;
    const flush = () => {
      if (page.length > 0) plans.push({ columns: group, widths, header: groupHeader, rows: page, continued, groupIndex, groupCount: groups.length });
      page = [];
      used = 0;
    };
    for (let i = 0; i < lines.length; i++) {
      const ln = project(lines[i]);
      const h = heightOf(ln);
      if (page.length > 0 && used + h > budget) {
        flush();
        continued = true;
        // Repeat the context of the question this page continues: its heading and its base row.
        if (ln.kind !== "question") {
          const q = lines.find((x) => x.question === ln.question && x.kind === "question");
          const base = lines.find((x) => x.question === ln.question && x.kind === "base");
          for (const ctx of [q && { ...q, label: `${q.label} (continued)` }, base && base !== lines[i] ? base : null]) {
            if (!ctx) continue;
            const c = project(ctx);
            page.push(c);
            used += heightOf(c);
          }
        }
      }
      page.push(ln);
      used += h;
    }
    flush();
  });
  return plans;
}

/** The lines of one table, in order: per question its heading, whole-table test, base and answers. */
export function crosstabLines(r: CrosstabResult): { header: string[]; lines: SlideLine[] } {
  const cols = r.columns;
  const header = ["Answer", ...cols.map((c) => (c.letter ? `${c.letter}: ${c.name}` : c.name)), "Total"];
  const blank = () => header.slice(1).map(() => "");
  const lines: SlideLine[] = [];
  r.questions.forEach((q, qi) => {
    lines.push({ label: q.label, cells: blank(), kind: "question", question: qi });
    const tt = q.tableTests?.[0];
    if (tt) {
      lines.push({
        label: `Whole-table test: ${tt.label} ${tt.p < 0.001 ? "p<0.001" : `p=${tt.p}`} (chi-square ${tt.chi2}, df ${tt.df})`,
        cells: blank(),
        kind: "test",
        question: qi,
      });
    }
    const asPct = q.kind === "single" || q.kind === "multi";
    for (const row of q.rows) {
      if (row.isBase) {
        if (row.isEffBase) continue; // one base row per question is enough on a slide
        lines.push({ label: row.label, cells: [...cols.map((_c, j) => String(row.count[j] ?? "")), String(row.total.count ?? "")], kind: "base", question: qi });
        continue;
      }
      const rowAsPct = asPct && !row.isScore;
      const fmt = (v: number | null | undefined): string => {
        if (v === null || v === undefined) return "-";
        if (!rowAsPct) return row.isMean ? v.toFixed(2) : `${v > 0 ? "+" : ""}${v.toFixed(1)}`;
        return `${v}%`;
      };
      lines.push({ label: row.label, cells: [...cols.map((_c, j) => fmt(row.pct[j])), fmt(row.total.pct)], kind: "answer", question: qi });
    }
  });
  return { header, lines };
}

/** Adds one table's slides to the deck (see the file comment for the layout guarantees). */
export function addCrosstabSlides(pptx: PptxGenJS, label: string, r: CrosstabResult): void {
  const { header, lines } = crosstabLines(r);
  const baseRow = r.questions[0]?.rows.find((x) => x.isBase);
  const note = [
    r.weightVar ? `Weighted by ${r.weightLabel ?? r.weightVar}` : "Unweighted",
    baseRow ? `base ${baseRow.total.count ?? "?"}` : "",
    r.provenance?.sourceFile ? `source: ${r.provenance.sourceFile}` : "",
  ].filter(Boolean).join(" · ");
  const plans = planCrosstabSlides(header, lines);
  const columnCount = header.length - 2;
  for (const plan of plans) {
    const slide = pptx.addSlide();
    const columnsNote = plan.groupCount > 1 ? ` (columns ${plan.columns[0] + 1}-${plan.columns[plan.columns.length - 1] + 1} of ${columnCount})` : "";
    slide.addText(`${label}${columnsNote}${plan.continued ? " (continued)" : ""}`, {
      x: MARGIN_X, y: 0.25, w: TABLE_W, h: 0.6, fontSize: 18, bold: true, color: "1E2761", fontFace: "Calibri",
    });
    const rows: PptxGenJS.TableRow[] = [
      plan.header.map((h) => ({ text: h, options: { bold: true, fill: { color: "EEF2FF" }, color: "1E2761" } })),
      ...plan.rows.map((ln) => [
        { text: ln.label, options: { bold: ln.kind === "question", italic: ln.kind === "test" || ln.kind === "base", align: "left" as const } },
        ...ln.cells.map((c) => ({ text: c, options: { italic: ln.kind === "test" || ln.kind === "base", align: "right" as const } })),
      ]),
    ];
    slide.addTable(rows, {
      x: MARGIN_X,
      y: TABLE_TOP,
      w: plan.widths.reduce((a, b) => a + b, 0),
      colW: plan.widths,
      fontSize: FONT_PT,
      fontFace: "Calibri",
      border: { type: "solid", color: "CBD5E1", pt: 0.5 },
      autoPage: false,
    });
    if (note) slide.addText(note, { x: MARGIN_X, y: 7.0, w: TABLE_W, h: 0.3, fontSize: 8, color: "64748B", fontFace: "Calibri" });
  }
}
