import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { withTenant } from "@/lib/db";
import { addTitleSlide, addFooter, CARD_LAYOUT, safeFileStem } from "@/lib/deckSlides";

const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

type ExportRecommendation = {
  theme: string | null;
  action_text: string;
  owner_role: string;
  timeline: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "accepted" | "rejected";
};

const NO_THEME_LABEL = "No theme";

const priorityColor: Record<ExportRecommendation["priority"], string> = {
  high: "DC2626",
  medium: "D97706",
  low: "64748B",
};

/**
 * Builds a client-presentable slide deck from a run's recommendations, one
 * slide per theme, matching the findings and insights deck exports' card
 * layout. Defaults to accepted-only (a deck going to a client or a task
 * board should reflect what's actually been decided, not every candidate
 * the agent proposed), with ?scope=all to include pending/rejected ones
 * too, each tagged with its status.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") === "all" ? "all" : "accepted";

  const [run, recommendations] = await withTenant(TENANT_ID, async (client) => {
    const runResult = await client.query<{
      project_name: string | null;
      decision_statement: string | null;
      audience: string | null;
    }>("select project_name, decision_statement, audience from runs where id = $1", [runId]);

    const recommendationsResult = await client.query<ExportRecommendation>(
      `select f.theme, r.action_text, r.owner_role, r.timeline, r.priority, r.status
       from recommendations r
       join insights i on i.id = r.insight_id
       join findings f on f.id = i.finding_id
       where r.run_id = $1${scope === "accepted" ? " and r.status = 'accepted'" : ""}
       order by f.theme nulls last, r.created_at`,
      [runId]
    );
    return [runResult.rows[0], recommendationsResult.rows] as const;
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

  if (recommendations.length === 0) {
    const emptySlide = pptx.addSlide();
    emptySlide.addText(
      scope === "accepted"
        ? "No recommendations have been accepted yet. Review and accept recommendations in the app, then export again."
        : "No recommendations have been generated for this project yet.",
      { x: 0.6, y: 2.3, w: 8.8, h: 1, fontSize: 16, color: "374151" }
    );
  }

  const grouped = new Map<string, ExportRecommendation[]>();
  for (const rec of recommendations) {
    const key = rec.theme ?? NO_THEME_LABEL;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(rec);
  }

  const { CARDS_PER_ROW, CARD_W, CARD_H, CARD_GAP_X, CARD_GAP_Y, GRID_X, GRID_Y } = CARD_LAYOUT;
  const CARDS_PER_SLIDE = CARD_LAYOUT.CARDS_PER_ROW * CARD_LAYOUT.CARDS_PER_COL;

  for (const [theme, themeRecs] of grouped) {
    const pageCount = Math.max(1, Math.ceil(themeRecs.length / CARDS_PER_SLIDE));

    for (let page = 0; page < pageCount; page++) {
      const slide = pptx.addSlide();
      const pageRecs = themeRecs.slice(page * CARDS_PER_SLIDE, (page + 1) * CARDS_PER_SLIDE);

      slide.addText(pageCount > 1 ? `${theme} (${page + 1}/${pageCount})` : theme, {
        x: 0.5,
        y: 0.35,
        w: 9,
        h: 0.55,
        fontSize: 22,
        bold: true,
        color: "1D4ED8",
      });

      pageRecs.forEach((rec, index) => {
        const col = index % CARDS_PER_ROW;
        const row = Math.floor(index / CARDS_PER_ROW);
        const x = GRID_X + col * (CARD_W + CARD_GAP_X);
        const y = GRID_Y + row * (CARD_H + CARD_GAP_Y);
        const accent = priorityColor[rec.priority];

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
          scope === "all" && rec.status !== "accepted"
            ? rec.status === "rejected"
              ? " · Rejected"
              : " · Pending review"
            : "";

        slide.addText(`${rec.priority.toUpperCase()} PRIORITY${statusTag}`, {
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
            { text: rec.action_text, options: { fontSize: 11.5, bold: true, color: "111827", breakLine: true } },
            {
              text: `${rec.owner_role} · ${rec.timeline}`,
              options: { fontSize: 9.5, italic: true, color: "6B7280" },
            },
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
  const safeName = safeFileStem(run.project_name ?? run.decision_statement ?? "recommendations", "recommendations");
  const suffix = scope === "accepted" ? "accepted-recommendations-deck" : "recommendations-deck";

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${safeName}-${suffix}.pptx"`,
    },
  });
}
