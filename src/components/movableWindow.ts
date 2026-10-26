"use client";

import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * Position and size of a floating window that can be dragged and resized (Grant, 2026-10-23: the
 * Research assistant "pops up on the right and can be moved around", "and it should be
 * resizable"). It opens on the right, near the top. Dragging its header, or the arrow keys on its
 * Move handle, moves it; dragging its corner grip, or the arrow keys on the grip, resizes it; Home
 * on either, or a double-click on the header, puts it back as it opened. The frame is kept inside
 * the browser window (also after the browser window is resized) and remembered per browser.
 * Storage may be blocked (private windows, previews), so every read and write is guarded and the
 * frame still applies for this page view.
 *
 * Position is a distance from the right and top edges, so the window stays on the right when the
 * browser window is widened. The grip is the bottom-left corner: with the right edge fixed, the
 * window grows to the left and down, away from the edge it is anchored to.
 */

export type WindowFrame = { right: number; top: number; width: number; height: number };

const EDGE = 8;
const KEY_STEP = 24;
export const MIN_SIZE = { width: 300, height: 320 };

/** The frame the window opens with: 380 wide, up to 560 tall, 20 from the right and 80 from the top. */
export function defaultFrame(view: { width: number; height: number }): WindowFrame {
  return { right: 20, top: 80, width: 380, height: Math.max(MIN_SIZE.height, Math.min(560, view.height - 96)) };
}

/**
 * Keeps a frame inside a viewport: size between MIN_SIZE and the viewport less EDGE on both sides,
 * then position at least EDGE from every edge.
 */
export function clampFrame(f: WindowFrame, view: { width: number; height: number }): WindowFrame {
  const width = Math.min(Math.max(f.width, MIN_SIZE.width), Math.max(MIN_SIZE.width, view.width - 2 * EDGE));
  const height = Math.min(Math.max(f.height, MIN_SIZE.height), Math.max(MIN_SIZE.height, view.height - 2 * EDGE));
  const maxRight = Math.max(EDGE, view.width - width - EDGE);
  const maxTop = Math.max(EDGE, view.height - height - EDGE);
  return { width, height, right: Math.min(Math.max(f.right, EDGE), maxRight), top: Math.min(Math.max(f.top, EDGE), maxTop) };
}

function readStored(key: string): WindowFrame | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<WindowFrame>;
    if ([v.right, v.top, v.width, v.height].every((n) => typeof n === "number" && Number.isFinite(n))) return v as WindowFrame;
  } catch {
    // Blocked or malformed: the default applies.
  }
  return null;
}

function writeStored(key: string, f: WindowFrame) {
  try {
    window.localStorage.setItem(key, JSON.stringify({ right: Math.round(f.right), top: Math.round(f.top), width: Math.round(f.width), height: Math.round(f.height) }));
  } catch {
    // Not remembered; the frame still applies for this page view.
  }
}

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

/** Drags with the pointer from a handle, calling `toFrame` with the pointer's movement. */
function dragFrom(e: PointerEvent<HTMLElement>, onMove: (dx: number, dy: number) => void, onEnd: () => void) {
  const target = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  target.setPointerCapture(e.pointerId);
  e.preventDefault();
  const move = (ev: globalThis.PointerEvent) => onMove(ev.clientX - startX, ev.clientY - startY);
  const up = () => {
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", up);
    onEnd();
  };
  target.addEventListener("pointermove", move);
  target.addEventListener("pointerup", up);
  target.addEventListener("pointercancel", up);
}

const step = (key: string): { dx: number; dy: number } | null =>
  key === "ArrowLeft" ? { dx: -KEY_STEP, dy: 0 } : key === "ArrowRight" ? { dx: KEY_STEP, dy: 0 } : key === "ArrowUp" ? { dx: 0, dy: -KEY_STEP } : key === "ArrowDown" ? { dx: 0, dy: KEY_STEP } : null;

/**
 * `frame` is null until the browser has been read, so the server render and the first client
 * render agree (the window uses its CSS default until then).
 */
export function useMovableWindow(storageKey: string) {
  const [frame, setFrame] = useState<WindowFrame | null>(null);

  // Read the remembered frame once mounted, and keep the window inside the viewport on resize.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after mount is the external sync this effect is for
    setFrame(clampFrame(readStored(storageKey) ?? defaultFrame(viewport()), viewport()));
    const onResize = () => setFrame((f) => (f ? clampFrame(f, viewport()) : f));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [storageKey]);

  const commit = useCallback(
    (f: WindowFrame) => {
      const next = clampFrame(f, viewport());
      setFrame(next);
      writeStored(storageKey, next);
    },
    [storageKey],
  );
  const current = () => frame ?? defaultFrame(viewport());
  const moved = (f: WindowFrame, dx: number, dy: number) => ({ ...f, right: f.right - dx, top: f.top + dy });
  // The grip is the bottom-left corner: left makes it wider, down makes it taller.
  const resized = (f: WindowFrame, dx: number, dy: number) => ({ ...f, width: f.width - dx, height: f.height + dy });

  /** Pointer handler for the header. Buttons inside it keep their own clicks. */
  const onMovePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a, input, textarea")) return;
    const start = current();
    let latest = start;
    dragFrom(
      e,
      (dx, dy) => {
        latest = clampFrame(moved(start, dx, dy), viewport());
        setFrame(latest);
      },
      () => commit(latest),
    );
  };

  const onResizePointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const start = current();
    let latest = start;
    dragFrom(
      e,
      (dx, dy) => {
        latest = clampFrame(resized(start, dx, dy), viewport());
        setFrame(latest);
      },
      () => commit(latest),
    );
  };

  /** Arrow keys move by KEY_STEP; Home puts the window back as it opened. */
  const onMoveKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Home") {
      e.preventDefault();
      return commit(defaultFrame(viewport()));
    }
    const d = step(e.key);
    if (!d) return;
    e.preventDefault();
    commit(moved(current(), d.dx, d.dy));
  };

  /** Arrow keys resize by KEY_STEP (left wider, down taller); Home puts the size back. */
  const onResizeKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Home") {
      e.preventDefault();
      const d = defaultFrame(viewport());
      return commit({ ...current(), width: d.width, height: d.height });
    }
    const d = step(e.key);
    if (!d) return;
    e.preventDefault();
    commit(resized(current(), d.dx, d.dy));
  };

  const reset = () => commit(defaultFrame(viewport()));

  return { frame, onMovePointerDown, onResizePointerDown, onMoveKey, onResizeKey, reset };
}
