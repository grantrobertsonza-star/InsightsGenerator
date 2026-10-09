"use client";

import { useState, useTransition } from "react";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import type { ActionResult } from "@/lib/codingAnalysisActions";
import { ChevronDownIcon } from "@/components/icons";
import DataQualityTab from "./DataQualityTab";

/**
 * Qualitative data quality for each coded transcript, shown in the same
 * Data quality tab as the import checks for tables, so there is one place
 * to look whatever was uploaded.
 */
export default function TranscriptQualityPanel({
  runId,
  items,
  title,
}: {
  runId: string;
  title?: string;
  items: { documentId: string; filename: string; view: CodingAnalysisView }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else if (result.message) setMessage(result.message);
    });
  }

  return (
    <div className="space-y-6">
      {items.map((item) => (
        <details
          key={item.documentId}
          className="card-surface group rounded-xl border border-border bg-white"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-sm font-semibold text-foreground">
            <span className="flex items-center gap-2">
              <ChevronDownIcon className="h-4 w-4 shrink-0 -rotate-90 text-muted transition-transform group-open:rotate-0" />
              {title ?? item.filename}
            </span>
            {!title && (
              <span className="text-xs font-normal text-muted">
                Quality control
              </span>
            )}
          </summary>
          <div className="border-t border-border px-5 py-4">
            <DataQualityTab
              runId={runId}
              view={item.view}
              run={run}
              busy={isPending}
            />
          </div>
        </details>
      ))}
      {message && <p className="text-xs text-muted">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
