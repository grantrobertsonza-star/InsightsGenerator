"use client";

// Links from a section dashboard to an item inside a module (Grant, 2026-10-23): open a source in
// Import at a tab, choose a data file in Cross tabs, select an objective. A module's content is
// mounted the first time it is opened (RunShell.SectionPanel), so a request made before it ever
// was is kept here and taken by the module when it mounts; an event tells one already mounted.

function channel<T>(name: string) {
  let pending: T | null = null;
  return {
    request(value: T) {
      pending = value;
      window.dispatchEvent(new CustomEvent<T>(name, { detail: value }));
    },
    /** The request waiting from before the module mounted, taken once. */
    takePending(): T | null {
      const v = pending;
      pending = null;
      return v;
    },
    subscribe(handler: (value: T) => void): () => void {
      const listener = (e: Event) => {
        pending = null;
        handler((e as CustomEvent<T>).detail);
      };
      window.addEventListener(name, listener);
      return () => window.removeEventListener(name, listener);
    },
  };
}

export type ImportOpenRequest = { documentId: string; tab?: string };
export const importFileLink = channel<ImportOpenRequest>("stage-open-import-file");
export const dataFileLink = channel<string>("stage-choose-data-file");
export const objectiveLink = channel<{ id: string | null; text: string }>("stage-select-objective");

/** Brings an element marked data-stage-anchor into view once its section is showing. */
export function scrollToAnchor(name: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      document.querySelector(`[data-stage-anchor="${name}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }),
  );
}
