"use client";

import { useState, useTransition } from "react";
import { addMemoAction, deleteMemoAction, reuseCodebookAction } from "@/lib/codingAnalysisActions";
import type { Memo, MemoKind } from "@/lib/codingMemos";

const KIND_LABEL: Record<MemoKind, string> = {
  analytic: "Analytic",
  reflexivity: "My stance",
  decision: "Decision",
};

export default function CodingExtrasClient({
  runId,
  documentId,
  filename,
  codeNames,
  memos,
  others,
}: {
  runId: string;
  documentId: string;
  filename: string;
  codeNames: string[];
  memos: Memo[];
  others: { documentId: string; filename: string; codes: number }[];
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<MemoKind>("analytic");
  const [code, setCode] = useState("");
  const [source, setSource] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const r = await addMemoAction(runId, documentId, code || null, kind, body);
      if (r.ok) setBody("");
      setMsg(r.ok ? "Memo saved." : r.error);
    });
  }
  function reuse() {
    if (!source) return;
    if (!window.confirm("This replaces the current codes of this transcript with the other transcript's codebook (as a new version; the old one is kept) and codes the transcript again. Continue?")) return;
    setMsg(null);
    start(async () => {
      const r = await reuseCodebookAction(runId, documentId, source);
      setMsg(r.ok ? (r.message ?? "Done.") : r.error);
    });
  }

  return (
    <details className="rounded-lg border border-border bg-white text-xs">
      <summary className="cursor-pointer px-3 py-2 font-medium text-foreground">
        Memos and shared codebook
        <span className="ml-2 font-normal text-muted">{memos.length} memo{memos.length === 1 ? "" : "s"}</span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
        {others.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="font-medium text-foreground">Use another transcript&apos;s codebook</div>
            <p className="text-muted">
              Coding {filename} with the same codes as another transcript makes counts comparable across transcripts.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select value={source} onChange={(e) => setSource(e.target.value)} className="rounded border border-border px-2 py-1">
                <option value="">Choose a transcript</option>
                {others.map((o) => (
                  <option key={o.documentId} value={o.documentId}>
                    {o.filename} ({o.codes} codes)
                  </option>
                ))}
              </select>
              <button type="button" disabled={!source || pending} onClick={reuse} className="rounded border border-border px-2 py-1 font-medium hover:bg-slate-50 disabled:opacity-50">
                {pending ? "Working..." : "Apply"}
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <div className="font-medium text-foreground">Add a memo</div>
          <div className="flex flex-wrap gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as MemoKind)} className="rounded border border-border px-2 py-1">
              {(Object.keys(KIND_LABEL) as MemoKind[]).map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
            <select value={code} onChange={(e) => setCode(e.target.value)} className="rounded border border-border px-2 py-1">
              <option value="">About the transcript</option>
              {codeNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} placeholder="What are you thinking, and why did you code it this way?" className="w-full rounded border border-border p-2" />
          <button type="button" disabled={!body.trim() || pending} onClick={save} className="w-fit rounded border border-border px-2 py-1 font-medium hover:bg-slate-50 disabled:opacity-50">
            Save memo
          </button>
        </div>
        {msg && <p className="text-muted">{msg}</p>}
        {memos.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {memos.map((m) => (
              <li key={m.id} className="rounded bg-slate-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase text-muted">
                    {KIND_LABEL[m.kind]}
                    {m.codeKey ? ` · ${m.codeKey}` : ""} · {new Date(m.createdAt).toLocaleDateString("en-GB")}
                  </span>
                  <button type="button" onClick={() => start(async () => { await deleteMemoAction(runId, m.id); })} className="text-muted hover:text-danger" aria-label="Delete memo">
                    ×
                  </button>
                </div>
                <p className="whitespace-pre-wrap text-foreground">{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
