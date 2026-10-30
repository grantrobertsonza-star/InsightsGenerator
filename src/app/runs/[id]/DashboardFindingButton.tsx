"use client";

// R5story: the brand tracking dashboard's story controls share one provider per open dashboard (one data file).
// The provider knows the project, the file and the client brand, and what has been posted from this file's
// dashboard (dashboardFindingStatusAction, which first checks the posted findings' sources). A card offers
// "Post as finding" with one element, <DashboardFindingButton page="..." card="..." />, naming the card as
// registered on the server (src/lib/trackerDashboardCards.ts); the server computes the figures and the sentence.
//
// Screen rules: "Posted" shows only after the server answers; a late answer for an earlier click (or another file,
// after the dashboard was reopened on it) never overwrites a newer one; a failure is shown on the card with the
// reason; a finding whose source changed since it was posted says so and can be posted again.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dashboardFindingStatusAction, postDashboardCardAction } from "@/lib/trackerDashboardStoryActions";


type Status = { findingId: string; page: string; card: string; kind: string; status: string; stale: boolean; superseded: boolean; reasons: string[]; focalCode: string | null };

type StoryContext = {
  runId: string;
  documentId: string;
  focalCode: string | null;
  statuses: Status[];
  freshnessError: string | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<StoryContext | null>(null);

export function useDashboardStory(): StoryContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDashboardStory needs a DashboardStoryProvider.");
  return c;
}

export function DashboardStoryProvider({ runId, documentId, focalCode, children }: { runId: string; documentId: string; focalCode: string | null; children: ReactNode }) {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [freshnessError, setFreshnessError] = useState<string | null>(null);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    const r = await dashboardFindingStatusAction(runId, documentId);
    if (id !== latest.current) return;
    if (!r.ok) return setFreshnessError(r.error);
    setStatuses(r.statuses as Status[]);
    setFreshnessError(r.freshnessError);
  }, [runId, documentId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => {
      latest.current += 1;
    };
  }, [refresh]);
  const value = useMemo(() => ({ runId, documentId, focalCode, statuses, freshnessError, refresh }), [runId, documentId, focalCode, statuses, freshnessError, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

type PostState = { state: "idle" } | { state: "posting" } | { state: "posted"; added: boolean; superseded: number } | { state: "failed"; error: string };

/** "Post as finding" for one registered dashboard card. */
export function DashboardFindingButton({ page, card, label }: { page: string; card: string; label?: string }) {
  const story = useDashboardStory();
  const [post, setPost] = useState<PostState>({ state: "idle" });
  const latest = useRef(0);
  // What is already posted for this card and the client brand chosen now (the newest live one).
  const posted = story.statuses.filter((s) => s.kind === "card" && s.page === page && s.card === card && s.status !== "rejected" && !s.superseded && (s.focalCode ?? null) === (story.focalCode ?? null)).pop();
  async function onPost() {
    const id = ++latest.current;
    setPost({ state: "posting" });
    const r = await postDashboardCardAction(story.runId, story.documentId, page, card);
    if (id !== latest.current) return;
    if (!r.ok) return setPost({ state: "failed", error: r.error });
    setPost({ state: "posted", added: r.added, superseded: r.superseded });
    void story.refresh();
  }
  const name = label ?? "this card";
  const stale = posted?.stale === true;
  const text =
    post.state === "posting"
      ? "Posting..."
      : post.state === "posted"
        ? post.added
          ? post.superseded > 0
            ? "Posted (earlier one marked superseded)"
            : "Posted as finding"
          : "Already posted"
        : stale
          ? "Source changed: post again"
          : posted
            ? "Posted"
            : "Post as finding";
  return (
    <span className="inline-flex flex-col items-end gap-0.5" data-testid="dashboard-finding" data-page={page} data-card={card}>
      <button
        type="button"
        onClick={() => void onPost()}
        disabled={post.state === "posting"}
        aria-label={`Post ${name} as a finding`}
        title={stale ? `Posted earlier; since then: ${posted?.reasons.join(" ")}` : posted ? "Already posted with the figures shown when it was posted. Click to post again if the figures changed." : "Post this card's figures as one finding, with its bases and caveats"}
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium disabled:opacity-60 ${
          stale ? "border-amber-300 bg-amber-50 text-amber-900" : posted || post.state === "posted" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
        }`}
        data-testid="dashboard-finding-button"
        data-state={post.state === "idle" ? (stale ? "stale" : posted ? "posted" : "idle") : post.state}
      >
        {text}
      </button>
      {post.state === "failed" && (
        <span role="alert" className="max-w-[16rem] text-right text-[11px] text-red-700" data-testid="dashboard-finding-error">
          {post.error}
        </span>
      )}
    </span>
  );
}
