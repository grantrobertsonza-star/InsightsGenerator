"use client";

import { useCallback, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

/**
 * Resizable columns for a full-width band of the one-page Objectives prototype (Grant, 2026-10-22:
 * "can we make these sizeable"). The band's container is a CSS grid; this hook gives it a column
 * template and the separators that sit between the columns as grid items of their own. Widths are
 * shares of the band, so they keep their proportions when the window changes. On narrow screens
 * the band stacks and the separators are hidden (the template only applies from the lg breakpoint).
 *
 * Widths are remembered per browser. Storage may be blocked (private windows, previews), so every
 * read and write is guarded and the widths still apply for this page view.
 */

const HANDLE_PX = 16; // the separator's own column; also the visual gap between columns
const MIN_COLUMN_PX = 200;
const KEY_STEP = 0.02;

const equalShares = (count: number) => Array.from({ length: count }, () => 1 / count);

const CHANGE_EVENT = "band-columns";
// The widths still apply for this page view when storage is blocked.
const pageShares = new Map<string, string>();

function readRaw(key: string): string | null {
  if (pageShares.has(key)) return pageShares.get(key)!;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parseShares(raw: string | null, count: number): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v) || v.length !== count || !v.every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)) return null;
    const total = v.reduce((a: number, b: number) => a + b, 0);
    return v.map((n: number) => n / total);
  } catch {
    return null;
  }
}

function writeShares(key: string, shares: number[]) {
  const raw = JSON.stringify(shares.map((s) => Math.round(s * 1000) / 1000));
  pageShares.set(key, raw);
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Not remembered; the widths still apply for this page view.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (event.key === null) pageShares.clear();
    else pageShares.delete(event.key);
    onChange();
  };
  window.addEventListener("storage", storageChanged);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", storageChanged);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** Moves the boundary after column `index` by `delta` (a share of the band), keeping both neighbours at least `min`. */
function moveBoundary(shares: number[], index: number, delta: number, min: number): number[] {
  const pair = shares[index] + shares[index + 1];
  const left = Math.max(min, Math.min(pair - min, shares[index] + delta));
  const next = [...shares];
  next[index] = left;
  next[index + 1] = pair - left;
  return next;
}

/** `containerRef` is the band's grid element, measured for the minimum column width and for dragging. */
export function useBandColumns(storageKey: string, count: number, containerRef: RefObject<HTMLElement | null>) {
  const key = `${storageKey}:v1:${count}`;
  // The server and the first client render have no stored widths, so they agree on equal columns.
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null);
  // While a separator is dragged, its widths show without being stored on every pointer move.
  const [dragging, setDragging] = useState<number[] | null>(null);
  const shares = dragging ?? parseShares(raw, count) ?? equalShares(count);

  /** The share of the band one minimum-width column takes, from the band's current width. */
  const minShare = useCallback(() => {
    const width = (containerRef.current?.clientWidth ?? 0) - HANDLE_PX * (count - 1);
    if (width <= 0) return 0.1;
    return Math.min(MIN_COLUMN_PX / width, 1 / count);
  }, [count, containerRef]);

  const commit = useCallback(
    (next: number[]) => {
      writeShares(key, next);
      setDragging(null);
    },
    [key],
  );

  const style = {
    "--band-cols": shares.map((s) => `minmax(0, ${s}fr)`).join(` ${HANDLE_PX}px `),
  } as CSSProperties;

  function handle(index: number, label: string) {
    const min = minShare();
    const before = shares.slice(0, index + 1).reduce((a, b) => a + b, 0);
    const lowest = shares.slice(0, index).reduce((a, b) => a + b, 0) + min;
    const highest = before + shares[index + 1] - min;

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
      const width = (containerRef.current?.clientWidth ?? 0) - HANDLE_PX * (count - 1);
      if (width <= 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const start = shares;
      const floor = minShare();
      const target = e.currentTarget;
      let latest = start;
      const move = (ev: globalThis.PointerEvent) => {
        latest = moveBoundary(start, index, (ev.clientX - startX) / width, floor);
        setDragging(latest);
      };
      const up = () => {
        target.removeEventListener("pointermove", move);
        target.removeEventListener("pointerup", up);
        target.removeEventListener("pointercancel", up);
        commit(latest);
      };
      target.addEventListener("pointermove", move);
      target.addEventListener("pointerup", up);
      target.addEventListener("pointercancel", up);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
      const current = shares;
      let next: number[] | null = null;
      if (e.key === "ArrowLeft") next = moveBoundary(current, index, -KEY_STEP, min);
      else if (e.key === "ArrowRight") next = moveBoundary(current, index, KEY_STEP, min);
      else if (e.key === "Home") next = moveBoundary(current, index, -1, min);
      else if (e.key === "End") next = moveBoundary(current, index, 1, min);
      else if (e.key === "Enter") next = equalShares(count);
      if (!next) return;
      e.preventDefault();
      commit(next);
    };

    return (
      <div
        key={`band-handle-${index}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        // The separator's position across the band, in percent.
        aria-valuenow={Math.round(before * 100)}
        aria-valuemin={Math.round(lowest * 100)}
        aria-valuemax={Math.round(highest * 100)}
        title={`${label}: drag, or use the arrow keys. Double-click to make the columns equal.`}
        tabIndex={0}
        data-testid={`band-column-handle-${index}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => commit(equalShares(count))}
        className="group hidden cursor-col-resize touch-none select-none justify-center self-stretch rounded focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary lg:flex"
      >
        <span className="my-1 w-0.5 rounded-full bg-slate-200 group-hover:bg-slate-400 group-focus-visible:bg-primary group-active:bg-primary" />
      </div>
    );
  }

  return { style, handle };
}
