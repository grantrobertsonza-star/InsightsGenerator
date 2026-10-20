"use client";

// Research Quality Review screen. Since 2026-10-20 in the layout of Grant's Research quality
// prototype, then (the same day) with the document list folded into the top of the review pane, so
// a third pane can show a criterion's detail:
//   middle: the document and its review, chosen at the top (the review list is the document's
//           history: its own reviews and the comparisons it is part of); the review's kind, state and
//           date; the actions (review as a brief or a proposal, compare with a brief, download, more);
//           its metadata folded; its failures and retry; then three tabs: Overview (the dashboard),
//           Criteria (filtered by dimension and status) and Improvements;
//   right:  the detail of the bar or criterion clicked: a dimension's criteria, or one criterion.
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
import {
  checklistScoreText,
  criterionRows,
  criterionShortLabel,
  filterCriterionRows,
  improvementsByTiming,
  reviewStepLabel,
  scorecard,
  shownFailedSteps,
} from "@/lib/researchQualityPresentation";
import InfoDot from "@/components/InfoDot";
import type { DashboardView } from "@/lib/researchQualityDashboard";
import type { ObservationView, ResearchQualityView } from "@/lib/researchQualityView";

const btn = "rounded-lg border border-border bg-white px-3 py-1.5 text-xs font-medium text-foreground hover:bg-slate-50 disabled:opacity-50";
const primary = "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover disabled:opacity-50";
const STATE_LABEL: Record<string, string> = { pending: "starting", running: "running", complete: "complete", partial: "partial", failed: "failed" };
const STATE_TONE: Record<string, string> = {
  complete: "bg-emerald-50 text-emerald-800",
  partial: "bg-amber-50 text-amber-800",
  failed: "bg-red-50 text-red-700",
  running: "bg-sky-50 text-sky-800",
  pending: "bg-sky-50 text-sky-800",
};
const REVIEWABLE = /\.(pdf|docx|txt)$/i;
const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");
const reviewLabel = (x: ResearchQualityView["reviews"][number]) => (x.kind ? REVIEW_KIND_LABEL[x.kind] : "Review (older format)");

type Doc = ResearchQualityView["documents"][number];
type Tab = "overview" | "criteria" | "improvements" | "details";

// A pending start: the kind and documents, shown with its cost estimate until confirmed.
type Pending = { kind: ReviewKind; documentIds: string[]; estimate: number | null };

/** Only briefs and proposals (Grant 2026-10-19): context files, and any document given either role. */
function reviewableDocs(view: ResearchQualityView): Doc[] {
  return view.documents.filter(
    (d) => REVIEWABLE.test(d.filename) && d.kind !== "instrument" && (d.kind === "evidence" || (d.source?.roles ?? []).some((r) => r === "brief" || r === "proposal")),
  );
}
/** A document's reviews, newest first: its own, the comparisons it is part of, and older-format ones. */
const reviewsOf = (view: ResearchQualityView, documentId: string) => view.reviews.filter((x) => x.sources.some((s) => s.documentId === documentId));
const roleOf = (d: Doc) => {
  const roles = (d.source?.roles ?? []).filter((x) => x === "brief" || x === "proposal");
  return roles.length === 2 ? "Brief and proposal" : roles[0] === "brief" ? "Brief" : roles[0] === "proposal" ? "Proposal" : "Brief or proposal";
};

