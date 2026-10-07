import type PptxGenJS from "pptxgenjs";
import { parseNumberedItems } from "./text";
import type { ConfidenceTier } from "./tiers";

/**
 * Shared visual language for every deck export (findings, insights,
 * recommendations, synthesized insights, and the narrative-driven Insights
 * Report). Centralising it here means one palette/typography decision
 * improves every deck at once, and a client-branded version later only
 * needs to replace the values in this section, not the slide-building
 * logic that uses them.
 *
 * Deliberately brand-neutral for now: a warm, confident palette and a
 * reusable geometric accent (addDotCluster) instead of photography, so a
 * deck still reads as considered before any client-specific imagery or
 * branding is layered on top of it.
 */
export const COLORS = {
  // Base
  ink: "15202B", // primary dark background, and heading text on light slides
  paper: "F8F5F0", // warm off-white, used instead of pure white for light slides
  panel: "FFFFFF",
  rule: "DED6C8", // hairline rules on light slides
  ruleOnDark: "2E3C48",
  body: "33404A",
  muted: "6B7686",
  mutedOnDark: "A9B4BE",
  // Signal palette (warm, confident; not tied to any client's brand)
  accent: "C2622D", // terracotta -- primary signal color, eyebrows/labels/accents
  accentDeep: "8F4520",
  accentOnDark: "E3A37C",
  gold: "C99A2E",
  teal: "3C7A89",
  // Semantic: kept distinct from the signal palette so a reader never
  // confuses "this is the deck's accent color" with "this is a verdict".
  // Per the app's own sceptic-dashboard rule, a badge is never color
  // alone -- every one of these pairs a color with a short icon glyph and
  // a text label (see CONFIDENCE_BADGES / PRIORITY_BADGES below).
  strong: "2F7A4F",
  moderate: "C2622D",
  exploratory: "6B7280",
  notTriangulated: "94A3B8",
  high: "AB2E22",
  medium: "C2622D",
  low: "6B7280",
} as const;

/** Safe, near-universally-installed Office fonts: no dependency on a font being present on whatever machine opens the deck. */
export const FONT = {
  display: "Georgia", // serif, used sparingly for pull-quotes and the apex statement
  body: "Calibri",
} as const;

type PriorityTier = "high" | "medium" | "low";

/**
 * Icon + label pairs for confidence tiers, reused across every slide that
 * shows a synthesized insight. The glyph is plain, widely-supported
 * Unicode (no icon font dependency) and exists specifically so the badge
 * never relies on color alone to be read correctly, including by someone
 * viewing a black-and-white printout.
 */
export const CONFIDENCE_BADGES: Record<
  string,
  { glyph: string; label: string; color: string }
> = {
  strong: { glyph: "●", label: "STRONG", color: COLORS.strong }, // ●
  moderate: { glyph: "▲", label: "MODERATE", color: COLORS.moderate }, // ▲
  exploratory: { glyph: "–", label: "EXPLORATORY", color: COLORS.exploratory }, // –
};
export const NOT_TRIANGULATED_BADGE = {
  glyph: "?",
  label: "NOT YET TRIANGULATED",
  color: COLORS.notTriangulated,
};

export function confidenceBadgeFor(tier: ConfidenceTier) {
  return (tier && CONFIDENCE_BADGES[tier]) || NOT_TRIANGULATED_BADGE;
}

export const PRIORITY_BADGES: Record<
  PriorityTier,
  { glyph: string; label: string; color: string }
> = {
  high: { glyph: "▲", label: "HIGH PRIORITY", color: COLORS.high }, // ▲
  medium: { glyph: "▶", label: "MEDIUM PRIORITY", color: COLORS.medium }, // ▶
  low: { glyph: "●", label: "LOW PRIORITY", color: COLORS.low }, // ●
};

type ValidationStatus = "resolved" | "partial" | "gap";

/**
 * Icon + label pairs for the objective/decision validator's per-item
 * disposition, shown on the "What we set out to answer" slide. A gap
 * deliberately shares exploratory's neutral grey rather than a warning
 * red: an honestly-named gap is a normal, useful research finding, not a
 * failure the deck should visually alarm the reader about.
 */
export const VALIDATION_BADGES: Record<
  ValidationStatus,
  { glyph: string; label: string; color: string }
> = {
  resolved: { glyph: "●", label: "RESOLVED", color: COLORS.strong },
  partial: { glyph: "▲", label: "PARTIAL", color: COLORS.moderate },
  gap: { glyph: "?", label: "GAP", color: COLORS.exploratory },
};

/**
 * A small scattered cluster of circles, the deck's one recurring geometric
 * motif in place of photography. Anchored at (x, y), growing down and to
 * the right; callers pick a corner and let it bleed off the slide edge the
 * way the title and section-divider slides do. Kept intentionally
 * irregular (varied size, a thinned-out diagonal) rather than a perfect
 * grid, so it reads as a considered design detail rather than a
 * placeholder pattern.
 */
