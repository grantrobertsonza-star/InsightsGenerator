"use client";

// R5 segment (Grant, 30 October 2026: "we need a filter up here, so the user can filter on a segment (age, gender,
// etc.)"): the Segment chip and its picker, on the brand dashboard and (R5 CSM segment, Grant 30 October 2026: "CSM
// needs a segment tool as well") on the CSM dashboard. The researcher picks profile questions (the list the
// server sends, trackerSegment.segmentQuestionsOf) and, within each, answers by code; answers of one question are
// alternatives (or), questions all hold (and). Apply hands the segment to the dashboard, which loads every page with
// it; the server checks it against the file and computes every figure on it. Labels are shown; codes are sent.
//
// Remembered per browser (useStoredSegment), for each project and dashboard: a segment is a way of viewing the
// figures, like the brands compared, not a configuration of the dashboard for everyone on the programme, so it is
// not saved with the programme's choices. Storage that cannot be read or written leaves the dashboard on all eligible
// respondents (the chip says so) and never blocks it.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Segment, SegmentQuestion } from "@/lib/trackerSegment";

const storageKey = (runId: string, kind: string) => `tracker-segment:${runId}:${kind}`;

/** A segment in one canonical form (questions by variable name, codes sorted), for comparing and for cache keys. */
export function segmentKey(segment: Segment | null): string {
  if (!segment || segment.questions.length === 0) return "all";
  const norm = [...segment.questions]
    .map((q) => ({ variable: q.variable, codes: [...new Set(q.codes)].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b)) }))
    .sort((a, b) => a.variable.localeCompare(b.variable));
  return JSON.stringify(norm);
}

