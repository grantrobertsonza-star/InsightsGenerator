"use client";

import { useCallback, useState } from "react";

// Which workspace is open on a data file's Analytics, kept outside the component (Grant, 29 October 2026: the Brand
// tracking dashboard "shows the menu for a short while then goes"). While a wave is read again the page refreshes and
// shows the file as being processed, which unmounts the file's Analytics; on the way back each workspace started
// closed, so the dashboard the researcher had just opened was gone. Kept per page load, by run, file and place, so
// the workspace reopens where it was (and calculates again). Closing it clears it.
const kept = new Map<string, unknown>();

export function useKeptOpen<T>(key: string, closed: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : closed));
  const set = useCallback(
    (next: T) => {
      if (next === closed) kept.delete(key);
      else kept.set(key, next);
      setValue(next);
    },
    [key, closed],
  );
  return [value, set];
}
