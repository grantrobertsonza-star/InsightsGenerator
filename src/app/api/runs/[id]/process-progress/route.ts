import { NextResponse } from "next/server";
import { routeRequestContext, runBelongsToTenant } from "@/lib/requestContext";
import { getProcessProgress } from "@/lib/processProgress";

// Polled by the ProcessProgress client component while a "Process
// documents" form is mid-submission, so the page can show "2 of 4
// documents" instead of sitting there with just a spinner for however long
// the whole pipeline takes. See processProgress.ts for why this is an
// in-memory, single-process tracker rather than a real job queue.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await routeRequestContext();
  if (context instanceof Response) return context;
  const { id: runId } = await params;
  // G6: progress is held in memory by run id, so ownership is checked here; another
  // organisation's run id gets the same 404 as one that does not exist.
  if (!(await runBelongsToTenant(context.tenantId, runId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ progress: getProcessProgress(runId) });
}
