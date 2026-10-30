"use client";

// R5 waves: the dashboard's wave and "Compare with" choices. The waves offered and their order come from the owner
// (src/lib/waves.ts projectWaves, through the overview's `waves`): included waves only, in fieldwork order when every
// wave has a date, otherwise upload order with the waves lacking a date named. "Compare with" offers the previous
// included wave (the default), any earlier included wave, or None. Choosing reloads the dashboard; the parent keeps
// the page, the brand and the Compare selection, and drops answers to earlier choices.
import type { WaveList } from "@/lib/trackerWaveChange";

/** A wave's fieldwork date as the selector shows it ("Jun 2026"), or that it has none. */
export function waveDateText(waveDate: string | null): string {
  if (!waveDate || !/^\d{4}-\d{2}/.test(waveDate)) return "no fieldwork date";
  return new Date(`${waveDate.slice(0, 7)}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function WaveSelector({
  waves,
  documentId,
  compareWith,
  loading,
  onWave,
  onCompare,
}: {
  waves: WaveList;
  documentId: string;
  compareWith: string;
  /** The wave or comparison being loaded, said beside the choices; null when nothing is loading. */
  loading: string | null;
  onWave: (documentId: string) => void;
  onCompare: (value: string) => void;
}) {
  const at = waves.included.findIndex((w) => w.documentId === documentId);
  const earlier = at > 0 ? waves.included.slice(0, at) : [];
  const previous = at > 0 ? waves.included[at - 1] : null;
  const box = "rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm";
  return (
    <>
      <label className={box}>
        <span className="mr-1.5 text-slate-500">Wave</span>
        <select aria-label="Wave" value={at >= 0 ? documentId : ""} onChange={(e) => onWave(e.target.value)} className="bg-transparent font-medium text-slate-900 outline-none" data-testid="wave-select">
          {at < 0 && <option value="">Not an included wave</option>}
          {waves.included.map((w) => (
            <option key={w.documentId} value={w.documentId}>
              {w.wave} ({waveDateText(w.waveDate)})
            </option>
          ))}
        </select>
      </label>
      <label className={box}>
        <span className="mr-1.5 text-slate-500">Compare with</span>
        <select aria-label="Compare with" value={compareWith} onChange={(e) => onCompare(e.target.value)} className="bg-transparent font-medium text-slate-900 outline-none" data-testid="wave-compare-select" disabled={at <= 0}>
          <option value="previous">{previous ? `Previous wave (${previous.wave})` : "No earlier wave"}</option>
          {earlier
            .slice(0, -1)
            .reverse()
            .map((w) => (
              <option key={w.documentId} value={w.documentId}>
                {w.wave}
              </option>
            ))}
          <option value="none">None</option>
        </select>
      </label>
      {loading && (
        <span className="text-xs text-slate-500" role="status" data-testid="wave-loading">
          Loading {loading}...
        </span>
      )}
      {(waves.undated.length > 0 || waves.excluded.length > 0) && (
        <span className="basis-full text-[11px] text-slate-500" data-testid="wave-order-note">
          {waves.undated.length > 0 ? waves.orderText : ""}
          {waves.excluded.length > 0 ? `${waves.undated.length > 0 ? " " : ""}Left out of wave tracking: ${waves.excluded.map((w) => w.wave).join(", ")}.` : ""}
        </span>
      )}
    </>
  );
}

/** The comparison's one line under a page's chips: which wave, the test, and a failed comparison or test. */
export function WaveTestNote({
  compared,
  test,
  onRetry,
}: {
  compared: { status: "ok"; wave: string } | { status: "none" | "off"; reason: string } | { status: "failed"; wave: string; error: string };
  test: { line: string; note: string; failed: string | null } | null;
  /** Reads the page again (the compared wave, or the test, failed). */
  onRetry?: () => void;
}) {
  const retry = onRetry && (
    <button type="button" onClick={onRetry} className="ml-2 rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] text-amber-900" data-testid="wave-retry">
      Try again
    </button>
  );
  return (
    <p className="text-[11px] text-slate-500" data-testid="wave-test-note">
      {compared.status === "ok" ? (
        <>
          Change against {compared.wave}, in points from unrounded figures. {test?.line} {test?.note} A figure marked * was not tested (hover for the reason).
          {test?.failed && (
            <span className="ml-1 text-amber-800" role="alert">
              {test.failed}
              {retry}
            </span>
          )}
        </>
      ) : compared.status === "failed" ? (
        <span className="text-amber-800" role="alert">
          {compared.wave} could not be read, so no change is shown: {compared.error}
          {retry}
        </span>
      ) : (
        compared.reason
      )}
    </p>
  );
}
