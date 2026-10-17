"use client";

import DeleteDocumentButton from "@/app/DeleteDocumentButton";
import type { InstrumentSummary } from "@/lib/instruments";
import InstrumentCard from "./InstrumentCard";

export type AttachedInstrumentInfo = {
  documentId: string;
  filename: string;
  summary: InstrumentSummary;
  deleteAction: () => Promise<void>;
  /** GT-010: the delete confirmation for this file, naming what goes with it. */
  deleteConfirm?: string;
};

const guideTypes = ["interview_guide", "focus_group_guide"];

function headline(s: InstrumentSummary, isGuide: boolean): string {
  if (s.items === 0) return "being read";
  if (isGuide) return `${s.items} questions and probes read`;
  const parts = [`${s.items} items read`];
  if (s.links.confirmed > 0) parts.push(`${s.links.confirmed} linked`);
  if (s.links.suggested > 0) parts.push(`${s.links.suggested} to check`);
  return parts.join(", ");
}

/**
 * Questionnaires and guides shown inside the card of the file they belong to,
 * above its data quality. Rolled up; reads and matches by itself the first time.
 */
export default function AttachedInstruments({
  runId,
  instruments,
  targetId,
  dataDocs,
  autoStart,
  onlyTranscript,
}: {
  runId: string;
  instruments: AttachedInstrumentInfo[];
  /** The data file the questionnaire links to (quant cards). */
  targetId?: string;
  dataDocs?: { id: string; name: string }[];
  autoStart: boolean;
  onlyTranscript?: string;
}) {
  return (
    <>
      {instruments.map((i) => {
        const isGuide = !!i.summary.type && guideTypes.includes(i.summary.type);
        return (
          <div key={i.documentId} className="flex items-start gap-2">
            <details className="min-w-0 flex-1 rounded-lg border border-border bg-white p-3">
              <summary className="cursor-pointer select-none text-xs font-semibold text-foreground">
                {isGuide ? "Guide" : "Questionnaire"}: <span className="font-normal text-muted">{i.filename}, {headline(i.summary, isGuide)}</span>
              </summary>
              <div className="mt-3">
                <InstrumentCard
                  runId={runId}
                  documentId={i.documentId}
                  summary={i.summary}
                  dataDocs={dataDocs ?? []}
                  fixedTarget={isGuide || (dataDocs?.length ?? 0) > 1 ? undefined : targetId}
                  autoStart={autoStart}
                  onlyTranscript={onlyTranscript}
                />
              </div>
            </details>
            <form action={i.deleteAction}>
              <DeleteDocumentButton confirmMessage={i.deleteConfirm} />
            </form>
          </div>
        );
      })}
    </>
  );
}
