// Fitting a chart's title and legend inside the chart's own width (Grant, 29 October 2026: "the legends in the
// chart module are being cut off"). The chart is one SVG whose width follows what is plotted
// (ChartVisual.tsx); a legend laid out at a fixed 150 per entry on one row, and a title on one line, ran past
// that width and were clipped, worst on a chart with few categories and many groups (nine provinces under
// "Yes" and "No"). Display only: no figure changes.
// Text width is estimated, since an SVG drawn for export has no layout engine to measure with: a generous
// average character width for the font size, so an estimate errs towards wrapping early rather than clipping.

/** Estimated width of `text` at `fontSize` (system-ui): about 0.6 of the size per character, 0.64 when bold. */
export function textWidth(text: string, fontSize: number, bold = false): number {
  return text.length * fontSize * (bold ? 0.64 : 0.6);
}

export type LegendEntry = { label: string };
export type LegendPlacement = { x: number; row: number };

/** Legend entries placed left to right, wrapping to a new row when the next entry would pass `maxWidth`.
 * Each entry is a 10-unit swatch, a 4-unit space, its label, and an 18-unit gap before the next. An entry
 * wider than a whole row gets a row of its own (its label is shortened by `fitText` before this). */
export function legendLayout(entries: LegendEntry[], maxWidth: number, fontSize: number): { placements: LegendPlacement[]; rows: number } {
  const placements: LegendPlacement[] = [];
  let x = 0;
  let row = 0;
  for (const e of entries) {
    const w = 14 + textWidth(e.label, fontSize, true);
    if (x > 0 && x + w > maxWidth) {
      row += 1;
      x = 0;
    }
    placements.push({ x, row });
    x += w + 18;
  }
  return { placements, rows: entries.length ? row + 1 : 0 };
}

/** `text` shortened with an ellipsis to fit `maxWidth`; unchanged when it fits. */
export function fitText(text: string, maxWidth: number, fontSize: number, bold = false): string {
  if (textWidth(text, fontSize, bold) <= maxWidth) return text;
  const chars = Math.max(1, Math.floor(maxWidth / (fontSize * (bold ? 0.64 : 0.6))) - 1);
  return `${text.slice(0, chars).trimEnd()}…`;
}

/** A title broken at spaces into at most `maxLines` lines that fit `maxWidth`; the last line ends with an
 * ellipsis when the title is longer than that. The full title stays available as the SVG's tooltip. */
export function wrapTitle(title: string, maxWidth: number, fontSize: number, maxLines = 2): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  for (; i < words.length; i++) {
    const next = current ? `${current} ${words[i]}` : words[i];
    if (textWidth(next, fontSize, true) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = words[i];
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && current) {
    lines.push(current);
    current = "";
    i = words.length;
  }
  const rest = i < words.length;
  return lines.map((l, k) => (k === lines.length - 1 && rest ? fitText(`${l} ${words.slice(i).join(" ")}`, maxWidth, fontSize, true) : fitText(l, maxWidth, fontSize, true)));
}
