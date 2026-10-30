"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SectionStatus, ModuleStatus } from "@/lib/sectionStatus";
import type { StageItem, StageTarget } from "@/lib/stageStatus";
import { StateDisc, STATE_LOOK } from "@/components/StageLook";
import { SectionIcon } from "@/components/sectionIcons";
import { useRunSection } from "./RunShell";
import { dataFileLink, importFileLink, objectiveLink, scrollToAnchor } from "./stageLinks";

// A section's dashboard (Grant, 2026-10-23, 3001): the section's state, then a card per module
// with its state, headline, what needs the researcher (each linked to the exact item) and its
// caveats. States and items come from lib/sectionStatus.ts. Opening the dashboard refreshes the
// page's data, so a change made in a module shows here when you come back to it.

const ITEM_DOT: Record<StageItem["state"], string> = {
  couldnt_check: "bg-red-500",
  needs_you: "bg-amber-500",
  working: "bg-sky-500",
  caveat: "bg-slate-400",
};

export function useFollow() {
  const { setSelected } = useRunSection();
  return (moduleId: string, t: StageTarget) => {
    switch (t.kind) {
      case "section":
        setSelected(t.id);
        return;
      case "import_file":
        setSelected("upload");
        importFileLink.request({ documentId: t.documentId, tab: t.tab });
        return;
      case "data_file":
        setSelected("crosstabs");
        dataFileLink.request(t.documentId);
        scrollToAnchor("crosstab-workspace");
        return;
      case "objective":
        setSelected("objective");
        objectiveLink.request({ id: t.id, text: t.text });
        return;
      case "context_form":
        setSelected("objective");
        scrollToAnchor("objective-context");
        return;
      case "none":
        setSelected(moduleId);
    }
  };
}

