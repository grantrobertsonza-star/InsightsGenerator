import type PptxGenJS from "pptxgenjs";
import { trailOutline, type EvidenceTrail, type TrailLine } from "./evidenceTrail";
import { COLORS, FONT, addFooter, addSectionDivider } from "./deckSlides";

// The evidence trail of each recommendation in the deck (evidence trail extras, Grant, 26 October 2026),
// the same outline the Word report's appendix prints (trailOutline): every step on its own line, indented
// by depth, and a break or caution stated in words on the line where it occurs. Lines are never cut short,
// because the qualification is at the end of a line; a long trail continues on further slides instead.

const BODY = { x: 0.6, y: 1.05, w: 8.8, h: 3.95 } as const;
const FONT_SIZE = 10;
/** Wrapped rows that fit the body box at FONT_SIZE, with room for paragraph spacing. */
const ROWS_PER_SLIDE = 19;
/** Characters per wrapped row at FONT_SIZE across the body width, before indentation. */
const CHARS_PER_ROW = 120;
const CHARS_PER_INDENT = 5;

/** Estimated rows a line wraps to on the slide; an estimate, so pages leave headroom (ROWS_PER_SLIDE). */
function rowsFor(line: TrailLine): number {
  return Math.max(1, Math.ceil(line.text.length / Math.max(40, CHARS_PER_ROW - CHARS_PER_INDENT * line.depth)));
}

/** The trail's lines split into slide pages, in order, none dropped or shortened. */
export function trailSlidePages(trail: EvidenceTrail): TrailLine[][] {
  const pages: TrailLine[][] = [];
  let page: TrailLine[] = [];
  let rows = 0;
  for (const line of trailOutline(trail)) {
    const need = rowsFor(line);
    if (page.length > 0 && rows + need > ROWS_PER_SLIDE) {
      pages.push(page);
      page = [];
      rows = 0;
    }
    page.push(line);
    rows += need;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

const STATE_COLOR = { current: COLORS.body, caution: COLORS.accentDeep, broken: COLORS.high } as const;

/** Adds the evidence-trail appendix: a divider, then each recommendation's trail on one or more slides. */
export function addEvidenceTrailSlides(pptx: PptxGenJS, trails: EvidenceTrail[], deckTitle: string): void {
  if (trails.length === 0) return;
  addSectionDivider(pptx, {
    eyebrow: "Appendix: evidence trails",
    title: "Each recommendation, what it is for, and every step of evidence beneath it.",
  });
  trails.forEach((trail, n) => {
    const pages = trailSlidePages(trail);
    pages.forEach((lines, i) => {
      const slide = pptx.addSlide();
      slide.background = { color: COLORS.paper };
      slide.addText(`EVIDENCE TRAIL ${n + 1}${pages.length > 1 ? ` (${i + 1} of ${pages.length})` : ""}`, {
        x: 0.6, y: 0.35, w: 8.8, h: 0.3, fontSize: 11, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 2,
      });
      slide.addText(trail.root.label, { x: 0.6, y: 0.62, w: 8.8, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.ink, fit: "shrink" });
      slide.addText(
        lines.map((l) => ({
          text: l.text,
          // Colour repeats what the words already say ("Break in the trail", "Check"); it is never the only signal.
          options: { breakLine: true, indentLevel: l.depth, bullet: { code: "25AA" }, color: STATE_COLOR[l.state], bold: l.depth === 0 },
        })),
        { ...BODY, fontSize: FONT_SIZE, fontFace: FONT.body, valign: "top", paraSpaceAfter: 2 },
      );
      addFooter(slide, deckTitle, "Evidence trail");
    });
  });
}
