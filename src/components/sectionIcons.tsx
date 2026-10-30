import type { ReactNode } from "react";
import { ChatIcon, DocumentIcon, ListIcon, PresentationIcon, SparkleIcon, TargetIcon, TranscriptIcon, UploadIcon } from "./icons";

/**
 * An icon for each of a project's sections, for the main menu's collapsed rail (Grant, 2026-10-20:
 * "small icons when the window is collapsed"). Outline icons at the size of the existing ones; a
 * section without one here shows its first letters instead, so a new section is never blank.
 */
const svg = (children: ReactNode) =>
  function SectionGlyph({ className }: { className?: string }) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    );
  };

const ShieldCheck = svg(
  <>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </>,
);
const Branch = svg(
  <>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <path d="M6 8.5v7M18 10.5c0 4-4 5.5-9.5 6.5" />
  </>,
);
const Table = svg(
  <>
    <rect x="3" y="5" width="18" height="14" rx="1.5" />
    <path d="M3 10h18M9 5v14" />
  </>,
);
const Trend = svg(
  <>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M15 7h6v6" />
  </>,
);
const Search = svg(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </>,
);
const Database = svg(
  <>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </>,
);
const Gauge = svg(
  <>
    <path d="M4.5 18a9 9 0 1 1 15 0" />
    <path d="M12 13l4-4" />
  </>,
);

const Overview = svg(
  <>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </>,
);

const SECTION_ICONS: Record<string, (p: { className?: string }) => ReactNode> = {
  "overview-prepare": Overview,
  "overview-analyse": Overview,
  "overview-develop": Overview,
  "overview-deliver": Overview,
  upload: UploadIcon,
  "research-quality": ShieldCheck,
  objective: TargetIcon,
  objectives: TargetIcon,
  decisions: Branch,
  crosstabs: Table,
  analytics: Trend,
  coding: TranscriptIcon,
  reports: PresentationIcon,
  findings: Search,
  synthesized: SparkleIcon,
  recommendations: ListIcon,
  "insights-report": DocumentIcon,
  assistant: ChatIcon,
  "working-data": Database,
  "api-usage": Gauge,
};

/** The section's icon, or its first letters when it has none. */
export function SectionIcon({ id, label, className }: { id: string; label: string; className?: string }) {
  const Icon = SECTION_ICONS[id];
  if (Icon) return <>{Icon({ className })}</>;
  return (
    <span aria-hidden="true" className="text-[10px] font-bold">
      {label
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? "")
        .join("")}
    </span>
  );
}
