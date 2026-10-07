"use client";

import { useState, useTransition } from "react";
import type { CrossThemeRow } from "@/lib/codingAnalysis";
import { integrateThemesAction } from "@/lib/codingAnalysisActions";

/**
 * Each theme (or stand-alone code) across every coded transcript of the run,
 * matched by name: in how many files it came up, and how many participants
 * that is out of everyone who spoke. Participants are counted per file and
 * added up, so people who appear in more than one file count once per file.
 */
export default function AcrossTranscripts({
  rows,
  documentNames,
  runId,
}: {
  rows: CrossThemeRow[];
  documentNames: Record<string, string>;
  runId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  function integrate() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const r = await integrateThemesAction(runId);
      if (!r.ok) setError(r.error);
      else setMessage(r.message ?? "Done");
    });
  }
  if (rows.length === 0) return null;
  const total = rows[0].documentsTotal;
  return (
    <details className="rounded-lg border border-border bg-white p-3 text-xs">
      <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
        Themes across transcripts ({rows.length} theme
        {rows.length === 1 ? "" : "s"} in {total} coded file
        {total === 1 ? "" : "s"})
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={integrate}
          disabled={isPending}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
        >
          {isPending ? "Working..." : "Group themes across transcripts"}
        </button>
        <span className="text-muted">
          Puts similar codes from different transcripts under one main theme.
          This replaces the themes now set on each transcript's codes.
        </span>
        {message && <span className="text-success">{message}</span>}
        {error && <span className="text-red-600">{error}</span>}
      </div>
      <p className="mt-2 text-muted">
        Themes are matched by name across files, so a theme called the same
        thing in two files is counted together. Participants are counted per
        file and added up.
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-3 font-bold">Theme</th>
              <th className="py-1.5 pr-3 font-bold">Files</th>
              <th className="py-1.5 pr-3 font-bold">Participants</th>
              <th className="py-1.5 pr-3 font-bold">Turns</th>
              <th className="py-1.5 font-bold">Where it came up</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct =
                r.speakersWith !== null &&
                r.speakersTotal !== null &&
                r.speakersTotal > 0
                  ? Math.round((r.speakersWith / r.speakersTotal) * 100)
                  : null;
              return (
                <tr key={r.theme} className="border-b border-border/60 align-top">
                  <td className="py-1.5 pr-3">
                    <div className="font-medium text-foreground">{r.theme}</div>
                    {r.codes.length > 0 && (
                      <div className="text-muted">
                        Sub-themes: {r.codes.join("; ")}
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {r.documentsWith} of {r.documentsTotal}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">
                    {r.speakersWith !== null && r.speakersTotal !== null
                      ? `${r.speakersWith} of ${r.speakersTotal}${pct !== null ? ` (${pct}%)` : ""}`
                      : "no speaker labels"}
                  </td>
                  <td className="py-1.5 pr-3">{r.turns}</td>
                  <td className="py-1.5 text-muted">
                    {r.perDocument
                      .filter((d) => d.present)
                      .map((d) => documentNames[d.documentId] ?? "File")
                      .join("; ") || "none"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