export function addDotCluster(
  slide: PptxGenJS.PresSlide,
  {
    x,
    y,
    rows = 7,
    cols = 4,
    spacing = 0.26,
    colors = [COLORS.accent, COLORS.teal, COLORS.gold],
  }: {
    x: number;
    y: number;
    rows?: number;
    cols?: number;
    spacing?: number;
    colors?: string[];
  },
) {
  const sizes = [0.05, 0.09, 0.14, 0.19];
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // Thin the grid out along a diagonal band so it reads as a loose
      // cluster rather than a filled rectangle.
      if ((r + c) % 3 === 0 && r % 2 === 0) continue;
      const size = sizes[(r * 2 + c) % sizes.length];
      const color = colors[(r + c) % colors.length];
      slide.addShape("ellipse", {
        x: x + c * spacing + (r % 2 === 1 ? spacing / 2 : 0),
        y: y + r * spacing,
        w: size,
        h: size,
        fill: { color },
        line: { type: "none" },
      });
      i++;
    }
  }
  return i;
}

/**
 * Cover slide shared by every deck export (findings, insights,
 * recommendations, synthesized insights, and the Insights Report). The
 * decision statement can be a single sentence or, once more than one
 * decision has been accepted, a "1. ...\n2. ..." numbered block (see
 * text.ts). Dropping that whole block into one fixed-height text box used
 * to overflow past the box's declared height (pptxgenjs does not clip or
 * shrink text to fit a box on its own) and print over the audience line
 * positioned below it. Showing only the first decision plus a "+N more"
 * count keeps the cover a cover, the same summarizing trick already used
 * for the project list's preview line.
 */
export function addTitleSlide(
  pptx: PptxGenJS,
  {
    title,
    decisionStatement,
    showDecisionLine,
    audience,
  }: {
    title: string;
    decisionStatement: string | null;
    showDecisionLine: boolean;
    audience: string | null;
  },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.ink };

  addDotCluster(slide, { x: 8.55, y: -0.3, rows: 9, cols: 4, spacing: 0.27 });

  slide.addShape("rect", {
    x: 0,
    y: 0.95,
    w: 10,
    h: 0.02,
    fill: { color: COLORS.accent },
    line: { type: "none" },
  });

  slide.addText("INSIGHTS REPORT", {
    x: 0.6,
    y: 1.3,
    w: 7.5,
    h: 0.35,
    fontSize: 12,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accentOnDark,
    charSpacing: 3,
  });

  const fittedTitle = fitParagraph(humanizeTitle(title), {
    fontSize: 34,
    widthIn: 7.6,
    heightIn: 1.6,
    minFontScale: 0.65,
  });
  slide.addText(fittedTitle.text, {
    x: 0.6,
    y: 1.75,
    w: 7.6,
    h: 1.6,
    fontSize: fittedTitle.fontSize,
    bold: true,
    fontFace: FONT.display,
    color: "FFFFFF",
    valign: "top",
  });

  if (showDecisionLine) {
    const decisionItems = parseNumberedItems(decisionStatement);
    if (decisionItems.length > 0) {
      const summary =
        decisionItems.length === 1
          ? decisionItems[0]
          : `${decisionItems[0]} (+${decisionItems.length - 1} more decision${decisionItems.length > 2 ? "s" : ""})`;
      slide.addText(summary, {
        x: 0.6,
        y: 3.3,
        w: 7.4,
        h: 1.1,
        fontSize: 15,
        fontFace: FONT.body,
        italic: true,
        color: COLORS.mutedOnDark,
        valign: "top",
        autoFit: true,
      });
    }
  }

  slide.addShape("rect", {
    x: 0,
    y: 4.75,
    w: 10,
    h: 0.01,
    fill: { color: COLORS.ruleOnDark },
    line: { type: "none" },
  });

  if (audience) {
    slide.addText(`PREPARED FOR: ${audience.toUpperCase()}`, {
      x: 0.6,
      y: 4.95,
      w: 7.5,
      h: 0.4,
      fontSize: 10.5,
      fontFace: FONT.body,
      bold: true,
      color: COLORS.mutedOnDark,
      charSpacing: 1,
    });
  }

  return slide;
}

/**
 * A full-bleed, dark section-divider slide: the narrative equivalent of a
 * chapter page, used to mark a real turn in the argument (moving from the
 * build-up into the governing thought, or from evidence into recommended
 * action) rather than just another bullet slide. Distinct from
 * addBigStatementSlide, which delivers one specific assertion; this one
 * announces where the reader now is in the story.
 */
