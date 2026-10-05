import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { addTitleSlide, addFooter, CARD_LAYOUT, safeFileStem } from "@/lib/deckSlides";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportInsight = {
  theme: string | null;
  verdict_tier: "robust" | "use_with_caution";
  headline: string;
  implication: string;
  finding_text: string;
};

const NO_THEME_LABEL = "No theme";

const tierColor: Record<ExportInsight["verdict_tier"], string> = {
  robust: "16A34A",
  use_with_caution: "D97706",
};

const tierLabel: Record<ExportInsight["verdict_tier"], string> = {
  robust: "Robust",
  use_with_caution: "Use with caution",
};

/**
 * Builds a client-presentable slide deck from a run's insights, one slide
 * per theme, in the same card-grid style as the findings deck export so the
 * two feel like one family of output rather than two different tools.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;

  const [run, insights] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>("select project_name, decision_statement, audience from runs where id = $1", [runId]);

    const insightsResult = await client.query<ExportInsight>(
      `select f.theme, v.verdict_tier, i.headline, i.implication, f.finding_text
       from insights i
       join findings f on f.id = i.finding_id
       join verdicts v on v.finding_id = f.id
       where i.run_id = $1
       order by f.theme nulls last, i.created_at`,
      [runId]
    );
    return [runResult.rows[0], insightsResult.rows] as const;
  });

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
    emptySlide.addText("No insights have been generated for this project yet.", {
      x: 0.6,
      y: 2.3,
      w: 8.8,
      h: 1,
      fontSize: 16,
      color: "374151",
    });
  }

  const grouped = new Map<string, ExportInsight[]>();
  for (const insight of insights) {
    const key = insight.theme ?? NO_THEME_LABEL;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(insight);
  }

  const { CARDS_PER_ROW, CARD_W, CARD_H, CARD_GAP_X, CARD_GAP_Y, GRID_X, GRID_Y } = CARD_LAYOUT;
  const CARDS_PER_SLIDE = CARD_LAYOUT.CARDS_PER_ROW * CARD_LAYOUT.CARDS_PER_COL;

  for (const [theme, themeInsights] of grouped) {
    const pageCount = Math.max(1, Math.ceil(themeInsights.length / CARDS_PER_SLIDE));

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      const pageInsights = themeInsights.slice(page * CARDS_PER_SLIDE, (page + 1) * CARDS_PER_SLIDE);

      slide.addText(pageCount > 1 ? `${theme} (${page + 1}/${pageCount})` : theme, {
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
        const accent = tierColor[insight.verdict_tier];

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

        slide.addText(tierLabel[insight.verdict_tier].toUpperCase(), {
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
            { text: insight.implication, options: { fontSize: 10, color: "374151" } },
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

      addFooter(slide, deckTitle, `${theme} · ${page + 1}/${pageCount}`);
    }
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeName = safeFileStem(run.project_name ?? run.decision_statement ?? "insights", "insights");

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-insights-deck.pptx"`,
    },
  });
}
