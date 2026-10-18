"use client";

// Research Quality Review v1 screen (brief section 2). Presentation and orchestration only: every
// read and write goes through researchQualityActions, which resolve the tenant and researcher on
// the server. Opening this section loads the view and makes no model call; only "Start review" and
// "Retry failed steps" do. A response that arrives after the researcher switched review is
// dropped (request sequence), so an older answer never overwrites a newer choice.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  estimateResearchQualityReviewAction,
  loadResearchQualityViewAction,
  purgeResearchQualitySourceAction,
  recordResearchQualityEntryAction,
  retryResearchQualityReviewAction,
  saveResearchQualityRolesAction,
  startResearchQualityReviewAction,
} from "@/lib/researchQualityActions";
import { RQ_PRESELECT_EVENT } from "./ReviewResearchQualityLink";
import { ROLE_LABEL, SOURCE_ROLES, type ResearcherEntryKind, type SourceRole } from "@/lib/researchQualityTypes";
import {
  FITNESS_LABEL,
  METHOD_LABEL,
  SUPPORT_LABEL,
  alignmentRows,
  documentationLabel,
  improvementsByTiming,
  overview,
  shownImplication,
  scorecard,
  comparisonLabel,
} from "@/lib/researchQualityPresentation";
import type { ObservationView, ResearchQualityView } from "@/lib/researchQualityView";

type Tab = "overview" | "documents" | "alignment" | "improvements" | "clarifications" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "documents", label: "Documents" },
  { id: "alignment", label: "Alignment" },
  { id: "improvements", label: "Improvements" },
  { id: "clarifications", label: "Clarifications" },
  { id: "history", label: "History and export" },
];
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
const defaultRoles = (kind: string): SourceRole[] => (kind === "report" ? ["report"] : kind === "instrument" ? ["questionnaire"] : kind === "transcript" ? ["fieldwork"] : ["brief"]);
const btn = "rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50";
const primary = "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";

