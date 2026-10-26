"use client";

import { useEffect, useRef, useState } from "react";
import { loadEvidenceTrailAction } from "@/lib/evidenceTrailActions";
import type { EvidenceTrail, TrailNode, TrailNodeKind } from "@/lib/evidenceTrail";

const KIND: Record<TrailNodeKind, { label: string; accent: string }> = {
  passage: { label: "Brief passage", accent: "bg-fuchsia-600" },
  objective: { label: "Objective", accent: "bg-violet-600" },
  decision: { label: "Decision", accent: "bg-indigo-600" },
  recommendation: { label: "Recommendation", accent: "bg-primary" },
  insight: { label: "Insight", accent: "bg-sky-600" },
  pre_insight: { label: "Pre-insight", accent: "bg-cyan-600" },
  finding: { label: "Finding", accent: "bg-teal-600" },
  data: { label: "Data point", accent: "bg-emerald-600" },
  source: { label: "Source", accent: "bg-slate-500" },
};
const STATE_BOX = {
  current: "border-border bg-white",
  caution: "border-amber-300 bg-amber-50",
  broken: "border-dashed border-red-300 bg-red-50",
} as const;
const STATE_WORD = { current: null, caution: "Check", broken: "Break in the trail" } as const;

/**
 * The evidence trail of one recommendation as a tree (CE-5, Grant, 26 October 2026): what it is for
 * (the decisions it serves, the objectives it answers) above it, and beneath it the insight, the
 * pre-insights, findings, data points and source files it rests on. Every node is a stored link
 * (evidenceTrail.ts); a link that is missing, out of date or no longer valid is shown as such, dashed,
 * so a break in the trail is visible rather than hidden. Read when opened; a late answer for another
 * recommendation is dropped.
 */
export default function EvidenceTrailDialog({ runId, recommendationId, onClose }: { runId: string; recommendationId: string; onClose: () => void }) {
  const [trail, setTrail] = useState<EvidenceTrail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const token = ++latest.current;
    void loadEvidenceTrailAction(runId, recommendationId)
      .then((r) => {
        if (token !== latest.current) return;
        if (r.ok) setTrail(r.trail);
        else setError(r.error);
      })
      .catch((e: unknown) => {
        if (token === latest.current) setError(e instanceof Error ? e.message : "The evidence trail could not be read.");
      });
    dialog.current?.focus();
    return () => {
      latest.current += 1;
    };
  }, [runId, recommendationId]);

  const breaks = trail ? countBroken([...trail.purpose, trail.root]) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Evidence trail"
        tabIndex={-1}
        data-testid="evidence-trail"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
        className="my-8 w-full max-w-4xl rounded-2xl border border-border bg-surface p-5 shadow-xl outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">Evidence trail</h2>
            <p className="mt-1 max-w-2xl text-xs text-muted">
              What this recommendation is for, and every step of evidence beneath it, from stored links only. A dashed step is a
              break in the trail: not recorded, out of date, or no longer valid.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-white">
            Close
          </button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            The evidence trail could not be read: {error}
          </p>
        )}
        {!trail && !error && <p className="text-sm text-muted">Reading the trail...</p>}
        {trail && (
          <div className="space-y-4">
            <p className="text-xs text-muted" data-testid="trail-breaks">
              {breaks === 0 ? "No breaks in the trail." : `${breaks} ${breaks === 1 ? "break" : "breaks"} in the trail.`}
            </p>
            <section aria-label="What it is for">
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">What it is for</h3>
              <div className="grid gap-2 sm:grid-cols-2" data-testid="trail-purpose">
                {trail.purpose.map((n, i) => (
                  <div key={`${n.kind}-${n.id ?? i}`} className="space-y-1.5">
                    <NodeCard node={n} />
                    {n.children.map((c, j) => (
                      <div key={j} className="ml-4 border-l border-slate-300 pl-3">
                        <NodeCard node={c} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
            <div className="flex justify-center text-muted" aria-hidden>
              <svg width="16" height="20" viewBox="0 0 16 20" fill="none"><path d="M8 0v16m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.5" /></svg>
            </div>
            <section aria-label="Evidence">
              <ul className="space-y-2" data-testid="trail-tree">
                <TreeItem node={trail.root} />
              </ul>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function countBroken(nodes: TrailNode[]): number {
  return nodes.reduce((n, x) => n + (x.state === "broken" ? 1 : 0) + countBroken(x.children), 0);
}

function TreeItem({ node }: { node: TrailNode }) {
  // Open to the source by default (Grant: "we can easily trace out steps"); each step folds.
  const [open, setOpen] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <li className="relative">
      <div className="flex items-start gap-2">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label={open ? `Fold ${KIND[node.kind].label}` : `Unfold ${KIND[node.kind].label}`}
            className="mt-2 h-5 w-5 shrink-0 rounded border border-border bg-white text-xs leading-none text-muted hover:text-foreground"
          >
            {open ? "−" : "+"}
          </button>
        ) : (
          <span className="mt-2 h-5 w-5 shrink-0" aria-hidden />
        )}
        <NodeCard node={node} />
      </div>
      {hasChildren && open && (
        <ul className="ml-[9px] mt-2 space-y-2 border-l border-slate-300 pl-5">
          {node.children.map((c, i) => (
            <TreeItem key={`${c.kind}-${c.id ?? i}`} node={c} />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeCard({ node }: { node: TrailNode }) {
  const kind = KIND[node.kind];
  const word = STATE_WORD[node.state];
  return (
    <div className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${STATE_BOX[node.state]}`} data-kind={node.kind} data-state={node.state}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${kind.accent}`} aria-hidden />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">{kind.label}</span>
        {word && <span className={`text-[10px] font-semibold uppercase tracking-wide ${node.state === "broken" ? "text-red-700" : "text-amber-800"}`}>{word}</span>}
      </div>
      <p className="mt-1 text-sm text-foreground">{node.label}</p>
      {node.details.length > 0 && <p className="mt-1 text-xs text-muted">{node.details.join(" · ")}</p>}
      {node.note && <p className="mt-1 text-xs text-foreground/80">{node.note}</p>}
    </div>
  );
}
