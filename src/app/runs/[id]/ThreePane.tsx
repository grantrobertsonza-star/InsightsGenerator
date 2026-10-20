"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

/**
 * The shared three-pane layout: a narrow input or filter pane on the left, the working list in the middle
 * and a detail pane on the right. On wide screens each pane scrolls on its own so the other two stay in
 * view, and the researcher can resize the side panes by dragging (or with the arrow keys on) the handles
 * between them, and collapse the left pane to a narrow rail. On narrow screens the panes stack and none
 * of this applies.
 *
 * Layout preferences are a per-browser convenience, kept in localStorage under one key per layout shape
 * (or `storageKey` when a screen passes its own). They are read after hydration through
 * useSyncExternalStore, so the server render and the first client render are always the default layout
 * (no hydration mismatch); a stored layout is applied straight after. Storage that is unavailable
 * (private window, blocked site data) simply means the defaults; nothing else depends on it.
 *
 * Collapsing hides the left pane's content but keeps it mounted, so filters or a half-typed entry in it
 * are not lost.
 */

const DEFAULT_LEFT_PX = 352; // 22rem, the original fixed width
const DEFAULT_RIGHT_PX = 384; // 24rem
const MIN_LEFT_PX = 224; // 14rem
const MIN_RIGHT_PX = 288; // 18rem
const MAX_SIDE_PX = 960;
const KEY_STEP_PX = 16;
const KEY_STEP_LARGE_PX = 64;

type Layout = { left: number | null; right: number | null; leftCollapsed: boolean };
const DEFAULT_LAYOUT: Layout = { left: null, right: null, leftCollapsed: false };

const CHANGE_EVENT = "three-pane-layout";
// The page must remain interactive when storage reads or writes are blocked. This also keeps
// layouts sharing a key in sync; a real cross-tab storage event invalidates the in-page value.
const pageLayouts = new Map<string, string>();

