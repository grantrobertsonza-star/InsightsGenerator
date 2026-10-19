"use client";

// Research Quality Review screen (Grant, 2026-10-19): a one-off, view-only review of how well a
// brief or a proposal is written, plus a separate comparison of a proposal against its brief.
//   left:   the project's documents, each reviewable as a brief or a proposal, with its reviews;
//           the comparison sits below as its own action;
//   middle: the selected review's dashboard (overall ring and one bar per dimension);
//   right:  the selected dimension's criteria: rating, reason, the document's own words, improvement.
// Presentation and orchestration only: every read and write goes through researchQualityActions,
// which resolve the tenant and researcher on the server. Opening the section makes no model call;
// only a confirmed start, "Retry failed steps" and "Continue review" do. A response that arrives
// after the researcher switched review is dropped (request sequence), so an older answer never
// overwrites a newer choice. Reviews made before review kinds stay readable, in their older format.
import { precisionCheckText } from "@/lib/marginOfError";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  estimateResearchQualityReviewAction,
  loadResearchQualityViewAction,
  purgeResearchQualitySourceAction,
  retryResearchQualityReviewAction,
  startResearchQualityReviewAction,
} from "@/lib/researchQualityActions";
import { Pane, ThreePane } from "./ThreePane";
import { RQ_PRESELECT_EVENT } from "./ReviewResearchQualityLink";
import { REVIEW_KIND_LABEL, type ReviewKind } from "@/lib/researchQualityTypes";
import { checklistScoreText, criterionShortLabel, scorecard } from "@/lib/researchQualityPresentation";
import InfoDot from "@/components/InfoDot";
import type { DashboardView } from "@/lib/researchQualityDashboard";
import type { ObservationView, ResearchQualityView } from "@/lib/researchQualityView";

const btn = "rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-50";
const primary = "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";
const STATE_LABEL: Record<string, string> = { pending: "starting", running: "running", complete: "complete", partial: "partial", failed: "failed" };
const REVIEWABLE = /\.(pdf|docx|txt)$/i;
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
const reviewLabel = (x: ResearchQualityView["reviews"][number]) => (x.kind ? REVIEW_KIND_LABEL[x.kind] : "Review (older format)");

// A pending start: the kind and documents, shown with its cost estimate until confirmed.
type Pending = { kind: ReviewKind; documentIds: string[]; estimate: number | null };

