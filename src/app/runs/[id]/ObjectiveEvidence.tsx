"use client";

import EvidenceTable from "./EvidenceTable";
import { sameObjective, useObjectiveSelection } from "./ObjectiveSelection";
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


/** The candidate id this evidence item is linked to, when it has one (see objectiveEvidence.ts). */
function itemCandidateId(it: ItemEvidence): string | null {
  return it.item_kind === "objective" ? it.objective_candidate_id : it.decision_candidate_id;
}

function Pill({ stance }: { stance: Stance }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style[stance]}`}>{label[stance]}</span>;
}

type SelectedObjective = Parameters<typeof sameObjective>[0];

/**
 * OBJ-REV-001/002 Rule B: splits the listing into groups that belong to a current objective or
 * decision and orphaned groups (rollUp's `orphaned`). Only current groups take part in the
 * selected-objective filter, so sameObjective's text fallback can never place an orphan - a deleted
 * candidate's or unknown-origin evidence - under a current objective with the same wording.
 */
export function partitionEvidenceItems(items: ItemEvidence[], selected: SelectedObjective) {
  const current = items.filter((it) => !it.orphaned);
  const orphans = items.filter((it) => it.orphaned);
  const shown = current.filter((it) => !selected || sameObjective(selected, { id: itemCandidateId(it), text: it.item_text }));
  return { shown, orphans, noneForSelected: Boolean(selected) && current.length > 0 && shown.length === 0 };
}

/** Why an orphaned group is not attached, in the researcher's terms. */
export function orphanReason(it: ItemEvidence): string {
  switch (it.identity) {
    case "deleted":
      return "Its objective or decision was removed.";
    case "unknown":
      return "Origin unknown: written before evidence origin was recorded, so it is not matched to any current objective.";
    case "conflict":
      return "Its stored link is inconsistent, so it is not matched to any objective.";
    case "linked":
      return "Its objective or decision is no longer accepted.";
    case "text":
      return "No current objective has this wording in this position.";
  }
}

type GroupHandlers = {
  runId: string;
  editing: string | null;
  draft: { question: string; request_text: string; supports_if: string; against_if: string };
  onDraft: (draft: { question: string; request_text: string; supports_if: string; against_if: string }) => void;
  onStartEdit: (q: EvidenceQuestion) => void;
  onCancelEdit: () => void;
  onSave: (q: EvidenceQuestion) => void;
  onToggle: (q: EvidenceQuestion) => void;
  onRetry: (id?: string) => void;
};

/**
 * The evidence groups: current ones (filtered by the selected objective), the "no evidence for this
 * objective" line, the migration-0095 notice, and the separate orphaned section. Presentational
 * only; keys are the group identity key, not kind-order, so two groups that once shared a position
 * never collide.
 */
export function EvidenceGroups({
  items,
  selected,
  originAvailable,
  busy,
  handlers,
}: {
  items: ItemEvidence[];
  selected: SelectedObjective;
  originAvailable: boolean;
  busy: boolean;
  handlers: GroupHandlers;
}) {
  const { shown, orphans, noneForSelected } = partitionEvidenceItems(items, selected);
  return (
    <>
      {!originAvailable && (
        <p className="text-xs text-amber-700" data-testid="origin-migration-notice">
          Evidence origin tracking needs database migration 0095_objective_evidence_origin. Until it is applied, evidence
          without a current candidate link is listed below as origin unknown rather than matched to an objective, and new
          evidence cannot be gathered. Apply the migration (npx.cmd supabase migration up), then reload.
        </p>
      )}
      {shown.map((it) => (
        <EvidenceGroupCard key={it.key} it={it} orphan={false} handlers={handlers} />
      ))}
      {noneForSelected && !busy && <p className="text-sm text-muted">No evidence questions for this objective yet.</p>}
      {orphans.length > 0 && (
        <div className="space-y-3 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3" data-testid="orphaned-evidence">
          <div>
            <h4 className="text-sm font-semibold text-foreground">No longer linked to a current objective or decision</h4>
            <p className="mt-0.5 text-xs text-muted">
              Kept as it was, including your edits and exclusions. It is not used for any objective&apos;s conclusion. Automatic
              questions here are replaced the next time evidence is gathered; ones you added, edited or left out stay.
            </p>
          </div>
          {orphans.map((it) => (
            <EvidenceGroupCard key={it.key} it={it} orphan handlers={handlers} />
          ))}
        </div>
      )}
    </>
  );
}

function EvidenceGroupCard({ it, orphan, handlers }: { it: ItemEvidence; orphan: boolean; handlers: GroupHandlers }) {
  const { runId, editing, draft, onDraft, onStartEdit, onCancelEdit, onSave, onToggle, onRetry } = handlers;
  return (
    <div className="rounded-lg border border-border p-3" data-orphaned={orphan ? "true" : "false"} data-identity={it.identity}>
      <div className="flex items-center gap-2">
        <Pill stance={it.stance} />
        <span className="text-xs uppercase tracking-wide text-muted">{it.item_kind}</span>
        {orphan && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {it.identity === "unknown" ? "Origin unknown" : "Not linked"}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium text-foreground">{it.item_text}</p>
      {orphan && <p className="mt-0.5 text-xs text-amber-800">{orphanReason(it)}</p>}
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
                      onChange={(e) => onDraft({ ...draft, [k]: e.target.value })}
                    />
                  </label>
                ))}
                <div className="flex gap-2">
                  <button className={btn} onClick={() => onSave(q)}>Save and re-read</button>
                  <button className={btn} onClick={onCancelEdit}>Cancel</button>
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
                        {x.table_id && <EvidenceTable runId={runId} tableId={x.table_id} />}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-1.5 flex gap-3 text-xs">
                  <button className="text-muted underline" onClick={() => onStartEdit(q)}>
                    Edit
                  </button>
                  <button className="text-muted underline" onClick={() => onToggle(q)}>
                    {q.excluded ? "Include" : "Leave out"}
                  </button>
                  {q.error && (
                    <button className="text-muted underline" onClick={() => onRetry(q.id)}>
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
  );
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
  // Set only when answerRest stops at its runaway guard with real work still pending
  // (OBJ-REV-009): this drives a genuine "Continue reading" action distinct from "Gather
  // again" - the note alone used to say "click again to continue", but the only button in
  // reach was "Gather again", which calls generateObjectiveEvidenceAction first and
  // regenerates the evidence questions from scratch, orphaning whatever had already been
  // answered and restarting the exact same incomplete run rather than continuing it.
  const [truncated, setTruncated] = useState(false);
  // Counter-review on OBJ-REV-009: this is the DURABLE counterpart to the `note` set inline
  // by gather() below - that one-shot note vanishes on reload, this is read back from the
  // database on every load (loadObjectiveEvidenceAction/getLatestVariablesTruncated), so the
  // warning survives even when nobody is watching right after the click that caused it.
  // OBJ-REV-009: null is a third, distinct state from true/false - "coverage status could not
  // be checked right now" (a lookup failure), never folded into "false" (verified not truncated).
  const [variablesTruncated, setVariablesTruncated] = useState<boolean | null>(false);
  // OBJ-REV-001/002 Rule B: false when migration 0095 is missing (reported by the load action).
  const [originAvailable, setOriginAvailable] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ question: "", request_text: "", supports_if: "", against_if: "" });

  async function refresh() {
    const r = await loadObjectiveEvidenceAction(runId);
    if (r.ok) {
      setItems(r.items);
      setVariablesTruncated(r.variablesTruncated);
      setOriginAvailable(r.originAvailable);
    } else setError(r.error);
  }
  // The first time a project has objectives and data but no evidence yet, gather it
  // without being asked. Once per browser session, so a failure never loops.
  useEffect(() => {
    void (async () => {
      const r = await loadObjectiveEvidenceAction(runId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setItems(r.items);
      setVariablesTruncated(r.variablesTruncated);
      setOriginAvailable(r.originAvailable);
      const none = r.items.reduce((n, i) => n + i.questions.length, 0) === 0;
      if (!none || !hasObjectiveOrDecision || dataFiles.length === 0) return;
      const flag = `evidence-auto-${runId}`;
      try {
        if (sessionStorage.getItem(flag)) return;
        sessionStorage.setItem(flag, "1");
      } catch {
        // storage blocked: still run once for this mount
      }
      void gather();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /** One click does it all: write the questions, then answer them two at a time until none remain. */
  async function gather() {
    setError(null);
    setNote(null);
    setTruncated(false);
    setBusy("Writing the evidence questions...");
    const g = await generateObjectiveEvidenceAction(runId);
    if (!g.ok) {
      setError(g.error);
      setBusy(null);
      return;
    }
    if (g.skippedInferred > 0) setNote(`${g.skippedInferred} inferred objective(s) skipped: reading the data against them would be circular.`);
    if (g.variablesTruncated) {
      const more = "One or more files have more eligible variables than this step reads at once, so some may not have been considered for an evidence question.";
      setNote((prev) => (prev ? `${prev} ${more}` : more));
    }
    await refresh();
    await answerRest();
  }

  async function answerRest() {
    const GUARD_LIMIT = 60;
    let stillRemaining = 0;
    let stalledOnPersistence = false;
    let guard = 0;
    for (; guard < GUARD_LIMIT; guard++) {
      setBusy("Reading the data...");
      const e = await evaluateObjectiveEvidenceAction(runId);
      if (!e.ok) {
        setError(e.error);
        break;
      }
      await refresh();
      stillRemaining = e.remaining;
      if (e.remaining === 0) break;
      // OBJ-REV-013: `done: 0` with `remaining > 0` means every pair this round was attempted
      // but nothing could actually be saved (a persistence failure, not "nothing left to do") -
      // breaking out silently here used to leave the researcher looking at a stopped spinner
      // with no explanation and unread questions still sitting there, indistinguishable from a
      // normal finish. Surfacing it explicitly is what "expose pending/degraded failures
      // deterministically" means for this screen.
      if (e.done === 0) {
        stalledOnPersistence = true;
        break;
      }
    }
    // OBJ-REV-M04: the guard above is a runaway cap, not "until none
    // remain" - say so when it's actually what stopped this, rather than
    // leaving the researcher thinking every question was read.
    const stillTruncated = guard >= GUARD_LIMIT && stillRemaining > 0;
    setTruncated(stillTruncated);
    if (stalledOnPersistence) {
      setError(
        `Could not save an answer for ${stillRemaining} question(s) still unread - something is preventing results from being stored. Try Continue reading again; if it keeps stalling, this needs attention before more progress can be made.`,
      );
    } else if (stillTruncated) {
      setNote(`Stopped after a long run with ${stillRemaining} question(s) still unread. Use Continue reading below.`);
    }
    setBusy(null);
  }

  /** Keeps answering what's already written, without regenerating anything (OBJ-REV-009):
   * the one thing "Gather again" cannot safely be used for, since it re-runs the question
   * writer first and can orphan already-answered work for items it decides to replace. */
  async function continueReading() {
    setError(null);
    await answerRest();
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

  const { selected } = useObjectiveSelection();
  if (dataFiles.length === 0) return null;
  const total = items.reduce((n, i) => n + i.questions.length, 0);
  const failed = items.flatMap((i) => i.questions).filter((q) => q.error && !q.excluded).length;

  return (
    <div className="mb-6 min-w-0 space-y-4 rounded-xl border border-border bg-white p-5">
      <div className="flex flex-col items-start gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Evidence from the data</h3>
          <p className="mt-1 text-xs text-muted">
            Each objective is broken into a few questions the data file can answer. A table is built for each and
            read as support for, against, or silent on the objective. No significance flag is needed: a level, a
            share, or a gap between groups all count. The questions are written before any table is seen, and you
            can edit or drop any of them. Every question is put to each data file in the project and the answers are
            combined: where files disagree the result is mixed, and a file without the variable is silent.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted">
            {dataFiles.length} data file{dataFiles.length === 1 ? "" : "s"}
          </span>
          <button className={btn} disabled={busy !== null || !hasObjectiveOrDecision} onClick={() => void gather()}>
            {busy ?? (total > 0 ? "Gather again" : "Gather evidence")}
          </button>
          {truncated && (
            <button className={btn} disabled={busy !== null} onClick={() => void continueReading()}>
              {busy ?? "Continue reading"}
            </button>
          )}
        </div>
      </div>
      {!hasObjectiveOrDecision && <p className="text-xs text-muted">Add a research objective or decision first.</p>}
      {variablesTruncated === true && (
        <p className="text-xs text-amber-700">
          One or more data files have more eligible variables than evidence-question writing reads at once, so some
          may never have been considered for a question. This reflects the evidence questions currently in effect,
          not just the last run - re-gather with fewer files, or treat any "data silent" verdict with that in mind.
        </p>
      )}
      {variablesTruncated === null && (
        <p className="text-xs text-amber-700">
          Whether any data file's variables were too many to all be considered for a question could not be checked
          just now - treat coverage as unverified rather than assuming nothing was left out.
        </p>
      )}
      {note && <p className="text-xs text-muted">{note}</p>}

      <EvidenceGroups
        items={items}
        selected={selected}
        originAvailable={originAvailable}
        busy={busy !== null}
        handlers={{
          runId,
          editing,
          draft,
          onDraft: setDraft,
          onStartEdit: (q) => {
            setEditing(q.id);
            setDraft({ question: q.question, request_text: q.request_text, supports_if: q.supports_if, against_if: q.against_if });
          },
          onCancelEdit: () => setEditing(null),
          onSave: (q) => void save(q),
          onToggle: (q) => void toggle(q),
          onRetry: (id) => void retry(id),
        }}
      />
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
