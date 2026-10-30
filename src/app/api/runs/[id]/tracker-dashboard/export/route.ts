// R5story: the brand tracking dashboard of one data file as a PowerPoint deck (trackerModuleExport.ts).
// ?documentId=<data file>&includeDrafts=1 adds AI drafts, each labelled as a draft on its slide.
import { NextResponse } from "next/server";
import { safeFileStem } from "@/lib/deckSlides";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";
import { exportTrackerModuleDeck } from "@/lib/trackerModuleExport";
import { ModuleDeckLayoutError } from "@/lib/trackerModuleSlides";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const { id: runId } = await params;
  // SEC1: another organisation's project answers exactly like a missing one, before anything is read.
  if (!(await runBelongsToTenant(context.tenantId, runId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const url = new URL(request.url);
  const documentId = url.searchParams.get("documentId") ?? "";
  if (!UUID.test(documentId)) return NextResponse.json({ error: "Choose the data file to export." }, { status: 400 });
  const includeDrafts = url.searchParams.get("includeDrafts") === "1";
  try {
    const { pptx, filename } = await exportTrackerModuleDeck(context.tenantId, runId, documentId, { includeDrafts });
    return new NextResponse(new Uint8Array(pptx), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${safeFileStem(filename.replace(/\.[^.]+$/, ""), "brand-tracking")}-brand-tracking.pptx"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: e instanceof ModuleDeckLayoutError ? `The deck could not be laid out without cutting text: ${message}` : `The deck could not be built: ${message}` }, { status: e instanceof ModuleDeckLayoutError ? 422 : 500 });
  }
}
