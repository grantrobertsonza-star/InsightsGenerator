import { NextResponse } from "next/server";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";
import { getRunCodingProgress } from "@/lib/codingProgress";

// Polled by the CodingProgressBar component while a coding step or a stability check is running.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const { id: runId } = await params;
  // G6: progress is held in memory by run id, so ownership is checked here; another
  // organisation's run id gets the same 404 as one that does not exist.
  if (!(await runBelongsToTenant(context.tenantId, runId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ progress: getRunCodingProgress(runId) });
}
