"use client";
import { useEffect, useRef, useState } from "react";
import { loadUaWorkspaceAction } from "@/lib/uaActions";
import type { WaveFile } from "@/lib/waveTrackingActions";
import UaDashboardPanel from "./UaDashboardPanel";

export default function UaDashboardTile({ runId, documentId, waveFiles }: { runId: string; documentId: string; waveFiles: WaveFile[] }) {
  const [state, setState] = useState<{ key: string; recognised: boolean; needsMapping: boolean; error: string | null }>({ key: "", recognised: false, needsMapping: false, error: null });
  const [open, setOpen] = useState<string | null>(null);
  const current = `${runId}:${documentId}`;
  const marker = useRef<HTMLLIElement>(null);
  const [seen, setSeen] = useState("");
  useEffect(() => {
    const target = `${runId}:${documentId}`;
    // Section panels stay mounted while hidden. Recognition must not queue full-file reads in Import.
    if (typeof IntersectionObserver === "undefined") {
      let active = true;
      Promise.resolve().then(() => { if (active) setSeen(target); });
      return () => { active = false; };
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(target); observer.disconnect(); }
    });
    if (marker.current) observer.observe(marker.current);
    return () => observer.disconnect();
  }, [runId, documentId]);
  useEffect(() => {
    if (seen !== `${runId}:${documentId}`) return;
    const target = `${runId}:${documentId}`; let active = true;
    loadUaWorkspaceAction(runId, documentId).then(r => {
      if (active) setState(r.ok ? { key: target, recognised: r.view.recognition.recognised, needsMapping: r.view.recognition.needsMapping, error: null } : { key: target, recognised: false, needsMapping: false, error: r.error });
    }).catch(e => { if (active) setState({ key: target, recognised: false, needsMapping: false, error: String(e) }); });
    return () => { active = false; };
  }, [runId, documentId, seen]);
  if (state.key !== current) return <li ref={marker} className="min-h-px" aria-hidden="true" />;
  if (!state.recognised && !state.needsMapping && !state.error) return null;
  return <li>
    <button type="button" disabled={!!state.error} onClick={() => setOpen(current)} className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-5 text-left shadow-sm transition hover:border-blue-400 focus-visible:outline-2 focus-visible:outline-primary disabled:bg-slate-50">
      <span className="text-base font-semibold text-foreground">{state.needsMapping ? "Usage & attitudes: review question mapping" : "Usage & attitudes dashboard"}</span>
      <span className="text-xs leading-relaxed text-slate-600">Consumption, personal purchase, occasions, brand meaning and growth audiences, with the eligible base behind each figure.</span>
      {state.error && <span className="text-xs text-red-800">Could not check U&amp;A inputs: {state.error}</span>}
    </button>
    {open === current && <UaDashboardPanel key={`${runId}:${documentId}`} runId={runId} initialDocumentId={documentId} waveFiles={waveFiles} onClose={() => setOpen(null)} />}
  </li>;
}
