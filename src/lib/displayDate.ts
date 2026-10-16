// Dates rendered by components that are pre-rendered on the server and then hydrated in the
// browser. toLocaleDateString() with no arguments uses each runtime's own locale and time zone, so
// the server and the browser can write different text ("2026/10/16" vs "10/17/2026"), React then
// discards the server output and rebuilds the tree (a hydration mismatch). A fixed locale and the
// UTC calendar day make both sides write the same text. The cost: near midnight the day shown is
// the UTC day, which can differ from the researcher's local day; the title gives the exact time.

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "16 Oct 2026": the UTC calendar day of an ISO timestamp, identical in every runtime. */
export function displayDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Date unknown" : DAY.format(d);
}

/** "2026-10-16 14:03 UTC": the exact moment, for a title or tooltip. */
export function displayUtcMinute(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Date unknown" : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
