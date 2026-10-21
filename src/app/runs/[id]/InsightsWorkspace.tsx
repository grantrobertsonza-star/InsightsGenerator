"use client";

import { useMemo, useState, type ReactNode } from "react";
import SynthesizedInsightsReview, { type InsightsReviewStart, type SynthesizedInsightRow } from "./SynthesizedInsightsReview";
import { AttentionRow, StatTile, WorkspaceTabs } from "./OverviewTiles";
import { inUseWith, SUPPORT_LABEL, summarizeInsights } from "@/lib/evidenceOverview";

type Tab = "overview" | "review";

/**
 * The Insights section (Grant, 2026-10-21): an overview first, then the existing review screen. The
 * overview counts the insights the Review tab lists (lib/evidenceOverview.summarizeInsights): whether
 * their support is still current, their stored quality band, how independently they are corroborated
 * and how they were reviewed, kept as separate judgements (accepting never repairs support, and no
 * combined score is made). The top insights are the highest stored quality among those in use whose
 * support is current. Every figure opens the Review tab with the very filter it was counted with
 * (Codex OV-01), or with that insight selected; a headline that sums several figures opens nothing,
 * and "All N insights" is the unfiltered route. The review stays mounted while the overview shows.
 */
export default function InsightsWorkspace({
  runId,
  insights,
  toolbar,
}: {
  runId: string;
  insights: SynthesizedInsightRow[];
  /** The exports and Run synthesis, rendered on the server, above the review. */
  toolbar: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [request, setRequest] = useState<{ start: InsightsReviewStart; n: number }>({ start: {}, n: 0 });
  const o = useMemo(() => summarizeInsights(insights), [insights]);
  const open = (start: InsightsReviewStart) => {
    setRequest((r) => ({ start, n: r.n + 1 }));
    setTab("review");
  };
  const inUse = o.total - o.review.rejected;

  // Nothing to summarise yet: the review as it was, with Run synthesis, and no tabs.
  if (insights.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="insights-workspace">
        {toolbar}
        <SynthesizedInsightsReview runId={runId} insights={insights} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="insights-workspace">
      <WorkspaceTabs
        label="Insights views"
        testId="insights-tab"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "review", label: `Insights (${insights.length})` },
        ]}
      />

      {tab === "overview" && (
          // OV-04: everything shrinks to the workspace, which the sidebar can leave very narrow; long
          // words break rather than push the page sideways.
          <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-slate-100 p-3 [overflow-wrap:anywhere] sm:p-5" data-testid="insights-overview">
            <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))]">
              <StatTile
                title="Evidence health"
                total={`${inUse} in use`}
                headline={o.support.current}
                headlineLabel="rest on current support"
                testId="io-support"
                segments={[
                  { key: "current", label: "Current", count: o.support.current, color: "bg-teal-700", onOpen: () => open(inUseWith({ support: "current" })) },
                  { key: "stale", label: "Changed", count: o.support.stale, color: "bg-amber-400", onOpen: () => open(inUseWith({ support: "stale" })) },
                  { key: "invalid", label: "No longer valid", count: o.support.invalid, color: "bg-rose-700", onOpen: () => open(inUseWith({ support: "invalid" })) },
                  { key: "unknown", label: "Not checked", count: o.support.unknown, color: "bg-slate-300", onOpen: () => open(inUseWith({ support: "unknown" })) },
                ]}
              />
              <StatTile
                title="Insight quality"
                total={`${inUse - o.quality.unscored} of ${inUse} scored`}
                headline={o.quality.qualified}
                headlineLabel="qualified (15 or more of 25)"
                testId="io-quality"
                segments={[
                  { key: "qualified", label: "Qualified", count: o.quality.qualified, color: "bg-blue-800", onOpen: () => open(inUseWith({ quality: "qualified" })) },
                  { key: "partial", label: "Partial", count: o.quality.partial, color: "bg-blue-400", onOpen: () => open(inUseWith({ quality: "partial" })) },
                  { key: "finding", label: "Finding only", count: o.quality.finding, color: "bg-blue-200", onOpen: () => open(inUseWith({ quality: "finding" })) },
                  { key: "unscored", label: "Not scored", count: o.quality.unscored, color: "bg-slate-200", onOpen: () => open(inUseWith({ quality: "unscored" })) },
                ]}
              />
              {/* OV-02: a stored tier counts as corroboration only once the sources were checked for
                  independence; a legacy tier with unchecked sources is counted apart, never as strong. */}
              <StatTile
                title="Corroboration"
                total={`${inUse - o.corroboration.unchecked} of ${inUse} sources checked`}
                headline={o.corroboration.strong}
                headlineLabel="strongly corroborated, sources checked"
                testId="io-confidence"
                segments={[
                  { key: "strong", label: "Strong", count: o.corroboration.strong, color: "bg-blue-800", onOpen: () => open(inUseWith({ corroboration: "strong" })) },
                  { key: "moderate", label: "Moderate", count: o.corroboration.moderate, color: "bg-blue-400", onOpen: () => open(inUseWith({ corroboration: "moderate" })) },
                  { key: "exploratory", label: "Exploratory", count: o.corroboration.exploratory, color: "bg-slate-400", onOpen: () => open(inUseWith({ corroboration: "exploratory" })) },
                  { key: "unrated", label: "No tier", count: o.corroboration.unrated, color: "bg-slate-300", onOpen: () => open(inUseWith({ corroboration: "unrated" })) },
                  { key: "unchecked", label: "Independence not checked", count: o.corroboration.unchecked, color: "bg-slate-200", onOpen: () => open(inUseWith({ corroboration: "unchecked" })) },
                ]}
              />
              <StatTile
                title="Researcher review"
                total={`${o.total} insights`}
                headline={o.review.accepted}
                headlineLabel="accepted"
                testId="io-review"
                segments={[
                  { key: "accepted", label: "Accepted", count: o.review.accepted, color: "bg-blue-800", onOpen: () => open({ review: "accepted" }) },
                  { key: "rejected", label: "Rejected", count: o.review.rejected, color: "bg-slate-500", onOpen: () => open({ review: "rejected" }) },
                ]}
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <section className="flex min-w-0 flex-[999_1_min(100%,35rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="io-top-h">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="io-top-h" className="text-base font-semibold text-foreground">What the evidence says</h3>
                  <span className="text-xs text-slate-600">Highest stored quality, current support only</span>
                </div>
                {o.top.length === 0 ? (
                  <p className="text-sm text-slate-600">No insight in use rests on current support yet. Check the ones listed under Needs a decision.</p>
                ) : (
                  <ol className="flex flex-col gap-2" data-testid="io-top">
                    {o.top.map((i, n) => (
                      <li key={i.id}>
                        <button
                          type="button"
                          onClick={() => open({ selectedId: i.id })}
                          data-insight-id={i.id}
                          className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-slate-200 p-3 text-left hover:border-slate-400"
                        >
                          <span className="text-xl font-bold text-slate-400">{String(n + 1).padStart(2, "0")}</span>
                          {/* Rank, wording and score sit in a row when there is room; on a narrow
                              workspace the wording takes the full width and the score goes below. */}
                          <span className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
                            <span className="text-sm font-semibold leading-snug text-foreground">{i.headline}</span>
                            {i.implication && <span className="line-clamp-2 text-xs leading-relaxed text-slate-600">{i.implication}</span>}
                            <span className="flex flex-wrap gap-1.5 text-[11px]">
                              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-800">{SUPPORT_LABEL.current}</span>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{i.review_status === "accepted" ? "Accepted" : "Rejected"}</span>
                              {i.independent_source_count !== null && (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                                  {`${i.independent_source_count} independent ${i.independent_source_count === 1 ? "source" : "sources"} · ${i.source_theme_count} ${i.source_theme_count === 1 ? "theme" : "themes"}`}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="ml-auto flex flex-col items-end gap-1">
                            {i.quality_score !== null ? (
                              <>
                                <span className="text-lg font-bold text-foreground">
                                  {i.quality_score}
                                  <span className="text-xs font-medium text-slate-600"> / 25</span>
                                </span>
                                <span className="flex h-1.5 w-24 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
                                  <span className="bg-blue-800" style={{ width: `${(i.quality_score / 25) * 100}%` }} />
                                </span>
                              </>
                            ) : (
                              <span className="text-xs text-slate-600">Not scored</span>
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <button type="button" onClick={() => open({})} className="self-start text-sm font-semibold text-primary hover:underline">
                  {`All ${insights.length} insights`}
                </button>
              </section>

              <section className="flex min-w-0 flex-[1_1_min(100%,20rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="io-attention-h">
                <h3 id="io-attention-h" className="text-base font-semibold text-foreground">Needs a decision</h3>
                <p className="text-xs text-slate-600">Before anything goes into the report or deck.</p>
                {o.support.invalid + o.support.stale + o.support.unknown === 0 ? (
                  <p className="text-sm text-slate-600">Every insight in use rests on current support.</p>
                ) : (
                  <div className="flex flex-col gap-2" data-testid="io-attention">
                    {o.support.invalid > 0 && <AttentionRow testId="io-attention-invalid" tone="rose" count={o.support.invalid} title="Rest on support that is no longer valid" detail="A finding behind each was rejected, or its source changed. Kept out of Accepted exports until reviewed." onOpen={() => open(inUseWith({ support: "invalid" }))} />}
                    {o.support.stale > 0 && <AttentionRow testId="io-attention-stale" tone="amber" count={o.support.stale} title="Support has changed since they were written" onOpen={() => open(inUseWith({ support: "stale" }))} />}
                    {o.support.unknown > 0 && <AttentionRow testId="io-attention-unknown" tone="slate" count={o.support.unknown} title="Support could not be checked" onOpen={() => open(inUseWith({ support: "unknown" }))} />}
                  </div>
                )}
              </section>
            </div>
            <p className="text-xs text-slate-600">
              Support, quality, corroboration and review are separate judgements: accepting an insight does not make its support current, and no combined score is shown.
            </p>
          </div>
      )}

      <div className={tab === "review" ? "flex flex-col gap-4" : "hidden"} role="tabpanel" aria-label="Insights">
        {toolbar}
        <SynthesizedInsightsReview runId={runId} insights={insights} request={request} />
      </div>
    </div>
  );
}
