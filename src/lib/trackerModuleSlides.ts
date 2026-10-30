// R5story (Grant, 30 October 2026): the whole brand tracking dashboard as a PowerPoint deck, "all self-contained
// from input to report": a title slide; the executive summary; one slide per dashboard page with its charts, key
// figures, bases and caveats in the footnote, and that page's accepted AI insights; the conclusions and
// recommendations. Built with pptxgenjs like every deck export, in the dashboard's own visual language (white cards,
// slate text, the client's brand in blue: docs/design previews), with the charts drawn by the shared chart image
// pipeline (renderChartImage.renderBarsImage).
//
// What the deck may say:
//   - figures come from the page loaders (trackerDashboardCards.ts), recomputed for the export, never from the
//     browser; a page that cannot be calculated gets its slide with the reason, never a silently missing slide;
//   - a page's insights are its ACCEPTED AI insights whose figures are still the page's; AI drafts appear only when
//     the researcher ticks "include drafts", each labelled "AI draft" on the slide; refused and discarded drafts never
//     appear; an accepted insight whose figures changed is left out and the slide says how many were;
//   - the executive summary and conclusions are the researcher's accepted text (or, with drafts included, an
//     unaccepted draft labelled as one); when nothing is accepted the slide says so instead of inventing one;
//   - text is never cut: sizes are measured with the crosstab slides' font metrics (wrapOffsets) and shrunk to a
//     floor; a list that still does not fit continues on a following slide, and anything else that cannot fit
//     throws ModuleDeckLayoutError, which the route returns as a visible refusal.
import PptxGenJS from "pptxgenjs";
import { lineHeight, wrapOffsets, type TextStyle } from "./crosstabSlides";
import { renderBarsImage } from "./renderChartImage";
import type { CardFigures, PageContext } from "./trackerDashboardCards";

export class ModuleDeckLayoutError extends Error {}

const W = 13.333;
const H = 7.5;
const MX = 0.5;
const C = {
  ink: "0F172A",
  body: "334155",
  muted: "64748B",
  rule: "E2E8F0",
  blue: "2563EB",
  blueDeep: "1D4ED8",
  blueTint: "EFF6FF",
  blueLine: "BFDBFE",
  page: "F5F7FB",
  amber: "B45309",
  amberTint: "FFFBEB",
};
const FONT = "Calibri";

export type StoryText =
  | { state: "accepted"; text: string }
  | { state: "draft"; text: string }
  | { state: "not_accepted"; drafts: number }
  | { state: "stale" }
  | { state: "nothing_accepted" };

export type DeckPage = {
  number: number;
  id: string;
  title: string;
  status: "ok" | "failed";
  error?: string;
  ctx?: PageContext;
  cards: (CardFigures & { sentence: string | null })[];
  insights: { accepted: string[]; drafts: string[]; staleAccepted: number; draftsLeftOut: number };
};

export type ModuleDeckInput = {
  filename: string;
  wave: string | null;
  focal: string | null;
  weighting: string;
  generatedAt: Date;
  includeDrafts: boolean;
  pages: DeckPage[];
  summary: StoryText;
  conclusions: StoryText;
};

/** Measured height of a text at a size in a box of this width (Carlito metrics, as the crosstab slides). */
function textHeight(text: string, widthIn: number, pt: number, style: TextStyle = "regular"): number {
  return wrapOffsets(text, widthIn, pt, style).length * lineHeight(pt) + 0.06;
}
/** The largest size from `max` down to `min` (half points) at which the text fits; null when none does. */
function fitSize(text: string, widthIn: number, heightIn: number, max: number, min: number, style: TextStyle = "regular"): number | null {
  for (let pt = max; pt >= min; pt -= 0.5) if (textHeight(text, widthIn, pt, style) <= heightIn) return pt;
  return null;
}
function mustFit(what: string, text: string, widthIn: number, heightIn: number, max: number, min: number, style: TextStyle = "regular"): number {
  const pt = fitSize(text, widthIn, heightIn, max, min, style);
  if (pt === null) throw new ModuleDeckLayoutError(`${what} is too long to fit its slide without cutting it.`);
  return pt;
}