export default function SectionDashboard({ navId, section, error }: { navId: string; section: SectionStatus | null; error: string | null }) {
  const { selected } = useRunSection();
  const router = useRouter();
  // Refreshed each time the dashboard is opened again (not on the first render, which is fresh).
  const wasOpen = useRef(selected === navId);
  useEffect(() => {
    const open = selected === navId;
    if (open && !wasOpen.current) router.refresh();
    wasOpen.current = open;
  }, [selected, navId, router]);

  if (!section)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" data-testid={`section-dashboard-${navId}`} data-state="couldnt_check">
        {`The status of this section could not be read: ${(error ?? "unknown error").replace(/\.$/, "")}. Reload the page to try again.`}
      </div>
    );

  const used = section.modules.filter((m) => m.status.state !== "not_used");
  const ready = used.filter((m) => m.status.state === "ready").length;
  const look = STATE_LOOK[section.state];
  return (
    <div data-testid={`section-dashboard-${navId}`} data-state={section.state}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StateDisc state={section.state} size="lg" />
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">{section.label}</h2>
          <p className="text-sm">
            <span className={`font-semibold ${look.text}`}>{look.label}</span>
            <span className="text-muted">{` · ${section.headline}`}</span>
            {used.length > 0 && <span className="text-muted">{` · ${ready} of ${used.length} ${used.length === 1 ? "module" : "modules"} ready`}</span>}
          </p>
        </div>
      </div>
      {/* Tiles (Grant, 2026-10-26): as many columns of about 17rem as the page holds, so the overview
          reads as a grid of modules rather than a few long rows across the page. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
        {section.modules.map((m) => (
          <ModuleCard key={m.id} id={m.id} label={m.label} status={m.status} />
        ))}
      </div>
    </div>
  );
}

function ModuleCard({ id, label, status }: { id: string; label: string; status: ModuleStatus }) {
  const follow = useFollow();
  const look = STATE_LOOK[status.state];
  const muted = status.state === "not_used";
  return (
    <section
      aria-labelledby={`module-${id}-label`}
      className={`flex flex-col rounded-xl border border-border border-l-4 bg-white p-3 shadow-sm ${look.rail} ${muted ? "bg-slate-50/60" : ""}`}
      data-testid={`module-card-${id}`}
      data-state={status.state}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${muted ? "bg-slate-100 text-slate-500" : "bg-primary-light text-primary"}`}>
          <SectionIcon id={id} label={label} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <h3 id={`module-${id}-label`} className="text-sm font-semibold text-foreground">
              {label}
            </h3>
            <span className={`text-[11px] font-bold uppercase tracking-wider ${look.text}`} data-testid="module-state">
              {look.label}
            </span>
          </div>
          <p className={`text-[13px] leading-snug ${muted ? "text-muted" : "text-foreground"}`}>{status.headline}</p>
          {status.counts.length > 1 && <p className="mt-0.5 text-xs text-muted">{status.counts.map((c) => c.label).join(" · ")}</p>}
        </div>
        <StateDisc state={status.state} size="sm" />
      </div>
      {status.issues.length > 0 && <Items items={status.issues} onFollow={(t) => follow(id, t)} testId="module-issues" limit={3} />}
      {status.caveats.length > 0 && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Keep in mind</p>
          <Items items={status.caveats} onFollow={(t) => follow(id, t)} testId="module-caveats" limit={2} />
        </div>
      )}
      <div className="mt-auto pt-3">
        <button type="button" onClick={() => follow(id, { kind: "section", id })} className="text-xs font-medium text-primary hover:underline" data-testid="module-open">
          {`Open ${label}`}
        </button>
      </div>
    </section>
  );
}

/** A module's items, the first `limit` shown with the rest behind "Show all" (no limit: all shown). */
function Items({ items, onFollow, testId, limit }: { items: StageItem[]; onFollow: (t: StageTarget) => void; testId: string; limit?: number }) {
  const [all, setAll] = useState(false);
  const cap = limit ?? items.length;
  const shown = all ? items : items.slice(0, cap);
  return (
    <ul className="mt-2 flex flex-col gap-1" data-testid={testId}>
      {shown.map((it) => (
        <li key={it.key} className="flex items-start gap-2 text-[13px] leading-snug" data-item-state={it.state}>
          <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ITEM_DOT[it.state]}`} />
          {it.target.kind !== "none" ? (
            <button type="button" onClick={() => onFollow(it.target)} className="text-left text-primary hover:underline">
              {it.text}
            </button>
          ) : (
            <span className="text-foreground">{it.text}</span>
          )}
        </li>
      ))}
      {items.length > cap && (
        <li>
          <button type="button" onClick={() => setAll(!all)} className="ml-4 text-xs text-muted hover:text-foreground hover:underline">
            {all ? "Show fewer" : `Show all ${items.length}`}
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * The status at the top of a module's page (Grant, 2026-10-23: "the dashboard on the pages as well";
 * 2026-10-26: everything the overview lists for the module, rolled up on the page itself rather than a
 * jump to the overview): the module's state and headline and its first item, linked; "N more" opens the
 * rest of its items and its caveats in place, from the same rule as the overview card
 * (lib/sectionStatus.ts). Not shown for an unused module.
 */
export function ModuleStatusBar({ moduleId, status, overview }: { moduleId: string; status: ModuleStatus | null; overview: { navId: string; label: string } | null }) {
  const follow = useFollow();
  const { setSelected } = useRunSection();
  const [open, setOpen] = useState(false);
  if (!status)
    return (
      <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid={`module-bar-${moduleId}`} data-state="couldnt_check">
        The status of this module could not be read. Reload the page to try again.
      </p>
    );
  if (status.state === "not_used") return null;
  const look = STATE_LOOK[status.state];
  const first = status.issues[0] ?? null;
  const rest = status.issues.slice(1);
  const more = rest.length + status.caveats.length;
  const detailId = `module-bar-${moduleId}-detail`;
  return (
    <div
      className={`mb-3 rounded-lg border border-border border-l-4 bg-white px-3 py-2 text-sm shadow-sm ${look.rail}`}
      data-testid={`module-bar-${moduleId}`}
      data-state={status.state}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StateDisc state={status.state} size="sm" />
        <span className={`text-[11px] font-bold uppercase tracking-wider ${look.text}`}>{look.label}</span>
        <span className="font-medium text-foreground">{status.headline}</span>
        {first &&
          (first.target.kind !== "none" && !(first.target.kind === "section" && first.target.id === moduleId) ? (
            <button type="button" onClick={() => follow(moduleId, first.target)} className="text-left text-primary hover:underline" data-testid="module-bar-first">
              {first.text}
            </button>
          ) : (
            <span className="text-muted" data-testid="module-bar-first">
              {first.text}
            </span>
          ))}
        {more > 0 && (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={detailId}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
            data-testid="module-bar-toggle"
          >
            {open ? "Show less" : `${more} more`}
            <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}>
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      {open && (
        <div id={detailId} className="mt-2 border-t border-border pt-2" data-testid="module-bar-detail">
          {rest.length > 0 && <Items items={rest} onFollow={(t) => follow(moduleId, t)} testId="module-bar-issues" />}
          {status.caveats.length > 0 && (
            <div className={rest.length > 0 ? "mt-2" : ""}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Keep in mind</p>
              <Items items={status.caveats} onFollow={(t) => follow(moduleId, t)} testId="module-bar-caveats" />
            </div>
          )}
          {overview && (
            <button type="button" onClick={() => setSelected(overview.navId)} className="mt-2 text-xs text-muted hover:text-foreground hover:underline" data-testid="module-bar-overview">
              {`See every module on the ${overview.label} overview`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
