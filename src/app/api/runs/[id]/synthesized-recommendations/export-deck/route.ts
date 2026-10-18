import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";
import { addFooter, addTitleSlide, safeFileStem } from "@/lib/deckSlides";
import { CrosstabLayoutError } from "@/lib/crosstabSlides";
import { FIELD_CELL_MARGIN, planFieldSlides } from "@/lib/fieldTableSlides";
import { exportFields, loadMainRecommendations, parseScope, qualificationTags, scopeLabel, supportText } from "@/lib/mainRecommendationExport";
import { routeRequestContext } from "@/lib/requestContext";

// LAYOUT_16x9 is 10 x 5.625 inches; the shared footer rule sits at 5.22.
const X = 0.5;
const LABEL_W = 1.9;
const VALUE_W = 7.1;
const TABLE_Y = 1.0;
const TABLE_BOTTOM = 5.1;
const PT = 10;

/**
 * GT-007: the main Recommendations list as slides. One recommendation per slide (continuing onto
 * further slides when its text is long, never clipped), every field in a native table, the
 * qualifications tagged in the slide title. ?scope=all (default) or ?scope=accepted. In the
 * accepted scope a recommendation whose insight's support is no longer valid is left out of the
 * main slides and listed, with the reason, on a closing slide (as the per-pre-insight deck does);
 * changed or unchecked support and earlier or unrecorded decisions stay, tagged.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const TENANT_ID = context.tenantId;
  const { id: runId } = await params;
  const scope = parseScope(new URL(request.url).searchParams.get("scope"));
  const data = await loadMainRecommendations(TENANT_ID, runId, scope);
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const leftOut = scope === "accepted" ? data.rows.filter((r) => data.supportOf(r).status === "invalid") : [];
  const shown = scope === "accepted" ? data.rows.filter((r) => data.supportOf(r).status !== "invalid") : data.rows;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  const deckTitle = data.run.project_name ?? data.run.decision_statement ?? "Insights Elevator";
  addTitleSlide(pptx, {
    title: deckTitle,
    decisionStatement: data.run.decision_statement,
    showDecisionLine: Boolean(data.run.project_name && data.run.decision_statement),
    audience: data.run.audience,
  });

  const about = pptx.addSlide();
  about.addText("About this export", { x: X, y: 0.35, w: 9, h: 0.5, fontSize: 20, bold: true, color: "1D4ED8" });
  about.addText(
    [
      { text: scopeLabel(scope), options: { breakLine: true } },
      { text: `${shown.length} recommendation${shown.length === 1 ? "" : "s"} on the following slides.`, options: { breakLine: true } },
      ...(leftOut.length > 0 ? [{ text: `${leftOut.length} left out because their insight's support is no longer valid (listed at the end).`, options: { breakLine: true } }] : []),
      { text: shown.length === 0 && leftOut.length === 0 ? "No recommendations in this scope." : "Tags in each title: review status, decisions and support, when they qualify the recommendation." },
    ],
    { x: X, y: 1.0, w: 9, h: 3.5, fontSize: 13, color: "374151", valign: "top" },
  );
  addFooter(about, deckTitle, "About");

  try {
    shown.forEach((row, index) => {
      const support = data.supportOf(row);
      const pages = planFieldSlides(
        exportFields(row, support).map(([field, text]) => ({ field, text, style: field === "Action" ? ("bold" as const) : ("regular" as const) })),
        { labelW: LABEL_W, valueW: VALUE_W, pt: PT, budget: TABLE_BOTTOM - TABLE_Y },
      );
      pages.forEach((rows, p) => {
        const slide = pptx.addSlide();
        const title = `Recommendation ${index + 1} of ${shown.length}${pages.length > 1 ? ` (${p + 1}/${pages.length})` : ""}${qualificationTags(row, support)}`;
        slide.addText(title, { x: X, y: 0.3, w: 9, h: 0.55, fontSize: 12, bold: true, color: "1D4ED8", valign: "top", margin: 0 });
        slide.addTable(
          rows.map((r) => [
            { text: r.part === 0 ? r.field : `${r.field} (cont.)`, options: { bold: true, color: "374151", fill: { color: "F1F5F9" } } },
            { text: r.shown, options: { bold: r.style === "bold", color: "111827" } },
          ]),
          { x: X, y: TABLE_Y, w: LABEL_W + VALUE_W, colW: [LABEL_W, VALUE_W], fontSize: PT, fontFace: "Calibri", margin: FIELD_CELL_MARGIN, border: { type: "solid", color: "CBD5E1", pt: 0.5 }, autoPage: false, valign: "top" },
        );
        addFooter(slide, deckTitle, `${index + 1}/${shown.length}`);
      });
    });

    if (leftOut.length > 0) {
      const pages = planFieldSlides(
        leftOut.map((r, i) => ({ field: `Left out ${i + 1}`, text: `${r.action_text} ${supportText(data.supportOf(r))}` })),
        { labelW: 1.6, valueW: 7.4, pt: PT, budget: TABLE_BOTTOM - TABLE_Y },
      );
      pages.forEach((rows, p) => {
        const slide = pptx.addSlide();
        slide.addText(`Left out: support no longer valid${pages.length > 1 ? ` (${p + 1}/${pages.length})` : ""}`, { x: X, y: 0.3, w: 9, h: 0.55, fontSize: 16, bold: true, color: "B91C1C", valign: "top", margin: 0 });
        slide.addTable(
          rows.map((r) => [
            { text: r.part === 0 ? r.field : "", options: { bold: true } },
            { text: r.shown, options: {} },
          ]),
          { x: X, y: TABLE_Y, w: 9, colW: [1.6, 7.4], fontSize: PT, fontFace: "Calibri", margin: FIELD_CELL_MARGIN, border: { type: "solid", color: "CBD5E1", pt: 0.5 }, autoPage: false, valign: "top" },
        );
        addFooter(slide, deckTitle, "Left out");
      });
    }
  } catch (error) {
    if (!(error instanceof CrosstabLayoutError)) throw error;
    return NextResponse.json({ error: `The recommendations cannot be laid out on slides without losing text (${error.message}) Export them to Excel instead.` }, { status: 422 });
  }

  const buffer = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const stem = safeFileStem(data.run.project_name ?? data.run.decision_statement ?? "recommendations", "recommendations");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${stem}-main-recommendations-${scope}.pptx"`,
    },
  });
}