export default function ResearchQualityReview({ runId }: { runId: string }) {
  const [view, setView] = useState<ResearchQualityView | null>(null);
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // dimension (or older-format criterion) id
  // A document chosen through "Review research quality" elsewhere on the page.
  const [highlight, setHighlight] = useState<string | null>(() => {
    try {
      return typeof window === "undefined" ? null : window.sessionStorage.getItem(RQ_PRESELECT_EVENT);
    } catch {
      return null; // storage blocked: no preselection
    }
  });
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
    try {
      window.sessionStorage.removeItem(RQ_PRESELECT_EVENT);
    } catch {
      // storage blocked
    }
    const on = (e: Event) => setHighlight((e as CustomEvent<string>).detail);
    window.addEventListener(RQ_PRESELECT_EVENT, on);
    return () => window.removeEventListener(RQ_PRESELECT_EVENT, on);
  }, []);
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
  const r = view.review;
  const open = (id: string) => {
    setSelected(null);
    setReviewId(id);
  };
  return (
    <div data-testid="research-quality">
      <ThreePane
        storageKey="research-quality-v2"
        left={
          <Pane side="left" title="Briefs and proposals">
            <DocumentList
              runId={runId}
              view={view}
              highlight={highlight}
              activeReviewId={r?.id ?? null}
              onOpen={open}
              onStarted={(id) => {
                setHighlight(null);
                open(id);
              }}
              reload={() => load(reviewId)}
            />
          </Pane>
        }
        middle={
          <Pane side="middle" title={r ? `${reviewLabel(r)} ${r.sequence}` : "Dashboard"}>
            {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-800">{error.text}</p>}
            {r ? (
              <ReviewMiddle runId={runId} view={view} selected={selected} onSelect={setSelected} reload={() => load(reviewId)} />
            ) : (
              <p className="text-sm text-muted">
                Choose a document on the left and review it as a brief or a proposal. You get a score for each part of good practice, an overall score and, for each part, what to improve.
              </p>
            )}
          </Pane>
        }
        right={
          <Pane side="right" title="Criterion details">
            {r ? (
              <CriterionDetails view={view} selected={selected} />
            ) : (
              <p className="text-xs text-muted">Click a bar on the dashboard to see why it scored as it did, in the document&apos;s own words, and how to improve it.</p>
            )}
          </Pane>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- left: documents and starts

function DocumentList({
  runId,
  view,
  highlight,
  activeReviewId,
  onOpen,
  onStarted,
  reload,
}: {
  runId: string;
  view: ResearchQualityView;
  highlight: string | null;
  activeReviewId: string | null;
  onOpen: (id: string) => void;
  onStarted: (id: string) => void;
  reload: () => Promise<void>;
}) {
  // Only briefs and proposals (Grant 2026-10-19): documents imported as context (a brief or proposal,
  // kind "evidence") and any document already given a brief or proposal role, for example a brief that
  // was added under Reports and reviewed as one. Reports, questionnaires and data are not listed.
  const docs = view.documents.filter(
    (d) => REVIEWABLE.test(d.filename) && d.kind !== "instrument" && (d.kind === "evidence" || (d.source?.roles ?? []).some((r) => r === "brief" || r === "proposal")),
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [cmp, setCmp] = useState<{ proposal: string; brief: string }>({ proposal: "", brief: "" });
  const charsOf = (id: string) => view.documents.find((d) => d.id === id)?.source?.currentVersion?.charCount ?? null;
  const nameOf = (id: string | null) => view.documents.find((d) => d.id === id)?.filename ?? "a removed document";

  async function ask(kind: ReviewKind, documentIds: string[]) {
    setMsg(null);
    const chars = documentIds.map(charsOf);
    // The length is known once a document has been read for a review; otherwise no figure is shown.
    const known = chars.every((c) => c !== null);
    const est = known ? await estimateResearchQualityReviewAction(chars.reduce<number>((n, c) => n + (c ?? 0), 0), documentIds.length).catch(() => null) : null;
    setPending({ kind, documentIds, estimate: est && est.ok ? est.estimateUsd : null });
  }
  async function start() {
    if (!pending) return;
    setBusy(true);
    const res = await startResearchQualityReviewAction(runId, { requestKey: key(), kind: pending.kind, sources: pending.documentIds.map((documentId) => ({ documentId })) }).catch(() => ({
      ok: false as const,
      error: "The connection to the server was interrupted, so the review may not have started. Reload to see.",
    }));
    setBusy(false);
    if (!res.ok) return setMsg({ text: res.error, error: true });
    setPending(null);
    onStarted(res.reviewId);
  }

  if (docs.length === 0) return <p className="text-xs text-muted">No briefs or proposals yet. Add one under Import data with the Brief or Proposal picker; Word, PDF and text files can be reviewed.</p>;
  const reviewsOf = (documentId: string) => view.reviews.filter((x) => x.kind && x.kind !== "proposal_vs_brief" && x.sources.some((s) => s.documentId === documentId));
  const comparisons = view.reviews.filter((x) => x.kind === "proposal_vs_brief");
  const older = view.reviews.filter((x) => !x.kind);
  const reviewButton = (x: ResearchQualityView["reviews"][number], text: string) => (
    <button
      onClick={() => onOpen(x.id)}
      aria-current={activeReviewId === x.id ? "true" : undefined}
      className={`w-full rounded px-1.5 py-1 text-left ${activeReviewId === x.id ? "bg-primary-light font-medium text-primary" : "hover:bg-slate-50"}`}
    >
      {text}
      <span className="ml-1 text-muted">{`${STATE_LABEL[x.state] ?? x.state}, ${x.createdAt.slice(0, 10)}`}</span>
    </button>
  );
  const confirmBox = pending && (
    <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-white p-2 text-xs" data-testid="rq-confirm">
      <p>
        {`${REVIEW_KIND_LABEL[pending.kind]} of ${pending.documentIds.map(nameOf).join(" against ")}. ${
          pending.estimate === null ? "Cost depends on length; a typical brief or proposal costs well under US$1." : `Estimated cost US$${pending.estimate.toFixed(2)}.`
        } The whole document is read.`}
      </p>
      <div className="flex gap-2">
        <button className={primary} disabled={busy} onClick={() => void start()}>
          {busy ? "Starting..." : "Start review"}
        </button>
        <button className={btn} disabled={busy} onClick={() => setPending(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">AI ratings of how well each document is written against good research practice, checked by code against its own words. A guide to what to improve, not a certification.</p>
      {docs.map((d) => {
        const mine = reviewsOf(d.id);
        const isPending = pending && pending.kind !== "proposal_vs_brief" && pending.documentIds[0] === d.id;
        return (
          <div key={d.id} className={`rounded-lg border bg-white p-2.5 text-xs ${highlight === d.id ? "border-primary ring-1 ring-primary/30" : "border-border"}`} data-document-id={d.id} data-highlight={highlight === d.id ? "true" : "false"}>
            <p className="truncate font-medium text-foreground" title={d.filename}>
              {d.filename}
              {(d.source?.roles ?? []).filter((x) => x === "brief" || x === "proposal").map((x) => (
                <span key={x} className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600" data-testid="rq-doc-role">
                  {x === "brief" ? "Brief" : "Proposal"}
                </span>
              ))}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <button className={btn} disabled={busy} onClick={() => void ask("brief", [d.id])}>
                Review as brief
              </button>
              <button className={btn} disabled={busy} onClick={() => void ask("proposal", [d.id])}>
                Review as proposal
              </button>
            </div>
            {isPending && <div className="mt-2">{confirmBox}</div>}
            {mine.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5" aria-label={`Reviews of ${d.filename}`}>
                {mine.map((x) => (
                  <li key={x.id}>{reviewButton(x, `${reviewLabel(x)} ${x.sequence}`)}</li>
                ))}
              </ul>
            )}
            {d.source?.currentVersion && (
              <button
                className="mt-1 text-[11px] text-muted hover:text-foreground hover:underline"
                onClick={async () => {
                  if (!window.confirm(`Permanently remove the copy of ${d.filename}'s text kept with its reviews? Quotes from it are removed and cannot be recovered. The project document itself is not affected.`)) return;
                  const x = await purgeResearchQualitySourceAction(runId, d.source!.sourceId);
                  setMsg(x.ok ? { text: `Removed ${x.versions} kept version(s) of ${d.filename}.`, error: false } : { text: x.error, error: true });
                  await reload();
                }}
              >
                Remove kept text
              </button>
            )}
          </div>
        );
      })}
      {docs.length >= 2 && (
        <section className="rounded-lg border border-dashed border-border p-2.5 text-xs" aria-label="Compare a proposal with its brief" data-testid="rq-compare">
          <h4 className="font-semibold text-foreground">Compare a proposal with its brief</h4>
          <p className="mt-0.5 text-muted">A separate review: does the proposal answer what the brief asks for?</p>
          <label className="mt-2 block">
            <span className="text-muted">Proposal</span>
            <select aria-label="Proposal to compare" value={cmp.proposal} onChange={(e) => setCmp({ ...cmp, proposal: e.target.value })} className="mt-0.5 block w-full rounded border border-border px-1 py-0.5">
              <option value="">choose</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-1 block">
            <span className="text-muted">Brief</span>
            <select aria-label="Brief to compare" value={cmp.brief} onChange={(e) => setCmp({ ...cmp, brief: e.target.value })} className="mt-0.5 block w-full rounded border border-border px-1 py-0.5">
              <option value="">choose</option>
              {docs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.filename}
                </option>
              ))}
            </select>
          </label>
          <button className={`${btn} mt-2`} disabled={busy || !cmp.proposal || !cmp.brief || cmp.proposal === cmp.brief} onClick={() => void ask("proposal_vs_brief", [cmp.proposal, cmp.brief])}>
            Compare
          </button>
          {pending?.kind === "proposal_vs_brief" && <div className="mt-2">{confirmBox}</div>}
          {comparisons.length > 0 && (
            <ul className="mt-2 flex flex-col gap-0.5" aria-label="Comparisons">
              {comparisons.map((x) => (
                <li key={x.id}>{reviewButton(x, `${x.sources[0]?.filename ?? "proposal"} against ${x.sources[1]?.filename ?? "brief"}`)}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      {older.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">{`Earlier reviews, older format (${older.length})`}</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {older.map((x) => (
              <li key={x.id}>{reviewButton(x, `Review ${x.sequence}: ${x.sources.map((s) => s.filename).join(", ")}`)}</li>
            ))}
          </ul>
        </details>
      )}
      {view.detachedSources.map((s) => (
        <p key={s.sourceId} className="text-[11px] text-muted">{`${s.filename ?? "A document"} was deleted from the project; its reviews stay readable${s.purged ? " (text removed)" : ""}.`}</p>
      ))}
      {msg && (
        <p role={msg.error ? "alert" : "status"} className={`text-xs ${msg.error ? "text-red-800" : "text-emerald-800"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- middle: dashboard

// A category's average falls between ratings, so colours follow the bands: 4 or more (80%) Strong,
// 3 or more (60%) Workable, 1 or more Weak, below 1 towards Absent.
const scoreBar = (score: number) => (score >= 4 ? "bg-indigo-500" : score >= 3 ? "bg-amber-400" : score >= 1 ? "bg-slate-400" : "bg-rose-400");
const scoreText = (score: number) => (score >= 4 ? "text-indigo-700" : score >= 3 ? "text-amber-700" : score >= 1 ? "text-slate-600" : "text-rose-700");
const BAND_RING: Record<string, string> = { strong: "#6366f1", workable: "#f59e0b", weak: "#e11d48" };
const BAND_LABEL: Record<string, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };
const readOf = (s: { assessedRanges: { start: number; end: number }[] }) => s.assessedRanges.reduce((n, x) => n + (x.end - x.start), 0);

function ReviewMiddle({ runId, view, selected, onSelect, reload }: { runId: string; view: ResearchQualityView; selected: string | null; onSelect: (id: string) => void; reload: () => Promise<void> }) {
  const r = view.review!;
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const failedSteps = (r.coverage.tasks ?? []).filter((t) => t.status === "failed");
  const retry = async (note: string) => {
    const x = await retryResearchQualityReviewAction(runId, r.id);
    setRetryMsg(x.ok ? note : x.error);
    await reload();
  };
  const partlyRead = r.manifest.sources.filter((s) => readOf(s) < s.charCount);
  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="rq-review-state"
        data-state={r.state}
        className={`rounded-md p-2 text-xs ${r.state === "complete" ? "bg-emerald-50 text-emerald-900" : r.state === "failed" ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}
      >
        <p>{`${r.manifest.sources.map((s) => s.filename).join(" against ")}. ${r.createdAt.slice(0, 10)}${r.createdBy ? `, ${r.createdBy}` : ""}.`}</p>
        {(r.state === "pending" || r.state === "running") && !r.progress.interrupted && (
          <p>{`Reviewing: ${r.progress.done} of ${r.progress.total} steps done${r.progress.failed ? `, ${r.progress.failed} failed` : ""}. Each step can take a minute or two; this page updates by itself.`}</p>
        )}
        {r.progress.interrupted && (
          <p data-testid="rq-review-interrupted">
            {`The review stopped before it finished (${r.progress.done} of ${r.progress.total} steps), most likely because the server restarted. Nothing done so far is lost. `}
            <button className={btn} onClick={() => void retry("Continuing the review from where it stopped.")}>
              Continue review
            </button>
          </p>
        )}
        {r.state === "partial" && <p>{`Partly complete: ${failedSteps.length} step(s) failed. What is shown was rated; the rest is shown as not rated.`}</p>}
        {r.state === "failed" && <p>The review failed: nothing could be rated.</p>}
        {failedSteps.map((t) => (
          <p key={t.key} className="mt-0.5">{`${t.key}: ${t.error ?? "failed"}`}</p>
        ))}
        {failedSteps.some((t) => t.attempts < t.maxAttempts) && (
          <button className={`${btn} mt-1`} onClick={() => void retry("Retrying the failed steps only.")}>
            Retry failed steps
          </button>
        )}
        {retryMsg && <p>{retryMsg}</p>}
        {r.syntheticReferences && <p className="font-semibold">Synthetic test references in use.</p>}
      </div>
      {partlyRead.map((s) => (
        <p key={s.sourceId} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{`${s.filename}: only the first ${readOf(s).toLocaleString("en-GB")} of ${s.charCount.toLocaleString("en-GB")} characters were read, so later sections are not rated.`}</p>
      ))}
      {r.kind ? (
        <>
          {r.dashboards.map((d) => (
            <Dashboard key={d.dashboardId} d={d} selected={selected} onSelect={onSelect} />
          ))}
          {r.dashboards.length === 0 && r.state !== "running" && r.state !== "pending" && <p className="text-xs text-muted">Nothing could be rated.</p>}
        </>
      ) : (
        <LegacyReview view={view} selected={selected} onSelect={onSelect} />
      )}
      <a className={`${primary} w-fit`} href={`/api/runs/${runId}/research-quality/export?review=${r.id}`} download>
        Download review (Word)
      </a>
    </div>
  );
}

/**
 * The bird's-eye view: the weighted overall percentage as a ring and one bar per dimension. A bar is
 * a button: choosing it shows that dimension's criteria on the right. Every figure is computed on the
 * server (researchQualityDashboard.ts); this only draws them.
 */
function Dashboard({ d, selected, onSelect }: { d: DashboardView; selected: string | null; onSelect: (id: string) => void }) {
  const current = selected ?? d.dimensions[0]?.dimensionId ?? null;
  return (
    <section className="rounded-xl border border-border bg-white p-3" aria-label={`${d.label} dashboard`} data-testid="rq-dashboard" data-dashboard={d.dashboardId} data-pct={d.pct ?? "none"}>
      <div className="flex flex-wrap items-center gap-3">
        <ScoreRing pct={d.pct} band={d.band} />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-foreground">{d.label}</h4>
          <p className="text-xs text-muted">
            {d.pct === null
              ? `Too little rated yet for an overall score (${d.ratedWeight} of ${d.totalWeight} weight).`
              : `${BAND_LABEL[d.band!]}: weighted across ${d.dimensions.filter((x) => x.state === "rated").length} of ${d.dimensions.length} dimensions.`}
            <InfoDot
              text={`Each criterion is rated Strong 5, Workable 3, Weak 1 or Absent 0. Overall = weighted points / weighted maximum, over rated dimensions; a category scores the average of its rated criteria. Strong 80% or more, Workable 60% or more. ${d.basis}`}
            />
          </p>
        </div>
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {d.dimensions.map((x) => {
          const name = x.categoryLabel ?? criterionShortLabel(x.dimensionId);
          const shown = x.score === null ? null : Number.isInteger(x.score) ? String(x.score) : x.score.toFixed(1);
          const active = current === x.dimensionId;
          return (
            <li key={x.dimensionId} data-criterion={x.dimensionId} data-state={x.state} data-score={x.score ?? "none"} data-weight={x.weight}>
              <button
                type="button"
                onClick={() => onSelect(x.dimensionId)}
                aria-pressed={active}
                className={`flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-left text-xs ${active ? "bg-primary-light ring-1 ring-primary/30" : "hover:bg-slate-50"}`}
              >
                <span className="min-w-[9rem] flex-1 truncate font-medium text-foreground" data-testid="rq-dimension-name">
                  {name}
                  {x.categoryLabel ? (
                    <span className="ml-1 text-[10px] font-normal text-muted">{`${x.weight}%`}</span>
                  ) : (
                    x.weight > 1 && (
                      <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600" title="Counts double in the overall score">{`x${x.weight}`}</span>
                    )
                  )}
                </span>
                <span className="flex min-w-[8rem] flex-[2] items-center gap-2">
                  <span className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${name}: ${shown === null ? x.label : `${shown} of 5, ${x.label}`}`}>
                    {x.score !== null && <span className={`absolute inset-y-0 left-0 rounded-full ${scoreBar(x.score)}`} style={{ width: `${Math.max(x.score, 0.15) * 20}%` }} />}
                  </span>
                  <span className={`w-[5.5rem] shrink-0 whitespace-nowrap text-right text-[10px] font-bold uppercase tracking-wide ${x.score === null ? "text-muted" : scoreText(x.score)}`}>
                    {shown === null ? (x.state === "failed" ? "failed" : "-") : `${shown} ${x.label}`}
                  </span>
                </span>
              </button>
              {x.categoryLabel && x.criteria.length > 1 && (
                // A category's own items and scores under its bar (Grant, 2026-10-19: the
                // methodology items on the dashboard, the reasons staying in the detail pane).
                // The bar above is the category's total: the average of these rated items.
                <ul className="mb-1 ml-3 flex flex-col border-l border-slate-200 pl-2" aria-label={`${name} items`}>
                  {x.criteria.map((c) => {
                    const cShown = c.score === null ? null : String(c.score);
                    return (
                      <li key={c.criterionId} data-sub-criterion={c.criterionId} data-score={c.score ?? "none"}>
                        <button
                          type="button"
                          onClick={() => onSelect(x.dimensionId)}
                          className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-slate-50"
                        >
                          <span className="min-w-[8rem] flex-1 truncate text-slate-700">{criterionShortLabel(c.criterionId)}</span>
                          <span className="flex min-w-[8rem] flex-[2] items-center gap-2">
                            <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${criterionShortLabel(c.criterionId)}: ${cShown === null ? c.label : `${cShown} of 5, ${c.label}`}`}>
                              {c.score !== null && <span className={`absolute inset-y-0 left-0 rounded-full ${scoreBar(c.score)}`} style={{ width: `${Math.max(c.score, 0.15) * 20}%` }} />}
                            </span>
                            <span className={`w-[5.5rem] shrink-0 whitespace-nowrap text-right text-[10px] font-semibold uppercase tracking-wide ${c.score === null ? "text-muted" : scoreText(c.score)}`}>
                              {cShown === null ? (c.state === "failed" ? "failed" : "-") : `${cShown} ${c.label}`}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        {d.dimensions.some((x) => x.categoryLabel && x.criteria.length > 1)
          ? "A category's bar is its total, the average of its rated items listed under it. Click a bar or an item for the reasons on the right."
          : "Click a bar for its detail on the right."}
      </p>
    </section>
  );
}

function ScoreRing({ pct, band }: { pct: number | null; band: string | null }) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 64 64" width="64" height="64" role="img" aria-label={pct === null ? "No overall score" : `Overall ${pct}%`} className="shrink-0" data-testid="rq-dashboard-ring">
      <circle cx="32" cy="32" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="7" />
      {pct !== null && (
        <circle cx="32" cy="32" r={radius} fill="none" stroke={BAND_RING[band ?? "weak"]} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(pct / 100) * circumference} ${circumference}`} transform="rotate(-90 32 32)" />
      )}
      <text x="32" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill="#0f172a">
        {pct === null ? "-" : `${pct}%`}
      </text>
    </svg>
  );
}

/** A review made before review kinds: its dashboard if it had one, its checklist scores and criteria, read-only. */
function LegacyReview({ view, selected, onSelect }: { view: ResearchQualityView; selected: string | null; onSelect: (id: string) => void }) {
  const r = view.review!;
  const groups = scorecard(r.observations);
  return (
    <div className="flex flex-col gap-3" data-testid="rq-legacy">
      <p className="rounded-md bg-slate-50 p-2 text-xs text-muted">An earlier review in the older format, shown as it was and read-only. Review a document as a brief or a proposal for the dashboard.</p>
      {r.dashboards.map((d) => (
        <Dashboard key={d.dashboardId} d={d} selected={selected} onSelect={onSelect} />
      ))}
      {r.checklists.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs" aria-label="Element checklists">
          {r.checklists.map((c) => (
            <li key={c.taskKey}>{`${c.filename}, ${c.label}: ${checklistScoreText(c.score, c.state)}`}</li>
          ))}
        </ul>
      )}
      {groups.map((g) => (
        <div key={g.group} className="rounded-xl border border-border bg-white text-xs">
          <div className="bg-slate-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">{g.label}</div>
          <ul className="divide-y divide-border">
            {g.rows.map((row) => (
              <li key={row.observation.versionId} data-criterion={row.observation.criterionId}>
                <button
                  type="button"
                  onClick={() => onSelect(row.observation.criterionId)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${selected === row.observation.criterionId ? "bg-primary-light" : "hover:bg-slate-50"}`}
                >
                  <span className="font-medium text-foreground">{criterionShortLabel(row.observation.criterionId)}</span>
                  <span className={`text-[10px] font-bold uppercase ${row.score === null ? "text-muted" : scoreText(row.score)}`}>{row.score === null ? row.label : `${row.score} ${row.label}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- right: criterion details

function CriterionDetails({ view, selected }: { view: ResearchQualityView; selected: string | null }) {
  const r = view.review!;
  const dims = r.dashboards.flatMap((d) => d.dimensions);
  const dim = dims.find((x) => x.dimensionId === selected) ?? (selected ? undefined : dims[0]);
  const criterionIds = dim ? dim.criteria.map((c) => c.criterionId) : selected ? [selected] : [];
  if (criterionIds.length === 0) return <p className="text-xs text-muted">Click a bar or a criterion to see its detail.</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="rq-details" data-dimension={dim?.dimensionId ?? selected ?? ""}>
      {dim?.categoryLabel && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">{dim.categoryLabel}</h4>
          <p className="text-xs text-muted">{`Weight ${dim.weight}%. The average of its rated criteria: ${dim.score === null ? "not rated" : `${dim.score.toFixed(1)} of 5`}.`}</p>
        </div>
      )}
      {criterionIds.map((cid) => (
        <CriterionDetail key={cid} view={view} criterionId={cid} />
      ))}
    </div>
  );
}

/**
 * RQC-6: the calculated margin-of-error check beside "Sample size and precision" (marginOfError.ts),
 * made by code when the review was prepared, not by the model, and labelled as such.
 */
function PrecisionChecks({ checks }: { checks: NonNullable<ResearchQualityView["review"]>["manifest"]["precisionChecks"] }) {
  if (!checks) return null;
  const all = checks.flatMap((c) => c.checks.map((k) => ({ ...k, filename: c.filename })));
  return (
    <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-2" data-testid="rq-precision-checks">
      <p className="font-medium">Margin of error, calculated (not the model&apos;s rating)</p>
      {all.length === 0 ? (
        <p className="mt-0.5 text-muted">No margin of error is stated in the text reviewed, so there is nothing to check.</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-1.5">
          {all.map((k, i) => (
            <li key={i} data-verdict={k.kind === "checked" ? k.verdict : "not_checked"}>
              <p className={k.kind === "checked" && k.verdict === "understated" ? "font-medium text-amber-800" : "text-foreground"}>{precisionCheckText(k)}</p>
              <p className="text-muted">{`“${k.quote}” ${k.filename}`}</p>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-muted">For a proportion of 50% (the widest margin), without a finite-population correction.</p>
    </div>
  );
}

function CriterionDetail({ view, criterionId }: { view: ResearchQualityView; criterionId: string }) {
  const r = view.review!;
  const obs: ObservationView[] = r.observations.filter((o) => o.criterionId === criterionId && o.status !== "dismissed");
  const rating = r.dashboards.flatMap((d) => d.dimensions.flatMap((x) => x.criteria)).find((c) => c.criterionId === criterionId);
  const first = obs[0];
  const sourceName = (v: string) => r.manifest.sources.find((s) => s.sourceVersionId === v)?.filename ?? "document";
  const score = rating?.score ?? first?.payload.rating?.score ?? null;
  const label = rating?.label ?? first?.payload.rating?.label ?? "Not rated";
  const improvement = first?.payload.improvement;
  return (
    <article className="rounded-lg border border-border bg-white p-3 text-xs" data-testid="rq-criterion-detail" data-criterion={criterionId}>
      <div className="flex items-start justify-between gap-2">
        <h5 className="text-sm font-semibold text-foreground">{criterionShortLabel(criterionId)}</h5>
        <span className={`shrink-0 whitespace-nowrap rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${score === null ? "text-muted" : scoreText(score)}`}>
          {score === null ? label : `${score} ${label}`}
        </span>
      </div>
      {first && <p className="mt-0.5 text-muted">{first.question}</p>}
      {!first && (
        <p className="mt-1 text-muted">
          {rating?.state === "pending" ? "Not rated yet: the review is still running." : rating?.state === "failed" ? "Could not be rated: its step failed. Retry the failed steps in the middle." : "Not rated."}
        </p>
      )}
      {first?.payload.rating?.reason && (
        <p className="mt-2">
          <span className="font-medium">Why: </span>
          {first.payload.rating.reason}
        </p>
      )}
      {criterionId === "RQ-PROP-SAMPLE-SIZE" && <PrecisionChecks checks={r.manifest.precisionChecks} />}
      {obs.some((o) => o.payload.statements.length > 0) && (
        <div className="mt-2">
          <p className="font-medium">In the document&apos;s words</p>
          <ul className="mt-0.5 flex flex-col gap-1">
            {obs
              .flatMap((o) => o.payload.statements)
              .map((s) => (
                <li key={s.factId} className="border-l-2 border-slate-300 pl-2 text-slate-700">
                  {`“${s.exactQuote ?? "(text removed)"}”`}
                  <span className="text-muted">{` ${sourceName(s.sourceVersionId)}, ${s.locator.page ? `p. ${s.locator.page}` : `para. ${s.locator.segmentId.replace(/^s/, "")}`}`}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
      {first?.payload.basis === "absence_in_assessed_scope" && (
        <p className="mt-1 text-muted">{first.payload.absenceScope === "complete" ? "Not found anywhere in the document, read in full." : "Not found in the parts that were read."}</p>
      )}
      {improvement && (improvement.currentAction || improvement.futureAction) && (
        <div className="mt-2 rounded-md bg-slate-50 p-2">
          <p className="font-medium">To improve</p>
          <p>{[improvement.currentAction, improvement.futureAction].filter(Boolean).join(" ")}</p>
        </div>
      )}
      {first && first.payload.uncertainty.length > 0 && <p className="mt-1 text-muted">{`Uncertain: ${first.payload.uncertainty.join("; ")}`}</p>}
    </article>
  );
}
