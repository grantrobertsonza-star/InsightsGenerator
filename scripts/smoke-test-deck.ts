import PptxGenJS from "pptxgenjs";
import {
  addTitleSlide,
  addFooter,
  addLabeledTextSlide,
  addBigStatementSlide,
  addSectionDivider,
  addEvidenceCard,
  confidenceBadgeFor,
  PRIORITY_BADGES,
  COLORS,
  FONT,
  CARD_LAYOUT,
  humanizeTitle,
  fitParagraph,
  VALIDATION_BADGES,
} from "../src/lib/deckSlides";

// Real strings copied verbatim from the problem slides in
// validateexisting-insights-report-deck_3.pptx, to confirm the fix actually
// holds against the exact content that overflowed before, not just short
// mock content.

const realExecSummary =
  "Across the accepted evidence, structural and demographic advantage (age, education, employment and income) " +
  "robustly predicts DFS adoption, but these factors explain only part of the story, leaving roughly three " +
  "quarters of the variance in usage intensity unexplained by anything currently measured. Subgroup interaction " +
  "effects on gender, metro status, and neighbourhood-level income look statistically striking in places, with " +
  "odds ratios running into the thousands, but are better read as artifacts of sparse cells and quasi-separation " +
  "than as reliable targeting signals. The single highest-priority action is to commission a properly powered, " +
  "regularized re-analysis before any segment-specific product or equity strategy is locked in against these " +
  "interaction effects.";

const realGoverningThought =
  "NLI, education, and structural vulnerability move almost identically, suggesting they are largely the same " +
  "latent construct rather than four separate targeting dimensions, and building separate strategies for each " +
  "risks redundant spend on the same population while genuinely unmeasured factors like trust and reliability " +
  "stay neglected.";

const realPillarHeadline =
  "Gender, metro, and NLI interaction effects look statistically striking but are artifacts of sparse cells and " +
  "quasi-separation, not reliable moderators.";

const realSoWhat =
  "No segment-specific product or equity strategy should be locked in from these interaction effects until a " +
  "properly powered, regularized re-analysis is commissioned.";

const realCardLines = [
  {
    text:
      "Subgroup interaction effects (gender/metro/NLI) are statistically seductive but structurally too fragile " +
      "to anchor targeting decisions",
    fontSize: 13,
    bold: true,
  },
  {
    text:
      "Across three independent interaction analyses (metro/gender, NLI-income, NLI-structural readiness), the " +
      "cluster reports interaction effects that appear notable or even 'significant'/'robust' on their face " +
      "(p=0.0446, OR=4.57, OR=91.66), but each is simultaneously flagged as resting on small cells (n=24) or " +
      "implausibly wide confidence intervals (e.g., 6.01-1396.84), undermining the apparent finding.",
    fontSize: 10,
    color: COLORS.body,
  },
  {
    text:
      "“No gender-, metro-, or NLI-specific targeting criterion should be locked in from these interaction " +
      "terms alone; the organization should either commission a proper multivariate/causal model with adequate " +
      "power or treat these as directional only.”",
    fontSize: 9.5,
    italic: true,
    color: COLORS.muted,
  },
];

const realRecLines = [
  {
    text:
      "Treat income/NLI as a high-confidence segmentation dimension for current descriptive targeting, but hold " +
      "off on finalizing specific NLI segment cutoffs for product eligibility until a validated scoring model " +
      "exists.",
    fontSize: 11.5,
    bold: true,
  },
  { text: "Head of Data Science · Within one quarter", fontSize: 9.5, italic: true, color: COLORS.muted },
];

