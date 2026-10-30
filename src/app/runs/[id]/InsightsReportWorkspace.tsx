"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DownloadIcon } from "@/components/icons";
import { AttentionRow, StatTile, WorkspaceTabs } from "./OverviewTiles";
import { useGoToSection } from "./RunShell";
import type { FigureStatus } from "@/lib/numberTrace";
import {
  summarizeReportReadiness,
  type ReadinessInsight,
  type ReadinessNarrative,
  type ReadinessRecommendation,
} from "@/lib/reportReadiness";

type Tab = "overview" | "narrative";

/**
 * The Insights report section (Grant, 2026-10-21): a readiness overview first, then the existing
 * generate and narrative screen. The overview counts what the deck and the Word report will be built
 * from and what holds them back (lib/reportReadiness, which states the export rules it reports). It
 * never changes what the exports include: they still decide that themselves when they are built.
 * The narrative screen stays mounted while the overview shows.
 */
export default function InsightsReportWorkspace({
  runId,
  insights,
  recommendations,
  narrative,
  narrativeFigures,
  narrativeView,
}: {
  runId: string;
  insights: ReadinessInsight[];
  recommendations: ReadinessRecommendation[];
  narrative: ReadinessNarrative | null;
  /** The narrative's stored figure check, or null when none is stored or the checks did not load. */
  narrativeFigures: FigureStatus | null;
  /** The generate, narrative and objectives screen, rendered on the server. */
  narrativeView: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const goTo = useGoToSection();
  const r = useMemo(
    () => summarizeReportReadiness(insights, recommendations, narrative, narrativeFigures),
    [insights, recommendations, narrative, narrativeFigures],
  );

  // Nothing accepted and nothing generated: the screen as it was, with a pointer to Insights.
  if (r.insights.accepted === 0 && !r.narrative) {
    return (
      <div className="flex flex-col gap-4" data-testid="insights-report-workspace">
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700" data-testid="ri-empty">
          <span>The report is built from accepted insights and recommendations. There are none yet.</span>
          <button type="button" onClick={() => goTo("synthesized")} className="font-semibold text-primary hover:underline">
            Open Insights
          </button>
        </div>
        {narrativeView}
      </div>
    );
  }

  const n = r.narrative;
  const openNarrative = () => setTab("narrative");
  const ins = r.insights.support;
  const rec = r.recommendations.support;
  const narrativeNotCurrent = n ? n.support.invalid + n.support.stale + n.support.unknown : 0;
  const attention: ReactNode[] = [];
  if (!n) {
    attention.push(
      <AttentionRow key="none" testId="ri-attention-generate" tone="slate" count={r.insights.included} title="Generate the narrative" detail="Neither export exists until the narrative is generated from the accepted insights." onOpen={openNarrative} />,
    );
  }
  if (ins.invalid > 0) {
    attention.push(
      <AttentionRow key="ii" testId="ri-attention-insights-invalid" tone="rose" count={ins.invalid} title="Insights left out: support no longer valid" detail="Both exports leave them out and say why. Opens the Insights section (all insights, not filtered)." onOpen={() => goTo("synthesized")} />,
    );
  }
  if (rec.invalid > 0) {
    attention.push(
      <AttentionRow key="ri" testId="ri-attention-recommendations-invalid" tone="rose" count={rec.invalid} title="Recommendations left out with their insight" detail="Each is built on an insight whose support is no longer valid. Opens the Recommendations section (not filtered)." onOpen={() => goTo("recommendations")} />,
    );
  }
  if (n && narrativeNotCurrent > 0) {
    attention.push(
      <AttentionRow key="nf" testId="ri-attention-narrative-support" tone="amber" count={narrativeNotCurrent} title="The narrative cites insights whose support is not current" detail="Its framing is exported as saved, with a note on each slide. Regenerate to update it." onOpen={openNarrative} />,
    );
  }
  if (r.narrativeFigures === "unsupported" || r.narrativeFigures === "needs_review") {
    attention.push(
      <AttentionRow key="fig" testId="ri-attention-figures" tone={r.narrativeFigures === "unsupported" ? "rose" : "amber"} count={1} title={r.narrativeFigures === "unsupported" ? "Figures in the narrative are not supported by its evidence" : "Figures in the narrative need review"} onOpen={openNarrative} />,
    );
  }
  if (ins.stale + ins.unknown > 0) {
    attention.push(
      <AttentionRow key="iq" testId="ri-attention-insights-qualified" tone="amber" count={ins.stale + ins.unknown} title="Insights included with a qualification" detail="Their support changed since they were drafted, or could not be checked. Opens the Insights section (not filtered)." onOpen={() => goTo("synthesized")} />,
    );
  }
  if (r.recommendations.pending > 0) {
    attention.push(
      <AttentionRow key="rp" testId="ri-attention-recommendations-pending" tone="slate" count={r.recommendations.pending} title="Recommendations not yet reviewed" detail="Only accepted recommendations go into the report. Opens the Recommendations section (not filtered)." onOpen={() => goTo("recommendations")} />,
    );
  }
  if (r.recommendations.onUnacceptedInsight > 0) {
    attention.push(
      <AttentionRow key="ru" testId="ri-attention-recommendations-orphaned" tone="slate" count={r.recommendations.onUnacceptedInsight} title="Accepted recommendations on a rejected insight" detail="Not used in the report while their insight is rejected. Opens the Recommendations section (not filtered)." onOpen={() => goTo("recommendations")} />,
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="insights-report-workspace">
      <WorkspaceTabs
        label="Insights report views"
        testId="report-tab"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "narrative", label: "Narrative and exports" },
        ]}
      />

      {tab === "overview" && (
        // OV-04: everything shrinks to the workspace, which the sidebar can leave very narrow; long
        // words break rather than push the page sideways.
        <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-slate-100 p-3 [overflow-wrap:anywhere] sm:p-5" data-testid="insights-report-overview">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,13rem),1fr))]">
            <StatTile
              title="Insights in the report"
              total={`${r.insights.accepted} accepted`}
              headline={r.insights.included}
              headlineLabel="included"
              testId="ri-insights"
              action={{ label: "Open the Insights section", onOpen: () => goTo("synthesized") }}
              segments={[
                { key: "current", label: "Current", count: ins.current, color: "bg-teal-700" },
                { key: "stale", label: "Changed", count: ins.stale, color: "bg-amber-400" },
                { key: "unknown", label: "Not checked", count: ins.unknown, color: "bg-slate-300" },
                { key: "invalid", label: "Left out", count: ins.invalid, color: "bg-rose-700" },
              ]}
            />
            <StatTile
              title="Recommendations in the report"
              total={`${r.recommendations.accepted} accepted`}
              headline={r.recommendations.included}
              headlineLabel="included"
              testId="ri-recommendations"
              action={{ label: "Open the Recommendations section", onOpen: () => goTo("recommendations") }}
              segments={[
                { key: "current", label: "Current", count: rec.current, color: "bg-teal-700" },
                { key: "stale", label: "Changed", count: rec.stale, color: "bg-amber-400" },
                { key: "unknown", label: "Not checked", count: rec.unknown, color: "bg-slate-300" },
                { key: "invalid", label: "Left out", count: rec.invalid, color: "bg-rose-700" },
              ]}
            />
            {n ? (
              <StatTile
                title="Narrative"
                total={n.generatedAt ? `Generated ${n.generatedAt}` : "Generated, date not recorded"}
                headline={n.cited}
                headlineLabel={`insights cited in ${n.pillars} ${n.pillars === 1 ? "pillar" : "pillars"}`}
                testId="ri-narrative"
                action={{ label: "Open the narrative", onOpen: openNarrative }}
                segments={[
                  { key: "current", label: "Current", count: n.support.current, color: "bg-teal-700" },
                  { key: "stale", label: "Changed", count: n.support.stale, color: "bg-amber-400" },
                  { key: "unknown", label: "Not checked", count: n.support.unknown, color: "bg-slate-300" },
                  { key: "invalid", label: "No longer valid", count: n.support.invalid, color: "bg-rose-700" },
                ]}
              />
            ) : (
              <section className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm" data-testid="ri-narrative" aria-label="Narrative">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Narrative</h3>
                <span className="text-2xl font-bold leading-tight text-foreground" data-testid="ri-narrative-headline">Not generated</span>
                <button type="button" onClick={openNarrative} className="self-start text-xs font-semibold text-primary hover:underline">
                  Generate it
                </button>
              </section>
            )}
          </div>

          <div className="flex flex-wrap gap-4">
            <section className="flex min-w-0 flex-[999_1_min(100%,35rem)] flex-col gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="ri-attention-h">
              <h3 id="ri-attention-h" className="text-base font-semibold text-foreground">Needs a decision before export</h3>
              {attention.length === 0 ? (
                <p className="text-sm text-slate-600" data-testid="ri-attention-none">
                  Every included insight and recommendation rests on current support, and the narrative cites only those.
                </p>
              ) : (
                <div className="flex flex-col gap-2" data-testid="ri-attention">
                  {attention}
                </div>
              )}
            </section>

            <section className="flex min-w-0 flex-[1_1_min(100%,20rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="ri-exports-h">
              <h3 id="ri-exports-h" className="text-base font-semibold text-foreground">Exports</h3>
              {n ? (
                <>
                  <div className="flex flex-wrap gap-2" data-testid="ri-exports">
                    <a href={`/api/runs/${runId}/story/export`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary">
                      <DownloadIcon className="h-3.5 w-3.5 text-muted" />
                      Export deck (.pptx)
                    </a>
                    <a href={`/api/runs/${runId}/story/export-docx`} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary">
                      <DownloadIcon className="h-3.5 w-3.5 text-muted" />
                      Export report (.docx)
                    </a>
                  </div>
                  <p className="text-xs text-slate-600">
                    Both are built from the narrative as last generated and the insights and recommendations accepted now.
                  </p>
                  {n.notCited > 0 && (
                    <p className="text-xs text-slate-600" data-testid="ri-not-cited">
                      {`${n.notCited} accepted ${n.notCited === 1 ? "insight is" : "insights are"} not cited by the narrative${n.overflow > 0 ? ` (the pillars show at most three each; ${n.overflow} more were placed in a pillar)` : ""}.`}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600">Available once the narrative is generated.</p>
              )}
            </section>
          </div>
          <p className="text-xs text-slate-600" data-testid="ri-freshness-note">
            Whether insights or recommendations were edited after the narrative was generated is not checked: no edit time is stored. Regenerate after changing them.
          </p>
        </div>
      )}

      <div className={tab === "narrative" ? "block" : "hidden"} role="tabpanel" aria-label="Narrative and exports">
        {narrativeView}
      </div>
    </div>
  );
}
