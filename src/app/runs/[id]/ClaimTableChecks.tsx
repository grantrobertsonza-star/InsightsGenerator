"use client";

import { useEffect, useState } from "react";
import { checkClaimsAction, loadClaimChecksAction, resetClaimChecksAction } from "@/lib/claimTableChecksActions";
import type { ClaimChecked } from "@/lib/claimTableChecks";

type Stance = "supports" | "against" | "mixed" | "inconclusive" | "silent";
const label: Record<Stance, string> = { supports: "Table supports", against: "Table contradicts", mixed: "Mixed", inconclusive: "Inconclusive", silent: "Tables silent" };
const style: Record<Stance, string> = {
  supports: "bg-green-50 text-green-800 ring-green-200",
  against: "bg-red-50 text-red-800 ring-red-200",
  mixed: "bg-amber-50 text-amber-800 ring-amber-200",
  inconclusive: "bg-slate-100 text-slate-700 ring-slate-200",
  silent: "bg-slate-50 text-slate-500 ring-slate-200",
};
const tierLabel = { a: "Tier a, figure check", b: "Tier b, re-derived test" } as const;
const btn = "whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-60";

function Pill({ s }: { s: Stance }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style[s]}`}>{label[s]}</span>;
}

export default function ClaimTableChecks({ runId }: { runId: string }) {
  const [claims, setClaims] = useState<ClaimChecked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const r = await loadClaimChecksAction(runId);
    if (r.ok) setClaims(r.claims);
    else setError(r.error);
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  async function run(fresh: boolean) {
    setError(null);
    setBusy(true);
    if (fresh) {
      const r = await resetClaimChecksAction(runId);
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
    }
    for (let guard = 0; guard < 40; guard++) {
      const r = await checkClaimsAction(runId);
      if (!r.ok) {
        setError(r.error);
        break;
      }
      await refresh();
      if (r.remaining === 0 || r.done === 0) break;
    }
    setBusy(false);
  }

  return (
    <div className="mt-6 max-w-3xl space-y-4 rounded-xl border border-border bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Report claims checked against tables</h3>
          <p className="mt-1 text-xs text-muted">
            Each quantitative claim is checked against the tables in the project, data set by data set, with no raw data needed. Tier a
            compares the figure the report states with the table. Tier b re-derives the stated gap or level from the percentages and
            bases. Where nothing in the tables speaks to a claim, that is shown as a result, not a pass.
          </p>
        </div>
        <button className={btn} disabled={busy} onClick={() => void run(claims.length > 0)}>
          {busy ? "Checking..." : claims.length > 0 ? "Check again" : "Check claims"}
        </button>
      </div>
      {claims.length === 0 && !busy && <p className="text-sm text-muted">Not checked yet.</p>}
      <ul className="space-y-3">
        {claims.map((c) => (
          <li key={c.finding_id} className="rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Pill s={c.stance} />
              {c.finding_kind === "stated_insight" && <span className="text-xs uppercase tracking-wide text-muted">insight</span>}
            </div>
            <p className="mt-1.5 text-sm text-foreground">{c.finding_text}</p>
            {c.nothingFound && c.datasets.length === 0 && <p className="mt-1 text-xs text-muted">No table in this project speaks to this claim.</p>}
            {c.datasets.map((d) => (
              <div key={d.document_id ?? d.name} className="mt-2 rounded border border-border/70 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill s={d.stance} />
                  <span className="text-xs text-muted">{d.name}</span>
                </div>
                <ul className="mt-1 space-y-1">
                  {d.checks.map((k) => (
                    <li key={k.id} className="text-xs text-muted">
                      <span className="font-medium">{tierLabel[k.tier]}</span>
                      {k.table_label ? ` (${k.table_label})` : ""}: {k.summary}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <p className="text-xs text-muted">
        Intervals are 95% normal approximations from the percentages and bases in the tables. Weights and design effects are not visible in a
        summary table, so a re-derived test is an approximation, not a replacement for the original analysis.
      </p>
    </div>
  );
}
