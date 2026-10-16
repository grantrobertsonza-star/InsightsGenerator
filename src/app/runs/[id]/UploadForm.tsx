"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import FileInput from "@/components/FileInput";
import { ChartIcon, DocumentIcon, GridIcon, TranscriptIcon, UploadIcon } from "@/components/icons";
import { uploadDocumentsAction } from "@/lib/documentUploadActions";

export default function UploadForm({ runId }: { runId: string }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setMessage(null);
        setError(null);
        start(async () => {
          const result = await uploadDocumentsAction(runId, data);
          // IMP-008: files already in the project are named, not silently dropped or re-added.
          const repeats = result.alreadyPresent && result.alreadyPresent.length > 0 ? ` ${result.alreadyPresent.join(" ")}` : "";
          if (result.ok) {
            setMessage(`Added ${result.added.length} file${result.added.length === 1 ? "" : "s"}${result.added.length ? `: ${result.added.join(", ")}` : ""}.${repeats}`);
          } else {
            // Files named in `added` are already stored, even though the overall result is an
            // error - said so here, and not just in the one case the batch fully succeeded, so
            // re-submitting after a partial failure doesn't mean re-picking (and re-storing) the
            // ones that already went through. The form's own file pickers are cleared below in
            // both cases for the same reason: whatever is still sitting in them after this submit
            // either already succeeded, or needs to be deliberately re-chosen, never silently
            // resent as-is.
            setError(
              (result.added.length > 0
                ? `${result.error} (Already added: ${result.added.join(", ")}.)`
                : result.error) + repeats,
            );
          }
          setRound((n) => n + 1); // remount the pickers so they are empty again, success or not
        });
      }}
    >
      <div key={round} className="grid grid-cols-1 gap-2">
        <FileInput name="reportFiles" multiple icon={<DocumentIcon className="h-3.5 w-3.5 text-primary" />} label="Reports" caption="PDF, Word or PowerPoint" />
        <FileInput
          name="tableFiles"
          multiple
          accept=".csv,.xlsx,.xls,.sav,.dta"
          icon={<ChartIcon className="h-3.5 w-3.5 text-primary" />}
          label="Tables"
          caption="Already aggregated"
        />
        <FileInput
          name="rawTableFiles"
          multiple
          accept=".csv,.xlsx,.xls,.sav,.dta"
          icon={<GridIcon className="h-3.5 w-3.5 text-primary" />}
          label="Raw data"
          caption="CSV/Excel, SPSS or Stata. Up to 20 MB and 100,000 cases per file. SAS excluded pending verification."
        />
        <FileInput
          name="outputFiles"
          multiple
          accept=".zip,.csv,.tsv,.xlsx,.xls,.txt,.md,.docx"
          icon={<ChartIcon className="h-3.5 w-3.5 text-primary" />}
          label="Statistical output"
          caption="A zip of models, clusters and logs"
        />
        <FileInput name="transcriptFiles" multiple icon={<TranscriptIcon className="h-3.5 w-3.5 text-primary" />} label="Qual data" caption="Coded or uncoded" />
        <FileInput name="instrumentFiles" multiple accept=".pdf,.docx" icon={<DocumentIcon className="h-3.5 w-3.5 text-primary" />} label="Questionnaire or guide" caption="Links to your data or transcripts" />
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted">
        If you add a questionnaire or guide, it is a
        <select name="instrumentType" defaultValue="questionnaire" className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground">
          <option value="questionnaire">survey questionnaire</option>
          <option value="interview_guide">interview guide</option>
          <option value="focus_group_guide">focus group guide</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        If you add statistical output, label the wave or study
        <input name="outputWave" placeholder="optional, for example Wave 1" className="w-full rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="flex w-fit items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md disabled:opacity-60"
      >
        <UploadIcon className="h-4 w-4" />
        {pending ? "Uploading..." : "Upload"}
      </button>
      <p className="max-w-3xl text-[11px] text-muted">
        Not sure how to lay a file out?{" "}
        <Link href="/knowledge/preparing-files" target="_blank" className="font-medium text-primary hover:underline">
          Read how to prepare your files
        </Link>
        .
      </p>
      <p className="max-w-3xl text-[11px] text-muted">
        Data handling: upload only files the owner has cleared for analysis. Consent should already be in place, and personal
        information should be removed or covered for this use (under POPIA, for example). The app does not scan for personal
        information or strip it out, so that check stays with you.
      </p>
      {message && <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">{message}</div>}
      {error && <div className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">{error}</div>}
    </form>
  );
}
