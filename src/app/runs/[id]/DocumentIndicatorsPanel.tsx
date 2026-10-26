"use client";

import { useEffect, useState } from "react";
import { documentIndicatorsAction, type DocumentIndicatorsResult } from "@/lib/documentIndicatorActions";
import { reviewCoverageText } from "@/lib/documentIndicators";

/**
 * Pages, words and (for a brief or proposal) how much of it a quality review reads, for the selected
 * file. Loaded when the file is selected; an answer that arrives after another file was selected is
 * dropped, so it never shows against the wrong file. Unknown is said as unknown, never as zero.
 */
export default function DocumentIndicatorsPanel({ runId, documentId }: { runId: string; documentId: string }) {
  const [result, setResult] = useState<{ documentId: string; value: DocumentIndicatorsResult } | null>(null);
  useEffect(() => {
    let current = true;
    documentIndicatorsAction(runId, documentId)
      .then((value) => current && setResult({ documentId, value }))
      .catch((e) => current && setResult({ documentId, value: { ok: false, error: e instanceof Error ? e.message : String(e) } }));
    return () => {
      current = false;
    };
  }, [runId, documentId]);

  const shown = result?.documentId === documentId ? result.value : null;
  const n = (v: number) => v.toLocaleString("en-GB");
  return (
    <div data-testid="document-indicators" className="flex flex-col gap-1.5 rounded-lg border border-border bg-white p-3 text-xs">
      <p className="font-semibold text-foreground">Document size</p>
      {!shown ? (
        <p className="text-muted">Counting...</p>
      ) : !shown.ok ? (
        <p className="text-danger">Could not count this file: {shown.error}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted">Pages</dt>
          <dd data-testid="indicator-pages" className="text-foreground">
            {shown.indicators.pages.count !== null ? n(shown.indicators.pages.count) : `Not known: ${shown.indicators.pages.reason}`}
          </dd>
          <dt className="text-muted">Words</dt>
          <dd data-testid="indicator-words" className="text-foreground">
            {shown.indicators.words !== null ? `${n(shown.indicators.words)} (as read from the file)` : "Not known: the text has not been read yet"}
          </dd>
          {shown.indicators.coverage && (
            <>
              <dt className="text-muted">Quality review</dt>
              <dd data-testid="indicator-coverage" className={shown.indicators.coverage.kind === "partial" ? "text-amber-800" : "text-foreground"}>
                {reviewCoverageText(shown.indicators.coverage)}
              </dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}