function readStored(key: string): string | null {
  if (pageLayouts.has(key)) return pageLayouts.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, layout: Layout) {
  const raw = JSON.stringify(layout);
  pageLayouts.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Storage unavailable: the layout still applies for this page view, it just is not remembered.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function parseLayout(raw: string | null): Layout {
  if (!raw) return DEFAULT_LAYOUT;
  try {
    const v = JSON.parse(raw) as Partial<Layout>;
    const width = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : null);
    return { left: width(v.left), right: width(v.right), leftCollapsed: v.leftCollapsed === true };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function subscribe(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null) pageLayouts.clear();
    else pageLayouts.delete(event.key);
    onChange();
  };
  window.addEventListener("storage", storageChanged);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function panelBounds(side: "left" | "right", total: number, leftShare = 0.35) {
  const max = Math.max(0, Math.min(MAX_SIDE_PX, Math.round(total * (side === "left" ? leftShare : 0.5))));
  return { min: Math.min(side === "left" ? MIN_LEFT_PX : MIN_RIGHT_PX, max), max };
}

export function ThreePane({
  left,
  middle,
  right,
  wideRight = false,
  storageKey,
  leftDefaultPx = DEFAULT_LEFT_PX,
  leftMaxShare = 0.35,
}: {
  /** Optional: without it the layout is the working list and a resizable detail pane (Import data). */
  left?: ReactNode;
  middle: ReactNode;
  right?: ReactNode;
  /** A roomier right pane for dense content such as data quality tables. */
  wideRight?: boolean;
  /** Remember this screen's layout separately; by default screens with the same shape share one. */
  storageKey?: string;
  /** The left pane's starting width, for a screen whose list needs more room (Cross tabs' variable table). */
  leftDefaultPx?: number;
  /** The largest share of the layout the left pane may take (default 35%). */
  leftMaxShare?: number;
}) {
  const hasRight = right !== undefined && right !== null && right !== false;
  const hasLeft = left !== undefined && left !== null && left !== false;
  const key = `three-pane:${storageKey ?? (!hasLeft ? "list-detail" : hasRight ? (wideRight ? "wide" : "three") : "two")}`;
  const raw = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  const saved = useMemo(() => parseLayout(raw), [raw]);
  // While dragging, widths live here and are saved once on release.
  const [drag, setDrag] = useState<Layout | null>(null);
  const layout = drag ?? saved;

  const gridRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<{ total: number; left: number; right: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const next = {
        total: gridRef.current?.getBoundingClientRect().width ?? 0,
        left: leftRef.current?.getBoundingClientRect().width ?? 0,
        right: rightRef.current?.getBoundingClientRect().width ?? 0,
      };
      setMeasured(previous => previous && previous.total === next.total && previous.left === next.left && previous.right === next.right ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    for (const element of [gridRef.current, leftRef.current, rightRef.current]) if (element) observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [hasRight]);

  // CSS min() keeps the middle pane usable even when a stored width came from a wider window.
  const leftCol = layout.leftCollapsed ? "2.75rem" : `min(${layout.left ?? leftDefaultPx}px, ${Math.round(leftMaxShare * 100)}%)`;
  const rightCol = hasRight
    ? layout.right !== null
      ? `min(${layout.right}px, 50%)`
      : wideRight
        ? "minmax(min(24rem,50%),34%)"
        : `min(${DEFAULT_RIGHT_PX}px,50%)`
    : null;
  const cols = [...(hasLeft ? [leftCol, "1rem"] : []), "minmax(0,1fr)", ...(rightCol ? ["1rem", rightCol] : [])].join(" ");

  const widthOf = (el: HTMLDivElement | null, fallback: number) => (el ? el.getBoundingClientRect().width : fallback);

  const limits = useCallback(
    (side: "left" | "right") => {
      const total = gridRef.current?.getBoundingClientRect().width ?? 1200;
      return panelBounds(side, total, leftMaxShare);
    },
    [leftMaxShare],
  );

  const commit = useCallback((next: Layout) => writeStored(key, next), [key]);

  function startDrag(side: "left" | "right", e: PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = side === "left" ? widthOf(leftRef.current, leftDefaultPx) : widthOf(rightRef.current, DEFAULT_RIGHT_PX);
    const { min, max } = limits(side);
    let current: Layout = layout;
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - startX;
      const width = Math.round(clamp(side === "left" ? start + dx : start - dx, min, max));
      current = side === "left" ? { ...layout, left: width } : { ...layout, right: width };
      setDrag(current);
    };
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDrag(null);
      if (current !== layout) commit(current);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function onHandleKey(side: "left" | "right", e: KeyboardEvent<HTMLDivElement>) {
    const { min, max } = limits(side);
    const now = side === "left" ? widthOf(leftRef.current, leftDefaultPx) : widthOf(rightRef.current, DEFAULT_RIGHT_PX);
    const step = e.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX;
    // The handle sits on the pane's inner edge, so an arrow moves the edge: right widens the left pane
    // and narrows the right pane.
    const grow = side === "left" ? 1 : -1;
    let width: number | null;
    if (e.key === "ArrowRight") width = now + step * grow;
    else if (e.key === "ArrowLeft") width = now - step * grow;
    else if (e.key === "Home") width = min;
    else if (e.key === "End") width = max;
    else if (e.key === "Enter") width = null; // back to the default width
    else return;
    e.preventDefault();
    const clamped = width === null ? null : Math.round(clamp(width, min, max));
    commit(side === "left" ? { ...layout, left: clamped } : { ...layout, right: clamped });
  }

  const reset = (side: "left" | "right") => commit(side === "left" ? { ...layout, left: null } : { ...layout, right: null });
  const setCollapsed = (leftCollapsed: boolean) => commit({ ...layout, leftCollapsed });

  const leftNow = measured?.left ?? layout.left ?? leftDefaultPx;
  const rightNow = measured?.right ?? layout.right ?? DEFAULT_RIGHT_PX;
  const total = measured?.total ?? 1200;
  const leftBounds = panelBounds("left", total, leftMaxShare);
  const rightBounds = panelBounds("right", total);

  return (
    <div
      ref={gridRef}
      className="grid grid-cols-1 items-start gap-4 lg:gap-0 lg:grid-cols-[var(--three-pane-cols)]"
      style={{ ["--three-pane-cols" as string]: cols }}
      data-testid="three-pane"
      data-left-collapsed={layout.leftCollapsed ? "true" : "false"}
    >
      {hasLeft && (
      <>
      <div ref={leftRef} className="min-w-0" data-testid="three-pane-left">
        <div className={layout.leftCollapsed ? "lg:hidden" : undefined}>{left}</div>
        {layout.leftCollapsed && (
          <div className="hidden lg:flex lg:justify-center">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="Expand left panel"
              title="Expand left panel"
              className="flex h-9 w-9 items-center justify-center rounded-lg border-2 border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Chevron direction="right" />
            </button>
          </div>
        )}
      </div>
      <div className="relative hidden self-stretch lg:block">
        {!layout.leftCollapsed && (
          <>
            <ResizeHandle
              label="Resize left panel"
              valueNow={Math.round(leftNow)}
              min={leftBounds.min}
              max={leftBounds.max}
              onPointerDown={(e) => startDrag("left", e)}
              onKeyDown={(e) => onHandleKey("left", e)}
              onDoubleClick={() => reset("left")}
              testId="three-pane-handle-left"
            />
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label="Collapse left panel"
              title="Collapse left panel"
              className="absolute left-1/2 top-2 z-10 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Chevron direction="left" />
            </button>
          </>
        )}
      </div>
      </>
      )}
      <div className="min-w-0">{middle}</div>
      {hasRight && (
        <>
          <div className="relative hidden self-stretch lg:block">
            <ResizeHandle
              label="Resize right panel"
              valueNow={Math.round(rightNow)}
              min={rightBounds.min}
              max={rightBounds.max}
              onPointerDown={(e) => startDrag("right", e)}
              onKeyDown={(e) => onHandleKey("right", e)}
              onDoubleClick={() => reset("right")}
              testId="three-pane-handle-right"
            />
          </div>
          <div ref={rightRef} className="min-w-0" data-testid="three-pane-right">
            {right}
          </div>
        </>
      )}
    </div>
  );
}

/** A vertical drag handle between two panes: pointer drag, arrow keys (Shift for bigger steps),
 * Home/End for the narrowest/widest, Enter or a double-click for the default width. min/max are the
 * effective bounds for assistive technology and valueNow is the measured rendered pane width. */
function ResizeHandle({
  label,
  valueNow,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
  testId,
}: {
  label: string;
  valueNow: number;
  min: number;
  max: number;
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
  testId: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={valueNow}
      aria-valuemin={min}
      aria-valuemax={max}
      title={`${label}: drag, or use the arrow keys. Double-click to reset.`}
      tabIndex={0}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      className="group absolute inset-0 flex cursor-col-resize touch-none select-none justify-center focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
    >
      <span className="my-3 w-0.5 rounded-full bg-transparent group-hover:bg-slate-300 group-focus-visible:bg-primary group-active:bg-primary" />
    </div>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
      <path d={direction === "left" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SIDES = {
  left: "bg-sky-50 border-sky-200",
  middle: "bg-slate-50 border-slate-300",
  right: "bg-white border-slate-300",
  /** White with a grey border on every side: Import, Research quality, Objectives and Business decisions (Grant, 2026-10-20). */
  plain: "bg-white border-border",
} as const;

const HEADERS = {
  left: "bg-sky-100 border-sky-200",
  middle: "bg-white border-slate-300",
  right: "bg-white border-slate-300",
  plain: "bg-white border-border",
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
