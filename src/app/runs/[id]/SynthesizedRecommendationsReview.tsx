"use client";

import { useState, useTransition } from "react";
import {
  acceptRecommendation,
  rejectRecommendation,
  restoreRecommendation,
  updateAndAcceptRecommendation,
  addOwnSynthesizedRecommendation,
  deleteRecommendation,
  regenerateSynthesizedRecommendations,
} from "@/lib/recommendationActions";
import { TrashIcon } from "@/components/icons";

type Priority = "high" | "medium" | "low";

type QualityTier = "finding" | "partial" | "qualified";

type ConfidenceTier = "strong" | "moderate" | "exploratory";

type Recommendation = {
  id: string;
  synthesized_insight_id: string;
  synthesized_insight_headline: string;
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: Priority;
  assumptions_and_risks: string;
  alternatives_considered: string;
  source: "researcher_authored" | "ai_suggested";
  status: "pending" | "accepted" | "rejected";
  edited: boolean;
  confidence_tier: ConfidenceTier | null;
  quality_score: number | null;
  quality_tier: QualityTier | null;
};

const qualityTierClass: Record<QualityTier, string> = {
  qualified: "bg-indigo-50 text-indigo-700",
  partial: "bg-amber-50 text-amber-700",
  finding: "bg-slate-100 text-slate-600",
};

const confidenceTierClass: Record<ConfidenceTier, string> = {
  strong: "bg-success-light text-success",
  moderate: "bg-amber-50 text-amber-700",
  exploratory: "bg-slate-100 text-slate-600",
};

const confidenceTierLabel: Record<ConfidenceTier, string> = {
  strong: "Strong",
  moderate: "Moderate",
  exploratory: "Exploratory",
};

type InsightOption = { id: string; headline: string };

// An accepted synthesized insight sitting in the reserve: it has cleared
// the evidence bar but has no accepted recommendation yet, either because
// the synthesizer itself flagged it as having no feasible action plan
// (Simoudis 2015's "retained, no action" case), or because one simply
// hasn't been generated, generated recommendation was rejected, or hasn't
// been accepted yet. Nothing here is lost; it resurfaces once a
// researcher adds a recommendation by hand or a later wave's data makes
// one of the generator's own candidates make sense.
type ParkedInsight = {
  id: string;
  headline: string;
  observation: string;
  tension: string;
  implication: string;
  action_plan_status: "has_action" | "retained_no_action";
};

type Draft = {
  action_text: string;
  owner_role: string;
  owner_feasibility_note: string;
  timeline: string;
  metric: string;
  priority: Priority;
  assumptions_and_risks: string;
  alternatives_considered: string;
};

const sourceLabel: Record<Recommendation["source"], string> = {
  researcher_authored: "Your text",
  ai_suggested: "Suggested",
};

const priorityStyle: Record<Priority, string> = {
  high: "bg-danger-light text-danger",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-slate-100 text-slate-500",
};

const inputClass =
  "w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const textareaClass = `${inputClass} resize-none`;
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-muted";

function draftFrom(rec: Recommendation): Draft {
  return {
    action_text: rec.action_text,
    owner_role: rec.owner_role,
    owner_feasibility_note: rec.owner_feasibility_note,
    timeline: rec.timeline,
    metric: rec.metric,
    priority: rec.priority,
    assumptions_and_risks: rec.assumptions_and_risks,
    alternatives_considered: rec.alternatives_considered,
  };
}

function draftComplete(draft: Draft): boolean {
  return Boolean(
    draft.action_text.trim() &&
      draft.owner_role.trim() &&
      draft.owner_feasibility_note.trim() &&
      draft.timeline.trim() &&
      draft.metric.trim() &&
      draft.assumptions_and_risks.trim() &&
      draft.alternatives_considered.trim()
  );
}

