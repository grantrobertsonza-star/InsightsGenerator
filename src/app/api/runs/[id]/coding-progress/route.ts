import { NextResponse } from "next/server";
import { getRunCodingProgress } from "@/lib/codingProgress";

// Polled by the CodingProgressBar component while a coding step or a stability check is running.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: runId } = await params;
  return NextResponse.json({ progress: getRunCodingProgress(runId) });
}
