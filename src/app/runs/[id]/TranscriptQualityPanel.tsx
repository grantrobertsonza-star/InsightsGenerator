"use client";

import { useState, useTransition } from "react";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import type { ActionResult } from "@/lib/codingAnalysisActions";
import DataQualityTab from "./DataQualityTab";

/**
 * Qualitative data quality for each coded transcript, shown in the same
 * Data quality tab as the import checks for tables, so there is one place
 * to look whatever was uploaded.
 */
export default function TranscriptQualityPanel({
  runId,
  items,
}: {
  runId: string;
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
        <section key={item.documentId} className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">
            {item.filename}
          </h3>
          <DataQualityTab
            runId={runId}
            view={item.view}
            run={run}
            busy={isPending}
          />
        </section>
      ))}
      {message && <p className="text-xs text-muted">{message}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