export function addSectionDivider(
  pptx: PptxGenJS,
  {
    eyebrow,
    title,
    subtitle,
  }: { eyebrow: string; title: string; subtitle?: string | null },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.ink };
  addDotCluster(slide, { x: -0.35, y: 3.2, rows: 6, cols: 3, spacing: 0.24 });

  slide.addText(eyebrow.toUpperCase(), {
    x: 0.7,
    y: 1.9,
    w: 8.6,
    h: 0.4,
    fontSize: 13,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accentOnDark,
    charSpacing: 3,
  });
  const fittedDividerTitle = fitParagraph(title, {
    fontSize: 30,
    widthIn: 8.6,
    heightIn: 1.4,
    minFontScale: 0.6,
  });
  slide.addText(fittedDividerTitle.text, {
    x: 0.7,
    y: 2.35,
    w: 8.6,
    h: 1.4,
    fontSize: fittedDividerTitle.fontSize,
    bold: true,
    fontFace: FONT.display,
    color: "FFFFFF",
    valign: "top",
  });
  if (subtitle) {
    const fittedDividerSubtitle = fitParagraph(subtitle, {
      fontSize: 14,
      widthIn: 8.2,
      heightIn: 0.8,
      minFontScale: 0.65,
    });
    slide.addText(fittedDividerSubtitle.text, {
      x: 0.7,
      y: 3.55,
      w: 8.2,
      h: 0.8,
      fontSize: fittedDividerSubtitle.fontSize,
      italic: true,
      fontFace: FONT.body,
      color: COLORS.mutedOnDark,
      valign: "top",
    });
  }
  return slide;
}

/** Small page footer used on every content slide across the deck exports. */
export function addFooter(
  slide: PptxGenJS.PresSlide,
  deckTitle: string,
  pageLabel: string,
) {
  slide.addShape("rect", {
    x: 0.5,
    y: 5.22,
    w: 9,
    h: 0.008,
    fill: { color: COLORS.rule },
    line: { type: "none" },
  });
  slide.addText(humanizeTitle(deckTitle).toUpperCase(), {
    x: 0.5,
    y: 5.3,
    w: 6,
    h: 0.25,
    fontSize: 8.5,
    fontFace: FONT.body,
    color: COLORS.muted,
    charSpacing: 0.5,
  });
  slide.addText(pageLabel, {
    x: 7,
    y: 5.3,
    w: 2.5,
    h: 0.25,
    fontSize: 8.5,
    fontFace: FONT.body,
    color: COLORS.muted,
    align: "right",
  });
}

// A full 3-row grid at the old CARD_H/GAP_Y/GRID_Y ran past the footer
// rule on a 5.625in LAYOUT_16x9 slide (third row bottom landed at ~5.40in
// against a 5.22in rule) -- these values keep three rows inside that
// bound with a little margin to spare.
export const CARD_LAYOUT = {
  CARDS_PER_ROW: 2,
  CARDS_PER_COL: 3,
  CARD_W: 4.4,
  CARD_H: 1.28,
  CARD_GAP_X: 0.2,
  CARD_GAP_Y: 0.12,
  GRID_X: 0.5,
  GRID_Y: 0.95,
} as const;

export function safeFileStem(name: string, fallback: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || fallback
  );
}

/**
 * A run's project_name is an internal identifier researchers type in while
 * setting a project up (often a single unspaced slug like "ValidateExisting"),
 * never meant to be read by a client. Rather than print it verbatim on a
 * client-facing cover slide, this inserts spaces at the obvious word
 * boundaries (camelCase, hyphens, underscores) and title-cases the result,
 * so "ValidateExisting" reads as "Validate Existing" instead of a raw slug.
 * A name that already has spaces in it was presumably typed as a real
 * title, so it's left untouched.
 */
