"use client";

import { useSyncExternalStore } from "react";

const noSubscription = () => () => {};

/**
 * False while the page is still the server-rendered HTML and React has not yet attached its event
 * handlers; true from then on. A server-rendered <select> can be changed in that gap: the browser
 * shows the new option, but no onChange runs, so nothing is saved, and when React takes over it
 * puts the old value back without any message. Controls whose change must be saved are disabled
 * until this is true, so a choice can never be made that will be silently dropped.
 *
 * useSyncExternalStore returns the server snapshot (false) during hydration and the client
 * snapshot (true) straight after, with no effect or extra state. A component first mounted after
 * hydration (a section opened later) gets true on its first render.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
