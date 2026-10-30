"use client";

// The brand dashboard extension's Variables selector (Grant's guide of 30 October 2026: "a collapsible Variables
// selector on the left"): each detected construct with its status (Found, Needs review, Not measured), and on opening
// it the question, source fields, answer labels, universe, denominator and the evidence that decided it. A construct
// in review offers its candidates for a targeted confirmation; nothing else asks for one. The brands shown, the
// weighting and the audience are chosen here too. This component only shows and asks: the confirmation is saved by
// the page (BrandExtensionViews.tsx) through the server, and "Saved" is shown only after the save succeeds.
import { useState } from "react";
import type { ExtensionDiagnostics } from "@/lib/brandExtension";
import type { ExtensionConstruct } from "@/lib/brandExtensionRoles";

const STATUS_TEXT: Record<ExtensionDiagnostics["status"], string> = { found: "Found", needs_review: "Needs review", not_measured: "Not measured" };
const STATUS_CLASS: Record<ExtensionDiagnostics["status"], string> = {
  found: "border-emerald-200 bg-emerald-50 text-emerald-800",
  needs_review: "border-amber-300 bg-amber-50 text-amber-900",
  not_measured: "border-slate-200 bg-slate-50 text-slate-600",
};

export type SelectorSave = { state: "idle" } | { state: "saving"; construct: ExtensionConstruct } | { state: "saved"; construct: ExtensionConstruct } | { state: "error"; text: string };

