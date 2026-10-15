import type { ReactNode } from "react";

/**
 * The shared three-pane layout: a narrow input or filter pane on the left, the working list in the middle
 * and a detail pane on the right. On wide screens each pane scrolls on its own so the other two stay in
 * view; on narrow screens they stack. Server-safe, no state.
 */
export function ThreePane({
  left,
  middle,
  right,
  wideRight = false,
}: {
  left: ReactNode;
  middle: ReactNode;
  right?: ReactNode;
  /** A roomier right pane for dense content such as data quality tables. */
  wideRight?: boolean;
}) {
  const cols = right
    ? wideRight
      ? "lg:grid-cols-[22rem_minmax(0,1fr)_minmax(24rem,34%)]"
      : "lg:grid-cols-[22rem_minmax(0,1fr)_24rem]"
    : "lg:grid-cols-[22rem_minmax(0,1fr)]";
  return (
    <div className={`grid grid-cols-1 items-start gap-4 ${cols}`}>
      {left}
      {middle}
      {right}
    </div>
  );
}

const SIDES = {
  left: "bg-sky-50 border-sky-200",
  middle: "bg-slate-50 border-slate-300",
  right: "bg-white border-slate-300",
} as const;

const HEADERS = {
  left: "bg-sky-100 border-sky-200",
  middle: "bg-white border-slate-300",
  right: "bg-white border-slate-300",
} as const;

/** One pane: a header row (title, optional count and actions) over a body that scrolls on wide screens. */
export function Pane({
  side,
  title,
  badge,
  actions,
  children,
}: {
  side: keyof typeof SIDES;
  title: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border-2 lg:max-h-[calc(100vh-10rem)] ${SIDES[side]}`}
    >
      <header className={`flex shrink-0 items-center gap-2 border-b-2 ${HEADERS[side]} px-4 py-3`}>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {badge}
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      </header>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">{children}</div>
    </section>
  );
}