export function humanizeTitle(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes(" ")) return trimmed;
  const spaced = trimmed
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((word) =>
      word === word.toUpperCase() && word.length <= 4
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

/** Title-cases a short audience label for display, instead of forcing it to all caps, which makes a short single word ("fintech") read like an unfilled placeholder rather than a real audience name. */
export function titleCaseAudience(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word === word.toUpperCase() && word.length <= 4
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

// ---------------------------------------------------------------------------
// Real text fitting.
//
// pptxgenjs's own `autoFit` option does not reliably shrink text to its box
// for real-world content: confirmed directly against a real generated deck,
// where long narrative paragraphs and evidence-card text ran past their
// slide and card boundaries even with autoFit set. pptxgenjs also doesn't
// expose true text measurement, so the functions below use a conservative
// character-width heuristic (good enough to catch real overflow, not
// pixel-perfect) to shrink font size in steps and, if it still won't fit at
// the smallest allowed size, truncate the text rather than let it spill
// past its box.
// ---------------------------------------------------------------------------

function estimateCharsPerLine(widthIn: number, fontSizePt: number): number {
  // Calibri's average character width runs roughly half its point size;
  // bold/display text is a little wider, but staying on the generous side
  // here just means we shrink/truncate a bit more eagerly, never less.
  const avgCharWidthIn = (fontSizePt * 0.52) / 72;
  return Math.max(4, Math.floor(widthIn / avgCharWidthIn));
}

function estimateLineCount(
  text: string,
  widthIn: number,
  fontSizePt: number,
): number {
  const charsPerLine = estimateCharsPerLine(widthIn, fontSizePt);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  let lines = 1;
  let current = 0;
  for (const word of words) {
    const wordLen = word.length + 1;
    if (current > 0 && current + wordLen > charsPerLine) {
      lines++;
      current = wordLen;
    } else {
      current += wordLen;
    }
  }
  return lines;
}

function truncateToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, Math.max(1, maxChars));
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Fits a single paragraph into a fixed-size box: shrinks font size in steps
 * down to minFontScale, then truncates with an ellipsis if it still doesn't
 * fit. Used for the one-paragraph text blocks (executive summary, SCQA
 * build-up slides, the governing-thought pull-quote) that were overflowing
 * their boxes on real narrative-length content.
 */
export function fitParagraph(
  text: string,
  {
    fontSize,
    widthIn,
    heightIn,
    minFontScale = 0.6,
  }: {
    fontSize: number;
    widthIn: number;
    heightIn: number;
    minFontScale?: number;
  },
): { text: string; fontSize: number } {
  const lineHeightFactor = 1.22;
  const fits = (t: string, fs: number) =>
    (estimateLineCount(t, widthIn, fs) * fs * lineHeightFactor) / 72 <=
    heightIn;

  let scale = 1;
  let size = fontSize;
  while (!fits(text, size) && scale > minFontScale) {
    scale = Math.max(minFontScale, scale - 0.08);
    size = Math.round(fontSize * scale * 10) / 10;
  }

  let working = text;
  let guard = 0;
  while (!fits(working, size) && guard < 25) {
    working = truncateToChars(
      working,
      Math.max(40, Math.floor(working.length * 0.9)),
    );
    guard++;
  }

  return { text: working, fontSize: size };
}

/**
 * Same idea as fitParagraph but for a stack of differently-sized lines in
 * one box (an evidence card's headline + body + implication) -- shrinks all
 * of them together proportionally, then truncates whichever line is longest
 * if that still isn't enough.
 */
function fitLinesToBox<T extends { text: string; fontSize: number }>(
  lines: T[],
  boxWidthIn: number,
  boxHeightIn: number,
  minFontScale = 0.72,
): T[] {
  const lineHeightFactor = 1.22;
  const estimateHeight = (candidate: T[]) =>
    candidate.reduce((sum, line) => {
      if (!line.text) return sum;
      const count = estimateLineCount(line.text, boxWidthIn, line.fontSize);
      return sum + (count * line.fontSize * lineHeightFactor) / 72;
    }, 0);

  let scale = 1;
  let working = lines.map((line) => ({ ...line }));
  for (
    let step = 0;
    step < 4 && estimateHeight(working) > boxHeightIn;
    step++
  ) {
    scale = Math.max(minFontScale, scale - 0.08);
    working = lines.map((line) => ({
      ...line,
      fontSize: Math.round(line.fontSize * scale * 10) / 10,
    }));
  }

  let guard = 0;
  while (estimateHeight(working) > boxHeightIn && guard < 20) {
    const longest = working.reduce((a, b) =>
      b.text.length > a.text.length ? b : a,
    );
    longest.text = truncateToChars(
      longest.text,
      Math.max(20, Math.floor(longest.text.length * 0.85)),
    );
    guard++;
  }

  return working;
}

/**
 * Fits a bulleted list of short lines (the caveats slide) into a fixed box:
 * shrinks the shared font size in steps, then truncates individual bullets
 * that are still too long once the font can't shrink any further. Each
 * caveat is already word-capped at generation time, so this is mostly a
 * safety net for several caveats together running longer than the box, not
 * a replacement for that cap -- the autoFit option this replaced didn't
 * reliably shrink real content and was letting caveats get cut off
 * mid-sentence by PowerPoint's own silent text clipping instead.
 */
export function fitBulletList(
  items: string[],
  {
    fontSize,
    widthIn,
    heightIn,
    minFontScale = 0.65,
  }: {
    fontSize: number;
    widthIn: number;
    heightIn: number;
    minFontScale?: number;
  },
): { items: string[]; fontSize: number } {
  const lineHeightFactor = 1.3; // a little extra for inter-bullet spacing
  const estimateHeight = (candidateItems: string[], fs: number) =>
    candidateItems.reduce(
      (sum, item) =>
        sum +
        (estimateLineCount(item, widthIn, fs) * fs * lineHeightFactor) / 72,
      0,
    );

  let scale = 1;
  let size = fontSize;
  while (estimateHeight(items, size) > heightIn && scale > minFontScale) {
    scale = Math.max(minFontScale, scale - 0.08);
    size = Math.round(fontSize * scale * 10) / 10;
  }

  let working = [...items];
  let guard = 0;
  while (estimateHeight(working, size) > heightIn && guard < 30) {
    const longestIndex = working.reduce(
      (bestIdx, item, idx) =>
        item.length > working[bestIdx].length ? idx : bestIdx,
      0,
    );
    working[longestIndex] = truncateToChars(
      working[longestIndex],
      Math.max(20, Math.floor(working[longestIndex].length * 0.85)),
    );
    guard++;
  }

  return { items: working, fontSize: size };
}

/**
 * A single build-up slide for the narrative-driven Insights Report deck: a
 * small all-caps label (SITUATION, COMPLICATION, ...) sitting over a
 * paragraph of body text. A short run of these in sequence builds the SCQA
 * argument before addBigStatementSlide delivers the governing thought as
 * the deck's answer. Alternates a warm paper background against the dark
 * divider/apex slides around it, so the SCQA build-up has visual rhythm
 * rather than reading as one more plain white slide after another.
 */
export function addLabeledTextSlide(
  pptx: PptxGenJS,
  {
    label,
    body,
    labelColor = COLORS.accent,
  }: { label: string; body: string; labelColor?: string },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };
  addDotCluster(slide, {
    x: 9.0,
    y: 3.7,
    rows: 5,
    cols: 3,
    spacing: 0.2,
    colors: [COLORS.accent, COLORS.teal],
  });

  slide.addText(label.toUpperCase(), {
    x: 0.7,
    y: 0.7,
    w: 8.3,
    h: 0.4,
    fontSize: 13,
    bold: true,
    fontFace: FONT.body,
    color: labelColor,
    charSpacing: 3,
  });
  slide.addShape("rect", {
    x: 0.7,
    y: 1.12,
    w: 0.6,
    h: 0.03,
    fill: { color: labelColor },
    line: { type: "none" },
  });
  const fittedBody = fitParagraph(body, {
    fontSize: 20,
    widthIn: 8.0,
    heightIn: 3.4,
    minFontScale: 0.55,
  });
  slide.addText(fittedBody.text, {
    x: 0.7,
    y: 1.5,
    w: 8.0,
    h: 3.4,
    fontSize: fittedBody.fontSize,
    fontFace: FONT.body,
    color: COLORS.ink,
    valign: "top",
  });
  return slide;
}

