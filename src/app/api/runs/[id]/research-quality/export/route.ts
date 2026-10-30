import { NextResponse } from "next/server";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";
import { loadResearchQualityView } from "@/lib/researchQualityView";
import { buildResearchQualityDocx } from "@/lib/researchQualityExport";
import { ResearchQualityError } from "@/lib/researchQualityTypes";
import { withTenantRead } from "@/lib/db";

// Research Quality Review DOCX for one review of a project the signed-in organisation owns
// (?review=<id>, default the latest). No model call. Another organisation's project or review
// answers 404 with nothing in it; a review that cannot be loaded never yields an apparently
// complete file.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const { id: runId } = await params;
  // SEC1: another organisation's project answers exactly like a missing one, before anything is read.
  if (!(await runBelongsToTenant(context.tenantId, runId))) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const reviewId = new URL(request.url).searchParams.get("review");
  try {
    const view = await loadResearchQualityView(context.tenantId, runId, reviewId);
    if (!view.review || (reviewId && view.review.id !== reviewId)) return NextResponse.json({ error: "No such review." }, { status: 404 });
    const name = await withTenantRead(context.tenantId, async (c) => (await c.query<{ project_name: string | null }>(`select project_name from runs where id = $1 and tenant_id = $2`, [runId, context.tenantId])).rows[0]?.project_name ?? null);
    const { buffer, filename } = await buildResearchQualityDocx(view, name);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ResearchQualityError) return NextResponse.json({ error: error.message }, { status: /migration/.test(error.message) ? 503 : 404 });
    console.error("[research-quality export]", error);
    return NextResponse.json({ error: "The review could not be exported. Nothing was downloaded; try again." }, { status: 500 });
  }
}
