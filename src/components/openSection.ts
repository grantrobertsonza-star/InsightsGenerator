"use client";

import { useSyncExternalStore } from "react";

/**
 * Which run section is open, for the floating Research assistant (AssistantDrawer.tsx), which sits
 * in the app shell outside the run page's section provider. RunNav publishes it; the drawer reads it
 * to tell the assistant where a question was asked, and to hide itself on the Research assistant
 * section, where the same conversation is already on the page.
 */
export type OpenSection = { runId: string; id: string; label: string } | null;

let current: OpenSection = null;
const listeners = new Set<() => void>();

export function publishOpenSection(next: OpenSection) {
  if (current?.runId === next?.runId && current?.id === next?.id && current?.label === next?.label) return;
  current = next;
  for (const l of listeners) l();
}

export function useOpenSection(): OpenSection {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
    () => null,
  );
}
