"use client";

import { useState, useTransition } from "react";
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
      className="flex max-w-3xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setMessage(null);
        setError(null);
        start(async () => {
          const result = await uploadDocumentsAction(runId, data);
          if (result.ok) {
            setMessage(`Added ${result.added.length} file${result.added.length === 1 ? "" : "s"}: ${result.added.join(", ")}`);
            setRound((n) => n + 1); // remount the pickers so they are empty again
          } else {
            setError(result.error);
          }
        });
      }}
    >
      <div key={round} className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <FileInput name="reportFiles" multiple icon={<DocumentIcon className="h-3.5 w-3.5 text-primary" />} label="Reports" caption="PDF, Word or PowerPoint" />
        <FileInput
          name="tableFiles"
          multiple
          accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
          icon={<ChartIcon className="h-3.5 w-3.5 text-primary" />}
          label="Tables"
          caption="Already aggregated"
        />
        <FileInput
          name="rawTableFiles"
          multiple
          accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
          icon={<GridIcon className="h-3.5 w-3.5 text-primary" />}
          label="Quant data"
          caption="Row by column data"
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
      <label className="flex items-center gap-2 text-xs text-muted">
        If you add a questionnaire or guide, it is a
        <select name="instrumentType" defaultValue="questionnaire" className="rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground">
          <option value="questionnaire">survey questionnaire</option>
          <option value="interview_guide">interview guide</option>
          <option value="focus_group_guide">focus group guide</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-muted">
        If you add statistical output, label the wave or study
        <input name="outputWave" placeholder="optional, for example Wave 1" className="w-52 rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground" />
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
        Data handling: files are expected to be cleared for analysis by their owner, with consent in place and any personal information removed or
        permitted for this use (for example under POPIA). Insights Elevator does not detect or remove personal information.
      </p>
      {message && <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">{message}</div>}
      {error && <div className="rounded-lg border border-danger bg-danger-light px-3 py-2 text-xs text-danger">{error}</div>}
    </form>
  );
}