// A restrained cycle through the deck's own accent palette, not an
// off-brand rainbow -- enough distinct, legible colors to tell neighboring
// chevrons apart without introducing a hue that doesn't appear anywhere
// else in the deck.
const ARGUMENT_FLOW_COLORS = [
  COLORS.accent,
  COLORS.teal,
  COLORS.gold,
  COLORS.accentDeep,
  COLORS.strong,
  COLORS.high,
];
const ROADMAP_COLORS = [
  COLORS.ink,
  COLORS.teal,
  COLORS.gold,
  COLORS.accentDeep,
  COLORS.strong,
  COLORS.accent,
];

/**
 * The deck's own table of contents: a chevron-ribbon roadmap of its actual
 * top-level sections (not the pillars -- see addArgumentMapSlide for that,
 * one level deeper), shown right after the title slide so a reader sees
 * the whole shape of the report before the first section starts. The
 * objectives/decisions segment only appears when that section will
 * actually render (a project with no recorded objective or decision skips
 * straight from the argument to recommendations), so the roadmap never
 * promises a section the deck doesn't have.
 */
export function addDeckRoadmapSlide(
  pptx: PptxGenJS,
  { hasObjectives }: { hasObjectives: boolean },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };

  slide.addText("HOW THIS REPORT IS BUILT", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.35,
    fontSize: 12,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accent,
    charSpacing: 2.5,
  });
  slide.addText("A roadmap before the detail.", {
    x: 0.5,
    y: 0.72,
    w: 9,
    h: 0.45,
    fontSize: 20,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.ink,
  });

  const segments = [
    {
      label: "EXECUTIVE SUMMARY",
      snippet: "The headline answer, before the build-up that justifies it.",
    },
    {
      label: "THE CASE",
      snippet: "What's true, what it collides with, and what to do next.",
    },
    ...(hasObjectives
      ? [
          {
            label: "OBJECTIVES & DECISIONS",
            snippet: "Checked against what this project set out to answer.",
          },
        ]
      : []),
    {
      label: "THE ARGUMENT",
      snippet: "The evidence, pillar by pillar, that proves the answer.",
    },
    {
      label: "RECOMMENDED ACTIONS",
      snippet: "What to do next, and who owns it.",
    },
    {
      label: "CAVEATS & SCOPE",
      snippet: "What this evidence can't yet tell you.",
    },
  ];

  const left = 0.5;
  const right = 9.5;
  const totalW = right - left;
  const overlap = 0.1;
  const n = segments.length;
  const segW = (totalW + overlap * (n - 1)) / n;
  const bannerY = 1.5;
  const bannerH = 0.75;
  const contentY = bannerY + bannerH + 0.16;
  const contentH = 5.05 - contentY;

  segments.forEach((segment, index) => {
    const color = ROADMAP_COLORS[index % ROADMAP_COLORS.length];
    const x = left + index * (segW - overlap);
    // Chevron segments (index > 0) have a concave notch cut into their left
    // edge -- label text anchored flush to that edge sits over the cut-away
    // area and reads as clipped (white text with nothing behind it), so the
    // text box is pushed in past the notch instead of starting at x.
    const notchPad = index === 0 ? 0.08 : 0.3;
    slide.addShape(index === 0 ? "rect" : "chevron", {
      x,
      y: bannerY,
      w: segW,
      h: bannerH,
      fill: { color },
      line: { type: "none" },
    });
    slide.addText(segment.label, {
      x: x + notchPad,
      y: bannerY,
      w: segW - notchPad - (index === n - 1 ? 0.2 : 0.3),
      h: bannerH,
      fontSize: 9,
      bold: true,
      fontFace: FONT.body,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      charSpacing: 0.3,
    });

    const colX =
      left + index * (segW - overlap) + (index === 0 ? 0 : overlap * 0.4);
    const colW = segW - (index === 0 ? overlap * 0.6 : overlap * 0.8);
    const fittedSnippet = fitParagraph(segment.snippet, {
      fontSize: 9.5,
      widthIn: colW - 0.14,
      heightIn: contentH - 0.1,
      minFontScale: 0.75,
    });
    slide.addText(fittedSnippet.text, {
      x: colX + 0.07,
      y: contentY,
      w: colW - 0.14,
      h: contentH,
      fontSize: fittedSnippet.fontSize,
      fontFace: FONT.body,
      color: COLORS.body,
      valign: "top",
    });
    slide.addShape("rect", {
      x: colX,
      y: contentY - 0.06,
      w: colW,
      h: 0.02,
      fill: { color },
      line: { type: "none" },
    });
  });

  return slide;
}

