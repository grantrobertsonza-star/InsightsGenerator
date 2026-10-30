"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadUaWorkspaceAction, loadUaPageAction, saveUaChoicesAction } from "@/lib/uaActions";
import type { UaWorkspace } from "@/lib/uaDashboards";
import type { UaComparison } from "@/lib/uaWaves";
import type { WaveFile } from "@/lib/waveTrackingActions";
import { UA_PAGES, type UaPage, type UaPageId } from "@/lib/uaTypes";

const number = (x: number, digits = 1) => new Intl.NumberFormat("en-ZA", { maximumFractionDigits: digits }).format(x);
export default function UaDashboardPanel({ runId, initialDocumentId, waveFiles, onClose }: { runId: string; initialDocumentId: string; waveFiles: WaveFile[]; onClose: () => void }) {
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const [view, setView] = useState<UaWorkspace | null>(null);
  const [pageId, setPageId] = useState<UaPageId>("footprint");
  const [loadedPage, setPage] = useState<UaPage | null>(null);
  const [resolvedKey, setResolvedKey] = useState("");
  const [loadedComparison, setComparison] = useState<UaComparison | null>(null);
  const [weighted, setWeighted] = useState(true);
  const [brands, setBrands] = useState<string[]>([]);
  const [focal, setFocal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [customise, setCustomise] = useState(false);
  const key = JSON.stringify([runId, documentId, pageId, weighted, brands, view?.revision ?? null]);
  const page = resolvedKey === key ? loadedPage : null;
  const comparison = resolvedKey === key ? loadedComparison : null;
  const workspaceReady = !!view;
  const request = useRef(key);
  useLayoutEffect(() => { request.current = key; }, [key]);
  const workspaceKey = `${runId}:${documentId}`;
  const workspaceTarget = useRef(workspaceKey);
  useLayoutEffect(() => { workspaceTarget.current = workspaceKey; }, [workspaceKey]);
  const dialog = useRef<HTMLDivElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { firstButton.current?.focus(); }, []);
  useEffect(() => {
    const key = `${runId}:${documentId}`; let active = true;
    Promise.resolve().then(() => {
      if (!active) return null;
      setView(null); setPage(null); setError(null); setNotice(null); setSaving(false); setLoading(true);
      return loadUaWorkspaceAction(runId, documentId);
    }).then(r => {
      if (!r) return;
      if (!active || workspaceTarget.current !== key) return;
      if (!r.ok) { setError(r.error); setLoading(false); return; }
      if (r.view.recognition.needsMapping) setCustomise(true);
      setView(r.view); setFocal(r.view.choices.focalBrand); setWeighted(r.view.choices.weighted);
      setBrands(r.view.choices.focalBrand && r.view.recognition.brands.some(b => b.code === r.view.choices.focalBrand) ? [r.view.choices.focalBrand, ...r.view.recognition.brands.filter(b => b.code !== r.view.choices.focalBrand).slice(0, 2).map(b => b.code)] : r.view.recognition.brands.slice(0, 3).map(b => b.code));
    }).catch(e => { if (active && workspaceTarget.current === key) { setError(String(e)); setLoading(false); } });
    return () => { active = false; };
  }, [runId, documentId]);
  useEffect(() => {
    if (!workspaceReady) return;
    let active = true; const target = key;
    Promise.resolve().then(() => {
      if (!active) return null;
      setPage(null); setComparison(null); setLoading(true); setError(null);
      return loadUaPageAction(runId, documentId, pageId, weighted, brands);
    }).then(r => {
      if (!r) return;
      if (!active || request.current !== target) return;
      setResolvedKey(target);
      if (r.ok) { setPage(r.page); setComparison(r.comparison); } else setError(r.error);
      setLoading(false);
    }).catch(e => { if (active && request.current === target) { setResolvedKey(target); setError(String(e)); setLoading(false); } });
    return () => { active = false; };
  }, [key, workspaceReady, runId, documentId, pageId, weighted, brands]);
  async function save() {
    if (!view) return;
    const target = workspaceTarget.current; setSaving(true); setNotice(null); setError(null);
    try {
      const r = await saveUaChoicesAction(runId, documentId, { scope: view.scope, revision: view.revision }, { focalBrand: focal, weighted, roleCorrections: view.choices.roleCorrections, lightUserMaximum: view.choices.lightUserMaximum });
      if (workspaceTarget.current !== target) return;
      if (!r.ok) setError(r.error);
      else if (!r.result.saved) setError(r.result.reason);
      else {
        const refreshed = await loadUaWorkspaceAction(runId, documentId);
        if (workspaceTarget.current !== target) return;
        if (!refreshed.ok) setError(`Choices saved, but reloading failed: ${refreshed.error}`);
        else { setView(refreshed.view); setNotice("Saved"); }
      }
    } catch (e) { if (workspaceTarget.current === target) setError(String(e)); }
    finally { if (workspaceTarget.current === target) setSaving(false); }
  }
  if (typeof document === "undefined") return null;
  const selectedPage = UA_PAGES.find(p => p.id === pageId)!;
  return createPortal(<div ref={dialog} className="fixed inset-0 z-50 overflow-auto bg-slate-100" role="dialog" aria-modal="true" aria-labelledby="ua-title" onKeyDown={e => {
    if (e.key === "Escape") onClose();
    if (e.key === "Tab") {
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), summary, [tabindex="0"]') ?? []).filter(x => x.getClientRects().length > 0);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }} data-testid="ua-dashboard">
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-blue-700">Research workspace</p><h2 id="ua-title" className="text-2xl font-semibold text-slate-950">Usage &amp; attitudes</h2></div><button ref={firstButton} type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">Close dashboard</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="Dashboard controls">
        <label className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Focal brand <select aria-label="Focal brand" value={focal ?? ""} onChange={e => { setFocal(e.target.value || null); setNotice(null); if (e.target.value) setBrands(b => [...new Set([e.target.value, ...b])]); }} className="ml-2 max-w-48 bg-transparent font-medium"><option value="">Choose our brand</option>{focal && view && !view.recognition.brands.some(b => b.code === focal) && <option value={focal}>Saved brand {focal}: not in this wave</option>}{view?.recognition.brands.map(b => <option key={b.code} value={b.code}>{b.label}</option>)}</select></label>
        <label className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">Wave <select aria-label="Wave" value={documentId} onChange={e => setDocumentId(e.target.value)} className="ml-2 max-w-52 bg-transparent font-medium">{!waveFiles.some(w => w.documentId === initialDocumentId) && <option value={initialDocumentId}>Current file</option>}{waveFiles.map(w => <option key={w.documentId} value={w.documentId}>{w.wave}</option>)}</select></label>
        <details className="relative rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><summary className="cursor-pointer">Compare brands ({brands.length})</summary><div className="absolute left-0 top-full z-20 mt-1 grid min-w-64 gap-2 rounded-lg border bg-white p-4 shadow-lg">{view?.recognition.brands.map(b => <label key={b.code} className="flex items-start gap-2"><input type="checkbox" checked={brands.includes(b.code)} onChange={e => setBrands(x => e.target.checked ? [...x, b.code] : x.filter(c => c !== b.code))} />{b.label}</label>)}</div></details>
        <label className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><input type="checkbox" checked={weighted} onChange={e => { setWeighted(e.target.checked); setNotice(null); }} className="mr-2" />Weighted</label>
        <span className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-slate-600" title="Claude will connect the shared raw-code segment picker">Segment: all eligible. Integration pending</span>
        <button type="button" onClick={() => setCustomise(x => !x)} className="rounded-lg border border-slate-300 px-3 py-2">Question mapping</button>
        <button type="button" disabled={saving || !view?.storageAvailable} onClick={save} className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:bg-slate-400">{saving ? "Saving..." : "Save choices"}</button>
        {notice && <span role="status" className="text-emerald-800">{notice}</span>}
      </div>
    </header>
    <div className="mx-auto grid max-w-[1600px] gap-6 px-5 py-6 lg:grid-cols-[230px_1fr]">
      <nav aria-label="U&A pages" className="space-y-1">{UA_PAGES.map((p, i) => {
        const exists = !view || view.metrics.some(m => m.page === p.id);
        return <button type="button" key={p.id} onClick={() => setPageId(p.id)} disabled={!exists} aria-current={pageId === p.id ? "page" : undefined} className={`w-full rounded-lg px-3 py-3 text-left text-sm leading-relaxed transition ${pageId === p.id ? "bg-blue-700 font-semibold text-white" : "text-slate-700 hover:bg-white"} disabled:cursor-not-allowed disabled:text-slate-400`}><span className="mr-2 font-mono text-xs">{String(i + 1).padStart(2, "0")}</span>{p.title}{!exists && <span className="block pl-6 text-xs">Not asked in this file</span>}</button>;
      })}<p className="px-3 pt-5 text-xs leading-relaxed text-slate-600">Independent cross-sections. Wave differences are descriptive; no significance claims.</p></nav>
      <main className="min-w-0"><div className="mb-5"><h3 className="text-2xl font-semibold text-slate-950">{selectedPage.title}</h3><p className="mt-1 text-sm text-slate-600">{selectedPage.description}</p></div>
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">Synthetic study. Population sizes use a fictional planning universe within one wave, never actual South African market estimates.</p>
        {!view?.storageAvailable && view && <p className="mb-3 text-sm text-amber-900">Choices are not saved: migration 0140 has not been applied.</p>}
        {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
        {customise && view && <section className="mb-5 rounded-xl border bg-white p-4"><h4 className="font-semibold">Question mapping and reasons</h4><p className="mt-1 text-sm text-slate-600">Definitions come from confirmed codebook questions, raw codes, field rules and response states. Resolve an ambiguous role before relying on its figures. Save choices to apply mapping edits.</p>{view.recognition.questions.map(q => <label key={q.role} className="mt-3 block text-sm">{q.role}: {q.reason}<select aria-label={`Question for ${q.role}`} value={view.choices.roleCorrections[q.role] ?? ""} onChange={e => { setNotice(null); setView(v => v ? { ...v, choices: { ...v.choices, roleCorrections: { ...v.choices.roleCorrections, [q.role]: e.target.value || null } } } : v); }} className="mt-1 block max-w-full rounded border p-2"><option value="">Not mapped</option>{view.recognition.fields.filter(f => f.meta.stateVariable && !/response-state/i.test(f.meta.fieldRole ?? "")).map(f => <option key={f.variable} value={f.variable}>{f.questionId}: {f.label} ({f.variable})</option>)}</select></label>)}<label className="mt-3 block text-sm">Light-user maximum P3M occasions <input type="number" min={1} max={10000} aria-label="Light-user maximum P3M occasions" value={view.choices.lightUserMaximum ?? ""} onChange={e => { setNotice(null); setView(v => v ? { ...v, choices: { ...v.choices, lightUserMaximum: e.target.value ? Number(e.target.value) : null } } : v); }} className="ml-2 w-24 rounded border p-2" /></label><details className="mt-3 text-xs text-slate-600"><summary>Recognition evidence</summary><ul>{view.recognition.reasons.map(r => <li className="mt-2" key={r}>{r}</li>)}</ul></details></section>}
        {loading && <p role="status" className="rounded-xl border bg-white p-6 text-slate-600">Reading eligible and answered bases...</p>}
        {comparison && <p className="mb-4 text-xs text-slate-600">{comparison.status === "ok" ? `Changes are percentage points since ${comparison.wave}, from unrounded values. Different people were interviewed.` : `Previous-wave change unavailable: ${comparison.reason}`}</p>}
        {page && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{page.metrics.map(({ spec, result }) => <article key={spec.id} className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="ua-metric" data-metric-label={spec.label}>
          <h4 className="text-sm font-semibold leading-relaxed text-slate-800">{spec.label}</h4><p className="mt-3 text-3xl font-semibold tabular-nums text-slate-950">{result.value === null ? "Not available" : `${number(result.value, spec.kind === "mean" ? 2 : 1)}${spec.unit === "percent" ? "%" : ""}`}</p>
          {spec.unit !== "percent" && <p className="text-xs text-slate-600">{spec.unit}</p>}
          {comparison?.status === "ok" && comparison.changes[spec.id] != null && <p className="mt-1 text-xs text-slate-700">{number(comparison.changes[spec.id]!)} points since previous wave</p>}
          {result.value !== null && spec.unit === "percent" && <div className="mt-3 h-1.5 overflow-hidden rounded bg-blue-50" aria-hidden="true"><div className="h-full rounded bg-blue-600" style={{ width: `${Math.max(0, Math.min(100, result.value))}%` }} /></div>}
          <dl className="mt-4 grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-slate-600"><dt>Eligible raw n</dt><dd className="text-right tabular-nums">{number(result.eligibleBase.n, 0)}</dd><dt>Eligible weighted base</dt><dd className="text-right tabular-nums">{number(result.eligibleBase.w)}</dd><dt>Eligible Kish base</dt><dd className="text-right tabular-nums">{number(result.eligibleBase.nEff)}</dd><dt>Valid raw n</dt><dd className="text-right tabular-nums">{number(result.validBase.n, 0)}</dd><dt>Weighted valid base</dt><dd className="text-right tabular-nums">{number(result.validBase.w)}</dd><dt>Kish effective base</dt><dd className="text-right tabular-nums">{number(result.validBase.nEff)}</dd></dl>
          {spec.assigned && <p className="mt-2 text-xs text-slate-600">Assigned raw n {number(result.assignedBase.n, 0)}; weighted {number(result.assignedBase.w)}; Kish {number(result.assignedBase.nEff)}</p>}
          {!!result.quotes?.length && <ul className="mt-3 space-y-2 text-sm text-slate-700">{result.quotes.map(q => <li key={q.row}><blockquote>{q.text}</blockquote><span className="text-xs text-slate-500">Source data row {q.row}{q.truncated ? "; excerpt limited to 2,000 characters" : ""}</span></li>)}</ul>}
          {result.reason && <p className="mt-2 text-xs text-amber-900">{result.reason}</p>}{spec.note && <p className="mt-2 text-xs text-slate-600">{spec.note}</p>}
          <details className="mt-auto pt-3 text-xs text-slate-600"><summary className="cursor-pointer">Evidence and base</summary><p className="mt-2 break-words leading-relaxed">{spec.reason}</p><p className="mt-2">Period: {spec.period}. Variable: {spec.variable}. {(spec.weightVar ?? page.weightVar) ? `Weight: ${spec.weightVar ?? page.weightVar}.` : "Unweighted."} {result.designApplied ? "Survey design applied." : "No survey-design variance applied."}</p></details>
        </article>)}</div>}
        {!!page?.unavailable.length && <details className="mt-5 rounded-xl border bg-white p-4 text-sm text-slate-700"><summary>Measures needing a question or a rule ({page.unavailable.length})</summary><ul>{page.unavailable.map((m, i) => <li key={`${m.label}:${i}`} className="mt-3"><strong>{m.label}:</strong> {m.reason}</li>)}</ul></details>}
      </main>
    </div>
  </div>, document.body);
}