function frame(pptx: PptxGenJS, footer: string, pageLabel: string): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  slide.background = { color: C.page };
  slide.addShape("rect", { x: 0, y: 0, w: 0.12, h: H, fill: { color: C.blue }, line: { type: "none" } });
  slide.addText(footer, { x: MX, y: H - 0.38, w: 9.5, h: 0.25, fontSize: 8, fontFace: FONT, color: C.muted, margin: 0 });
  slide.addText(pageLabel, { x: W - MX - 2.5, y: H - 0.38, w: 2.5, h: 0.25, fontSize: 8, fontFace: FONT, color: C.muted, align: "right", margin: 0 });
  return slide;
}

function heading(slide: PptxGenJS.Slide, eyebrow: string, title: string, subtitle: string | null) {
  slide.addText(eyebrow.toUpperCase(), { x: MX, y: 0.32, w: 9, h: 0.25, fontSize: 10, bold: true, fontFace: FONT, color: C.blue, charSpacing: 1, margin: 0 });
  slide.addText(title, { x: MX, y: 0.58, w: W - 2 * MX, h: 0.55, fontSize: 26, bold: true, fontFace: FONT, color: C.ink, margin: 0 });
  if (subtitle) slide.addText(subtitle, { x: MX, y: 1.13, w: W - 2 * MX, h: 0.28, fontSize: 11, fontFace: FONT, color: C.muted, margin: 0 });
}

function draftLabel(): PptxGenJS.TextProps {
  return { text: "AI DRAFT, NOT ACCEPTED  ", options: { bold: true, color: C.amber } };
}

function addTitleSlide(pptx: PptxGenJS, d: ModuleDeckInput, footer: string) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };
  slide.addShape("rect", { x: 0, y: 0, w: 4.4, h: H, fill: { color: C.blue }, line: { type: "none" } });
  slide.addText("INSIGHTS ELEVATOR", { x: 0.55, y: 0.6, w: 3.5, h: 0.3, fontSize: 11, bold: true, fontFace: FONT, color: "FFFFFF", charSpacing: 2, margin: 0 });
  slide.addText("Brand tracking", { x: 0.55, y: 2.6, w: 3.6, h: 0.9, fontSize: 34, bold: true, fontFace: FONT, color: "FFFFFF", margin: 0 });
  slide.addText("Report from the brand tracking dashboard", { x: 0.55, y: 3.45, w: 3.6, h: 0.6, fontSize: 13, fontFace: FONT, color: "DBEAFE", margin: 0 });
  const lines = [
    d.focal ? `Client brand: ${d.focal}` : "Client brand: not chosen",
    `Wave: ${d.wave ?? "not labelled"}`,
    `Data file: ${d.filename}`,
    `Figures: ${d.weighting}`,
    `Exported ${d.generatedAt.toISOString().slice(0, 10)}`,
    d.includeDrafts ? "AI drafts are included and labelled as drafts." : "Only insights and text the researcher accepted are included.",
  ];
  const body = lines.join("\n");
  const pt = mustFit("The title slide's details", body, 7.6, 3.4, 16, 11);
  slide.addText(body, { x: 5.0, y: 2.5, w: 7.6, h: 3.4, fontSize: pt, fontFace: FONT, color: C.body, valign: "top", margin: 0, paraSpaceAfter: 6 });
  slide.addText("Brand tracking report", { x: 5.0, y: 1.4, w: 7.6, h: 0.7, fontSize: 30, bold: true, fontFace: FONT, color: C.ink, margin: 0 });
  slide.addText(footer, { x: 5.0, y: H - 0.5, w: 7.6, h: 0.25, fontSize: 8, fontFace: FONT, color: C.muted, margin: 0 });
}

function storySentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z0-9"])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function addStorySlides(pptx: PptxGenJS, d: ModuleDeckInput, kind: "summary" | "conclusions", footer: string, label: () => string) {
  const t = kind === "summary" ? d.summary : d.conclusions;
  const title = kind === "summary" ? "Executive summary" : "Conclusions and recommendations";
  const what = kind === "summary" ? "executive summary" : "conclusions and recommendations";
  const boxW = W - 2 * MX - 0.6;
  const boxH = 4.6;
  if (t.state === "nothing_accepted" || t.state === "not_accepted" || t.state === "stale") {
    const slide = frame(pptx, footer, label());
    heading(slide, kind === "summary" ? "Summary" : "Conclusions", title, null);
    const text =
      t.state === "nothing_accepted"
        ? `Nothing on this dashboard has been accepted yet, so no ${what} is drafted. Accept AI insights or post cards as findings, then draft and accept the ${what}.`
        : t.state === "stale"
          ? `The accepted ${what} ${kind === "summary" ? "was" : "were"} drafted from insights or findings that have changed since, so ${kind === "summary" ? "it is" : "they are"} not shown. Draft again from what is accepted now.`
          : `No ${what} ${kind === "summary" ? "has" : "have"} been accepted yet${t.drafts > 0 ? ` (${t.drafts} AI draft${t.drafts === 1 ? "" : "s"} not included)` : ""}, so it is not shown.`;
    slide.addShape("roundRect", { x: MX, y: 1.7, w: W - 2 * MX, h: 1.4, fill: { color: "FFFFFF" }, line: { color: C.rule, width: 1 }, rectRadius: 0.08 });
    slide.addText(text, { x: MX + 0.3, y: 1.85, w: W - 2 * MX - 0.6, h: 1.1, fontSize: 16, fontFace: FONT, color: C.body, valign: "middle", margin: 0 });
    return;
  }
  // Sentences are kept whole: as many as fit at the floor size per slide, the rest continue on the next slide.
  const sentences = storySentences(t.text);
  const pages: string[][] = [];
  let current: string[] = [];
  for (const s of sentences) {
    const next = [...current, s];
    if (current.length > 0 && fitSize(next.join("\n"), boxW, boxH, 18, 13) === null) {
      pages.push(current);
      current = [s];
    } else current = next;
  }
  if (current.length) pages.push(current);
  pages.forEach((part, i) => {
    const slide = frame(pptx, footer, label());
    heading(slide, kind === "summary" ? "Summary" : "Conclusions", i === 0 ? title : `${title} (continued)`, t.state === "draft" ? "AI draft, not accepted by the researcher" : "Accepted by the researcher");
    const body = part.join("\n");
    const pt = mustFit(`A sentence of the ${what}`, body, boxW, boxH, 18, 13);
    slide.addShape("roundRect", { x: MX, y: 1.6, w: W - 2 * MX, h: boxH + 0.4, fill: { color: t.state === "draft" ? C.amberTint : "FFFFFF" }, line: { color: t.state === "draft" ? "FCD34D" : C.rule, width: 1 }, rectRadius: 0.08 });
    slide.addText(
      part.map((s, j) => ({ text: s, options: { bullet: { indent: 18 }, breakLine: j < part.length - 1, paraSpaceAfter: 8 } })),
      { x: MX + 0.3, y: 1.8, w: boxW, h: boxH, fontSize: pt, fontFace: FONT, color: C.ink, valign: "top", margin: 0 },
    );
  });
}

function unavailableWords(c: CardFigures): string {
  const head = c.status === "not_measured" ? "Not measured" : c.status === "mapping_needed" ? "Mapping needed" : c.status === "needs_brand" ? "Brand not chosen" : "Not available";
  return `${head}. ${c.reason ?? ""}`.trim();
}