function readStored(runId: string, kind: string): Segment | null {
  try {
    const raw = window.localStorage.getItem(storageKey(runId, kind));
    if (!raw) return null;
    const v = JSON.parse(raw) as Segment;
    return v && Array.isArray(v.questions) && v.questions.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** The dashboard's segment, remembered in this browser for the project and dashboard kind (the brand and CSM dashboards
 * each keep their own: `tracker-segment:<runId>:brand`, `tracker-segment:<runId>:csm`, R5 CSM segment). */
export function useStoredSegment(runId: string, kind: "brand" | "csm"): [Segment | null, (s: Segment | null) => void] {
  const [segment, setSegment] = useState<Segment | null>(() => (typeof window !== "undefined" ? readStored(runId, kind) : null));
  const set = (s: Segment | null) => {
    const next = s && s.questions.length > 0 ? s : null;
    // The same segment applied again keeps the one in use, so the pages are not computed again for nothing.
    setSegment((now) => (segmentKey(now) === segmentKey(next) ? now : next));
    try {
      if (next) window.localStorage.setItem(storageKey(runId, kind), JSON.stringify(next));
      else window.localStorage.removeItem(storageKey(runId, kind));
    } catch {
      // Not remembered in this browser; the dashboard still uses it now.
    }
  };
  return [segment, set];
}

/** The chip's short text: each question's chosen answers by their labels ("Woman; 25-34 or 35-49"). */
export function segmentSummary(segment: Segment | null, questions: SegmentQuestion[]): string {
  if (!segment || segment.questions.length === 0) return "All eligible";
  return segment.questions
    .map((s) => {
      const q = questions.find((x) => x.variable === s.variable);
      return s.codes.map((c) => q?.answers.find((a) => a.code === c)?.label ?? `${s.variable} ${c}`).join(" or ");
    })
    .join("; ");
}

export function SegmentChip({ questions, segment, onApply }: { questions: SegmentQuestion[]; segment: Segment | null; onApply: (s: Segment | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string[]>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  function openPicker() {
    // The draft starts from the segment in use; nothing changes until Apply.
    const d: Record<string, string[]> = {};
    for (const q of segment?.questions ?? []) d[q.variable] = [...q.codes];
    setDraft(d);
    setFocus(segment?.questions[0]?.variable ?? questions[0]?.variable ?? null);
    setOpen((v) => !v);
  }
  const toggle = (variable: string, code: string) =>
    setDraft((d) => {
      const now = d[variable] ?? [];
      return { ...d, [variable]: now.includes(code) ? now.filter((c) => c !== code) : [...now, code] };
    });
  function apply(next: Segment | null) {
    onApply(next);
    setOpen(false);
  }
  const chosen: Segment = {
    questions: questions.filter((q) => (draft[q.variable] ?? []).length > 0).map((q) => ({ variable: q.variable, codes: q.answers.map((a) => a.code).filter((c) => draft[q.variable].includes(c)) })),
  };
  const current = questions.find((q) => q.variable === focus) ?? null;
  const summary = segmentSummary(segment, questions);

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={openPicker}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`max-w-[22rem] truncate rounded-lg border px-3.5 py-2 text-left text-sm hover:border-blue-300 ${segment ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"}`}
        title={summary}
        data-testid="tracker-segment-chip"
      >
        <span className="text-slate-500">Segment</span> <span className="font-medium text-slate-900">{summary}</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Segment" className="absolute left-0 top-full z-20 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-4 shadow-lg" data-testid="tracker-segment-picker">
          <p className="text-sm font-semibold text-slate-900">Segment</p>
          <p className="mt-0.5 text-xs text-slate-500">Every page and figure is calculated on the respondents in the segment. Answers of one question: any of them. Several questions: all of them. A respondent who did not answer a question is outside the segment.</p>
          {questions.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No profile question (age, gender, income and the like, asked once with an answer list) was found in this file.</p>
          ) : (
            <div className="mt-3 grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3">
              <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto" aria-label="Profile questions">
                {questions.map((q) => {
                  const n = (draft[q.variable] ?? []).length;
                  return (
                    <li key={q.variable}>
                      <button
                        type="button"
                        onClick={() => setFocus(q.variable)}
                        aria-current={focus === q.variable ? "true" : undefined}
                        className={`flex w-full items-baseline justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm ${focus === q.variable ? "bg-blue-50 font-medium text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
                        data-testid="tracker-segment-question"
                        data-variable={q.variable}
                      >
                        <span className="truncate" title={`${q.label} (${q.variable})`}>{q.label}</span>
                        {n > 0 && <span className="shrink-0 rounded-full bg-blue-600 px-1.5 text-[10px] font-semibold text-white">{n}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <fieldset className="max-h-64 overflow-y-auto rounded-md border border-slate-100 p-2">
                {current && (
                  <>
                    <legend className="px-1 text-xs font-medium text-slate-500">{current.label}</legend>
                    {current.answers.map((a) => (
                      <label key={a.code} className="flex items-center gap-2 rounded px-1 py-1 text-sm text-slate-800 hover:bg-slate-50">
                        <input type="checkbox" checked={(draft[current.variable] ?? []).includes(a.code)} onChange={() => toggle(current.variable, a.code)} data-testid="tracker-segment-answer" data-code={a.code} />
                        {a.label}
                      </label>
                    ))}
                  </>
                )}
              </fieldset>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="truncate text-xs text-slate-500" data-testid="tracker-segment-draft">{segmentSummary(chosen, questions)}</p>
            <div className="flex shrink-0 gap-2">
              <button type="button" onClick={() => apply(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="tracker-segment-clear">
                Clear
              </button>
              <button type="button" onClick={() => apply(chosen.questions.length > 0 ? chosen : null)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700" data-testid="tracker-segment-apply">
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The base line under a card's title while a segment is applied: the segment and its unweighted n on this page. */
export function SegmentBaseLine({ text, n, effectiveBase }: { text: string; n: number | null; effectiveBase: number | null }) {
  return (
    <p className="mt-0.5 text-xs font-medium text-blue-800" data-testid="tracker-segment-base">
      Segment: {text}; n={n === null ? "n/a" : n.toLocaleString()}
      {effectiveBase !== null ? `, effective base ${Math.round(effectiveBase)}` : ""}. Every figure and base on this card is within the segment.
    </p>
  );
}

/** The segment reading of the page shown (its loader's `segment`), for every card's base line; null on all eligible. */
export const SegmentBaseContext = createContext<{ text: string; n: number | null; effectiveBase: number | null } | null>(null);

/** A card's segment base line, when a segment is applied to the page it is on. */
export function CardSegmentBase() {
  const s = useContext(SegmentBaseContext);
  return s ? <SegmentBaseLine text={s.text} n={s.n} effectiveBase={s.effectiveBase} /> : null;
}