function EditFields({ draft, onChange }: { draft: Draft; onChange: (draft: Draft) => void }) {
  return (
    <div className="space-y-2">
      <div>
        <label className={labelClass}>Action</label>
        <textarea
          rows={2}
          value={draft.action_text}
          onChange={(e) => onChange({ ...draft, action_text: e.target.value })}
          className={textareaClass}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Owner role</label>
          <input value={draft.owner_role} onChange={(e) => onChange({ ...draft, owner_role: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Timeline</label>
          <input value={draft.timeline} onChange={(e) => onChange({ ...draft, timeline: e.target.value })} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Why this owner, and feasibility</label>
        <textarea
          rows={2}
          value={draft.owner_feasibility_note}
          onChange={(e) => onChange({ ...draft, owner_feasibility_note: e.target.value })}
          className={textareaClass}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Metric</label>
          <input value={draft.metric} onChange={(e) => onChange({ ...draft, metric: e.target.value })} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Priority</label>
          <select
            value={draft.priority}
            onChange={(e) => onChange({ ...draft, priority: e.target.value as Priority })}
            className={inputClass}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div>
        <label className={labelClass}>Assumptions and risks</label>
        <textarea
          rows={2}
          value={draft.assumptions_and_risks}
          onChange={(e) => onChange({ ...draft, assumptions_and_risks: e.target.value })}
          className={textareaClass}
        />
      </div>
      <div>
        <label className={labelClass}>Alternatives considered</label>
        <textarea
          rows={2}
          value={draft.alternatives_considered}
          onChange={(e) => onChange({ ...draft, alternatives_considered: e.target.value })}
          className={textareaClass}
        />
      </div>
    </div>
  );
}

function RecommendationCard({ runId, recommendation }: { runId: string; recommendation: Recommendation }) {
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(draftFrom(recommendation));

  const isAccepted = recommendation.status === "accepted";
  const isRejected = recommendation.status === "rejected";

  function handleDelete() {
    if (!confirm("Delete this recommendation? This can't be undone.")) return;
    startTransition(() => deleteRecommendation(runId, recommendation.id));
  }

  return (
    <div
      className={`rounded-lg border p-4 transition ${
        isAccepted ? "border-success bg-success-light" : isRejected ? "border-border opacity-50" : "border-border bg-white"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
              recommendation.source === "ai_suggested" ? "bg-primary-light text-primary" : "bg-slate-100 text-slate-500"
            }`}
          >
            {sourceLabel[recommendation.source]}
          </span>
          <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${priorityStyle[recommendation.priority]}`}>
            {recommendation.priority} priority
          </span>
          {recommendation.confidence_tier && (
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${confidenceTierClass[recommendation.confidence_tier]}`}
              title="Triangulation strength of the synthesized insight this recommendation was built from"
            >
              {confidenceTierLabel[recommendation.confidence_tier]}
            </span>
          )}
          {recommendation.quality_tier && (
            <span
              className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${qualityTierClass[recommendation.quality_tier]}`}
              title="Quality score of the insight this recommendation was built from"
            >
              Insight: {recommendation.quality_score}/25
            </span>
          )}
          {recommendation.edited && (
            <span className="inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Edited before accepting
            </span>
          )}
          {isAccepted && (
            <span className="inline-block rounded bg-success px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Accepted
            </span>
          )}
        </div>
        <button
          disabled={isPending}
          onClick={handleDelete}
          aria-label="Delete recommendation"
          title="Delete recommendation"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-danger-light hover:text-danger"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>

      <div className="mb-2 text-xs text-muted">
        From insight: <span className="font-medium text-foreground">{recommendation.synthesized_insight_headline}</span>
      </div>

      {isEditing ? (
        <EditFields draft={draft} onChange={setDraft} />
      ) : (
        <div className="space-y-1.5 text-sm">
          <div className="font-medium text-foreground">{recommendation.action_text}</div>
          <div className="text-xs text-muted">
            <span className="font-semibold text-foreground">{recommendation.owner_role}</span> &middot; {recommendation.timeline}
          </div>
          <div className="text-xs text-muted">{recommendation.owner_feasibility_note}</div>
          <div className="text-xs text-muted">
            <span className="font-semibold text-foreground">Metric: </span>
            {recommendation.metric}
          </div>
          <div className="text-xs text-muted">
            <span className="font-semibold text-foreground">Assumptions and risks: </span>
            {recommendation.assumptions_and_risks}
          </div>
          <div className="text-xs text-muted">
            <span className="font-semibold text-foreground">Alternatives considered: </span>
            {recommendation.alternatives_considered}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {isEditing ? (
          <>
            <button
              disabled={isPending || !draftComplete(draft)}
              onClick={() =>
                startTransition(async () => {
                  await updateAndAcceptRecommendation(runId, recommendation.id, draft);
                  setIsEditing(false);
                })
              }
              className="rounded-lg border border-success bg-success px-2.5 py-1 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              Save and accept
            </button>
            <button
              onClick={() => {
                setDraft(draftFrom(recommendation));
                setIsEditing(false);
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
          </>
        ) : isRejected ? (
          <button
            disabled={isPending}
            onClick={() => startTransition(() => restoreRecommendation(runId, recommendation.id))}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
          >
            Restore
          </button>
        ) : (
          <>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => acceptRecommendation(runId, recommendation.id))}
                className="rounded-lg border border-success px-2.5 py-1 text-xs font-medium text-success transition hover:bg-success-light"
              >
                Accept
              </button>
            )}
            <button
              disabled={isPending}
              onClick={() => setIsEditing(true)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted hover:border-slate-400 hover:text-foreground"
            >
              {isAccepted ? "Edit" : "Edit and accept"}
            </button>
            {!isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => rejectRecommendation(runId, recommendation.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Reject
              </button>
            )}
            {isAccepted && (
              <button
                disabled={isPending}
                onClick={() => startTransition(() => restoreRecommendation(runId, recommendation.id))}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-danger hover:text-danger"
              >
                Unaccept
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const emptyDraft: Draft = {
  action_text: "",
  owner_role: "",
  owner_feasibility_note: "",
  timeline: "",
  metric: "",
  priority: "medium",
  assumptions_and_risks: "",
  alternatives_considered: "",
};

/**
 * The funnel-output recommendations review: one card per recommendation
 * anchored to a synthesized (real) insight rather than a pre-insight. This
 * is what "Recommendations" means now -- a run with 16 real insights
 * produces something close to 16 recommendations, not 60 or 100 of them.
 * The original 1:1 pre-insight list still exists, just as its own "All
 * recommendations" section (see RecommendationsReview.tsx), kept rather
 * than replaced.
 *
 * Structurally this mirrors RecommendationsReview closely -- same
 * accept/reject/edit/delete contract, same auto-accepted-by-default
 * framing -- minus the theme filter, since a synthesized insight doesn't
 * carry a single theme the way a pre-insight does.
 */
export default function SynthesizedRecommendationsReview({
  runId,
  recommendations,
  insightOptions,
  parkedInsights,
  hasDecision,
  hasInsights,
}: {
  runId: string;
  recommendations: Recommendation[];
  // Every accepted synthesized insight this run has, for the "add your
  // own" picker. Only accepted ones: a rejected synthesized insight isn't
  // a real insight any more as far as the researcher is concerned.
  insightOptions: InsightOption[];
  // Accepted insights with no accepted recommendation yet -- the insight
  // reserve. See the ParkedInsight type above for why they're here.
  parkedInsights: ParkedInsight[];
  hasDecision: boolean;
  hasInsights: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [addInsightId, setAddInsightId] = useState(insightOptions[0]?.id ?? "");
  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft);
  const [priorityFilter, setPriorityFilter] = useState<"all" | Priority>("all");

  const live = recommendations.filter((r) => r.status !== "rejected");
  const highCount = live.filter((r) => r.priority === "high").length;
  const mediumCount = live.filter((r) => r.priority === "medium").length;
  const lowCount = live.filter((r) => r.priority === "low").length;

  const filteredRecommendations = recommendations.filter((rec) => {
    if (priorityFilter !== "all" && rec.priority !== priorityFilter) return false;
    return true;
  });

  const isFiltering = priorityFilter !== "all";

  const accepted = filteredRecommendations.filter((r) => r.status === "accepted");
  const pending = filteredRecommendations.filter((r) => r.status === "pending");
  const rejected = filteredRecommendations.filter((r) => r.status === "rejected");

  function handleRegenerate() {
    setRegenerateError(null);
    startTransition(async () => {
      const result = await regenerateSynthesizedRecommendations(runId);
      if (!result.ok) {
        setRegenerateError(result.error);
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-muted">
          One recommended action per synthesized insight: a named owner, a timeline, and a metric to judge
          it by. Every one proposed here is already accepted, so the run finishes without a review step; a
          genuine insight can support several actions side by side, so more than one is accepted at once.
          Reject anything that doesn&apos;t belong, edit one in place, or add your own tied to a specific
          insight.
        </p>
        {hasDecision && hasInsights && (
          <button
            disabled={isPending}
            onClick={handleRegenerate}
            className="whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60"
          >
            {isPending ? "Working..." : "Generate for new insights"}
          </button>
        )}
      </div>

      {regenerateError && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-4 py-3 text-sm text-danger">
          <span>Couldn&apos;t generate recommendations right now: {regenerateError}</span>
          <button onClick={() => setRegenerateError(null)} className="shrink-0 font-medium underline">
            Dismiss
          </button>
        </div>
      )}

      {!hasDecision && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          Waiting on a confirmed decision. Actions are judged against a specific decision, in both starting
          points, so this fills in automatically once one is accepted on the decision brief above.
        </div>
      )}

      {hasDecision && !hasInsights && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          No accepted synthesized insights yet to turn into actions. Once insights are clustered and
          accepted, recommendations are proposed automatically.
        </div>
      )}

      {hasDecision && hasInsights && recommendations.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-3 text-sm text-muted">
          We tried to generate recommendations automatically and it didn&apos;t come back with anything,
          most likely a temporary issue. Click &quot;Generate for new insights&quot; above to try again, or
          add your own below.
        </div>
      )}

      {live.length > 0 && (
        <div className="grid grid-cols-4 gap-2 sm:max-w-lg">
          <button
            type="button"
            onClick={() => setPriorityFilter("all")}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              priorityFilter === "all" ? "border-primary bg-primary-light" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-foreground">{live.length}</div>
            <div className="text-xs text-muted">Total</div>
          </button>
          <button
            type="button"
            onClick={() => setPriorityFilter((f) => (f === "high" ? "all" : "high"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              priorityFilter === "high" ? "border-danger bg-danger-light" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-danger">{highCount}</div>
            <div className="text-xs text-muted">High priority</div>
          </button>
          <button
            type="button"
            onClick={() => setPriorityFilter((f) => (f === "medium" ? "all" : "medium"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              priorityFilter === "medium" ? "border-amber-400 bg-amber-50" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-amber-700">{mediumCount}</div>
            <div className="text-xs text-muted">Medium priority</div>
          </button>
          <button
            type="button"
            onClick={() => setPriorityFilter((f) => (f === "low" ? "all" : "low"))}
            className={`rounded-lg border px-3 py-2 text-left transition ${
              priorityFilter === "low" ? "border-slate-400 bg-slate-100" : "border-border bg-white hover:border-slate-300"
            }`}
          >
            <div className="text-lg font-semibold text-slate-600">{lowCount}</div>
            <div className="text-xs text-muted">Low priority</div>
          </button>
        </div>
      )}

      {isFiltering && accepted.length === 0 && pending.length === 0 && (
        <p className="text-sm text-muted">No recommendations match this filter.</p>
      )}

      {accepted.length > 0 && (
        <div className="space-y-2">
          {accepted.map((rec) => (
            <RecommendationCard key={rec.id} runId={runId} recommendation={rec} />
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-2">
          {accepted.length > 0 && <div className="text-xs font-semibold uppercase tracking-wide text-muted">Other recommendations</div>}
          {pending.map((rec) => (
            <RecommendationCard key={rec.id} runId={runId} recommendation={rec} />
          ))}
        </div>
      )}

      {insightOptions.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!addInsightId || !draftComplete(addDraft)) return;
            startTransition(async () => {
              await addOwnSynthesizedRecommendation(runId, addInsightId, addDraft);
              setAddDraft(emptyDraft);
            });
          }}
          className="rounded-lg border border-dashed border-border p-4"
        >
          <label className={labelClass}>Add your own recommendation</label>
          <select value={addInsightId} onChange={(e) => setAddInsightId(e.target.value)} className={`${inputClass} mb-2`}>
            {insightOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.headline}
              </option>
            ))}
          </select>
          <EditFields draft={addDraft} onChange={setAddDraft} />
          <button
            type="submit"
            disabled={isPending || !addInsightId || !draftComplete(addDraft)}
            className="mt-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white transition hover:bg-primary-hover disabled:opacity-50"
          >
            Add recommendation
          </button>
        </form>
      )}

      {rejected.length > 0 && (
        <div className="rounded-lg border border-dashed border-border p-3">
          <button
            type="button"
            onClick={() => setRejectedOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-muted hover:text-foreground"
          >
            <span>Rejected ({rejected.length})</span>
            <span className="text-xs">{rejectedOpen ? "Hide" : "Show"}</span>
          </button>
          {rejectedOpen && (
            <div className="mt-3 space-y-2">
              {rejected.map((rec) => (
                <RecommendationCard key={rec.id} runId={runId} recommendation={rec} />
              ))}
            </div>
          )}
        </div>
      )}

      {parkedInsights.length > 0 && (
        <div className="rounded-lg border border-dashed border-indigo-200 bg-indigo-50/40 p-3">
          <button
            type="button"
            onClick={() => setReserveOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-indigo-700 hover:text-indigo-900"
          >
            <span>Insight reserve ({parkedInsights.length})</span>
            <span className="text-xs">{reserveOpen ? "Hide" : "Show"}</span>
          </button>
          {reserveOpen && (
            <div className="mt-3 space-y-2">
              <p className="text-xs text-indigo-700">
                Accepted insights with no accepted recommendation yet. Some were flagged by the Elevator as
                having no feasible action plan right now; others just haven&apos;t been turned into one. Nothing
                here is lost, add a recommendation by hand below, or revisit once a later wave adds more data.
              </p>
              {parkedInsights.map((insight) => (
                <div key={insight.id} className="rounded-lg border border-indigo-100 bg-white p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-foreground">{insight.headline}</div>
                    <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                      {insight.action_plan_status === "retained_no_action"
                        ? "No action plan identified"
                        : "Not yet actioned"}
                    </span>
                  </div>
                  <p className="text-xs text-muted">{insight.implication}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