async function addPageSlides(pptx: PptxGenJS, d: ModuleDeckInput, p: DeckPage, footer: string, label: () => string) {
  const eyebrow = `Page ${String(p.number).padStart(2, "0")}`;
  const subtitle = p.ctx ? [p.ctx.focal ? `Client brand ${p.ctx.focal.label}` : null, p.ctx.wave, p.ctx.weighted && p.ctx.weightVar ? `weighted by ${p.ctx.weightVar}` : "unweighted"].filter(Boolean).join(" · ") : null;
  if (p.status === "failed") {
    const slide = frame(pptx, footer, label());
    heading(slide, eyebrow, p.title, null);
    slide.addText(`This page could not be calculated for the export, so it has no figures here: ${p.error ?? "unknown error"}`, { x: MX, y: 1.7, w: W - 2 * MX, h: 1.0, fontSize: 14, fontFace: FONT, color: "991B1B", margin: 0 });
    return;
  }
  const slide = frame(pptx, footer, label());
  heading(slide, eyebrow, p.title, subtitle);

  // Left: the page's cards, side by side.
  const leftW = 8.35;
  const top = 1.6;
  const cardH = 4.55;
  const gap = 0.18;
  const n = Math.max(1, p.cards.length);
  const cw = (leftW - gap * (n - 1)) / n;
  for (let i = 0; i < p.cards.length; i++) {
    const c = p.cards[i];
    const x = MX + i * (cw + gap);
    slide.addShape("roundRect", { x, y: top, w: cw, h: cardH, fill: { color: "FFFFFF" }, line: { color: C.rule, width: 1 }, rectRadius: 0.06 });
    const innerW = cw - 0.3;
    const titlePt = mustFit(`The card title "${c.title}"`, c.title, innerW, 0.5, 13, 10, "bold");
    slide.addText(c.title, { x: x + 0.15, y: top + 0.12, w: innerW, h: 0.5, fontSize: titlePt, bold: true, fontFace: FONT, color: C.ink, valign: "top", margin: 0 });
    if (c.status !== "ok") {
      const words = unavailableWords(c);
      const pt = mustFit(`The note on "${c.title}"`, words, innerW, 3.6, 11, 8);
      slide.addText(words, { x: x + 0.15, y: top + 0.7, w: innerW, h: 3.6, fontSize: pt, fontFace: FONT, color: C.muted, valign: "top", margin: 0 });
      continue;
    }
    let y = top + 0.62;
    if (c.chart && c.chart.rows.length > 0) {
      const img = await renderBarsImage({ rows: c.chart.rows, unit: c.chart.unit }, Math.round(innerW * 150));
      const maxH = 2.35;
      let w = innerW;
      let h = (img.height / img.width) * w;
      if (h > maxH) {
        h = maxH;
        w = (img.width / img.height) * h;
      }
      slide.addImage({ data: `data:image/png;base64,${img.png.toString("base64")}`, x: x + 0.15, y, w, h, altText: `${c.chart.title}: ${c.chart.rows.map((r) => `${r.label} ${r.value === null ? "n/a" : r.value.toFixed(1)}`).join(", ")}` });
      y += h + 0.1;
    }
    const keyText = c.sentence ?? "No sentence: choose the client brand to state this card's figures.";
    const room = top + cardH - y - 0.12;
    const pt = mustFit(`The key figures of "${c.title}"`, keyText, innerW, room, 10, 6.5);
    slide.addText(keyText, { x: x + 0.15, y, w: innerW, h: room, fontSize: pt, fontFace: FONT, color: C.body, valign: "top", margin: 0 });
  }

  // Right: the page's insights.
  const rx = MX + leftW + 0.25;
  const rw = W - MX - rx;
  slide.addShape("roundRect", { x: rx, y: top, w: rw, h: cardH, fill: { color: C.blueTint }, line: { color: C.blueLine, width: 1 }, rectRadius: 0.06 });
  slide.addText("Insights", { x: rx + 0.18, y: top + 0.12, w: rw - 0.36, h: 0.35, fontSize: 13, bold: true, fontFace: FONT, color: C.blueDeep, margin: 0 });
  const items: { text: string; draft: boolean }[] = [...p.insights.accepted.map((t) => ({ text: t, draft: false })), ...(d.includeDrafts ? p.insights.drafts.map((t) => ({ text: t, draft: true })) : [])];
  const extra: string[] = [];
  if (p.insights.staleAccepted > 0) extra.push(`${p.insights.staleAccepted} accepted insight${p.insights.staleAccepted === 1 ? " is" : "s are"} left out: the page's figures changed since ${p.insights.staleAccepted === 1 ? "it was" : "they were"} drafted.`);
  if (!d.includeDrafts && p.insights.draftsLeftOut > 0) extra.push(`${p.insights.draftsLeftOut} AI draft${p.insights.draftsLeftOut === 1 ? " is" : "s are"} not included (not accepted).`);
  const iw = rw - 0.36;
  const ih = cardH - 0.6;
  const runsOf = (list: { text: string; draft: boolean }[]): PptxGenJS.TextProps[] => {
    if (list.length === 0) return [{ text: "No insight on this page has been accepted yet.", options: { color: C.muted, breakLine: extra.length > 0 } }, ...extra.map((e, j) => ({ text: e, options: { color: C.muted, fontSize: 9, breakLine: j < extra.length - 1 } }))];
    const runs: PptxGenJS.TextProps[] = [];
    list.forEach((it, j) => {
      if (it.draft) runs.push({ ...draftLabel(), options: { ...draftLabel().options, bullet: { indent: 14 } } });
      runs.push({ text: it.text, options: { ...(it.draft ? {} : { bullet: { indent: 14 } }), breakLine: true, paraSpaceAfter: 6 } });
      void j;
    });
    extra.forEach((e, j) => runs.push({ text: e, options: { color: C.muted, breakLine: j < extra.length - 1 } }));
    return runs;
  };
  const plain = (list: { text: string; draft: boolean }[]) => [...list.map((it) => `${it.draft ? "AI DRAFT, NOT ACCEPTED  " : ""}${it.text}`), ...extra].join("\n") || "No insight on this page has been accepted yet.";
  // As many insights as fit at the floor size here; the rest continue on a following slide.
  let shown = items;
  let rest: typeof items = [];
  while (shown.length > 1 && fitSize(plain(shown), iw - 0.2, ih, 12, 8) === null) {
    rest = [shown[shown.length - 1], ...rest];
    shown = shown.slice(0, -1);
  }
  const ipt = mustFit(`An insight on "${p.title}"`, plain(shown), iw - 0.2, ih, 12, 8);
  slide.addText(runsOf(shown), { x: rx + 0.18, y: top + 0.52, w: iw, h: ih, fontSize: ipt, fontFace: FONT, color: C.ink, valign: "top", margin: 0 });

  // Footnote: weighting, bases, qualifications and caveats, every card's, said once each.
  const notes = [...new Set(p.cards.filter((c) => c.status === "ok").flatMap((c) => [...c.notes]))];
  const methods = p.cards.filter((c) => c.status === "ok").map((c) => `${c.title}: ${c.method}${baseLine(c)}`);
  const foot = [...methods, ...notes].join(" ");
  const fpt = mustFit(`The footnote of "${p.title}"`, foot, W - 2 * MX, 0.95, 8, 6);
  slide.addText(foot, { x: MX, y: top + cardH + 0.12, w: W - 2 * MX, h: 0.95, fontSize: fpt, fontFace: FONT, color: C.muted, valign: "top", margin: 0 });

  if (rest.length > 0) {
    const more: DeckPage = { ...p, title: `${p.title} (continued)`, cards: [], insights: { accepted: rest.filter((r) => !r.draft).map((r) => r.text), drafts: rest.filter((r) => r.draft).map((r) => r.text), staleAccepted: 0, draftsLeftOut: 0 } };
    await addInsightsOnlySlide(pptx, d, more, footer, label);
  }
}