export default function ResearchQualityReview({ runId }: { runId: string }) {
  const [view, setView] = useState<ResearchQualityView | null>(null);
  const [starting, setStarting] = useState(false);
  // A document chosen through "Review research quality" elsewhere on the page.
  const [preselectDocumentId, setPreselect] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : window.sessionStorage.getItem(RQ_PRESELECT_EVENT);
    } catch {
      return null; // storage blocked: no preselection
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.removeItem(RQ_PRESELECT_EVENT);
    } catch {
      // storage blocked
    }
    const on = (e: Event) => {
      setPreselect((e as CustomEvent<string>).detail);
      setStarting(true);
    };
    window.addEventListener(RQ_PRESELECT_EVENT, on);
    return () => window.removeEventListener(RQ_PRESELECT_EVENT, on);
  }, []);
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const seq = useRef(0);

  const load = useCallback(
    async (id: string | null) => {
      const mine = ++seq.current;
      const r = await loadResearchQualityViewAction(runId, id).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted. Reload to try again." }));
      if (mine !== seq.current) return; // a newer request superseded this one
      if (!r.ok) setError({ text: r.error, setup: "setup" in r ? r.setup : false });
      else {
        setError(null);
        setView(r.view);
      }
    },
    [runId],
  );
  useEffect(() => {
    // Loading the view is the effect's purpose (an external read); its state update is async.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(reviewId);
  }, [load, reviewId]);
  const running = view?.review && (view.review.state === "pending" || view.review.state === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(reviewId), 4000);
    return () => clearInterval(t);
  }, [running, load, reviewId]);

  if (error?.setup) return <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{error.text}</p>;
  if (!view) return <p className="text-sm text-muted">{error ? error.text : "Loading..."}</p>;
  const showStart = starting || !view.review;
  return (
    <div className="flex flex-col gap-3" data-testid="research-quality">
      {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error.text}</p>}
      <p className="max-w-3xl text-xs text-muted">
        AI judgements about the documents you select, checked by code and reviewed by you. Not a score or a certification. The text of reviewed documents is kept with the review history, even if
        the project document is later deleted, until you purge it under Documents.
      </p>
      {view.reviews.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label>
            Review{" "}
            <select aria-label="Review version" value={view.review?.id ?? ""} onChange={(e) => { setStarting(false); setReviewId(e.target.value || null); }} className="rounded border border-border px-1 py-0.5">
              {view.reviews.map((r) => (
                <option key={r.id} value={r.id}>{`Review ${r.sequence}: ${r.state}, ${r.createdAt.slice(0, 10)}`}</option>
              ))}
            </select>
          </label>
          {!showStart && <button className={btn} onClick={() => setStarting(true)}>New review version</button>}
        </div>
      )}
      {showStart ? (
        <StartPanel
          key={preselectDocumentId ?? "none"}
          runId={runId}
          view={view}
          preselect={preselectDocumentId}
          onCancel={view.review ? () => setStarting(false) : null}
          onStarted={(id) => {
            setStarting(false);
            setReviewId(id);
            setTab("overview");
            void load(id);
          }}
        />
      ) : (
        <>
          <div role="tablist" className="flex flex-wrap gap-1 border-b border-border">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`px-2.5 py-1.5 text-xs font-medium ${tab === t.id ? "border-b-2 border-primary text-foreground" : "text-muted"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <ReviewBody runId={runId} view={view} tab={tab} reload={() => load(reviewId)} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- start

function StartPanel({ runId, view, preselect, onCancel, onStarted }: { runId: string; view: ResearchQualityView; preselect: string | null; onCancel: (() => void) | null; onStarted: (id: string) => void }) {
  const reviewable = view.documents.filter((d) => /\.(pdf|docx|txt)$/i.test(d.filename));
  const [picked, setPicked] = useState<Record<string, SourceRole[]>>(() => {
    const init: Record<string, SourceRole[]> = {};
    for (const d of reviewable) if (d.id === preselect || (!preselect && d.source)) init[d.id] = d.source?.roles ?? defaultRoles(d.kind);
    return init;
  });
  const [mode, setMode] = useState<"improve_planned" | "review_documented">("review_documented");
  const [studyType, setStudyType] = useState("unclear");
  const [purpose, setPurpose] = useState("");
  const [decisionIds, setDecisionIds] = useState<string[]>(view.candidates.decisions.map((d) => d.id));
  const [objectiveIds, setObjectiveIds] = useState<string[]>(view.candidates.objectives.map((o) => o.id));
  const [extraDecisions, setExtraDecisions] = useState("");
  const [confirm, setConfirm] = useState<{ estimate: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const requestKey = useRef(key());
  const chosen = Object.entries(picked);
  const chars = chosen.reduce((n, [id]) => n + (view.documents.find((d) => d.id === id)?.source?.currentVersion?.charCount ?? 20_000), 0);

  const decisions = [
    ...view.candidates.decisions.filter((d) => decisionIds.includes(d.id)).map((d) => ({ decisionId: d.id, text: d.text })),
    ...extraDecisions.split("\n").map((t) => t.trim()).filter(Boolean).map((text) => ({ decisionId: null, text })),
  ];
  const objectives = view.candidates.objectives.filter((o) => objectiveIds.includes(o.id)).map((o) => ({ objectiveId: o.id, text: o.text }));

  async function review() {
    setErr(null);
    if (chosen.length === 0) return setErr("Select at least one document. A brief on its own is enough to start.");
    if (chosen.some(([, roles]) => roles.length === 0)) return setErr("Give every selected document at least one role.");
    const e = await estimateResearchQualityReviewAction(chars, chosen.length).catch(() => null);
    setConfirm({ estimate: e && e.ok ? e.estimateUsd : null });
  }
  async function start() {
    setBusy(true);
    setErr(null);
    const r = await startResearchQualityReviewAction(runId, {
      requestKey: requestKey.current,
      mode,
      studyType,
      purpose,
      sources: chosen.map(([documentId, roles]) => ({ documentId, roles })),
      decisions,
      objectives,
    }).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted, so the review may not have started. Check History before trying again." }));
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    requestKey.current = key();
    onStarted(r.reviewId);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-white p-3" aria-label="Start a research quality review">
      <h3 className="text-sm font-semibold">{view.review ? "New review version" : "Start a research quality review"}</h3>
      {reviewable.length === 0 ? (
        <p className="text-sm text-muted">Add a brief, proposal, questionnaire, methodology or report under Import data first (PDF, Word or plain text). A brief on its own is enough.</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-xs font-medium">Documents and their roles</legend>
          {reviewable.map((d) => {
            const on = d.id in picked;
            return (
              <div key={d.id} className="rounded border border-border p-2 text-xs" data-document-id={d.id}>
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[d.id] = d.source?.roles ?? defaultRoles(d.kind); else delete n[d.id]; return n; })} />
                  {d.filename}
                </label>
                {on && (
                  <div className="mt-1 flex flex-wrap gap-2 pl-6">
                    {SOURCE_ROLES.map((role) => (
                      <label key={role} className="flex items-center gap-1">
                        <input type="checkbox" checked={picked[d.id].includes(role)} onChange={(e) => setPicked((p) => ({ ...p, [d.id]: e.target.checked ? [...p[d.id], role] : p[d.id].filter((x) => x !== role) }))} />
                        {ROLE_LABEL[role]}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
      )}
      {view.documents.length > reviewable.length && <p className="text-xs text-muted">Data tables, spreadsheets and slide decks cannot be reviewed for research quality in this version.</p>}
      <div className="flex flex-wrap gap-4 text-xs">
        <fieldset>
          <legend className="font-medium">Review mode</legend>
          <label className="mr-3"><input type="radio" name="rq-mode" checked={mode === "improve_planned"} onChange={() => setMode("improve_planned")} /> Improve a planned study</label>
          <label><input type="radio" name="rq-mode" checked={mode === "review_documented"} onChange={() => setMode("review_documented")} /> Review a documented study</label>
        </fieldset>
        <label className="flex flex-col">
          <span className="font-medium">Study type</span>
          <select aria-label="Study type" value={studyType} onChange={(e) => setStudyType(e.target.value)} className="rounded border border-border px-1 py-0.5">
            <option value="unclear">Not sure</option>
            <option value="quantitative">Quantitative</option>
            <option value="qualitative">Qualitative</option>
            <option value="mixed">Mixed methods</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col text-xs">
        <span className="font-medium">Purpose of the research (what it is for)</span>
        <textarea aria-label="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} className="rounded border border-border p-1.5" />
      </label>
      <fieldset className="text-xs">
        <legend className="font-medium">Decisions it should inform</legend>
        {view.candidates.decisions.map((d) => (
          <label key={d.id} className="block"><input type="checkbox" checked={decisionIds.includes(d.id)} onChange={(e) => setDecisionIds((x) => (e.target.checked ? [...x, d.id] : x.filter((y) => y !== d.id)))} /> {d.text}</label>
        ))}
        <textarea aria-label="Other decisions, one per line" placeholder="Other decisions, one per line" value={extraDecisions} onChange={(e) => setExtraDecisions(e.target.value)} rows={2} className="mt-1 w-full rounded border border-border p-1.5" />
      </fieldset>
      {view.candidates.objectives.length > 0 && (
        <fieldset className="text-xs">
          <legend className="font-medium">Accepted objectives to check against</legend>
          {view.candidates.objectives.map((o) => (
            <label key={o.id} className="block"><input type="checkbox" checked={objectiveIds.includes(o.id)} onChange={(e) => setObjectiveIds((x) => (e.target.checked ? [...x, o.id] : x.filter((y) => y !== o.id)))} /> {o.text}</label>
          ))}
        </fieldset>
      )}
      {err && <p role="alert" className="rounded bg-red-50 p-2 text-xs text-red-800">{err}</p>}
      {confirm ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs" aria-label="Review scope">
          <p>
            {chosen.length} document(s). Each is read up to 40,000 characters (120,000 in total); anything longer is a labelled partial review. About {Math.max(1, Math.ceil(chars / 20_000)) + 4} model calls,
            each tried at most twice. Estimated cost {confirm.estimate === null ? "unknown" : `about US$${confirm.estimate.toFixed(2)}`} (an estimate, not a limit; actual cost is recorded).
          </p>
          <div className="mt-2 flex gap-2">
            <button className={primary} disabled={busy} onClick={start}>{busy ? "Starting..." : "Start review"}</button>
            <button className={btn} onClick={() => setConfirm(null)}>Back</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button className={primary} onClick={review} disabled={reviewable.length === 0}>Review selected material</button>
          {onCancel && <button className={btn} onClick={onCancel}>Cancel</button>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- review body

function ReviewBody({ runId, view, tab, reload }: { runId: string; view: ResearchQualityView; tab: Tab; reload: () => Promise<void> }) {
  const r = view.review!;
  const ov = useMemo(() => overview(r.observations), [r.observations]);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const failedSteps = (r.coverage.tasks ?? []).filter((t) => t.status === "failed");
  return (
    <div className="flex flex-col gap-3">
      <div data-testid="rq-review-state" data-state={r.state} className={`rounded-md p-2 text-xs ${r.state === "complete" ? "bg-emerald-50 text-emerald-900" : r.state === "failed" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>
        {r.state === "pending" || r.state === "running" ? "Reviewing the selected material. This page updates by itself." : null}
        {r.state === "complete" ? `Review ${r.sequence} is complete.` : null}
        {r.state === "partial" ? `Review ${r.sequence} is partial: ${failedSteps.length} step(s) failed. What is shown was assessed; the rest is listed as not assessed.` : null}
        {r.state === "failed" ? `Review ${r.sequence} failed: nothing could be assessed.` : null}
        {r.syntheticReferences && <span className="ml-2 font-semibold">Synthetic test references in use, not methodological standards.</span>}
        {failedSteps.length > 0 && (
          <div className="mt-1">
            {failedSteps.map((t) => (
              <div key={t.key}>{`${t.key}: ${t.error ?? "failed"} (attempt ${t.attempts} of ${t.maxAttempts})`}</div>
            ))}
            {failedSteps.some((t) => t.attempts < t.maxAttempts) && (
              <button className={`${btn} mt-1`} onClick={async () => { const x = await retryResearchQualityReviewAction(runId, r.id); setRetryMsg(x.ok ? "Retrying the failed steps only." : x.error); await reload(); }}>
                Retry failed steps
              </button>
            )}
            {retryMsg && <div>{retryMsg}</div>}
          </div>
        )}
        {r.newClarifications > 0 && <div className="mt-1">{r.newClarifications} clarification(s) were added after this review; start a new review version to include them.</div>}
      </div>
      {tab === "overview" && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            <Stat label="Documented strengths" n={ov.strengths.length} />
            <Stat label="Concerns" n={ov.concerns.length} />
            <Stat label="Documentation gaps" n={ov.gaps.length} />
            <Stat label="Decision implications" n={ov.decisionImplications.length} />
          </div>
          <p className="text-xs text-muted">{`${ov.awaitingReview} awaiting your review. ${ov.requiresReview} need review because a source changed or could not be checked.`}</p>
          <SourceFreshness view={view} />
          <Scorecard view={view} />
          {r.manifest.criteria.filter((c) => c.status !== "selected").length > 0 && (
            <details className="text-xs">
              <summary>Criteria not assessed in this review</summary>
              <ul className="list-disc pl-5">{r.manifest.criteria.filter((c) => c.status !== "selected").map((c) => <li key={c.criterionId}>{`${c.criterionId} (${c.status}): ${c.reason}`}</li>)}</ul>
            </details>
          )}
          {r.observations.length === 0 && r.state !== "running" && r.state !== "pending" && <p className="text-sm text-muted">No observations were published.</p>}
          {r.observations.map((o) => <ObservationCard key={o.versionId} runId={runId} o={o} view={view} reload={reload} />)}
        </>
      )}
      {tab === "documents" && <DocumentsTab runId={runId} view={view} reload={reload} />}
      {tab === "alignment" && <AlignmentTab view={view} />}
      {tab === "improvements" && <ImprovementsTab view={view} />}
      {tab === "clarifications" && <ClarificationsTab runId={runId} view={view} reload={reload} />}
      {tab === "history" && <HistoryTab runId={runId} view={view} />}
    </div>
  );
}

