import type { ReactNode } from "react";
import type { ModuleState } from "@/lib/sectionStatus";

// How each status looks (Grant, 2026-10-23): one colour, one icon and one word per state, the same
// on the section dashboards and on the main dashboard's project rows. Colour is never the only
// signal: every state also has its word and its icon.

export const STATE_LOOK: Record<ModuleState, { label: string; rail: string; text: string; disc: string; soft: string; icon: ReactNode }> = {
  ready: {
    label: "Ready",
    rail: "border-l-green-500",
    text: "text-green-700",
    disc: "bg-green-500",
    soft: "bg-green-50 text-green-800 ring-green-200",
    icon: <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  needs_you: {
    label: "Needs you",
    rail: "border-l-amber-500",
    text: "text-amber-700",
    disc: "bg-amber-500",
    soft: "bg-amber-50 text-amber-900 ring-amber-200",
    icon: <path d="M10 5v6M10 14.5v.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
  working: {
    label: "Working",
    rail: "border-l-sky-500",
    text: "text-sky-700",
    disc: "bg-sky-500",
    soft: "bg-sky-50 text-sky-900 ring-sky-200",
    icon: <path d="M10 5.5v4.5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  couldnt_check: {
    label: "Couldn't check",
    rail: "border-l-red-500",
    text: "text-red-700",
    disc: "bg-red-500",
    soft: "bg-red-50 text-red-800 ring-red-200",
    icon: <path d="M7.5 7.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2.2M10 14.5v.01" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  },
  not_used: {
    label: "Not used",
    rail: "border-l-slate-300",
    text: "text-slate-500",
    disc: "bg-slate-300",
    soft: "bg-slate-50 text-slate-600 ring-slate-200",
    icon: <path d="M6 10h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  },
};

export function StateDisc({ state, size = "md" }: { state: ModuleState; size?: "sm" | "md" | "lg" }) {
  const look = STATE_LOOK[state];
  const box = size === "lg" ? "h-10 w-10" : size === "md" ? "h-7 w-7" : "h-5 w-5";
  const glyph = size === "lg" ? "h-6 w-6" : size === "md" ? "h-4 w-4" : "h-3 w-3";
  return (
    <span aria-hidden="true" className={`flex ${box} shrink-0 items-center justify-center rounded-full text-white ${look.disc}`}>
      <svg viewBox="0 0 20 20" className={glyph}>
        {look.icon}
      </svg>
    </span>
  );
}

/** A compact pill: icon disc and word, for a section on the main dashboard. */
export function StatePill({ state, label, title }: { state: ModuleState; label: string; title?: string }) {
  const look = STATE_LOOK[state];
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-xs font-medium ring-1 ring-inset ${look.soft}`} data-state={state}>
      <StateDisc state={state} size="sm" />
      <span>
        {label}
        <span className="sr-only">: {look.label}</span>
      </span>
    </span>
  );
}
