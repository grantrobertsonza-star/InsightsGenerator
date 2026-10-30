"use client";

import { StatePill, STATE_LOOK } from "@/components/StageLook";
import { nextStep, type SectionStatus } from "@/lib/sectionStatus";
import { useGoToSection } from "./RunShell";

/**
 * Where a project opens (Grant, 27 October 2026: "Should we not always open on the same page?"): its four
 * stages with their state and headline, each opening that stage's overview, and the one next step,
 * from the same statuses as the stage overviews and the dashboard (sectionStatus.ts). A status that
 * could not be read says so; it is never shown as "nothing to do".
 */
export default function ProjectOverview({ sections, error }: { sections: SectionStatus[] | null; error: string | null }) {
  const go = useGoToSection();
  if (!sections) {
    return (
      <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="project-overview-error">
        {`The project's status could not be read: ${(error ?? "unknown error").replace(/\.$/, "")}. The stages are still open from the menu on the left.`}
      </p>
    );
  }
  const next = nextStep(sections);
  return (
    <div className="space-y-4" data-testid="project-overview">
      <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Next step</p>
        {next ? (
          <button type="button" className="mt-1 text-left text-sm text-primary hover:underline" onClick={() => go(next.moduleId)} data-testid="project-overview-next">
            <span className="font-medium">{next.label}</span>
            <span className="text-muted">{` · ${next.text}`}</span>
          </button>
        ) : (
          <p className="mt-1 text-sm text-muted">Nothing is waiting for you. Open a stage below to carry on.</p>
        )}
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {sections.map((s, i) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => go(s.navId)}
              data-testid="project-overview-stage"
              data-state={s.state}
              className={`flex h-full w-full flex-col items-start gap-2 rounded-xl border border-l-4 border-border bg-white p-4 text-left shadow-sm transition hover:border-primary/40 ${STATE_LOOK[s.state].rail}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{`${i + 1}. ${s.label}`}</span>
              <StatePill state={s.state} label={STATE_LOOK[s.state].label} />
              <span className="text-sm text-foreground">{s.headline}</span>
              <span className="mt-auto text-xs text-primary">{`Open ${s.label}`}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