async function main() {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const deckTitle = humanizeTitle("ValidateExisting");

  addTitleSlide(pptx, {
    title: "ValidateExisting",
    decisionStatement: "Should we launch a segment-specific DFS pricing strategy next quarter?",
    showDecisionLine: true,
    audience: "fintech",
  });

  const summarySlide = addLabeledTextSlide(pptx, { label: "Executive summary", body: realExecSummary });
  addFooter(summarySlide, deckTitle, "Executive summary");

  addSectionDivider(pptx, {
    eyebrow: "How this report builds its case",
    title: "What's true, what it collides with, and what to do next.",
  });

  const apexSlide = addBigStatementSlide(pptx, {
    eyebrow: "What this means",
    statement: realGoverningThought,
    subtext: "Should we launch a segment-specific DFS pricing strategy next quarter?",
  });
  addFooter(apexSlide, deckTitle, "Governing thought");

  addSectionDivider(pptx, {
    eyebrow: "What this means for what you asked",
    title: "Checked against the project's own objectives and decisions.",
  });

  const objSlide = pptx.addSlide();
  objSlide.background = { color: COLORS.paper };
  objSlide.addText("OBJECTIVES & DECISIONS", {
    x: 0.5, y: 0.4, w: 9, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 2,
  });
  const objRows: Array<{ kind: "objective" | "decision"; text: string; status: "resolved" | "partial" | "gap"; conclusion: string }> = [
    {
      kind: "objective",
      text: "Determine which demographic and structural factors most strongly predict DFS adoption among low-income South African households.",
      status: "resolved",
      conclusion: "Age, education, employment, and income robustly predict adoption, though they explain only about a quarter of the variance in usage intensity.",
    },
    {
      kind: "decision",
      text: "Should we launch a segment-specific DFS pricing strategy next quarter?",
      status: "partial",
      conclusion: "Income/NLI segmentation is well-supported for descriptive targeting, but no accepted evidence yet validates specific pricing cutoffs.",
    },
    {
      kind: "objective",
      text: "Understand the role of trust and platform reliability in DFS non-adoption.",
      status: "gap",
      conclusion: "No accepted insight speaks to trust or reliability directly; this remains unmeasured in the current evidence base.",
    },
  ];
  objRows.forEach((item, rowIndex) => {
    const y = 1.0 + rowIndex * (1.0 + 0.16);
    addEvidenceCard(objSlide, {
      x: 0.5,
      y,
      w: 9,
      h: 1.0,
      badge: VALIDATION_BADGES[item.status],
      lines: [
        { text: `${item.kind === "objective" ? "Objective" : "Decision"}: ${item.text}`, fontSize: 12.5, bold: true },
        { text: item.conclusion, fontSize: 10.5, color: COLORS.body },
      ],
    });
  });
  addFooter(objSlide, deckTitle, "Objectives & decisions · 1/1");

  const pillarSlide = pptx.addSlide();
  pillarSlide.background = { color: COLORS.paper };
  pillarSlide.addText("PILLAR 3 OF 5", {
    x: 0.6, y: 0.4, w: 8.8, h: 0.3, fontSize: 11, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 1.5,
  });
  const fittedHeadline = fitParagraph(realPillarHeadline, { fontSize: 19, widthIn: 8.8, heightIn: 0.55, minFontScale: 0.65 });
  pillarSlide.addText(fittedHeadline.text, {
    x: 0.6, y: 0.72, w: 8.8, h: 0.55, fontSize: fittedHeadline.fontSize, bold: true, fontFace: FONT.display, color: COLORS.ink,
  });
  const fittedSoWhat = fitParagraph(realSoWhat, { fontSize: 12, widthIn: 8.8, heightIn: 0.45, minFontScale: 0.7 });
  pillarSlide.addText(fittedSoWhat.text, {
    x: 0.6, y: 1.3, w: 8.8, h: 0.45, fontSize: fittedSoWhat.fontSize, italic: true, fontFace: FONT.body, color: COLORS.muted,
  });
  const INSIGHT_ROW = { H: 1.5, GAP: 0.22, GRID_X: 0.5, GRID_Y: 1.85, W: 9 };
  addEvidenceCard(pillarSlide, {
    x: INSIGHT_ROW.GRID_X,
    y: INSIGHT_ROW.GRID_Y,
    w: INSIGHT_ROW.W,
    h: INSIGHT_ROW.H,
    badge: confidenceBadgeFor("strong"),
    lines: realCardLines,
  });
  addEvidenceCard(pillarSlide, {
    x: INSIGHT_ROW.GRID_X,
    y: INSIGHT_ROW.GRID_Y + INSIGHT_ROW.H + INSIGHT_ROW.GAP,
    w: INSIGHT_ROW.W,
    h: INSIGHT_ROW.H,
    badge: confidenceBadgeFor("strong"),
    lines: realCardLines,
  });
  addFooter(pillarSlide, deckTitle, "Pillar 3 · 1/1");

  addSectionDivider(pptx, { eyebrow: "From evidence to action", title: "What the data says to do about it." });

  const recSlide = pptx.addSlide();
  recSlide.background = { color: COLORS.paper };
  recSlide.addText("RECOMMENDED ACTIONS", {
    x: 0.5, y: 0.4, w: 9, h: 0.4, fontSize: 13, bold: true, fontFace: FONT.body, color: COLORS.accent, charSpacing: 2,
  });
  const { CARD_W, CARD_H, CARD_GAP_X, CARD_GAP_Y, GRID_X, GRID_Y } = CARD_LAYOUT;
  for (let i = 0; i < 6; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    addEvidenceCard(recSlide, {
      x: GRID_X + col * (CARD_W + CARD_GAP_X),
      y: GRID_Y + row * (CARD_H + CARD_GAP_Y),
      w: CARD_W,
      h: CARD_H,
      badge: PRIORITY_BADGES.high,
      lines: realRecLines,
    });
  }
  addFooter(recSlide, deckTitle, "Recommended actions · 1/1");

  await pptx.writeFile({ fileName: process.argv[2] || "smoke-test-deck.pptx" });
  console.log("wrote deck");
}

main();
