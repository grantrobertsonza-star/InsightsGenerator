"use client";

import { useCallback, useRef, useSyncExternalStore, type ReactNode } from "react";

/**
 * Two panes side by side with a divider the researcher can drag left or right (Grant, 29 October 2026: "a split
 * screen so we can pull left or right to make the nps bigger or smaller and the drivers bigger or smaller"). On
 * wide screens (1280 and up) the divider sets the split, from a quarter to three quarters of the width; below
 * that the panes stack and there is no divider. With one pane only, it takes the full width. The
 * divider is a keyboard-operable separator: arrow keys move it by 5%, Home resets it to half.
 *
 * The split is a viewing preference of this browser, kept in browser storage (and only there). Storage that is
 * unavailable leaves the default half-and-half split; nothing else depends on it.
 */
const KEY_PREFIX = "analytics-split:";
const MIN = 25;
const MAX = 75;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, Math.round(v)));

function readSplit(key: string): number {
  try {
    const v = Number(window.localStorage.getItem(KEY_PREFIX + key));
    return Number.isFinite(v) && v >= MIN && v <= MAX ? v : 50;
  } catch {
    return 50;
  }
}

// The split as an external store: this browser's saved value, read from storage every time, and listeners told of
// every change, including one saved in another tab. The in-memory copy is used only when storage refuses the write
// (a blocked browser), so it can never hide a value saved elsewhere: an open view follows another tab's change
// (Codex UI1-F01), and a view opened later reads the value saved while it was closed (Codex UI1R-F01).
const memorySplit = new Map<string, number>();
const listeners = new Set<() => void>();
/** Another tab saved or removed a split (or cleared storage): tell the views, which read storage again. Other keys
 * are ignored. With storage blocked no such event arrives, and this tab's in-memory value stands. */
function onStorage(e: StorageEvent) {
  if (e.key === null) memorySplit.clear();
  else if (e.key.startsWith(KEY_PREFIX)) memorySplit.delete(e.key.slice(KEY_PREFIX.length));
  else return;
  listeners.forEach((l) => l());
}
const splitStore = {
  get: (key: string) => memorySplit.get(key) ?? readSplit(key),
  set: (key: string, v: number) => {
    try {
      window.localStorage.setItem(KEY_PREFIX + key, String(v));
      memorySplit.delete(key);
    } catch {
      // A browser that blocks storage keeps the split for this visit only.
      memorySplit.set(key, v);
    }
    listeners.forEach((l) => l());
  },
  subscribe: (l: () => void) => {
    if (listeners.size === 0) window.addEventListener("storage", onStorage);
    listeners.add(l);
    return () => {
      listeners.delete(l);
      if (listeners.size === 0) window.removeEventListener("storage", onStorage);
    };
  },
};

const WIDE = "(min-width: 1280px)";
const subscribeWide = (l: () => void) => {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", l);
  return () => mq.removeEventListener("change", l);
};

export default function ResizableSplit({ left, right, storageKey, testId }: { left: ReactNode; right: ReactNode; storageKey: string; testId: string }) {
  const split = useSyncExternalStore(splitStore.subscribe, () => splitStore.get(storageKey), () => 50);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const keep = useCallback((v: number) => splitStore.set(storageKey, clamp(v)), [storageKey]);
  const both = left !== null && left !== false && left !== undefined && right !== null && right !== false && right !== undefined;
  const active = wide && both;

  const fromPointer = (clientX: number) => {
    const box = gridRef.current?.getBoundingClientRect();
    if (box && box.width > 0) keep(((clientX - box.left) / box.width) * 100);
  };

  return (
    <div className="relative">
      <div
        ref={gridRef}
        className="grid grid-cols-1 items-start gap-4"
        style={active ? { gridTemplateColumns: `minmax(0, ${split}fr) minmax(0, ${100 - split}fr)` } : undefined}
        data-testid={testId}
        data-split={active ? split : undefined}
      >
        {both ? (
          <>
            <div className="min-w-0" data-testid={`${testId}-left`}>{left}</div>
            <div className="min-w-0" data-testid={`${testId}-right`}>{right}</div>
          </>
        ) : (
          <div className="min-w-0">{left || right}</div>
        )}
      </div>
      {active && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the two columns"
          aria-valuemin={MIN}
          aria-valuemax={MAX}
          aria-valuenow={split}
          tabIndex={0}
          data-testid={`${testId}-handle`}
          className="group absolute top-0 bottom-0 z-10 flex w-4 -translate-x-1/2 cursor-col-resize justify-center focus:outline-none"
          style={{ left: `calc(${split}% - ${((split - 50) / 50) * 8}px)` }}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture?.(e.pointerId);
            e.preventDefault();
          }}
          onPointerMove={(e) => {
            if (dragging.current) fromPointer(e.clientX);
          }}
          onPointerUp={(e) => {
            dragging.current = false;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onDoubleClick={() => keep(50)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") keep(split - 5);
            else if (e.key === "ArrowRight") keep(split + 5);
            else if (e.key === "Home") keep(50);
            else return;
            e.preventDefault();
          }}
          title="Drag to resize the columns (double-click to reset)"
        >
          <span className="h-full w-1 rounded-full bg-slate-200 transition-colors group-hover:bg-primary/50 group-focus-visible:bg-primary" />
        </div>
      )}
    </div>
  );
}
