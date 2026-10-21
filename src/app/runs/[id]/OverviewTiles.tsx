"use client";

import type { ReactNode } from "react";

/**
 * Shared pieces of the Findings and Insights overviews (Grant, 2026-10-21): a summary tile with a
 * stacked bar and a legend, and a "needs a decision" row. A segment or row with `onOpen` is a button
 * that opens the Review tab filtered to exactly the records it counts; one without is plain text,
 * because no filter for it exists. Colours differ in lightness as well as hue, and every count is
 * also written out in the legend, so nothing depends on colour alone.
 */
export type Segment = { key: string; label: string; count: number; color: string; onOpen?: () => void };

export function StatTile({
  title,
  total,
  headline,
  headlineLabel,
  segments,
  testId,
  onOpen,
  action,
}: {
  title: string;
  /** "121 insights" and the like, top right. */
  total: string;
  headline: number;
  headlineLabel: string;
  segments: Segment[];
  testId: string;
  /** Opens exactly the records the headline counts; omit when the headline sums several figures. */
  onOpen?: () => void;
  /** A separate, plainly labelled route (for example to an unfiltered list), under the legend. */
  action?: { label: string; onOpen: () => void };
}) {
  const sum = segments.reduce((n, s) => n + s.count, 0);
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" data-testid={testId} aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        <span className="text-xs text-slate-600">{total}</span>
      </div>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="flex flex-wrap items-baseline gap-x-2 text-left hover:underline">
          <span className="text-3xl font-bold text-foreground" data-testid={`${testId}-headline`}>{headline}</span>
          <span className="text-sm text-slate-600">{headlineLabel}</span>
        </button>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-3xl font-bold text-foreground" data-testid={`${testId}-headline`}>{headline}</span>
          <span className="text-sm text-slate-600">{headlineLabel}</span>
        </div>
      )}
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100"
        role="img"
        aria-label={segments.map((s) => `${s.label} ${s.count}`).join(", ")}
      >
        {sum > 0 && segments.filter((s) => s.count > 0).map((s) => <span key={s.key} className={s.color} style={{ flex: s.count }} />)}
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-700">
        {segments.map((s) => (
          <li key={s.key}>
            {s.onOpen && s.count > 0 ? (
              <button type="button" onClick={s.onOpen} className="flex items-center gap-1.5 hover:underline" data-testid={`${testId}-${s.key}`}>
                <span className={`h-2 w-2 rounded-sm ${s.color}`} aria-hidden="true" />
                {`${s.label} ${s.count}`}
              </button>
            ) : (
              <span className="flex items-center gap-1.5" data-testid={`${testId}-${s.key}`}>
                <span className={`h-2 w-2 rounded-sm ${s.color}`} aria-hidden="true" />
                {`${s.label} ${s.count}`}
              </span>
            )}
          </li>
        ))}
      </ul>
      {action && (
        <button type="button" onClick={action.onOpen} className="self-start text-xs font-semibold text-primary hover:underline" data-testid={`${testId}-action`}>
          {action.label}
        </button>
      )}
    </section>
  );
}

export function AttentionRow({
  count,
  title,
  detail,
  tone,
  onOpen,
  testId,
}: {
  count: number;
  title: string;
  detail?: ReactNode;
  tone: "rose" | "orange" | "amber" | "slate";
  onOpen?: () => void;
  testId: string;
}) {
  const toneClass = {
    rose: "bg-rose-50 text-rose-700",
    orange: "bg-orange-50 text-orange-700",
    amber: "bg-amber-50 text-amber-800",
    slate: "bg-slate-50 text-slate-700",
  }[tone];
  const body = (
    <>
      <span className={`min-w-[2.5rem] text-xl font-bold ${toneClass.split(" ")[1]}`}>{count}</span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        {detail && <span className="text-xs text-slate-600">{detail}</span>}
      </span>
    </>
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`flex w-full items-start gap-3 rounded-lg p-3 text-left hover:ring-1 hover:ring-slate-300 ${toneClass.split(" ")[0]}`} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div className={`flex items-start gap-3 rounded-lg p-3 ${toneClass.split(" ")[0]}`} data-testid={testId}>
      {body}
    </div>
  );
}

/** The tab strip of the Findings and Insights workspaces. */
export function WorkspaceTabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  testId,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
  label: string;
  testId: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-5 border-b border-slate-200" data-testid={testId}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          data-testid={`${testId}-${t.id}`}
          onClick={() => onChange(t.id)}
          className={`-mb-px border-b-2 py-2 text-sm font-medium ${active === t.id ? "border-primary text-primary" : "border-transparent text-slate-600 hover:text-foreground"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