export default function VariablesSelector({
  diagnostics,
  brands,
  shownBrands,
  onBrands,
  weighted,
  canWeight,
  onWeighted,
  audienceOptions,
  audience,
  onAudience,
  storageAvailable,
  save,
  onConfirm,
}: {
  diagnostics: ExtensionDiagnostics[];
  brands: { code: string; label: string }[];
  shownBrands: string[];
  onBrands: (codes: string[]) => void;
  weighted: boolean;
  canWeight: boolean;
  onWeighted: (weighted: boolean) => void;
  audienceOptions: { variable: string; label: string; answers: { code: string; label: string }[] }[];
  audience: { variable: string; code: string } | null;
  onAudience: (a: { variable: string; code: string } | null) => void;
  storageAvailable: boolean;
  save: SelectorSave;
  onConfirm: (construct: ExtensionConstruct, choice: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<ExtensionConstruct | null>(null);
  const [choice, setChoice] = useState<Partial<Record<ExtensionConstruct, string>>>({});
  const [audienceVar, setAudienceVar] = useState<string>(audience?.variable ?? "");
  const selectedAudience = audienceOptions.find((o) => o.variable === audienceVar) ?? null;

  if (!open)
    return (
      <aside className="shrink-0" aria-label="Variables" data-testid="ext-variables" data-open="false">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex h-full min-h-[3rem] items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-3 text-xs font-semibold text-slate-700 hover:border-blue-300 [writing-mode:vertical-rl] max-lg:[writing-mode:horizontal-tb]"
          data-testid="ext-variables-toggle"
        >
          Variables
        </button>
      </aside>
    );
  return (
    <aside className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-4 lg:w-80" aria-label="Variables" data-testid="ext-variables" data-open="true">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">Variables</h3>
        <button type="button" onClick={() => setOpen(false)} aria-expanded={true} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" data-testid="ext-variables-toggle">
          Hide
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">Detected from wording, answer labels, sets and routing. Variable names are hints only.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {diagnostics.map((d) => {
          const isOpen = expanded === d.construct;
          return (
            <li key={d.construct} className="rounded-xl border border-slate-200" data-testid="ext-construct" data-construct={d.construct} data-status={d.status}>
              <button type="button" onClick={() => setExpanded(isOpen ? null : d.construct)} aria-expanded={isOpen} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm">
                <span className="font-medium text-slate-800">{d.title}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${STATUS_CLASS[d.status]}`}>{STATUS_TEXT[d.status]}</span>
              </button>
              {isOpen && (
                <div className="border-t border-slate-100 px-3 py-2 text-xs text-slate-600" data-testid="ext-construct-details">
                  {d.reason && <p className="mb-2 text-slate-700">{d.reason}</p>}
                  {d.question && (
                    <p>
                      <span className="font-semibold text-slate-700">Question: </span>
                      {d.question}
                    </p>
                  )}
                  {d.sourceFields.length > 0 && (
                    <p className="mt-1 break-words">
                      <span className="font-semibold text-slate-700">Source fields: </span>
                      {d.sourceFields.join(", ")}
                    </p>
                  )}
                  {d.valueLabels.slice(0, 2).map((v) => (
                    <div key={v.variable} className="mt-1">
                      <span className="font-semibold text-slate-700">Answers ({v.variable}): </span>
                      {v.labels.map((l) => `${l.code} ${l.label}`).join("; ")}
                    </div>
                  ))}
                  <p className="mt-1">
                    <span className="font-semibold text-slate-700">Universe: </span>
                    {d.universe}
                  </p>
                  <p className="mt-1">
                    <span className="font-semibold text-slate-700">Denominator: </span>
                    {d.denominator}
                  </p>
                  {d.evidence.length > 0 && (
                    <ul className="mt-1 list-disc pl-4">
                      {d.evidence.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {d.confirmed && (
                    <p className="mt-1 text-slate-500" data-testid="ext-confirmed">
                      Confirmed{d.confirmed.by ? ` by ${d.confirmed.by}` : ""} on {d.confirmed.at.slice(0, 10)}.
                    </p>
                  )}
                  {d.status === "needs_review" && (
                    <fieldset className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2" data-testid="ext-confirm">
                      <legend className="px-1 text-[11px] font-semibold text-amber-900">Confirm which question this is</legend>
                      {d.candidates.map((c) => (
                        <label key={c.key} className="mt-1 flex items-start gap-2">
                          <input type="radio" name={`ext-${d.construct}`} value={c.key} checked={choice[d.construct] === c.key} onChange={() => setChoice((x) => ({ ...x, [d.construct]: c.key }))} />
                          <span>{c.description}</span>
                        </label>
                      ))}
                      <label className="mt-1 flex items-start gap-2">
                        <input type="radio" name={`ext-${d.construct}`} value="not_measured" checked={choice[d.construct] === "not_measured"} onChange={() => setChoice((x) => ({ ...x, [d.construct]: "not_measured" }))} />
                        <span>This file does not measure it</span>
                      </label>
                      <button
                        type="button"
                        disabled={!storageAvailable || !choice[d.construct] || save.state === "saving"}
                        onClick={() => onConfirm(d.construct, choice[d.construct]!)}
                        className="mt-2 rounded-md bg-[#2563eb] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                      >
                        {save.state === "saving" && save.construct === d.construct ? "Saving..." : "Confirm"}
                      </button>
                      {!storageAvailable && <p className="mt-1 text-[11px] text-amber-900">Confirmations cannot be saved until the database has migration 0140.</p>}
                      {save.state === "saved" && save.construct === d.construct && (
                        <p className="mt-1 text-[11px] text-emerald-700" role="status">
                          Saved
                        </p>
                      )}
                    </fieldset>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {save.state === "error" && (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800" role="alert">
          {save.text}
        </p>
      )}

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Brands</h4>
      <ul className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-xs" data-testid="ext-brand-items">
        {brands.map((b) => (
          <li key={b.code}>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shownBrands.includes(b.code)}
                onChange={(e) => onBrands(e.target.checked ? brands.map((x) => x.code).filter((c) => c === b.code || shownBrands.includes(c)) : shownBrands.filter((c) => c !== b.code))}
              />
              <span className="truncate">{b.label}</span>
            </label>
          </li>
        ))}
      </ul>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Weighting</h4>
      <div className="mt-1 flex gap-1.5 text-xs" role="group" aria-label="Weighting">
        <button type="button" aria-pressed={weighted} disabled={!canWeight} onClick={() => onWeighted(true)} className={`rounded-md border px-2.5 py-1 ${weighted ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200"} disabled:opacity-50`}>
          Weighted
        </button>
        <button type="button" aria-pressed={!weighted} onClick={() => onWeighted(false)} className={`rounded-md border px-2.5 py-1 ${!weighted ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200"}`}>
          Unweighted
        </button>
      </div>

      <h4 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Audience</h4>
      <div className="mt-1 flex flex-col gap-1.5 text-xs">
        <select aria-label="Audience question" value={audienceVar} onChange={(e) => { setAudienceVar(e.target.value); if (!e.target.value) onAudience(null); }} className="rounded-md border border-slate-200 px-2 py-1" data-testid="ext-audience-question">
          <option value="">All respondents</option>
          {audienceOptions.map((o) => (
            <option key={o.variable} value={o.variable}>
              {o.label}
            </option>
          ))}
        </select>
        {selectedAudience && (
          <select aria-label="Audience answer" value={audience?.variable === selectedAudience.variable ? audience.code : ""} onChange={(e) => onAudience(e.target.value ? { variable: selectedAudience.variable, code: e.target.value } : null)} className="rounded-md border border-slate-200 px-2 py-1" data-testid="ext-audience-answer">
            <option value="">Choose an answer</option>
            {selectedAudience.answers.map((a) => (
              <option key={a.code} value={a.code}>
                {a.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </aside>
  );
}