/**
 * A visual SCQA (Situation-Complication-Question-Answer / Pyramid
 * Principle) overview: four cards building to the governing thought in the
 * final "answer" card, so a reader sees the shape of this argument at a
 * glance before the deck spends a full slide each on situation,
 * complication, and governing thought. Plays the same "roadmap before the
 * detail" role for the SCQA build-up that addDeckRoadmapSlide plays for
 * the whole deck, one level up.
 */
export function addVisualSCQASlide(
  pptx: PptxGenJS,
  {
    situation,
    complication,
    question,
    answer,
  }: {
    situation: string;
    complication: string;
    question: string;
    answer: string;
  },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };

  slide.addText("HOW THIS REPORT BUILDS ITS CASE", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.35,
    fontSize: 12,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accent,
    charSpacing: 2.5,
  });
  slide.addText("Situation, complication, question, answer.", {
    x: 0.5,
    y: 0.72,
    w: 9,
    h: 0.45,
    fontSize: 20,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.ink,
  });

  const steps = [
    { tag: "S", label: "SITUATION", text: situation, color: COLORS.ink },
    { tag: "C", label: "COMPLICATION", text: complication, color: COLORS.ink },
    { tag: "Q", label: "QUESTION", text: question, color: COLORS.ink },
    { tag: "A", label: "ANSWER", text: answer, color: COLORS.accent },
  ];

  const top = 1.5;
  const cardW = 2.18;
  const gap = 0.14;
  const startX = 0.5;
  const cardH = 3.3;
  steps.forEach((step, i) => {
    const x = startX + i * (cardW + gap);
    slide.addShape("rect", {
      x,
      y: top,
      w: cardW,
      h: cardH,
      fill: { color: step.color },
      line: { type: "none" },
    });
    slide.addText(step.tag, {
      x: x + 0.15,
      y: top + 0.12,
      w: cardW - 0.3,
      h: 0.6,
      fontSize: 30,
      bold: true,
      fontFace: FONT.display,
      color: "FFFFFF",
    });
    slide.addText(step.label, {
      x: x + 0.15,
      y: top + 0.78,
      w: cardW - 0.3,
      h: 0.3,
      fontSize: 10.5,
      bold: true,
      fontFace: FONT.body,
      color: "FFFFFF",
      charSpacing: 1,
    });
    const fittedText = fitParagraph(step.text, {
      fontSize: 11,
      widthIn: cardW - 0.3,
      heightIn: cardH - 1.3,
      minFontScale: 0.65,
    });
    slide.addText(fittedText.text, {
      x: x + 0.15,
      y: top + 1.14,
      w: cardW - 0.3,
      h: cardH - 1.3,
      fontSize: fittedText.fontSize,
      italic: true,
      fontFace: FONT.body,
      color: "FFFFFF",
      valign: "top",
    });
    if (i < steps.length - 1) {
      slide.addText("→", {
        x: x + cardW,
        y: top + cardH / 2 - 0.25,
        w: gap,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: COLORS.muted,
        align: "center",
        valign: "middle",
      });
    }
  });

  return slide;
}

/**
 * A visual map of the argument's shape: the governing thought and the
 * pillars that support it, laid out as a single connected ribbon of
 * chevron banners (one segment per stage) with a short content column
 * underneath each -- the same "roadmap" visual consulting decks use to
 * preview a multi-stage argument before drilling into any one stage.
 *
 * Deliberately a map, not a preview: each column gets only a short,
 * truncated snippet (governing thought for the first segment, headline
 * only for each pillar), never the full evidence. Exists because
 * "PILLAR 1 OF N" was otherwise the reader's first signal that pillars
 * existed at all, with no sense of how many there were or how each one
 * related to the governing thought just stated.
 */
