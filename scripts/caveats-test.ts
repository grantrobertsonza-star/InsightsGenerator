import PptxGenJS from "pptxgenjs";
import { addFooter, fitBulletList, fitParagraph, COLORS, FONT } from "../src/lib/deckSlides";

// Real-length caveats copied from the problem deck's register (several,
// each already word-capped individually but long together) plus one
// long-ish caveat to stress the per-bullet truncation fallback.
const caveats = [
  "This analysis draws only on documents explicitly marked accepted as of the generation date; anything pending review is excluded from every insight and recommendation above.",
  "Subgroup interaction effects (gender, metro, NLI) rest on small sub-samples and should be treated as directional hypotheses, not confirmed targeting criteria, until a properly powered re-analysis is run.",
  "The four-segment framework is behaviorally distinct but statistically soft at its boundaries; segment sizes and especially the Structurally Excluded group's threshold should be re-derived before resourcing decisions.",
  "No causal claims are made anywhere in this report; every relationship described is observational and association-based unless explicitly flagged otherwise.",
  "Confidence tiers reflect triangulation across sources, not business importance, a strong-confidence insight may still be lower priority than a moderate one with bigger commercial stakes.",
  "Provincial and demographic comparisons use self-reported survey data and may understate true access-use gaps in under-sampled areas.",
];

const footnoteText =
  "Based only on synthesized insights and recommendations explicitly accepted as of 2 October 2026. " +
  "Confidence tier reflects how well-triangulated each insight's evidence is, not how important it is.";

async function main() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const slide = pptx.addSlide();
  slide.background = { color: COLORS.ink };
  slide.addText("CAVEATS & SCOPE", {
    x: 0.6, y: 0.55, w: 8.6, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accentOnDark, charSpacing: 2,
  });

  const fittedCaveats = fitBulletList(caveats, { fontSize: 14, widthIn: 8.4, heightIn: 3.2, minFontScale: 0.65 });
  console.log("caveats fontSize:", fittedCaveats.fontSize);
  fittedCaveats.items.forEach((c, i) => console.log(`[${i}] (${c.split(/\s+/).length}w)`, c));

  slide.addText(
    fittedCaveats.items.map((caveat) => ({ text: caveat, options: { bullet: { code: "25AA" }, breakLine: true, color: "FFFFFF" } })),
    { x: 0.7, y: 1.15, w: 8.4, h: 3.2, fontSize: fittedCaveats.fontSize, fontFace: FONT.body, valign: "top" }
  );

  slide.addShape("rect", { x: 0.7, y: 4.5, w: 8.4, h: 0.008, fill: { color: COLORS.ruleOnDark }, line: { type: "none" } });
  const fittedFootnote = fitParagraph(footnoteText, { fontSize: 10, widthIn: 8.4, heightIn: 0.6, minFontScale: 0.75 });
  slide.addText(fittedFootnote.text, {
    x: 0.7, y: 4.62, w: 8.4, h: 0.6, fontSize: fittedFootnote.fontSize, italic: true, fontFace: FONT.body, color: COLORS.mutedOnDark,
  });

  addFooter(slide, "Validate Existing", "Caveats & scope");

  await pptx.writeFile({ fileName: "caveats-test.pptx" });
  console.log("wrote deck");
}

main();
