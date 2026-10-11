"use client";

import { useEffect, useState } from "react";
import {
  editObjectiveEvidenceAction,
  evaluateObjectiveEvidenceAction,
  generateObjectiveEvidenceAction,
  loadObjectiveEvidenceAction,
  retryObjectiveEvidenceAction,
} from "@/lib/objectiveEvidenceActions";
import type { EvidenceQuestion, ItemEvidence } from "@/lib/objectiveEvidence";

type Stance = "supports" | "against" | "mixed" | "inconclusive" | "silent";
const label: Record<Stance, string> = {
  supports: "Supports",
  against: "Against",
  mixed: "Mixed",
  inconclusive: "Inconclusive",
  silent: "Data silent",
};
const style: Record<Stance, string> = {
  supports: "bg-green-50 text-green-800 ring-green-200",
  against: "bg-red-50 text-red-800 ring-red-200",
  mixed: "bg-amber-50 text-amber-800 ring-amber-200",
  inconclusive: "bg-slate-100 text-slate-700 ring-slate-200",
  silent: "bg-slate-50 text-slate-500 ring-slate-200",
};
const btn =
  "whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60";

function Pill({ stance }: { stance: Stance }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style[stance]}`}>{label[stance]}</span>;
}

export default function ObjectiveEvidence({
  runId,
  dataFiles,
  hasObjectiveOrDecision,
}: {
  runId: string;
  dataFiles: { id: string; name: string }[];
  hasObjectiveOrDecision: boolean;
}) {
  const [items, setItems] = useState<ItemEvidence[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", request_text: "", supports_if: "", against_if: "" });

  async function refresh() {
    const r = await loadObjectiveEvidenceAction(runId);
    if (r.ok) setItems(r.items);
    else setError(r.error);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /** One click does it all: write the questions, then answer them two at a time until none remain. */
  async function gather() {
    setError(null);
    setNote(null);
    setBusy("Writing the evidence questions...");
    const g = await generateObjectiveEvidenceAction(runId);
    if (!g.ok) {
      setError(g.error);
      setBusy(null);
      return;
    }
    if (g.skippedInferred > 0) setNote(`${g.skippedInferred} inferred objective(s) skipped: reading the data against them would be circular.`);
    await refresh();
    await answerRest();
  }

  async function answerRest() {
    for (let guard = 0; guard < 60; guard++) {
      setBusy("Reading the data...");
      const e = await evaluateObjectiveEvidenceAction(runId);
      if (!e.ok) {
        setError(e.error);
        break;
      }
      await refresh();
      if (e.remaining === 0 || e.done === 0) break;
    }
    setBusy(null);
  }

  async function save(q: EvidenceQuestion) {
    const r = await editObjectiveEvidenceAction(runId, q.id, draft);
    if (!r.ok) setError(r.error);
    setEditing(null);
    await refresh();
    await answerRest();
  }

  async function toggle(q: EvidenceQuestion) {
    await editObjectiveEvidenceAction(runId, q.id, { excluded: !q.excluded });
    await refresh();
  }

  async function retry(id?: string) {
    await retryObjectiveEvidenceAction(runId, id);
    await refresh();
    await answerRest();
  }

  if (dataFiles.length === 0) return null;
  const total = items.reduce((n, i) => n + i.questions.length, 0);
  const failed = items.flatMap((i) => i.questions).filter((q) => q.error && !q.excluded).length;

  return (
    <div className="mb-6 max-w-3xl space-y-4 rounded-xl border border-border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Evidence from the data</h3>
          <p className="mt-1 text-xs text-muted">
            Each objective is broken into a few questions the data file can answer. A table is built for each and
            read as support for, against, or silent on the objective. No significance flag is needed: a level, a
            share, or a gap between groups all count. The questions are written before any table is seen, and you
            can edit or drop any of them. Every question is put to each data file in the project and the answers are
            combined: where files disagree the result is mixed, and a file without the variable is silent.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-xs text-muted">
            {dataFiles.length} data file{dataFiles.length === 1 ? "" : "s"}
          </span>
          <button className={btn} disabled={busy !== null || !hasObjectiveOrDecision} onClick={() => void gather()}>
            {busy ?? (total > 0 ? "Gather again" : "Gather evidence")}
          </button>
        </div>
      </div>
      {!hasObjectiveOrDecision && <p className="text-xs text-muted">Add a research objective or decision first.</p>}
      {note && <p className="text-xs text-muted">{note}</p>}

      {items.map((it) => (
        <div key={`${it.item_kind}-${it.item_order}`} className="rounded-lg border border-border p-3">
          <div className="flex items-center gap-2">
            <Pill stance={it.stance} />
            <span className="text-xs uppercase tracking-wide text-muted">{it.item_kind}</span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-foreground">{it.item_text}</p>
          <ul className="mt-2 space-y-2">
            {it.questions.map((q) => (
              <li key={q.id} className={`rounded border border-border/70 p-2 text-sm ${q.excluded ? "opacity-50" : ""}`}>
                {editing === q.id ? (
                  <div className="space-y-1.5">
                    {(["question", "request_text", "supports_if", "against_if"] as const).map((k) => (
                      <label key={k} className="block text-xs text-muted">
                        {{ question: "Question", request_text: "Table to build", supports_if: "Supports if", against_if: "Against if" }[k]}
                        <input
                          className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm text-foreground"
                          value={draft[k]}
                          onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                        />
                      </label>
                    ))}
                    <div className="flex gap-2">
                      <button className={btn} onClick={() => void save(q)}>Save and re-read</button>
                      <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {q.stance ? <Pill stance={q.stance} /> : <span className="text-xs text-muted">{q.error ? "Could not be answered" : "Not read yet"}</span>}
                      {q.results.length > 1 && q.stance && <span className="text-xs text-muted">all files combined</span>}
                      {q.source !== "auto" && <span className="text-xs text-muted">{q.source}</span>}
                    </div>
                    <p className="mt-1 text-foreground">{q.question}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      Table: {q.request_text}. Supports if {q.supports_if || "n/a"}. Against if {q.against_if || "n/a"}.
                    </p>
                    {q.results.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {q.results.map((x) => (
                          <li key={x.document_id} className="text-sm text-muted">
                            <span className="mr-1.5 text-xs font-medium text-foreground">{x.dataset_name}</span>
                            {x.stance ? <Pill stance={x.stance} /> : <span className="text-xs text-red-700">could not be answered</span>}
                            {x.basis === "judged" && <span className="ml-1.5 text-xs">judged by the model</span>}
                            {x.summary && <span className="mt-0.5 block">{x.summary}</span>}
                            {x.error && <span className="mt-0.5 block text-xs text-red-700">{x.error}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-1.5 flex gap-3 text-xs">
                      <button
                        className="text-muted underline"
                        onClick={() => {
                          setEditing(q.id);
                          setDraft({ question: q.question, request_text: q.request_text, supports_if: q.supports_if, against_if: q.against_if });
                        }}
                      >
                        Edit
                      </button>
                      <button className="text-muted underline" onClick={() => void toggle(q)}>
                        {q.excluded ? "Include" : "Leave out"}
                      </button>
                      {q.error && (
                        <button className="text-muted underline" onClick={() => void retry(q.id)}>
                          Try again
                        </button>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {total === 0 && !busy && <p className="text-sm text-muted">Not gathered yet.</p>}
      {failed > 0 && !busy && (
        <button className={btn} onClick={() => void retry()}>
          Try the {failed} failed question{failed === 1 ? "" : "s"} again
        </button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-muted">
        Intervals are 95% normal approximations and are not corrected for the number of questions, so a stance is
        evidence to weigh, not a verdict. Data silent means the file cannot speak to it, which is itself a result.
      </p>
    </div>
  );
}
