// Throwaway visual smoke-test for the new Insights Report deck design
// (src/lib/deckSlides.ts). Builds one deck with representative mock
// content -- cover, SCQA build-up, governing thought, a pillar of
// evidence cards, a recommendations slide, and caveats -- entirely
// standalone (no DB, no Next.js) so Grant can open it in PowerPoint and
// judge the look before it's wired into a real run. Safe to delete once
// reviewed.
import PptxGenJS from "pptxgenjs";
import fs from "node:fs";

const COLORS = {
  ink: "15202B", paper: "F8F5F0", panel: "FFFFFF", rule: "DED6C8", ruleOnDark: "2E3C48",
  body: "33404A", muted: "6B7686", mutedOnDark: "A9B4BE",
  accent: "C2622D", accentDeep: "8F4520", accentOnDark: "E3A37C", gold: "C99A2E", teal: "3C7A89",
  strong: "2F7A4F", moderate: "C2622D", exploratory: "6B7280", notTriangulated: "94A3B8",
  high: "AB2E22", medium: "C2622D", low: "6B7280",
};
const FONT = { display: "Georgia", body: "Calibri" };

function addDotCluster(slide, { x, y, rows = 7, cols = 4, spacing = 0.26, colors = [COLORS.accent, COLORS.teal, COLORS.gold] }) {
  const sizes = [0.05, 0.09, 0.14, 0.19];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 3 === 0 && r % 2 === 0) continue;
      const size = sizes[(r * 2 + c) % sizes.length];
      const color = colors[(r + c) % colors.length];
      slide.addShape("ellipse", { x: x + c * spacing + (r % 2 === 1 ? spacing / 2 : 0), y: y + r * spacing, w: size, h: size, fill: { color }, line: { type: "none" } });
    }
  }
}

function addEvidenceCard(slide, { x, y, w, h, badge, lines }) {
  slide.addShape("roundRect", { x, y, w, h, rectRadius: 0.07, fill: { color: COLORS.panel }, line: { color: COLORS.rule, width: 0.75 } });
  slide.addShape("roundRect", { x, y, w: 0.08, h, rectRadius: 0.04, fill: { color: badge.color }, line: { type: "none" } });
  slide.addText(`${badge.glyph} ${badge.label}`, { x: x + w - 2.3, y: y + 0.12, w: 2.1, h: 0.24, fontSize: 8.5, bold: true, fontFace: FONT.body, color: badge.color, align: "right", charSpacing: 0.5 });
  slide.addText(lines.map((l) => ({ text: l.text, options: { fontSize: l.fontSize, bold: !!l.bold, italic: !!l.italic, color: l.color ?? COLORS.ink, fontFace: FONT.body, breakLine: true } })), { x: x + 0.22, y: y + 0.12, w: w - 2.5, h: h - 0.22, valign: "top", autoFit: true });
}

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_16x9";

// Cover
const cover = pptx.addSlide();
cover.background = { color: COLORS.ink };
addDotCluster(cover, { x: 8.55, y: -0.3, rows: 9, cols: 4, spacing: 0.27 });
cover.addShape("rect", { x: 0, y: 0.95, w: 10, h: 0.02, fill: { color: COLORS.accent }, line: { type: "none" } });
cover.addText("INSIGHTS REPORT", { x: 0.6, y: 1.3, w: 7.5, h: 0.35, fontSize: 12, bold: true, fontFace: FONT.body, color: COLORS.accentOnDark, charSpacing: 3 });
cover.addText("DFS Usage Among South African MSMEs", { x: 0.6, y: 1.75, w: 7.6, h: 1.6, fontSize: 34, bold: true, fontFace: FONT.display, color: "FFFFFF", valign: "top", autoFit: true });
cover.addText("Should FinMark prioritise agent-network expansion or digital-literacy programming in the next funding cycle?", { x: 0.6, y: 3.3, w: 7.4, h: 1.1, fontSize: 15, fontFace: FONT.body, italic: true, color: COLORS.mutedOnDark, valign: "top", autoFit: true });
cover.addShape("rect", { x: 0, y: 4.75, w: 10, h: 0.01, fill: { color: COLORS.ruleOnDark }, line: { type: "none" } });
cover.addText("PREPARED FOR: FINMARK TRUST PROGRAMME TEAM", { x: 0.6, y: 4.95, w: 7.5, h: 0.4, fontSize: 10.5, fontFace: FONT.body, bold: true, color: COLORS.mutedOnDark, charSpacing: 1 });

// Section divider
const divider = pptx.addSlide();
divider.background = { color: COLORS.ink };
addDotCluster(divider, { x: -0.35, y: 3.2, rows: 6, cols: 3, spacing: 0.24 });
divider.addText("HOW THIS REPORT BUILDS ITS CASE", { x: 0.7, y: 1.9, w: 8.6, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accentOnDark, charSpacing: 3 });
divider.addText("What's true, what it collides with, and what to do next.", { x: 0.7, y: 2.35, w: 8.6, h: 1.4, fontSize: 30, bold: true, fontFace: FONT.display, color: "FFFFFF", valign: "top", autoFit: true });

