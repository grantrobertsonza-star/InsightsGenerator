import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { addTitleSlide, addFooter, CARD_LAYOUT, safeFileStem, fitBulletList } from "@/lib/deckSlides";
import { loadInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { summariseSupport, type SupportStatus } from "@/lib/supportStatusShared";
import { loadSynthesizedInsightSources, sourceLine } from "@/lib/sourceAttribution";
import { figureCheckLoadErrorNote, loadRunFigureChecksForExport } from "@/lib/figureChecks";
import { figureCheckNote } from "@/lib/numberTrace";
import { routeRequestContext } from "@/lib/requestContext";

type ExportInsight = {
  id: string;
  confidence_tier: "strong" | "moderate" | "exploratory" | null;
  headline: string;
  implication: string;
  quality_score: number | null;
  review_status: "accepted" | "rejected";
};

const NO_CONFIDENCE_LABEL = "Not yet triangulated";

const tierColor: Record<string, string> = {
  strong: "16A34A",
  moderate: "D97706",
  exploratory: "64748B",
};

const tierLabel: Record<string, string> = {
  strong: "Strong",
  moderate: "Moderate",
  exploratory: "Exploratory",
};

/**
 * Builds a client-presentable slide deck from a run's synthesized
 * insights, in the same card-grid style as the findings/insights/
 * recommendations deck exports. Grouped by confidence tier rather than
 * theme -- a synthesized insight is built by clustering across pre-insights
 * (and often across themes, see source_theme_count), so it doesn't carry a
 * single theme the way a pre-insight does; triangulation strength is the
 * grouping that actually matters for a reader deciding how much weight to
 * put on each one. Defaults to accepted-only, same reasoning as the
 * recommendations deck export, with ?scope=all to include rejected ones
 * too.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") === "all" ? "all" : "accepted";

  const [run, allInsights, sourcesByInsight] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>("select project_name, decision_statement, audience from runs where id = $1", [runId]);

    const insightsResult = await client.query<ExportInsight>(
      `select id, confidence_tier, headline, implication, quality_score, review_status
       from synthesized_insights
       where run_id = $1${scope === "accepted" ? " and review_status = 'accepted'" : ""}
       order by quality_score desc nulls last, created_at`,
      [runId]
    );
    return [runResult.rows[0], insightsResult.rows, await loadSynthesizedInsightSources(client, insightsResult.rows.map((i) => i.id))] as const;
  });

  // FND-001: same support rule as the story deck. In the default (accepted, client-facing) scope
  // an insight whose support is no longer valid is left out and listed on a closing slide; changed
  // or uncheckable support stays, tagged in words. scope=all is the audit view: everything stays,
  // tagged. Read-only.
  const support = await loadInsightSupportOrUnchecked(TENANT_ID, runId, allInsights.map((i) => i.id));
  // Numerical traceability (0101): a card whose figures need review says so under its sources.
  const figures = await loadRunFigureChecksForExport((fn) => withTenant(TENANT_ID, fn), runId);
  const supportTag: Record<SupportStatus, string> = {
    current: "",
    stale: " · SUPPORT CHANGED",
    unknown: " · SUPPORT NOT CHECKED",
    invalid: " · SUPPORT NO LONGER VALID",
  };
  const excludedLines = scope === "accepted"
    ? allInsights
        .filter((i) => support.statusOf(i.id).status === "invalid")
        .map((i) => `${i.headline}. ${summariseSupport(support.statusOf(i.id))}`)
    : [];
  const insights = scope === "accepted"
    ? allInsights.filter((i) => support.statusOf(i.id).status !== "invalid")
    : allInsights;

  if (!run) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const deckTitle = run.project_name ?? run.decision_statement ?? "Insights Elevator";

  addTitleSlide(pptx, {
    title: deckTitle,
    decisionStatement: run.decision_statement,
    showDecisionLine: Boolean(run.project_name && run.decision_statement),
    audience: run.audience,
  });

  if (insights.length === 0) {
    const emptySlide = pptx.addSlide();
    emptySlide.addText(
      scope === "accepted"
        ? "No synthesized insights have been accepted yet. Review and accept insights in the app, then export again."
        : "No synthesized insights have been generated for this project yet.",
      { x: 0.6, y: 2.3, w: 8.8, h: 1, fontSize: 16, color: "374151" }
    );
  }

  const grouped = new Map<string, ExportInsight[]>();
  for (const insight of insights) {
    const key = insight.confidence_tier ?? NO_CONFIDENCE_LABEL;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(insight);
  }

  const { CARDS_PER_ROW, CARD_W, CARD_H, CARD_GAP_X, CARD_GAP_Y, GRID_X, GRID_Y } = CARD_LAYOUT;
  const CARDS_PER_SLIDE = CARD_LAYOUT.CARDS_PER_ROW * CARD_LAYOUT.CARDS_PER_COL;

  for (const [tier, tierInsights] of grouped) {
    const sectionLabel = tierLabel[tier] ?? tier;
    const pageCount = Math.max(1, Math.ceil(tierInsights.length / CARDS_PER_SLIDE));

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      const pageInsights = tierInsights.slice(page * CARDS_PER_SLIDE, (page + 1) * CARDS_PER_SLIDE);

      slide.addText(pageCount > 1 ? `${sectionLabel} (${page + 1}/${pageCount})` : sectionLabel, {
        x: 0.5,
        y: 0.35,
        w: 9,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: "1D4ED8",
      });

      pageInsights.forEach((insight, index) => {
        const col = index % CARDS_PER_ROW;
        const row = Math.floor(index / CARDS_PER_ROW);
        const x = GRID_X + col * (CARD_W + CARD_GAP_X);
        const y = GRID_Y + row * (CARD_H + CARD_GAP_Y);
        const accent = tierColor[tier] ?? "64748B";

        slide.addShape("roundRect", {
          x,
          y,
          w: CARD_W,
          h: CARD_H,
          rectRadius: 0.06,
          fill: { color: "F8FAFC" },
          line: { color: "E2E8F0", width: 0.75 },
        });
        slide.addShape("rect", { x, y, w: 0.06, h: CARD_H, fill: { color: accent }, line: { type: "none" } });

        const statusTag =
          (scope === "all" && insight.review_status === "rejected" ? " · Rejected" : "") +
          supportTag[support.statusOf(insight.id).status];

        slide.addText(`${sectionLabel.toUpperCase()}${statusTag}`, {
          x: x + 0.15,
          y: y + 0.08,
          w: CARD_W - 0.3,
          h: 0.2,
          fontSize: 9,
          bold: true,
          color: accent,
          charSpacing: 1,
        });

        slide.addText(
          [
            { text: insight.headline, options: { fontSize: 12, bold: true, color: "111827", breakLine: true } },
            { text: insight.implication, options: { fontSize: 10, color: "374151", breakLine: true } },
            // Golden-thread repair: the evidence's sources, as in the app.
            { text: sourceLine(sourcesByInsight.get(insight.id) ?? []), options: { fontSize: 8, color: "6B7280", breakLine: true } },
            ...(() => {
              const note = figureCheckLoadErrorNote(figures) ?? figureCheckNote(figures.synthesizedInsights[insight.id]);
              return note ? [{ text: note, options: { fontSize: 8, color: "B45309" } }] : [];
            })(),
          ],
          {
            x: x + 0.15,
            y: y + 0.3,
            w: CARD_W - 0.3,
            h: CARD_H - 0.38,
            valign: "top",
            autoFit: true,
          }
        );
      });

      addFooter(slide, deckTitle, `${sectionLabel} · ${page + 1}/${pageCount}`);
    }
  }

  if (excludedLines.length > 0) {
    const slide = pptx.addSlide();
    slide.addText("Left out: support no longer valid", {
      x: 0.5,
      y: 0.35,
      w: 9,
      h: 0.55,
      fontSize: 22,
      bold: true,
      color: "1D4ED8",
    });
    const fitted = fitBulletList(excludedLines, { fontSize: 13, widthIn: 8.6, heightIn: 3.9, minFontScale: 0.6 });
    slide.addText(
      fitted.items.map((line) => ({ text: line, options: { bullet: true, breakLine: true } })),
      { x: 0.6, y: 1.05, w: 8.6, h: 3.9, fontSize: fitted.fontSize, color: "374151", valign: "top" },
    );
    addFooter(slide, deckTitle, "Left out: needs review");
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeName = safeFileStem(run.project_name ?? run.decision_statement ?? "synthesized-insights", "synthesized-insights");
  const suffix = scope === "accepted" ? "accepted-synthesized-insights-deck" : "synthesized-insights-deck";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.pptx"`,
    },
  });
}
