// A record laid out as a two-column table (field | text) across as many slides as its text needs,
// for exports whose text has no length limit (GT-007, the main recommendation deck). Text is
// measured with the same per-character widths and wrapping as the crosstab slides
// (crosstabSlides.ts), so a long field continues on the next slide, marked "(cont.)", instead of
// running off the slide. Joined, a field's parts are its text exactly. A field that cannot fit
// even one line per slide throws, for the route to refuse visibly.
import { CrosstabLayoutError, lineHeight, wrapOffsets, type TextStyle } from "./crosstabSlides";

/** Cell margins [top, right, bottom, left] in inches; wrapOffsets allows 0.16 inches of padding. */
export const FIELD_CELL_MARGIN: [number, number, number, number] = [0.04, 0.06, 0.04, 0.06];
const PAD_H = FIELD_CELL_MARGIN[0] + FIELD_CELL_MARGIN[2] + 0.02;
const CONT = "(cont.) ";

export type FieldRow = { field: string; text: string; part: number; shown: string; style: TextStyle };
export type FieldGeometry = { labelW: number; valueW: number; pt: number; budget: number };

function rowH(field: string, shown: string, style: TextStyle, g: FieldGeometry): number {
  const lines = Math.max(wrapOffsets(field, g.labelW, g.pt, "bold").length, wrapOffsets(shown, g.valueW, g.pt, style).length);
  return PAD_H + lines * lineHeight(g.pt);
}

export function fieldRowHeight(row: FieldRow, g: FieldGeometry): number {
  return rowH(row.field, row.shown, row.style, g);
}

/** Pages of rows: each page's estimated height stays within g.budget. */
export function planFieldSlides(fields: { field: string; text: string; style?: TextStyle }[], g: FieldGeometry): FieldRow[][] {
  const pages: FieldRow[][] = [];
  let page: FieldRow[] = [];
  let used = 0;
  const next = () => {
    pages.push(page);
    page = [];
    used = 0;
  };
  for (const f of fields) {
    const style = f.style ?? "regular";
    const text = f.text === "" ? "-" : f.text; // an empty field is shown as empty, not dropped
    let pos = 0;
    let part = 0;
    while (pos < text.length || part === 0) {
      const prefix = part === 0 ? "" : CONT;
      const rest = text.slice(pos);
      const h = rowH(f.field, prefix + rest, style, g);
      if (used + h <= g.budget) {
        page.push({ field: f.field, text: rest, part, shown: prefix + rest, style });
        used += h;
        break;
      }
      // Split here when at least two lines fit; otherwise start a fresh slide.
      const room = g.budget - used;
      const maxLines = Math.floor((room - PAD_H) / lineHeight(g.pt) + 1e-9);
      const labelLines = wrapOffsets(f.field, g.labelW, g.pt, "bold").length;
      if (maxLines < Math.max(2, labelLines)) {
        if (page.length === 0) throw new CrosstabLayoutError(`The field "${f.field}" cannot fit on a slide.`);
        next();
        continue;
      }
      const offsets = wrapOffsets(prefix + rest, g.valueW, g.pt, style);
      const end = pos + offsets[maxLines - 1][1] - prefix.length;
      if (end <= pos) {
        if (page.length === 0) throw new CrosstabLayoutError(`The field "${f.field}" cannot fit on a slide.`);
        next();
        continue;
      }
      page.push({ field: f.field, text: text.slice(pos, end), part, shown: prefix + text.slice(pos, end), style });
      pos = end;
      part++;
      next();
    }
  }
  if (page.length > 0) pages.push(page);
  return pages;
}
