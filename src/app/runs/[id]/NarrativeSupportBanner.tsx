// FND-001 / REP-OUT-001: the support line above a stored narrative. Presentational only; the
// counting rule lives in narrativeSupportSummary.ts.
import type { InsightSupport } from "@/lib/supportStatusShared";
import { summariseNarrativeSupport } from "@/lib/narrativeSupportSummary";

export function NarrativeSupportBanner({
  insightIds,
  supportById,
}: {
  insightIds: string[];
  supportById: Record<string, InsightSupport | undefined>;
}) {
  const summary = summariseNarrativeSupport(insightIds, supportById);
  if (!summary) return null;
  return (
    <p
      data-testid="narrative-support-status"
      data-support-status={summary.status}
      // The distinct insights this count covers, so a browser check can recount them from the
      // insight cards' own support statuses instead of trusting this sentence.
      data-cited-insight-ids={[...new Set(insightIds)].join(" ")}
      className="text-xs text-foreground"
    >
      <span className="font-semibold">{summary.heading}:</span> {summary.sentence}
    </p>
  );
}