export default function ResearchQualityReview({ runId }: { runId: string }) {
  const [view, setView] = useState<ResearchQualityView | null>(null);
  const [error, setError] = useState<{ text: string; setup?: boolean } | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null);
  // The document chosen on the left; null until chosen, when the shown review's own document is used.
  const [docId, setDocId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // Criteria tab: its two filters and the criterion opened (null: the dimension's criteria, all of them).
  const [dimension, setDimension] = useState("all");
  const [status, setStatus] = useState("all");
  const [criterion, setCriterion] = useState<string | null>(null);
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
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      setHighlight(id);
      setDocId(id);
    };
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
  const docs = reviewableDocs(view);
  // The document shown: the one chosen, else one highlighted from Import, else the shown review's own,
  // else the first. A chosen document that has gone (deleted) falls back the same way.
  const fallback = (highlight && docs.find((d) => d.id === highlight)?.id) ?? view.review?.sources.find((s) => docs.some((d) => d.id === s.documentId))?.documentId ?? docs[0]?.id ?? null;
  const doc = docs.find((d) => d.id === docId) ?? docs.find((d) => d.id === fallback) ?? null;
  // The loaded review belongs on the right only while its document is the one shown.
  const review = doc && view.review && view.review.sources.some((s) => s.documentId === doc.id) ? view.review : null;
  const openReview = (id: string) => {
    setCriterion(null);
    setDimension("all");
    setStatus("all");
    setReviewId(id);
  };
  const chooseDoc = (d: Doc) => {
    setDocId(d.id);
    const latest = reviewsOf(view, d.id)[0];
    if (latest && latest.id !== view.review?.id) openReview(latest.id);
  };
  return (
    <div data-testid="research-quality">
      <ThreePane
        storageKey="research-quality-v4"
        wideRight
        middle={
          <section className="overflow-hidden rounded-xl border-2 border-border bg-white lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto" aria-label="Selected review">
            {error && <p role="alert" className="m-5 mb-0 rounded-md bg-red-50 p-2 text-sm text-red-800">{error.text}</p>}
            {doc ? (
              <ReviewDetail
                runId={runId}
                view={view}
                docs={docs}
                doc={doc}
                review={review}
                picker={<DocumentPicker view={view} docs={docs} doc={doc} highlight={highlight} activeReviewId={review?.id ?? null} onChoose={chooseDoc} onOpen={openReview} />}
                tab={tab}
                setTab={setTab}
                dimension={dimension}
                setDimension={setDimension}
                status={status}
                setStatus={setStatus}
                criterion={criterion}
                setCriterion={setCriterion}
                onStarted={(id) => {
                  setHighlight(null);
                  setTab("overview");
                  openReview(id);
                }}
                reload={() => load(reviewId)}
              />
            ) : (
              <p className="p-5 text-sm text-muted">No briefs or proposals yet. Add one under Import data as a Brief or a Proposal; Word, PDF and text files can be reviewed.</p>
            )}
          </section>
        }
        right={
          <Pane side="plain" title="Criterion details">
            {review ? (
              <CriterionPanel view={view} dimension={dimension} criterion={criterion} />
            ) : (
              <p className="text-xs text-muted">Choose a bar or a criterion of a review to see its question, the reasons for its rating, the document&apos;s own words and what to improve.</p>
            )}
          </Pane>
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------- the document and review pickers

/**
 * The document and its review, chosen at the top of the review pane (Grant, 2026-10-20: the left
 * pane folded into the top of the second, so the third can show a criterion's detail). The review
 * list is the document's history, newest first: its own reviews and the comparisons it is part of.
 */
function DocumentPicker({
  view,
  docs,
  doc,
  highlight,
  activeReviewId,
  onChoose,
  onOpen,
}: {
  view: ResearchQualityView;
  docs: Doc[];
  doc: Doc;
  highlight: string | null;
  activeReviewId: string | null;
  onChoose: (d: Doc) => void;
  onOpen: (reviewId: string) => void;
}) {
  const mine = reviewsOf(view, doc.id);
  return (
    <div className="flex flex-col gap-2 border-b border-border bg-slate-50 px-5 py-3" data-testid="rq-picker" data-document-id={doc.id} data-highlight={highlight === doc.id ? "true" : "false"}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-muted">
          {`Document (${docs.length})`}
          <select
            aria-label="Document"
            value={doc.id}
            onChange={(e) => {
              const d = docs.find((x) => x.id === e.target.value);
              if (d) onChoose(d);
            }}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground"
          >
            {docs.map((d) => (
              <option key={d.id} value={d.id}>
                {`${d.filename} · ${roleOf(d)}`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs text-muted">
          {`Review (${mine.length} of this document)`}
          <select
            aria-label="Review"
            value={activeReviewId ?? ""}
            disabled={mine.length === 0}
            onChange={(e) => e.target.value && onOpen(e.target.value)}
            className="rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground disabled:text-muted"
          >
            {mine.length === 0 && <option value="">No review yet</option>}
            {mine.map((x) => (
              <option key={x.id} value={x.id}>
                {`${x.kind === "proposal_vs_brief" ? "Proposal against brief" : reviewLabel(x)} · No. ${x.sequence} · ${x.createdAt.slice(0, 10)} · ${STATE_LABEL[x.state] ?? x.state}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11px] text-muted">
        <span data-testid="rq-doc-role">{roleOf(doc)}</span>
        {doc.source?.currentVersion ? (doc.source.currentVersion.purged ? " · kept text removed" : " · text kept for its reviews") : " · not reviewed yet"}
        {" · AI ratings of how well the document is written against good research practice, checked by code against its own words; a guide to what to improve, not a certification."}
        {/* Deleted documents in the same paragraph, to keep the block short (Grant, 2026-10-20). */}
        {view.detachedSources.map((s) => ` ${s.filename ?? "A document"} was deleted from the project; its reviews stay readable${s.purged ? " (text removed)" : ""}.`).join("")}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- right: the selected review

const readOf = (s: { assessedRanges: { start: number; end: number }[] }) => s.assessedRanges.reduce((n, x) => n + (x.end - x.start), 0);

function ReviewDetail({
  runId,
  view,
  docs,
  doc,
  review,
  picker,
  tab,
  setTab,
  dimension,
  setDimension,
  status,
  setStatus,
  criterion,
  setCriterion,
  onStarted,
  reload,
}: {
  runId: string;
  view: ResearchQualityView;
  docs: Doc[];
  doc: Doc;
  review: ResearchQualityView["review"];
  picker: React.ReactNode;
  tab: Tab;
  setTab: (t: Tab) => void;
  dimension: string;
  setDimension: (d: string) => void;
  status: string;
  setStatus: (s: string) => void;
  criterion: string | null;
  setCriterion: (c: string | null) => void;
  onStarted: (id: string) => void;
  reload: () => Promise<void>;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [briefId, setBriefId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const charsOf = (id: string) => view.documents.find((d) => d.id === id)?.source?.currentVersion?.charCount ?? null;
  const nameOf = (id: string | null) => view.documents.find((d) => d.id === id)?.filename ?? "a removed document";
  // The brief to compare this document with: any other brief or proposal, a recorded brief first.
  const briefs = docs.filter((d) => d.id !== doc.id).sort((a, b) => Number((b.source?.roles ?? []).includes("brief")) - Number((a.source?.roles ?? []).includes("brief")));
  const chosenBrief = briefs.some((b) => b.id === briefId) ? briefId : (briefs[0]?.id ?? "");

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
  const isBrief = (doc.source?.roles ?? []).includes("brief") && !(doc.source?.roles ?? []).includes("proposal");
  return (
    <div className="flex flex-col">
      {picker}
      <div className="flex flex-col gap-3 px-5 pb-4 pt-5" data-testid="rq-selected">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Selected review</p>
          <h3 className="text-xl font-semibold text-foreground">{review ? (review.kind === "proposal_vs_brief" ? "Proposal against brief" : reviewLabel(review)) : "No review yet"}</h3>
          <p className="mt-0.5 break-words text-sm text-foreground">{review ? review.manifest.sources.map((s) => s.filename).join(" against ") : doc.filename}</p>
          {review && (
            <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_TONE[review.state] ?? "bg-slate-100 text-slate-600"}`} data-testid="rq-state-chip">
                {review.progress.interrupted ? "interrupted" : (STATE_LABEL[review.state] ?? review.state)}
              </span>
              <span>{`No. ${review.sequence} · ${review.createdAt.slice(0, 10)}${review.createdBy ? ` · ${review.createdBy}` : ""}`}</span>
            </p>
          )}
          {!review && <p className="mt-1 text-xs text-muted">Review it as a brief or a proposal: a score for each part of good practice, an overall score and, for each part, what to improve.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Review actions">
          <button className={isBrief ? primary : btn} disabled={busy} onClick={() => void ask("brief", [doc.id])}>
            Review brief
          </button>
          <button className={isBrief ? btn : primary} disabled={busy} onClick={() => void ask("proposal", [doc.id])}>
            Review proposal
          </button>
          <button className={btn} disabled={busy || briefs.length === 0} title={briefs.length === 0 ? "Add a brief to compare this proposal with" : undefined} onClick={() => void ask("proposal_vs_brief", [doc.id, chosenBrief])}>
            Compare with brief
          </button>
          {review && (
            <a className={btn} href={`/api/runs/${runId}/research-quality/export?review=${review.id}`} download>
              Download review (Word)
            </a>
          )}
          <details className="relative">
            <summary className={`${btn} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>More actions</summary>
            <div className="absolute right-0 z-20 mt-1 w-72 rounded-lg border border-border bg-white p-2 text-xs shadow-lg">
              {doc.source?.currentVersion && !doc.source.currentVersion.purged ? (
                <button
                  type="button"
                  className="w-full rounded-md px-2 py-1 text-left text-danger hover:bg-slate-50"
                  onClick={async () => {
                    if (!window.confirm(`Permanently remove the copy of ${doc.filename}'s text kept with its reviews? Quotes from it are removed and cannot be recovered. The project document itself is not affected.`)) return;
                    const x = await purgeResearchQualitySourceAction(runId, doc.source!.sourceId);
                    setMsg(x.ok ? { text: `Removed ${x.versions} kept version(s) of ${doc.filename}.`, error: false } : { text: x.error, error: true });
                    await reload();
                  }}
                >
                  Remove kept text
                </button>
              ) : (
                <p className="px-2 py-1 text-muted">No kept text to remove for this document.</p>
              )}
            </div>
          </details>
        </div>
        {pending && (
          <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-white p-3 text-xs" data-testid="rq-confirm">
            {pending.kind === "proposal_vs_brief" && (
              <label className="flex flex-wrap items-center gap-2">
                <span className="text-muted">Brief to compare with</span>
                <select
                  aria-label="Brief to compare"
                  value={pending.documentIds[1]}
                  onChange={(e) => {
                    setBriefId(e.target.value);
                    void ask("proposal_vs_brief", [doc.id, e.target.value]);
                  }}
                  className="rounded-md border border-border px-2 py-1"
                >
                  {briefs.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.filename}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
        )}
        {msg && (
          <p role={msg.error ? "alert" : "status"} className={`text-xs ${msg.error ? "text-red-800" : "text-emerald-800"}`}>
            {msg.text}
          </p>
        )}
        {review && <PartlyReadNotes review={review} />}
        {review && <ReviewState runId={runId} review={review} reload={reload} />}
      </div>
      {review && (
        <>
          <div role="tablist" aria-label="Parts of the review" className="flex gap-6 border-b border-border px-5">
            {(
              [
                ["overview", "Overview"],
                ["criteria", "Criteria"],
                ["improvements", "Improvements"],
                ["details", "Details"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`rq-tab-${id}`}
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`-mb-px border-b-2 py-2.5 text-sm font-medium ${tab === id ? "border-primary text-primary" : "border-transparent text-muted hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p-5">
            <div role="tabpanel" aria-labelledby="rq-tab-overview" className={tab === "overview" ? "flex flex-col gap-3" : "hidden"}>
              {review.kind ? (
                <>
                  {review.dashboards.map((d) => (
                    <Dashboard
                      key={d.dashboardId}
                      d={d}
                      selected={dimension === "all" ? null : dimension}
                      selectedCriterion={criterion}
                      onSelect={(id) => {
                        setDimension(id);
                        setStatus("all");
                        setCriterion(null);
                      }}
                      onSelectCriterion={(dimensionId, criterionId) => {
                        setDimension(dimensionId);
                        setStatus("all");
                        setCriterion(criterionId);
                      }}
                    />
                  ))}
                  {review.dashboards.length === 0 && review.state !== "running" && review.state !== "pending" && <p className="text-xs text-muted">Nothing could be rated.</p>}
                </>
              ) : (
                <LegacyReview
                  view={view}
                  selected={criterion}
                  onSelect={(id) => setCriterion(id)}
                />
              )}
            </div>
            <div role="tabpanel" aria-labelledby="rq-tab-criteria" className={tab === "criteria" ? "" : "hidden"}>
              <CriteriaTab view={view} dimension={dimension} setDimension={setDimension} status={status} setStatus={setStatus} criterion={criterion} setCriterion={setCriterion} />
            </div>
            <div role="tabpanel" aria-labelledby="rq-tab-improvements" className={tab === "improvements" ? "" : "hidden"}>
              <Improvements view={view} />
            </div>
            <div role="tabpanel" aria-labelledby="rq-tab-details" className={tab === "details" ? "" : "hidden"}>
              <ReviewMetadata review={review} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Sources the reviewer read only in part: shown above the tabs, as they limit what was rated. */
function PartlyReadNotes({ review }: { review: NonNullable<ResearchQualityView["review"]> }) {
  return (
    <>
      {review.manifest.sources
        .filter((s) => readOf(s) < s.charCount)
        .map((s) => (
          <p key={s.sourceId} className="rounded-md bg-amber-50 p-2 text-xs text-amber-900">{`${s.filename}: only the first ${readOf(s).toLocaleString("en-GB")} of ${s.charCount.toLocaleString("en-GB")} characters were read, so later sections are not rated.`}</p>
        ))}
    </>
  );
}

/** Who ran the review, on what, under which releases: its own tab (Grant, 2026-10-20), as it is for checking rather than reading. */
function ReviewMetadata({ review }: { review: NonNullable<ResearchQualityView["review"]> }) {
  return (
    <div className="text-xs" data-testid="rq-metadata">
      <h3 className="text-sm font-medium text-foreground">Reviewer, source versions and review metadata</h3>
      <dl className="mt-2 grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-muted">
        <dt>Started</dt>
        <dd className="text-foreground">{`${review.createdAt.slice(0, 16).replace("T", " ")}${review.createdBy ? `, by ${review.createdBy}` : ""}`}</dd>
        {review.completedAt && (
          <>
            <dt>Finished</dt>
            <dd className="text-foreground">{review.completedAt.slice(0, 16).replace("T", " ")}</dd>
          </>
        )}
        {review.manifest.sources.map((s) => (
          <MetaRow key={s.sourceVersionId} label={s.filename} value={`${s.roles.join(" and ") || "no role"}; ${s.charCount.toLocaleString("en-GB")} characters, ${readOf(s).toLocaleString("en-GB")} read`} />
        ))}
        <dt>Criteria release</dt>
        <dd className="text-foreground">{review.criteriaRelease}</dd>
        <dt>Model and prompt</dt>
        <dd className="text-foreground">{`${review.model}, prompt ${review.promptVersion}`}</dd>
        <dt>Cost</dt>
        <dd className="text-foreground">{`US$${review.actualCostUsd.toFixed(2)}${review.estimatedCostUsd !== null ? ` (estimated US$${review.estimatedCostUsd.toFixed(2)})` : ""}`}</dd>
      </dl>
      {review.syntheticReferences && <p className="mt-1 font-semibold text-amber-800">Synthetic test references in use.</p>}
    </div>
  );
}
const MetaRow = ({ label, value }: { label: string; value: string }) => (
  <>
    <dt className="truncate" title={label}>{label}</dt>
    <dd className="text-foreground">{value}</dd>
  </>
);

/** Running, interrupted, partial or failed: what happened, which steps failed, and the retry. */
function ReviewState({ runId, review, reload }: { runId: string; review: NonNullable<ResearchQualityView["review"]>; reload: () => Promise<void> }) {
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const running = (review.state === "pending" || review.state === "running") && !review.progress.interrupted;
  const failedSteps = shownFailedSteps(review);
  const retry = async (note: string) => {
    const x = await retryResearchQualityReviewAction(runId, review.id);
    setRetryMsg(x.ok ? note : x.error);
    await reload();
  };
  const quiet = review.state === "complete" && !review.progress.interrupted && !retryMsg;
  return (
    <div
      data-testid="rq-review-state"
      data-state={review.state}
      className={quiet ? "hidden" : `rounded-lg p-3 text-xs ${review.state === "failed" ? "bg-red-50 text-red-800" : review.state === "complete" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}
    >
      {running && (
        <p>{`Reviewing: ${review.progress.done} of ${review.progress.total} steps done${review.progress.failed ? `, ${review.progress.failed} failed` : ""}. Each step can take a minute or two; this page updates by itself.`}</p>
      )}
      {review.progress.interrupted && (
        <p data-testid="rq-review-interrupted">
          {`The review stopped before it finished (${review.progress.done} of ${review.progress.total} steps), most likely because the server restarted. Nothing done so far is lost. `}
          <button className={btn} onClick={() => void retry("Continuing the review from where it stopped.")}>
            Continue review
          </button>
        </p>
      )}
      {review.state === "partial" && <p>{`Partly complete: ${failedSteps.length} step(s) failed. What is shown was rated; the rest is shown as not rated.`}</p>}
      {review.state === "failed" && <p>The review failed: nothing could be rated.</p>}
      {failedSteps.map((t) => (
        <p key={t.key} className="mt-1" data-testid="rq-failed-step" data-step={t.key}>{`${reviewStepLabel(t.key, review.manifest)}: ${t.error ?? "failed"}. Attempts ${t.attempts} of ${t.maxAttempts}.`}</p>
      ))}
      {failedSteps.some((t) => t.attempts < t.maxAttempts) ? (
        <button className={`${btn} mt-2`} onClick={() => void retry("Retrying the failed steps only.")}>
          Retry failed steps
        </button>
      ) : (
        failedSteps.length > 0 && <p className="mt-1">No retries remain for these steps. Start a new review if it is still needed; this one stays as it is.</p>
      )}
      {retryMsg && <p className="mt-1">{retryMsg}</p>}
    </div>
  );
}

/** The Criteria tab: filter by dimension and status and choose a criterion; its detail is on the right. */
function CriteriaTab({
  view,
  dimension,
  setDimension,
  status,
  setStatus,
  criterion,
  setCriterion,
}: {
  view: ResearchQualityView;
  dimension: string;
  setDimension: (d: string) => void;
  status: string;
  setStatus: (s: string) => void;
  criterion: string | null;
  setCriterion: (c: string | null) => void;
}) {
  const r = view.review!;
  const all = r.kind
    ? criterionRows(r.dashboards)
    : // An older-format review: its criteria from its observations, in scorecard order.
      scorecard(r.observations).flatMap((g) =>
        g.rows.map((row) => ({ criterionId: row.observation.criterionId, dimensionId: g.group, dimensionLabel: g.label, score: row.score, status: row.label })),
      );
  const dimensions = [...new Map(all.map((x) => [x.dimensionId, x.dimensionLabel])).entries()];
  const statuses = [...new Set(all.map((x) => x.status))];
  const rows = filterCriterionRows(all, dimension, status);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Dimension
          <select
            aria-label="Dimension"
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value);
              setCriterion(null);
            }}
            className="min-w-[12rem] rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="all">All dimensions</option>
            {dimensions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Assessment status
          <select
            aria-label="Assessment status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCriterion(null);
            }}
            className="min-w-[12rem] rounded-lg border border-border bg-white px-2.5 py-1.5 text-sm text-foreground"
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="border-t border-border pt-3 text-xs" open>
        <summary className="cursor-pointer select-none text-sm font-medium text-foreground">{`Choose a criterion (${rows.length})`}</summary>
        <ul className="mt-2 flex flex-col gap-0.5" aria-label="Criteria">
          {rows.map((x) => (
            <li key={x.criterionId} data-criterion-row={x.criterionId}>
              <button
                type="button"
                onClick={() => setCriterion(x.criterionId)}
                aria-pressed={criterion === x.criterionId}
                className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left ${criterion === x.criterionId ? "bg-primary-light font-medium text-primary" : "hover:bg-slate-50"}`}
              >
                <span className="min-w-0 truncate">
                  {criterionShortLabel(x.criterionId)}
                  {dimension === "all" && x.dimensionLabel !== criterionShortLabel(x.criterionId) && <span className="ml-1.5 text-[11px] font-normal text-muted">{x.dimensionLabel}</span>}
                </span>
                <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${x.score === null ? "text-muted" : scoreText(x.score)}`}>{x.score === null ? x.status : `${x.score} ${x.status}`}</span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="text-muted">No criterion has that dimension and status.</li>}
        </ul>
      </details>
      <p className="text-[11px] text-muted">Choose a criterion for its detail on the right.</p>
    </div>
  );
}

/**
 * The right-hand pane: the chosen criterion's detail; with a dimension chosen and no single criterion,
 * all of that dimension's criteria (a category's with its weight and average); otherwise a prompt.
 */
function CriterionPanel({ view, dimension, criterion }: { view: ResearchQualityView; dimension: string; criterion: string | null }) {
  const r = view.review!;
  const dim = r.dashboards.flatMap((d) => d.dimensions).find((x) => x.dimensionId === dimension);
  const shown = criterion ? [criterion] : dim ? dim.criteria.map((c) => c.criterionId) : [];
  if (shown.length === 0) {
    return <p className="text-xs text-muted">Click a bar or a criterion to see its question, the reasons for its rating, the document&apos;s own words and what to improve.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="rq-details" data-dimension={criterion ?? dimension}>
      {!criterion && dim?.categoryLabel && (
        <div>
          <h4 className="text-sm font-semibold text-foreground">{dim.categoryLabel}</h4>
          <p className="text-xs text-muted">{`Weight ${dim.weight}%. The average of its rated criteria: ${dim.score === null ? "not rated" : `${dim.score.toFixed(1)} of 5`}.`}</p>
        </div>
      )}
      {shown.map((cid) => (
        <CriterionDetail key={cid} view={view} criterionId={cid} />
      ))}
    </div>
  );
}

/** The Improvements tab: each criterion's improvement, by when it can be made. */
function Improvements({ view }: { view: ResearchQualityView }) {
  const groups = improvementsByTiming(view.review!.observations).filter((g) => g.items.length > 0);
  if (groups.length === 0) return <p className="text-xs text-muted">No improvements were suggested in this review.</p>;
  return (
    <div className="flex flex-col gap-4 text-xs" data-testid="rq-improvements">
      {groups.map((g) => (
        <section key={g.timing}>
          <h4 className="mb-1.5 text-sm font-semibold text-foreground">{g.label}</h4>
          <ul className="flex flex-col gap-2">
            {g.items.map((o) => (
              <li key={o.versionId} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{criterionShortLabel(o.criterionId)}</p>
                <p className="mt-0.5">{[o.payload.improvement!.currentAction, o.payload.improvement!.futureAction].filter(Boolean).join(" ")}</p>
                {o.payload.improvement!.rationale && <p className="mt-1 text-muted">{o.payload.improvement!.rationale}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the dashboard

// A category's average falls between ratings, so colours follow the bands: 4 or more (80%) Strong,
// 3 or more (60%) Workable, 1 or more Weak, below 1 towards Absent.
const scoreBar = (score: number) => (score >= 4 ? "bg-indigo-500" : score >= 3 ? "bg-amber-400" : score >= 1 ? "bg-slate-400" : "bg-rose-400");
const scoreText = (score: number) => (score >= 4 ? "text-indigo-700" : score >= 3 ? "text-amber-700" : score >= 1 ? "text-slate-600" : "text-rose-700");
const BAND_RING: Record<string, string> = { strong: "#6366f1", workable: "#f59e0b", weak: "#e11d48" };
const BAND_LABEL: Record<string, string> = { strong: "Strong", workable: "Workable", weak: "Weak" };

/**
 * The bird's-eye view: the weighted overall percentage as a ring and one bar per dimension. A bar is
 * a button: choosing it shows that dimension's criteria on the right. Every figure is computed on the
 * server (researchQualityDashboard.ts); this only draws them.
 */
function Dashboard({
  d,
  selected,
  onSelect,
  selectedCriterion = null,
  onSelectCriterion,
}: {
  d: DashboardView;
  selected: string | null;
  onSelect: (id: string) => void;
  selectedCriterion?: string | null;
  /** A category's own item: its detail alone on the right (without it, the item opens its category). */
  onSelectCriterion?: (dimensionId: string, criterionId: string) => void;
}) {
  const current = selected;
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
                          onClick={() => (onSelectCriterion ? onSelectCriterion(x.dimensionId, c.criterionId) : onSelect(x.dimensionId))}
                          aria-pressed={selectedCriterion === c.criterionId}
                          className={`flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] ${selectedCriterion === c.criterionId ? "bg-primary-light ring-1 ring-primary/30" : "hover:bg-slate-50"}`}
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
          ? "A category's bar is its total, the average of its rated items listed under it. Click a bar for all its items, or an item for that one, with the reasons on the right."
          : "Click a bar for its criterion, with the reasons on the right."}
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
  const statementCount = obs.reduce((n, o) => n + o.payload.statements.length, 0);
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
          {rating?.state === "pending" ? "Not rated yet: the review is still running." : rating?.state === "failed" ? "Could not be rated: its step failed. Retry the failed steps above the tabs." : "Not rated."}
        </p>
      )}
      {first?.payload.rating?.reason && (
        <p className="mt-2">
          <span className="font-medium">Why: </span>
          {first.payload.rating.reason}
        </p>
      )}
      {criterionId === "RQ-PROP-SAMPLE-SIZE" && <PrecisionChecks checks={r.manifest.precisionChecks} />}
      {statementCount > 0 && (
        // Closed when a criterion is opened (Grant, 2026-10-20): the quotes can run to a page, and the
        // rating and its reason come first. Keyed by criterion so switching criteria closes it again.
        <details key={criterionId} className="group mt-2" data-testid="rq-document-words">
          <summary className="cursor-pointer select-none font-medium marker:text-muted">
            {`In the document's words (${statementCount})`}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {obs
              .flatMap((o) => o.payload.statements)
              .map((s) => (
                <li key={s.factId} className="border-l-2 border-slate-300 pl-2 text-slate-700">
                  {`“${s.exactQuote ?? "(text removed)"}”`}
                  <span className="text-muted">{` ${sourceName(s.sourceVersionId)}, ${s.locator.page ? `p. ${s.locator.page}` : `para. ${s.locator.segmentId.replace(/^s/, "")}`}`}</span>
                </li>
              ))}
          </ul>
        </details>
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
