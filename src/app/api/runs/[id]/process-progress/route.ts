import { NextResponse } from "next/server";
import { getProcessProgress } from "@/lib/processProgress";

// Polled by the ProcessProgress client component while a "Process
// documents" form is mid-submission, so the page can show "2 of 4
// documents" instead of sitting there with just a spinner for however long
// the whole pipeline takes. See processProgress.ts for why this is an
// in-memory, single-process tracker rather than a real job queue.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  return NextResponse.json({ progress: getProcessProgress(runId) });
}