export function addArgumentMapSlide(
  pptx: PptxGenJS,
  {
    governingThought,
    pillars,
  }: { governingThought: string; pillars: { headline: string }[] },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };

  slide.addText("THE SHAPE OF THIS ARGUMENT", {
    x: 0.5,
    y: 0.4,
    w: 9,
    h: 0.35,
    fontSize: 12,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accent,
    charSpacing: 2.5,
  });
  slide.addText("How the evidence breaks down.", {
    x: 0.5,
    y: 0.72,
    w: 9,
    h: 0.45,
    fontSize: 20,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.ink,
  });

  // segments[0] is the governing thought; segments[1..] are the pillars.
  const segments = [
    { label: "THE ANSWER", snippet: governingThought, color: COLORS.ink },
    ...pillars.map((pillar, index) => ({
      label: `PILLAR ${index + 1}`,
      snippet: pillar.headline,
      color: ARGUMENT_FLOW_COLORS[index % ARGUMENT_FLOW_COLORS.length],
    })),
  ];

  const left = 0.5;
  const right = 9.5;
  const totalW = right - left;
  const overlap = 0.14; // how far each chevron's notch tucks under the previous one
  const n = segments.length;
  const segW = (totalW + overlap * (n - 1)) / n;

  const bannerY = 1.45;
  const bannerH = 0.85;
  const contentY = bannerY + bannerH + 0.18;
  const contentH = 5.05 - contentY;

  segments.forEach((segment, index) => {
    const x = left + index * (segW - overlap);
    // The lead segment has a flat left edge (plain rect); every segment
    // after it has a matching notch cut into its left edge (chevron) so it
    // reads as one continuous arrow rather than a row of separate shapes.
    slide.addShape(index === 0 ? "rect" : "chevron", {
      x,
      y: bannerY,
      w: segW,
      h: bannerH,
      fill: { color: segment.color },
      line: { type: "none" },
    });
    slide.addText(segment.label, {
      x: x + 0.1,
      y: bannerY,
      w: segW - (index === n - 1 ? 0.3 : 0.45),
      h: bannerH,
      fontSize: 11,
      bold: true,
      fontFace: FONT.body,
      color: "FFFFFF",
      align: "center",
      valign: "middle",
      charSpacing: 0.5,
    });

    const colX =
      left + index * (segW - overlap) + (index === 0 ? 0 : overlap * 0.4);
    const colW = segW - (index === 0 ? overlap * 0.6 : overlap * 0.8);
    const fittedSnippet = fitParagraph(segment.snippet, {
      fontSize: 10.5,
      widthIn: colW - 0.2,
      heightIn: contentH - 0.1,
      minFontScale: 0.7,
    });
    slide.addText(fittedSnippet.text, {
      x: colX + 0.1,
      y: contentY,
      w: colW - 0.2,
      h: contentH,
      fontSize: fittedSnippet.fontSize,
      fontFace: FONT.body,
      color: COLORS.body,
      valign: "top",
    });
    slide.addShape("rect", {
      x: colX,
      y: contentY - 0.06,
      w: colW,
      h: 0.025,
      fill: { color: segment.color },
      line: { type: "none" },
    });
  });

  return slide;
}

/**
 * The "apex" slide of the SCQA deck: the governing thought, stated as the
 * one assertive answer the pillar slides that follow exist to support.
 * Styled as a pull-quote (large serif text, an opening quotation mark)
 * against a full-bleed dark background, so it reads as the deck's center
 * of gravity rather than another bullet slide.
 */
export function addBigStatementSlide(
  pptx: PptxGenJS,
  {
    eyebrow,
    statement,
    subtext,
  }: { eyebrow: string; statement: string; subtext?: string | null },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.ink };
  addDotCluster(slide, { x: -0.3, y: -0.3, rows: 5, cols: 3, spacing: 0.24 });

  slide.addText(eyebrow.toUpperCase(), {
    x: 0.7,
    y: 1.05,
    w: 8.4,
    h: 0.4,
    fontSize: 13,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accentOnDark,
    charSpacing: 3,
  });

  // A large serif quotation mark sitting just above the statement, giving
  // the governing thought the same "someone said this" weight a pull-quote
  // carries in the reference deck, without needing a photograph behind it.
  slide.addText("“", {
    x: 0.55,
    y: 1.35,
    w: 1.2,
    h: 1.1,
    fontSize: 70,
    fontFace: FONT.display,
    bold: true,
    color: COLORS.accentDeep,
  });

  const fittedStatement = fitParagraph(statement, {
    fontSize: 27,
    widthIn: 8.3,
    heightIn: 2.1,
    minFontScale: 0.55,
  });
  slide.addText(fittedStatement.text, {
    x: 0.75,
    y: 2.15,
    w: 8.3,
    h: 2.1,
    fontSize: fittedStatement.fontSize,
    bold: true,
    fontFace: FONT.display,
    color: "FFFFFF",
    valign: "top",
  });

  if (subtext) {
    slide.addShape("rect", {
      x: 0.75,
      y: 4.35,
      w: 0.5,
      h: 0.025,
      fill: { color: COLORS.accentOnDark },
      line: { type: "none" },
    });
    const fittedSubtext = fitParagraph(subtext, {
      fontSize: 13,
      widthIn: 8.1,
      heightIn: 0.7,
      minFontScale: 0.7,
    });
    slide.addText(fittedSubtext.text, {
      x: 0.75,
      y: 4.5,
      w: 8.1,
      h: 0.7,
      fontSize: fittedSubtext.fontSize,
      italic: true,
      fontFace: FONT.body,
      color: COLORS.mutedOnDark,
      valign: "top",
    });
  }
  return slide;
}