function Scorecard({ view }: { view: ResearchQualityView }) {
  const groups = scorecard(view.review!.observations);
  if (groups.length === 0) return null;
  return (
    <div className="overflow-x-auto" aria-label="Scorecard">
      <p className="text-xs text-muted">Each criterion is scored on its own: Strong 5, Workable 3, Weak 1, Absent 0. Scores are not added up.</p>
      <table className="w-full border-collapse text-xs">
        <thead><tr><th className="border-b p-1 text-left">Criterion</th><th className="border-b p-1 text-left">Score</th><th className="border-b p-1 text-left">Suggested improvement</th></tr></thead>
        <tbody>
          {groups.map((g) => [
            <tr key={g.group}><td colSpan={3} className="bg-slate-50 p-1 font-semibold">{g.label}</td></tr>,
            ...g.rows.map((r) => (
              <tr key={r.observation.versionId} className="align-top" data-score={r.score ?? "none"} data-criterion={r.observation.criterionId}>
                <td className="border-b p-1">{r.observation.criterionId}<div className="text-muted">{r.observation.question}</div>{comparisonLabel(r.comparison) && <div className="text-muted">{comparisonLabel(r.comparison)}</div>}</td>
                <td className="border-b p-1 whitespace-nowrap">{`${r.label}${r.score !== null ? ` (${r.score}/5)` : ""}`}{r.observation.freshness !== "current" && <div className="text-amber-800">requires review</div>}</td>
                <td className="border-b p-1">{r.suggestion ?? (r.score === 5 ? "None needed." : "No suggestion given.")}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

const Stat = ({ label, n }: { label: string; n: number }) => (
  <div className="rounded border border-border bg-white p-2"><div className="text-lg font-semibold">{n}</div><div className="text-muted">{label}</div></div>
);

function SourceFreshness({ view }: { view: ResearchQualityView }) {
  const r = view.review!;
  return (
    <ul className="text-xs" aria-label="Sources in this review">
      {r.sourceFreshness.map((f) => {
        const m = r.manifest.sources.find((s) => s.sourceId === f.sourceId)!;
        const read = m.assessedRanges.reduce((n, x) => n + (x.end - x.start), 0);
        return (
          <li key={f.sourceId} data-source-status={f.status}>
            <span className="font-medium">{f.filename}</span>{` (${m.roles.map((x) => ROLE_LABEL[x]).join(", ")}): ${read < m.charCount ? `partly read (${read.toLocaleString("en-GB")} of ${m.charCount.toLocaleString("en-GB")} characters)` : "read in full"}. ${f.detail}`}
          </li>
        );
      })}
    </ul>
  );
}

function ObservationCard({ runId, o, view, reload }: { runId: string; o: ObservationView; view: ResearchQualityView; reload: () => Promise<void> }) {
  const r = view.review!;
  const [wording, setWording] = useState(o.wording?.text ?? "");
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const a = o.payload.assessment;
  const sourceName = (v: string) => r.manifest.sources.find((s) => s.sourceVersionId === v)?.filename ?? "source";
  async function act(kind: ResearcherEntryKind, body: string | null) {
    setBusy(true);
    setMsg(null);
    const res = await recordResearchQualityEntryAction(runId, { kind, observationId: o.observationId, observationVersionId: o.versionId, body, expectedRevision: o.revision, idempotencyKey: key() }).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted, so this may not have been saved. Your text is still here; reload to see what was saved." }));
    setBusy(false);
    if (!res.ok) return setMsg({ text: res.error, error: true });
    if (kind === "wording") setEditing(false);
    if (kind === "comment") setComment("");
    setMsg({ text: "Saved.", error: false });
    await reload();
  }
  return (
    <article className="rounded-lg border border-border bg-white p-3 text-xs" data-testid="rq-observation" data-criterion={o.criterionId} data-status={o.status} data-freshness={o.freshness} data-observation-id={o.observationId}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{o.criterionId}</span>
        <span className="text-muted">{o.question}</span>
      </div>
      {o.freshness !== "current" && <p className="mt-1 rounded bg-amber-50 p-1.5 text-amber-900" role="status">{o.freshness === "requires_review" ? `Requires review: ${o.freshnessReason}` : "Could not check whether its sources changed."}</p>}
      {o.previous && o.status === "awaiting_review" && (
        <p className="mt-1 rounded bg-sky-50 p-1.5 text-sky-900" role="status">
          {`Update awaiting review. In review ${o.previous.reviewSequence} you ${o.previous.status === "awaiting_review" ? "edited" : o.previous.status} an earlier version${o.previous.wording ? `, worded: "${o.previous.wording}"` : ""}. That decision does not carry over to this new judgement.`}
        </p>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5">
        <Badge>{`Score: ${o.payload.rating?.label ?? "Not rated"}${o.payload.rating?.score != null ? ` (${o.payload.rating.score}/5)` : ""}`}</Badge>
        {comparisonLabel(o.payload.comparison) && <Badge>{comparisonLabel(o.payload.comparison)}</Badge>}
        <Badge>{`Documentation: ${documentationLabel(o.payload)}`}</Badge>
        <Badge>{`Methodology: ${METHOD_LABEL[a.methodology]}`}</Badge>
        {a.decisionFitness.map((d, i) => <Badge key={i}>{`${d.decisionRef !== null ? `${r.manifest.decisions[d.decisionRef]?.text.slice(0, 40)}: ` : ""}${FITNESS_LABEL[d.state]}`}</Badge>)}
        <Badge>{`Status: ${o.status.replace("_", " ")}`}</Badge>
      </div>
      <p className="mt-2"><span className="font-medium">{o.wording ? "Implication (your wording): " : "Implication: "}</span>{shownImplication(o)}</p>
      {o.wording && <p className="text-muted">{`Generated: ${o.payload.implication}`}</p>}
      {o.payload.rating?.reason && <p className="mt-1 text-muted">{`Why this score: ${o.payload.rating.reason}`}</p>}
      {a.reasoning && <p className="mt-1 text-muted">{`AI reasoning: ${a.reasoning}`}</p>}
      {o.payload.statements.length > 0 && (
        <ul className="mt-1 list-disc pl-5">
          {o.payload.statements.map((s) => (
            <li key={s.factId}>
              <span className="text-muted">{s.phase === "planned" ? "Planned: " : s.phase === "reported_executed" ? "Reported as done: " : ""}</span>
              {`"${s.exactQuote ?? "(text purged)"}"`}
              <span className="text-muted">{` ${sourceName(s.sourceVersionId)}, ${s.locator.page ? `p. ${s.locator.page}` : `para. ${s.locator.segmentId.replace(/^s/, "")}`}`}</span>
            </li>
          ))}
        </ul>
      )}
      {o.payload.basis === "absence_in_assessed_scope" && <p className="mt-1 text-muted">{o.payload.absenceScope === "complete" ? "Not found in any of the documents, read in full." : "Not found in the assessed passages; not every relevant document was read in full."}</p>}
      {o.payload.uncertainty.length > 0 && <p className="mt-1 text-muted">{`Uncertain: ${o.payload.uncertainty.join("; ")}`}</p>}
      {o.payload.improvement && (
        <div className="mt-1 rounded bg-slate-50 p-1.5">
          {o.payload.improvement.currentAction && <div>{`Now: ${o.payload.improvement.currentAction}`}</div>}
          {o.payload.improvement.futureAction && <div>{`Next study: ${o.payload.improvement.futureAction}`}</div>}
          {SUPPORT_LABEL[o.payload.referenceSupportStatus] && <div className="text-muted">{SUPPORT_LABEL[o.payload.referenceSupportStatus]}</div>}
          {o.payload.methodologicalReferenceRefs.map((ref) => {
            const rp = r.referencePassages.find((x) => x.referenceId === ref.referenceId && x.passageId === ref.passageId);
            return <div key={`${ref.referenceId}:${ref.passageId}`} className="text-muted">{`${ref.referenceId}:${ref.passageId}${rp?.synthetic ? " (synthetic test reference)" : ""}: ${rp?.text ?? ""}`}</div>;
          })}
        </div>
      )}
      {o.payload.validationNotes.length > 0 && <p className="mt-1 text-muted">{`Checked by code: ${o.payload.validationNotes.join(" ")}`}</p>}
      {o.comments.map((c, i) => <p key={i} className="mt-1 border-l-2 border-border pl-2">{`${c.by}, ${c.at.slice(0, 16)}: ${c.text}`}</p>)}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {o.status !== "accepted" && <button className={btn} disabled={busy} onClick={() => act("accept", null)}>Accept</button>}
        {o.status !== "dismissed" && <button className={btn} disabled={busy} onClick={() => act("dismiss", null)}>Dismiss</button>}
        {o.status !== "awaiting_review" && <button className={btn} disabled={busy} onClick={() => act("reopen", null)}>Reopen</button>}
        <button className={btn} disabled={busy} onClick={() => setEditing((x) => !x)}>Edit wording</button>
        {o.decidedBy && <span className="text-muted">{`${o.status.replace("_", " ")} by ${o.decidedBy}`}</span>}
      </div>
      {editing && (
        <div className="mt-1 flex flex-col gap-1">
          <textarea aria-label="Your wording" value={wording} onChange={(e) => setWording(e.target.value)} rows={3} className="rounded border border-border p-1.5" />
          <div><button className={btn} disabled={busy || !wording.trim()} onClick={() => act("wording", wording)}>Save wording</button></div>
        </div>
      )}
      <div className="mt-1 flex gap-1">
        <input aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment" className="min-w-0 flex-1 rounded border border-border px-1.5 py-0.5" />
        <button className={btn} disabled={busy || !comment.trim()} onClick={() => act("comment", comment)}>Comment</button>
      </div>
      {msg && <p role={msg.error ? "alert" : "status"} className={msg.error ? "mt-1 text-red-800" : "mt-1 text-emerald-800"}>{msg.text}</p>}
    </article>
  );
}

const Badge = ({ children }: { children: React.ReactNode }) => <span className="rounded bg-slate-100 px-1.5 py-0.5">{children}</span>;

function DocumentsTab({ runId, view, reload }: { runId: string; view: ResearchQualityView; reload: () => Promise<void> }) {
  const r = view.review!;
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 text-xs">
      {view.documents.filter((d) => d.source).map((d) => {
        const s = d.source!;
        const cited = r.observations.filter((o) => o.payload.statements.some((st) => r.manifest.sources.find((m) => m.sourceVersionId === st.sourceVersionId)?.sourceId === s.sourceId));
        return (
          <div key={d.id} className="rounded border border-border bg-white p-2" data-source-id={s.sourceId}>
            <div className="font-medium">{d.filename}</div>
            <div className="text-muted">{s.currentVersion ? `Version ${s.currentVersion.ordinal} (${s.currentVersion.extractor.replace("_", " ")}, ${s.currentVersion.charCount.toLocaleString("en-GB")} characters)${s.currentVersion.purged ? ", text purged" : ""}; ${s.versions} version(s) kept.` : "Not read yet."}</div>
            <RoleEditor runId={runId} documentId={d.id} roles={s.roles} revision={s.revision} onSaved={reload} />
            {cited.length > 0 && <div className="mt-1">{`Cited by: ${cited.map((o) => o.criterionId).join(", ")}`}</div>}
            <button
              className={`${btn} mt-1`}
              onClick={async () => {
                if (!window.confirm(`Permanently purge the retained text of ${d.filename} from every review? Quotes from it are removed and cannot be recovered. The project document itself is not affected.`)) return;
                const x = await purgeResearchQualitySourceAction(runId, s.sourceId);
                setMsg(x.ok ? `Purged ${x.versions} version(s) of ${d.filename}.` : x.error);
                await reload();
              }}
            >
              Purge retained text
            </button>
          </div>
        );
      })}
      {view.detachedSources.map((s) => <div key={s.sourceId} className="rounded border border-dashed border-border p-2 text-muted">{`${s.filename ?? "A source"}: its project document was deleted. Its snapshot stays in review history${s.purged ? " (text purged)" : " until purged"}.`}</div>)}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}

function RoleEditor({ runId, documentId, roles, revision, onSaved }: { runId: string; documentId: string; roles: SourceRole[]; revision: number; onSaved: () => Promise<void> }) {
  const [value, setValue] = useState<SourceRole[]>(roles);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {SOURCE_ROLES.map((role) => (
        <label key={role} className="flex items-center gap-1">
          <input type="checkbox" checked={value.includes(role)} onChange={(e) => setValue((v) => (e.target.checked ? [...v, role] : v.filter((x) => x !== role)))} />
          {ROLE_LABEL[role]}
        </label>
      ))}
      <button className={btn} onClick={async () => { const x = await saveResearchQualityRolesAction(runId, documentId, value, revision); setMsg(x.ok ? "Roles saved. Reviews that used the old roles now need review." : x.error); if (x.ok) await onSaved(); }}>Save roles</button>
      {msg && <span role="status">{msg}</span>}
    </div>
  );
}

function AlignmentTab({ view }: { view: ResearchQualityView }) {
  const r = view.review!;
  const rows = alignmentRows(r.facts, r.manifest);
  const conflicts = r.observations.filter((o) => o.criterionId === "RQ-ALIGN-CONSISTENCY" || o.criterionId === "RQ-PLAN-EXECUTION" || o.payload.assessment.documentation === "conflicting");
  return (
    <div className="flex flex-col gap-2 text-xs">
      {conflicts.length > 0 && <div className="rounded bg-amber-50 p-2">{conflicts.map((o) => <p key={o.versionId}>{`${o.criterionId}: ${shownImplication(o)}`}</p>)}</div>}
      {rows.length === 0 && <p className="text-muted">No documented statements to compare.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead><tr><th className="border-b p-1 text-left">Topic</th>{r.manifest.sources.map((s) => <th key={s.sourceId} className="border-b p-1 text-left">{s.filename}</th>)}</tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.topic} className="align-top">
                  <td className="border-b p-1 font-medium">{row.topic.replace("_", " ")}</td>
                  {row.bySource.map((b) => (
                    <td key={b.sourceId} className="border-b p-1">
                      {b.facts.map((f) => <div key={f.factId} className="mb-1"><span className="text-muted">{f.phase === "planned" ? "Planned: " : f.phase === "reported_executed" ? "Reported: " : ""}</span>{`"${f.exactQuote ?? "(purged)"}"`}</div>)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImprovementsTab({ view }: { view: ResearchQualityView }) {
  const groups = improvementsByTiming(view.review!.observations);
  return (
    <div className="flex flex-col gap-3 text-xs">
      <p className="text-muted">Priorities by when they matter, not calculated severity. Dismissed observations are left out.</p>
      {groups.map((g) => (
        <section key={g.timing}>
          <h4 className="font-semibold">{g.label}</h4>
          {g.items.length === 0 ? <p className="text-muted">None.</p> : (
            <ul className="list-disc pl-5">
              {g.items.map((o) => (
                <li key={o.versionId} data-freshness={o.freshness}>
                  {`${o.criterionId}: ${[o.payload.improvement!.currentAction && `Now: ${o.payload.improvement!.currentAction}`, o.payload.improvement!.futureAction && `Next study: ${o.payload.improvement!.futureAction}`].filter(Boolean).join(" ")}`}
                  {o.payload.improvement!.rationale && <span className="text-muted">{` Why: ${o.payload.improvement!.rationale}`}</span>}
                  {SUPPORT_LABEL[o.payload.referenceSupportStatus] && <span className="text-muted">{` (${SUPPORT_LABEL[o.payload.referenceSupportStatus]})`}</span>}
                  {o.freshness !== "current" && <span className="text-amber-800">{" Requires review."}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ClarificationsTab({ runId, view, reload }: { runId: string; view: ResearchQualityView; reload: () => Promise<void> }) {
  const r = view.review!;
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const questions = r.observations.filter((o) => o.status !== "dismissed").flatMap((o) => o.payload.clarificationQuestions.map((q) => ({ q, c: o.criterionId })));
  return (
    <div className="flex flex-col gap-2 text-xs">
      <h4 className="font-semibold">Questions from this review</h4>
      {questions.length === 0 ? <p className="text-muted">None.</p> : <ul className="list-disc pl-5">{questions.map((x, i) => <li key={i}>{`${x.c}: ${x.q}`}</li>)}</ul>}
      <h4 className="font-semibold">Your clarifications</h4>
      <p className="text-muted">Saved as information you supplied, with your name and the time. A later review version can use it; it never becomes a quote from a document.</p>
      {view.clarifications.map((c) => <p key={c.entryId} className="border-l-2 border-border pl-2">{`${c.by}, ${c.at.slice(0, 16)}${r.manifest.clarificationIds.includes(c.entryId) ? "" : " (after this review)"}: ${c.text}`}</p>)}
      <textarea aria-label="Clarification" value={text} onChange={(e) => setText(e.target.value)} rows={3} className="rounded border border-border p-1.5" />
      <div>
        <button className={btn} disabled={busy || !text.trim()} onClick={async () => {
          setBusy(true);
          const x = await recordResearchQualityEntryAction(runId, { kind: "clarification", observationId: null, observationVersionId: null, body: text, expectedRevision: null, idempotencyKey: key() }).catch(() => ({ ok: false as const, error: "The connection to the server was interrupted, so this may not have been saved. Your text is still here; reload to see what was saved." }));
          setBusy(false);
          if (!x.ok) return setMsg({ text: x.error, error: true });
          setText("");
          setMsg({ text: "Clarification saved. Start a new review version to take it into account.", error: false });
          await reload();
        }}>Save clarification</button>
      </div>
      {msg && <p role={msg.error ? "alert" : "status"}>{msg.text}</p>}
    </div>
  );
}

function HistoryTab({ runId, view }: { runId: string; view: ResearchQualityView }) {
  const r = view.review!;
  const [other, setOther] = useState<string>("");
  const [diff, setDiff] = useState<{ added: string[]; removed: string[]; changed: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function compare(id: string) {
    setOther(id);
    setDiff(null);
    if (!id) return;
    const x = await loadResearchQualityViewAction(runId, id);
    if (!x.ok || !x.view.review) return setErr(x.ok ? "That review could not be loaded." : x.error);
    const mine = new Map(r.observations.map((o) => [o.observationId, o]));
    const theirs = new Map(x.view.review.observations.map((o) => [o.observationId, o]));
    setDiff({
      added: r.observations.filter((o) => !theirs.has(o.observationId)).map((o) => o.criterionId),
      removed: x.view.review.observations.filter((o) => !mine.has(o.observationId)).map((o) => o.criterionId),
      changed: r.observations.filter((o) => theirs.has(o.observationId) && JSON.stringify(theirs.get(o.observationId)!.payload.assessment) !== JSON.stringify(o.payload.assessment)).map((o) => o.criterionId),
    });
  }
  return (
    <div className="flex flex-col gap-2 text-xs">
      <ul>
        {view.reviews.map((x) => <li key={x.id}>{`Review ${x.sequence}: ${x.state}, ${x.createdAt.slice(0, 16)} by ${x.createdBy ?? "single user"}; criteria ${x.criteriaRelease}, references ${x.referencesRelease}; cost US$${x.actualCostUsd.toFixed(4)} (estimate ${x.estimatedCostUsd === null ? "unknown" : `US$${x.estimatedCostUsd.toFixed(2)}`})`}</li>)}
      </ul>
      <label>
        {`Compare review ${r.sequence} with `}
        <select aria-label="Compare with" value={other} onChange={(e) => void compare(e.target.value)} className="rounded border border-border px-1 py-0.5">
          <option value="">choose a review</option>
          {view.reviews.filter((x) => x.id !== r.id).map((x) => <option key={x.id} value={x.id}>{`Review ${x.sequence}`}</option>)}
        </select>
      </label>
      {err && <p role="alert">{err}</p>}
      {diff && <p>{`New: ${diff.added.join(", ") || "none"}. No longer present: ${diff.removed.join(", ") || "none"}. Judgement changed: ${diff.changed.join(", ") || "none"}.`}</p>}
      <a className={`${primary} w-fit`} href={`/api/runs/${runId}/research-quality/export?review=${r.id}`} download>Download review (Word)</a>
    </div>
  );
}
