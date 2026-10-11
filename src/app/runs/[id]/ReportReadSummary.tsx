import type { ReactNode } from "react";

export type ReportReadStats = {
  pages: number;
  characters: number;
  parts: number;
  failedParts: number;
  ranAt: string | null;
} | null;

export type ReportFindingLite = {
  finding_kind: string | null;
  source_page: number | null;
  quote_verified: boolean | null;
  status: "pending" | "accepted" | "rejected";
};

const KIND_LABEL: Record<string, string> = {
  fact: "Facts and statistics",
  own_finding: "The authors' own analysis",
  external_citation: "Other work the report cites",
  hypothesis: "Hypotheses",
  methodology: "Method notes",
  recommendation: "Recommendations",
  stated_insight: "Insights the report states",
};

function Tile({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold leading-none text-foreground">{value}</div>
      {note && <div className="mt-1 text-[11px] text-muted">{note}</div>}
    </div>
  );
}

/**
 * A small read-out under a report's Extract button: how much of the report was read and what came out of
 * it. Counts come from the findings themselves, so they stay true after findings are accepted, rejected or
 * re-extracted. Pages read come from the extraction's own note; older extractions have none, so that tile
 * is simply left out.
 */
export default function ReportReadSummary({
  stats,
  findings,
}: {
  stats: ReportReadStats;
  findings: ReportFindingLite[];
}) {
  if (findings.length === 0 && !stats) return null;

  const byKind = new Map<string, number>();
  for (const f of findings) {
    const k = f.finding_kind ?? "other";
    byKind.set(k, (byKind.get(k) ?? 0) + 1);
  }
  const kinds = [...byKind.entries()].sort((a, b) => b[1] - a[1]);
  const top = kinds.length > 0 ? kinds[0][1] : 1;

  const pagesWith = new Set(findings.map((f) => f.source_page).filter((p): p is number => p !== null)).size;
  const withQuote = findings.filter((f) => f.quote_verified !== null);
  const verified = withQuote.filter((f) => f.quote_verified === true).length;
  const accepted = findings.filter((f) => f.status === "accepted").length;
  const rejected = findings.filter((f) => f.status === "rejected").length;

  return (
    <div className="space-y-2.5" aria-label="What was read and extracted">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats && stats.pages > 0 && (
          <Tile
            label="Pages read"
            value={stats.pages}
            note={stats.parts > 1 ? `in ${stats.parts} parts` : undefined}
          />
        )}
        <Tile label="Findings" value={findings.length} note={accepted + rejected > 0 ? `${accepted} accepted, ${rejected} rejected` : "none reviewed yet"} />
        {stats && stats.pages > 0 && pagesWith > 0 && (
          <Tile label="Pages with findings" value={pagesWith} note={`of ${stats.pages}`} />
        )}
        {withQuote.length > 0 && (
          <Tile label="Quotes found in the text" value={`${Math.round((verified / withQuote.length) * 100)}%`} note={withQuote.length - verified > 0 ? `${verified} of ${withQuote.length}, ${withQuote.length - verified} to check` : `${verified} of ${withQuote.length}`} />
        )}
      </div>

      {kinds.length > 0 && (
        <ul className="space-y-1">
          {kinds.map(([kind, n]) => (
            <li key={kind} className="grid grid-cols-[minmax(0,11rem)_1fr_2rem] items-center gap-2 text-xs">
              <span className="truncate text-foreground">{KIND_LABEL[kind] ?? "Other"}</span>
              <span className="h-2 rounded-full bg-slate-100">
                <span className="block h-2 rounded-full bg-primary" style={{ width: `${Math.max(4, (n / top) * 100)}%` }} />
              </span>
              <span className="text-right tabular-nums text-muted">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {stats && stats.failedParts > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
          {stats.failedParts} of {stats.parts} parts could not be read, so some pages may be missing. Run Extract
          findings again.
        </p>
      )}
    </div>
  );
}