/**
 * A single evidence or recommendation card: a left accent bar, an icon +
 * label badge (never color alone, per the sceptic-dashboard rule the rest
 * of this app follows), a bold headline, and up to two supporting lines.
 * Shared by the pillar-insight cards and the recommendation cards in the
 * Insights Report export so both read as one consistent system rather
 * than two slightly different card styles.
 */
export function addEvidenceCard(
  slide: PptxGenJS.PresSlide,
  {
    x,
    y,
    w,
    h,
    badge,
    lines,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    badge: { glyph: string; label: string; color: string };
    lines: Array<{
      text: string;
      fontSize: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }>;
  },
) {
  slide.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.07,
    fill: { color: COLORS.panel },
    line: { color: COLORS.rule, width: 0.75 },
  });
  slide.addShape("roundRect", {
    x,
    y,
    w: 0.08,
    h,
    rectRadius: 0.04,
    fill: { color: badge.color },
    line: { type: "none" },
  });

  // The badge sits in its own strip across the top of the card rather than
  // sharing every text line's width: reserving ~2.5in of horizontal space
  // for it on every line is harmless on a wide pillar card, but on a
  // narrower recommendation card (CARD_W 4.4in) it left barely 1.9in for
  // body text, forcing far more line-wrapping than the card's height could
  // hold and causing exactly the overflow seen in real generated decks.
  const badgeRowH = 0.26;
  slide.addText(`${badge.glyph} ${badge.label}`, {
    x: x + w - 2.1,
    y: y + 0.1,
    w: 1.9,
    h: badgeRowH,
    fontSize: 8.5,
    bold: true,
    fontFace: FONT.body,
    color: badge.color,
    align: "right",
    charSpacing: 0.5,
  });

  const textX = x + 0.22;
  const textY = y + badgeRowH + 0.14;
  const textW = w - 0.44;
  const textH = h - (badgeRowH + 0.14) - 0.12;
  const fittedLines = fitLinesToBox(lines, textW, textH);

  slide.addText(
    fittedLines.map((line) => ({
      text: line.text,
      options: {
        fontSize: line.fontSize,
        bold: line.bold ?? false,
        italic: line.italic ?? false,
        color: line.color ?? COLORS.ink,
        fontFace: FONT.body,
        breakLine: true,
      },
    })),
    {
      x: textX,
      y: textY,
      w: textW,
      h: textH,
      valign: "top",
    },
  );
}

// One slide per chart-eligible theme in the "Evidence charts" section the
// deck export route adds between the objectives/decisions pages and the
// pillar slides -- the same server-rendered PNG (renderChartImage.ts) the
// docx report's Findings section embeds, so the deck and the Word report
// never show two different pictures of the same theme's evidence.
export function addChartSlide(
  pptx: PptxGenJS,
  {
    eyebrow,
    title,
    image,
    caption,
  }: {
    eyebrow: string;
    title: string;
    image: { png: Buffer; width: number; height: number };
    caption: string;
  },
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };

  slide.addText(eyebrow.toUpperCase(), {
    x: 0.6,
    y: 0.4,
    w: 8.8,
    h: 0.3,
    fontSize: 11,
    bold: true,
    fontFace: FONT.body,
    color: COLORS.accent,
    charSpacing: 1.5,
  });

  const fittedTitle = fitParagraph(title, {
    fontSize: 18,
    widthIn: 8.8,
    heightIn: 0.5,
    minFontScale: 0.7,
  });
  slide.addText(fittedTitle.text, {
    x: 0.6,
    y: 0.68,
    w: 8.8,
    h: 0.5,
    fontSize: fittedTitle.fontSize,
    bold: true,
    fontFace: FONT.display,
    color: COLORS.ink,
  });

  // Fit the image into a box below the title and above the caption,
  // preserving its aspect ratio rather than stretching it.
  const maxW = 8.6;
  const maxH = 3.5;
  const aspect = image.width / image.height;
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  const x = 0.6 + (maxW - w) / 2;
  const y = 1.3;

  slide.addImage({
    data: `image/png;base64,${image.png.toString("base64")}`,
    x,
    y,
    w,
    h,
  });

  const fittedCaption = fitParagraph(caption, {
    fontSize: 11,
    widthIn: 8.8,
    heightIn: 0.5,
    minFontScale: 0.75,
  });
  slide.addText(fittedCaption.text, {
    x: 0.6,
    y: y + h + 0.12,
    w: 8.8,
    h: 0.5,
    fontSize: fittedCaption.fontSize,
    italic: true,
    fontFace: FONT.body,
    color: COLORS.muted,
    valign: "top",
  });

  return slide;
}