// Governing thought (pull quote)
const apex = pptx.addSlide();
apex.background = { color: COLORS.ink };
addDotCluster(apex, { x: -0.3, y: -0.3, rows: 5, cols: 3, spacing: 0.24 });
apex.addText("WHAT THIS MEANS", { x: 0.7, y: 1.05, w: 8.4, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accentOnDark, charSpacing: 3 });
apex.addText("“", { x: 0.55, y: 1.35, w: 1.2, h: 1.1, fontSize: 70, fontFace: FONT.display, bold: true, color: COLORS.accentDeep });
apex.addText("Agents are not the bottleneck. Trust in what happens after the first deposit is.", { x: 0.75, y: 2.15, w: 8.3, h: 2.1, fontSize: 27, bold: true, fontFace: FONT.display, color: "FFFFFF", valign: "top", autoFit: true });
apex.addShape("rect", { x: 0.75, y: 4.35, w: 0.5, h: 0.025, fill: { color: COLORS.accentOnDark }, line: { type: "none" } });
apex.addText("So where should the next funding cycle actually go?", { x: 0.75, y: 4.5, w: 8.1, h: 0.7, fontSize: 13, italic: true, fontFace: FONT.body, color: COLORS.mutedOnDark, valign: "top", autoFit: true });

// Pillar of evidence cards
const pillar = pptx.addSlide();
pillar.background = { color: COLORS.paper };
pillar.addText("PILLAR 1 OF 3", { x: 0.6, y: 0.4, w: 8.8, h: 0.3, fontSize: 11, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 1.5 });
pillar.addText("Access has outpaced trust.", { x: 0.6, y: 0.72, w: 8.8, h: 0.55, fontSize: 19, bold: true, fontFace: FONT.display, color: COLORS.ink, autoFit: true });
pillar.addText("Most MSMEs can reach a DFS agent. Far fewer trust what the product does after that first transaction.", { x: 0.6, y: 1.3, w: 8.8, h: 0.45, fontSize: 12, italic: true, fontFace: FONT.body, color: COLORS.muted, autoFit: true });
const rowData = [
  { badge: { glyph: "●", label: "STRONG", color: COLORS.strong }, headline: "68% of surveyed MSMEs are within 2km of an active agent.", obs: "Access is no longer the binding constraint in the sampled districts.", quote: "Coverage looks solved; the next constraint is somewhere else." },
  { badge: { glyph: "▲", label: "MODERATE", color: COLORS.moderate }, headline: "41% cite unclear fees as a reason for not transacting again.", obs: "Fee opacity, not fee level, is the recurring complaint across three waves.", quote: "Clarity may matter more here than price itself." },
];
rowData.forEach((row, i) => {
  const y = 1.85 + i * 1.72;
  addEvidenceCard(pillar, { x: 0.5, y, w: 9, h: 1.5, badge: row.badge, lines: [
    { text: row.headline, fontSize: 13, bold: true },
    { text: row.obs, fontSize: 10, color: COLORS.body },
    { text: `“${row.quote}”`, fontSize: 9.5, italic: true, color: COLORS.muted },
  ]});
});

// Recommendations
const recDivider = pptx.addSlide();
recDivider.background = { color: COLORS.ink };
addDotCluster(recDivider, { x: -0.35, y: 3.2, rows: 6, cols: 3, spacing: 0.24 });
recDivider.addText("FROM EVIDENCE TO ACTION", { x: 0.7, y: 1.9, w: 8.6, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accentOnDark, charSpacing: 3 });
recDivider.addText("What the data says to do about it.", { x: 0.7, y: 2.35, w: 8.6, h: 1.4, fontSize: 30, bold: true, fontFace: FONT.display, color: "FFFFFF", valign: "top", autoFit: true });

const recs = pptx.addSlide();
recs.background = { color: COLORS.paper };
recs.addText("RECOMMENDED ACTIONS", { x: 0.5, y: 0.4, w: 9, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 2 });
const recRows = [
  { badge: { glyph: "▲", label: "HIGH PRIORITY", color: COLORS.high }, text: "Pilot a plain-language fee receipt at the point of transaction.", meta: "Product team · Q1 2027" },
  { badge: { glyph: "▶", label: "MEDIUM PRIORITY", color: COLORS.medium }, text: "Shift 20% of agent-expansion budget to post-transaction follow-up calls.", meta: "Programme team · Q2 2027" },
];
recRows.forEach((r, i) => {
  const x = 0.5 + (i % 2) * 4.6;
  const y = 1.05;
  addEvidenceCard(recs, { x, y, w: 4.4, h: 1.35, badge: r.badge, lines: [ { text: r.text, fontSize: 11.5, bold: true }, { text: r.meta, fontSize: 9.5, italic: true, color: COLORS.muted } ] });
});

const outPath = process.argv[2] || "insights-report-preview.pptx";
const buffer = await pptx.write({ outputType: "nodebuffer" });
fs.writeFileSync(outPath, buffer);
console.log("wrote", outPath);
