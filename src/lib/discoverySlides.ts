import type PptxGenJS from "pptxgenjs";
import type { DiscoveryReportData } from "./discoveryReport";
import {
  COLORS,
  FONT,
  addEvidenceCard,
  addFooter,
  addLabeledTextSlide,
  addSectionDivider,
} from "./deckSlides";

// Same card geometry the objectives/decisions pages use (two three-line
// cards per slide at full width), so these pages read as part of one deck.
const CARD = { H: 1.5, GAP: 0.22, X: 0.5, Y: 1.0, W: 9, PER_SLIDE: 2 } as const;

const QUALITY_BADGES: Record<
  string,
  { glyph: string; label: string; color: string }
> = {
  qualified: { glyph: "●", label: "QUALIFIED INSIGHT", color: COLORS.strong },
  partial: { glyph: "▲", label: "PARTIAL INSIGHT", color: COLORS.moderate },
  finding: { glyph: "–", label: "FINDING LEVEL", color: COLORS.exploratory },
};
const NEW_BADGE = { glyph: "★", label: "NEW", color: COLORS.teal };
const CONTRADICTED_BADGE = {
  glyph: "!",
  label: "CONTRADICTED",
  color: COLORS.high,
};

function paged<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let start = 0; start < items.length; start += perPage)
    pages.push(items.slice(start, start + perPage));
  return pages;
}

function addCardPage(
  pptx: PptxGenJS,
  heading: string,
  pageIndex: number,
  pageCount: number,
  cards: Array<{
    badge: { glyph: string; label: string; color: string };
    lines: Array<{
      text: string;
      fontSize: number;
      bold?: boolean;
      italic?: boolean;
      color?: string;
    }>;
  }>,
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.paper };
  slide.addText(
    pageCount > 1 ? `${heading} · PAGE ${pageIndex + 1}/${pageCount}` : heading,
    {
      x: 0.5,
      y: 0.4,
      w: 9,
      h: 0.4,
      fontSize: 13,
      bold: true,
      fontFace: FONT.body,
      color: COLORS.accent,
      charSpacing: 2,
    },
  );
  cards.forEach((card, row) => {
    addEvidenceCard(slide, {
      x: CARD.X,
      y: CARD.Y + row * (CARD.H + CARD.GAP),
      w: CARD.W,
      h: CARD.H,
      badge: card.badge,
      lines: card.lines,
    });
  });
  return slide;
}

/**
 * The deck counterpart of docxReport.ts's "New insights beyond the report"
 * section: what this analysis added beyond what the original report said,
 * on its own pages, so a reader can tell the validated material from the
 * net-new material. Adds nothing at all when there is nothing to say, so a
 * run with no net-new content does not grow an empty divider.
 */
export function addDiscoverySlides(
  pptx: PptxGenJS,
  d: DiscoveryReportData,
  deckTitle: string,
): void {
  const hasContent =
    d.netNewInsights.length > 0 ||
    d.netNewFindings.length > 0 ||
    d.contradictions.length > 0;
  if (!hasContent && !d.verificationNote) return;

  addSectionDivider(pptx, {
    eyebrow: "New beyond the report",
    title: "What this analysis found that the original report did not say.",
  });

  if (d.verificationNote) {
    const slide = addLabeledTextSlide(pptx, {
      label: "How far this could be checked",
      body:
        `${d.verificationNote} Insight quality was still assessed, because that is a read of each claim's ` +
        "own reasoning and needs no underlying data. Treat every verdict in this report accordingly.",
      labelColor: COLORS.high,
    });
    addFooter(slide, deckTitle, "How far this could be checked");
  }

  const insightPages = paged(d.netNewInsights, CARD.PER_SLIDE);
  insightPages.forEach((page, index) => {
    const slide = addCardPage(
      pptx,
      "NEW INSIGHTS",
      index,
      insightPages.length,
      page.map((insight) => ({
        badge:
          (insight.qualityTier && QUALITY_BADGES[insight.qualityTier]) ||
          NEW_BADGE,
        lines: [
          { text: insight.headline, fontSize: 12.5, bold: true },
          {
            text: insight.provenanceCaption,
            fontSize: 10.5,
            color: COLORS.body,
          },
          {
            text: `“${insight.implication}”`,
            fontSize: 10,
            italic: true,
            color: COLORS.muted,
          },
        ],
      })),
    );
    addFooter(
      slide,
      deckTitle,
      `New insights · ${index + 1}/${insightPages.length}`,
    );
  });

  if (d.netNewFindings.length > 0) {
    const shown = d.netNewFindings.slice(0, 6);
    const more =
      d.netNewFindings.length - shown.length + d.netNewFindingsOmitted;
    const slide = addLabeledTextSlide(pptx, {
      label: "New findings from the data",
      body:
        shown
          .map((f) => `• ${f.theme ? `${f.theme}: ` : ""}${f.text}`)
          .join("\n") +
        (more > 0 ? `\n…and ${more} more, in the full report.` : ""),
      labelColor: COLORS.teal,
    });
    addFooter(slide, deckTitle, "New findings from the data");
  }

  const contradictionPages = paged(d.contradictions, CARD.PER_SLIDE);
  contradictionPages.forEach((page, index) => {
    const slide = addCardPage(
      pptx,
      "WHERE THE EVIDENCE CONTRADICTS THE REPORT",
      index,
      contradictionPages.length,
      page.map((c) => ({
        badge: CONTRADICTED_BADGE,
        lines: [
          {
            text: `The report said: “${c.originalText}”`,
            fontSize: 12,
            bold: true,
          },
          {
            text: `Contradicted by ${
              c.contradictedBy === "net_new_finding"
                ? "a new finding from the data"
                : c.contradictedBy === "net_new_insight"
                  ? "a new insight"
                  : "another claim in the same report"
            }: “${c.contradictingText}”`,
            fontSize: 10.5,
            color: COLORS.body,
          },
          {
            text: c.rationale,
            fontSize: 10,
            italic: true,
            color: COLORS.muted,
          },
        ],
      })),
    );
    addFooter(
      slide,
      deckTitle,
      `Contradictions · ${index + 1}/${contradictionPages.length}`,
    );
  });
}
