"use client";

import type { InstrumentSummary } from "@/lib/instruments";
import { useSelectImportFile } from "./TranscriptSetup";
import { useInstrumentAutoStart } from "./useInstrumentAutoStart";

export type AttachedInstrumentInfo = {
  documentId: string;
  filename: string;
  summary: InstrumentSummary;
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
 * The questionnaires and guides linked to the selected data file or transcript, one line each:
 * name and status, with a way to its own card. The full card used to be repeated here, duplicating
 * the questionnaire's own pane (Grant, 2026-10-19). The first read and match still start from
 * here, by the same rule as the full card (useInstrumentAutoStart), and a failure shows on the line.
 */
/**
 * What linking a questionnaire does, at the top of a Questionnaire links tab (Grant, 2026-10-22: "else
 * it's just a link"). Kept to what the code does: confirmed links supply question wording and answer
 * labels (getLabelOverlay), and codes the questionnaire marks as don't know are left out of bases
 * (instruments.ts, claude/questionnaire-meaning-failure.md), which can move percentages.
 */
export function QuestionnaireLinkingNote() {
  return (
    <p className="max-w-3xl text-xs text-muted" data-testid="questionnaire-linking-note">
      Linking matches each question in the questionnaire, or each entry in the codebook, to a variable in the data file. Once
      you confirm a link, tables and charts built from that variable show its wording and answer labels, and answer codes marked as
      don&apos;t know are treated as missing, so bases and percentages can change. Nothing applies until it is confirmed, by you
      or, for a question worded exactly like a codebook entry you have confirmed, through that entry (shown as &quot;Identical to
      codebook&quot;, and withdrawn if the codebook entry is). The data file itself is never changed.
    </p>
  );
}

export default function AttachedInstruments({
  runId,
  instruments,
  targetId,
  dataDocs,
  autoStart,
}: {
  runId: string;
  instruments: AttachedInstrumentInfo[];
  /** The data file the questionnaire links to (quant cards). */
  targetId?: string;
  dataDocs?: { id: string; name: string }[];
  autoStart: boolean;
}) {
  return (
    <>
      {instruments.map((i) => (
        <AttachedInstrumentLine key={i.documentId} runId={runId} info={i} targetId={targetId} dataDocs={dataDocs ?? []} autoStart={autoStart} />
      ))}
    </>
  );
}

function AttachedInstrumentLine({ runId, info, targetId, dataDocs, autoStart }: { runId: string; info: AttachedInstrumentInfo; targetId?: string; dataDocs: { id: string; name: string }[]; autoStart: boolean }) {
  const select = useSelectImportFile();
  const isGuide = !!info.summary.type && guideTypes.includes(info.summary.type);
  // The same data file the full card would match to: this file when it is the only candidate.
  const fixedTarget = isGuide || dataDocs.length > 1 ? undefined : targetId;
  const target = fixedTarget ?? info.summary.forDocumentId ?? "";
  const auto = useInstrumentAutoStart({ runId, documentId: info.documentId, summary: info.summary, isGuide, target, enabled: autoStart });
  return (
    <div data-testid="attached-instrument" className="flex flex-col gap-1 rounded-lg border border-border bg-white p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words">
          <span className="font-semibold text-foreground">{isGuide ? "Guide" : "Questionnaire"}:</span>{" "}
          <span className="text-muted">
            {info.filename}, {auto.running ? (info.summary.items === 0 ? "reading now" : "matching now") : headline(info.summary, isGuide)}
          </span>
        </p>
        <button type="button" onClick={() => select(info.documentId)} className="shrink-0 font-medium text-primary underline">
          Show
        </button>
      </div>
      {auto.message && <p className="text-foreground">{auto.message}</p>}
      {auto.error && <p className="text-danger">{auto.error}</p>}
    </div>
  );
}