function baseLine(c: CardFigures): string {
  const bases = [...new Set(c.figures.filter((f) => f.value !== null && f.base !== null).map((f) => f.base!))];
  if (bases.length === 0) return " Base not known.";
  const lo = Math.min(...bases);
  const hi = Math.max(...bases);
  return lo === hi ? ` Base n=${lo.toLocaleString("en-GB")}.` : ` Bases n=${lo.toLocaleString("en-GB")} to ${hi.toLocaleString("en-GB")}.`;
}

async function addInsightsOnlySlide(pptx: PptxGenJS, d: ModuleDeckInput, p: DeckPage, footer: string, label: () => string) {
  const slide = frame(pptx, footer, label());
  heading(slide, `Page ${String(p.number).padStart(2, "0")}`, p.title, null);
  const list = [...p.insights.accepted.map((t) => ({ text: t, draft: false })), ...p.insights.drafts.map((t) => ({ text: t, draft: true }))];
  const text = list.map((it) => `${it.draft ? "AI DRAFT, NOT ACCEPTED  " : ""}${it.text}`).join("\n");
  const pt = mustFit(`The insights continued on "${p.title}"`, text, W - 2 * MX - 0.4, 4.6, 14, 9);
  slide.addText(
    list.flatMap((it, j) => [...(it.draft ? [draftLabel()] : []), { text: it.text, options: { breakLine: j < list.length - 1, paraSpaceAfter: 8 } }]),
    { x: MX + 0.2, y: 1.7, w: W - 2 * MX - 0.4, h: 4.6, fontSize: pt, fontFace: FONT, color: C.ink, valign: "top", margin: 0 },
  );
  void d;
}

/** Builds the module's deck (see the file comment). */
export async function buildTrackerModuleDeck(d: ModuleDeckInput): Promise<PptxGenJS> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = "Brand tracking report";
  const footer = `Brand tracking · ${d.focal ?? "client brand not chosen"} · ${d.wave ?? "wave not labelled"} · ${d.filename}${d.includeDrafts ? " · includes AI drafts" : ""}`;
  let n = 1;
  const label = () => `${++n}`;
  addTitleSlide(pptx, d, footer);
  addStorySlides(pptx, d, "summary", footer, label);
  for (const p of d.pages) await addPageSlides(pptx, d, p, footer, label);
  addStorySlides(pptx, d, "conclusions", footer, label);
  return pptx;
}
