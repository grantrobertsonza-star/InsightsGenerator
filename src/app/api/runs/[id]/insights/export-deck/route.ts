import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { addTitleSlide, addFooter, CARD_LAYOUT, safeFileStem } from "@/lib/deckSlides";
import { findingSourceSql, formatFindingSource, sourceLine } from "@/lib/sourceAttribution";
import { placePreInsight, type DeckPlacement } from "@/lib/preInsightDeckEligibility";
import { figureCheckLoadErrorNote, loadRunFigureChecksForExport } from "@/lib/figureChecks";
import { figureCheckNote } from "@/lib/numberTrace";
import { loadPreInsightSupportOrUnchecked } from "@/lib/supportStatus";
import { summariseSupport, type SupportStatus } from "@/lib/supportStatusShared";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportInsight = {
  id: string;
  theme: string | null;
  verdict_tier: string | null;
  finding_status: string | null;
  headline: string;
  implication: string;
  finding_text: string;
  source_filename: string | null;
  source_page: number | null;
  source_table_label: string | null;
};

const NO_THEME_LABEL = "No theme";

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
      // The LATEST verdict per finding (one row per pre-insight; joining every verdict repeated a
      // pre-insight once per re-verification), and the finding's current status.
      `select i.id, f.theme, v.verdict_tier, f.status as finding_status, i.headline, i.implication, f.finding_text,
              ${findingSourceSql("f").columns}
       from insights i
       join findings f on f.id = i.finding_id
       left join lateral (
         select vv.verdict_tier from verdicts vv
         where vv.finding_id = f.id
         order by vv.created_at desc, vv.id desc
         limit 1
       ) v on true
       ${findingSourceSql("f").join}
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

  // GT-006 (FND-001 for pre-insights): the shared support rule beside the verdict rule. Support no
  // longer valid leaves a card out, listed with its reason on the closing slide; changed or
  // uncheckable support stays, tagged in words, as the synthesized-insights deck does.
  const support = await loadPreInsightSupportOrUnchecked(TENANT_ID, runId, insights.map((i) => i.id));
  const supportTag: Record<SupportStatus, string> = {
    current: "",
    stale: " · SUPPORT CHANGED",
    unknown: " · SUPPORT NOT CHECKED",
    invalid: " · SUPPORT NO LONGER VALID",
  };
  const placed = insights.map((insight): { insight: ExportInsight; placement: DeckPlacement } => {
    const placement = placePreInsight(insight);
    const s = support.statusOf(insight.id);
    if (placement.include && s.status === "invalid") return { insight, placement: { include: false, reason: summariseSupport(s) } };
    return { insight, placement };
  });
  // Numerical traceability (0101): a card whose figures need review says so under its source.
  const figures = await loadRunFigureChecksForExport((fn) => withTenant(TENANT_ID, fn), runId);
  const included = placed.filter(
    (p): p is { insight: ExportInsight; placement: Extract<DeckPlacement, { include: true }> } => p.placement.include,
  );
  const excluded = placed.filter(
    (p): p is { insight: ExportInsight; placement: Extract<DeckPlacement, { include: false }> } => !p.placement.include,
  );

  if (included.length === 0) {
    const emptySlide = pptx.addSlide();
    const message =
      insights.length === 0
        ? "No insights have been generated for this project yet."
        : "No pre-insight currently rests on a supported finding. The ones not included are listed on the next slide.";
    emptySlide.addText(message, {
      x: 0.6,
      y: 2.3,
      w: 8.8,
      h: 1,
      fontSize: 16,
      color: "374151",
    });
  }

  const grouped = new Map<string, typeof included>();
  for (const entry of included) {
    const key = entry.insight.theme ?? NO_THEME_LABEL;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(entry);
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

      pageInsights.forEach(({ insight, placement }, index) => {
        const col = index % CARDS_PER_ROW;
        const row = Math.floor(index / CARDS_PER_ROW);
        const x = GRID_X + col * (CARD_W + CARD_GAP_X);
        const y = GRID_Y + row * (CARD_H + CARD_GAP_Y);
        const accent = placement.color;

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

        slide.addText(`${placement.label.toUpperCase()}${supportTag[support.statusOf(insight.id).status]}`, {
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
            // Golden-thread repair: the source of the finding this insight comes from.
            { text: sourceLine([formatFindingSource(insight)]), options: { fontSize: 8, color: "6B7280", breakLine: true } },
            ...(() => {
              const note = figureCheckLoadErrorNote(figures) ?? figureCheckNote(figures.preInsights[insight.id]);
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

      addFooter(slide, deckTitle, `${theme} · ${page + 1}/${pageCount}`);
    }
  }

  // Pre-insights that no longer rest on a supported finding are listed, never silently dropped.
  if (excluded.length > 0) {
    const LINES_PER_SLIDE = 8;
    const pages = Math.ceil(excluded.length / LINES_PER_SLIDE);
    for (let page = 0; page < pages; page++) {
      const slide = pptx.addSlide();
      slide.addText(pages > 1 ? `Not included (${page + 1}/${pages})` : "Not included", {
        x: 0.5,
        y: 0.35,
        w: 9,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: "B91C1C",
      });
      const lines = excluded.slice(page * LINES_PER_SLIDE, (page + 1) * LINES_PER_SLIDE).flatMap(({ insight, placement }) => [
        { text: `${insight.headline}: not included because ${placement.reason}.`, options: { fontSize: 11, color: "111827", breakLine: true } },
        { text: sourceLine([formatFindingSource(insight)]), options: { fontSize: 8, color: "6B7280", breakLine: true } },
      ]);
      slide.addText(lines, { x: 0.5, y: 1.0, w: 9, h: 4.2, valign: "top", autoFit: true });
      addFooter(slide, deckTitle, `Not included · ${page + 1}/${pages}`);
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
