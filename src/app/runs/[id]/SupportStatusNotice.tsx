// FND-001 / ANA-NPS-003 downstream freshness: the support-status notice shown on any card that
// rests on a synthesized insight (the insight itself, and recommendations anchored to it).
// Presentational only; the status comes from the server (supportStatus.ts).
import {
  SUPPORT_STATUS_LABEL,
  summariseSupport,
  type InsightSupport,
  type SupportStatus,
} from "@/lib/supportStatusShared";

// FND-001: words on every badge, never colour alone. A current insight shows no badge, so the
// screen only draws attention where something moved.
const supportBadgeClass: Record<Exclude<SupportStatus, "current">, string> = {
  stale: "bg-amber-50 text-amber-800",
  invalid: "bg-rose-50 text-rose-800",
  unknown: "bg-slate-100 text-slate-600",
};

/** FND-001: the support badge and its reason, for any card anchored to a synthesized insight. */
export function SupportStatusNotice({
  support,
  subject = "insight",
}: {
  support: InsightSupport;
  /** What the card is, for the explanation: an insight, or a recommendation inheriting it. */
  subject?: "insight" | "recommendation";
}) {
  if (support.status === "current") return null;
  return (
    <p
      data-testid="support-status"
      data-support-status={support.status}
      className="text-xs text-foreground"
    >
      <span
        className={`mr-1.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${supportBadgeClass[support.status]}`}
      >
        {SUPPORT_STATUS_LABEL[support.status]}
      </span>
      {subject === "recommendation" ? "Its insight: " : ""}
      {summariseSupport(support).replace(`${SUPPORT_STATUS_LABEL[support.status]}: `, "")}
      {support.status === "invalid"
        ? " It is left out of exports until you review it. Your wording and decision are kept."
        : support.status === "stale"
          ? " Exports show it with this note. Review it, or re-run synthesis to rebuild it from current evidence."
          : " Exports show it with this note."}
    </p>
  );
}
