"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadRespondentQualityAction } from "@/lib/crosstabActions";
import type { RespondentQuality } from "@/lib/respondentQuality";

const fmt = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "n/a" : n.toLocaleString("en-ZA", { maximumFractionDigits: d }));
const pct = (part: number, whole: number) => (whole > 0 ? `${fmt((100 * part) / whole, 1)}%` : "n/a");

/**
 * Respondent checks for a case-level file (Grant, 26 October 2026): who answered every battery the
 * same way, who gave mostly non-answers, who finished too fast, and whether one interviewer's cases
 * stand apart. Read from the whole file by the engine when the Data quality tab first comes into view
 * (a hidden tab must not read the file), not stored. Flags only: nothing is excluded.
 */
export default function RespondentQualityPanel({ runId, documentId }: { runId: string; documentId: string }) {
  const [quality, setQuality] = useState<RespondentQuality | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const requested = useRef(false);

  const load = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    setLoading(true);
    setError(null);
    void loadRespondentQualityAction(runId, documentId)
      .then((r) => {
        if (r.ok) setQuality(r.quality);
        else setError(r.error);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "The respondent checks could not be loaded."))
      .finally(() => setLoading(false));
  }, [runId, documentId]);

  useEffect(() => {
    if (!root.current) return;
    if (typeof IntersectionObserver === "undefined") {
      load();
      return;
    }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        load();
        watch.disconnect();
      }
    });
    watch.observe(root.current);
    return () => watch.disconnect();
  }, [load]);

  const retry = () => {
    requested.current = false;
    load();
  };

  return (
    <div ref={root} className="space-y-3 rounded-xl border border-border bg-white p-4" data-testid="respondent-quality">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Respondents</h3>
        <p className="mt-1 max-w-3xl text-xs text-muted">
          Checks each respondent across the whole file, unweighted: answering a battery the same way throughout,
          mostly non-answers, finishing too fast, and interviewers whose cases stand apart. These are prompts to
          look, not proof of bad data. Nothing is excluded; any decision to drop a case is yours.
        </p>
      </div>
      {loading && <p className="text-xs text-muted">Checking every respondent...</p>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          The respondent checks could not be run: {error}{" "}
          <button type="button" className="underline" onClick={retry}>
            Try again
          </button>
        </p>
      )}
      {quality && <Results q={quality} />}
    </div>
  );
}

function Results({ q }: { q: RespondentQuality }) {
  const s = q.straightlining;
  const d = q.duration;
  return (
    <div className="space-y-3 text-xs text-foreground">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Tile value={fmt(q.flaggedCases)} label={`Respondents flagged (${pct(q.flaggedCases, q.cases)} of ${fmt(q.cases)})`} />
        <Tile value={fmt(s.flagged)} label="Straightlining" />
        <Tile value={q.nonAnswer.measured ? fmt(q.nonAnswer.flagged) : "Not measured"} label="Mostly non-answers" />
        <Tile value={d.variable ? fmt(d.speeders ?? 0) : "Not measured"} label="Speeders" />
      </div>

      <Section title="Straightlining" testId="rq-straightlining">
        {s.grids.length === 0 ? (
          <p className="text-muted">No batteries were found: {s.minItems} or more numbered items on one answer scale (for example Q13_1 to Q13_14).</p>
        ) : (
          <>
            <p className="text-muted">
              A respondent is flagged when they give one answer throughout at least {s.minBatteries} batteries and at least
              half of those they answered (a battery counts once {s.minItems} or more of its items are answered). Near:{" "}
              {Math.round(s.nearThreshold * 100)}% or more of the answers the same.
            </p>
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="py-1 pr-2">Battery</th>
                  <th className="py-1 pr-2 text-right">Items</th>
                  <th className="py-1 pr-2 text-right">Answered</th>
                  <th className="py-1 pr-2 text-right">One answer throughout</th>
                  <th className="py-1 text-right">Near</th>
                </tr>
              </thead>
              <tbody>
                {s.grids.map((g) => (
                  <tr key={g.stem} className="border-b border-border last:border-0" title={g.items.join(", ")}>
                    <td className="py-1 pr-2 font-medium">{g.stem}</td>
                    <td className="py-1 pr-2 text-right">{g.items.length}</td>
                    <td className="py-1 pr-2 text-right">{fmt(g.eligible)}</td>
                    <td className="py-1 pr-2 text-right">
                      {fmt(g.straightliners)} ({pct(g.straightliners, g.eligible)})
                    </td>
                    <td className="py-1 text-right">{fmt(g.nearStraightliners)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>

      <Section title="Non-answers" testId="rq-non-answers">
        {q.nonAnswer.measured ? (
          <p className="text-muted">
            {fmt(q.nonAnswer.flagged)} respondents gave non-answers (don&apos;t know, refused and similar, as the file labels them) to{" "}
            {Math.round(q.nonAnswer.threshold * 100)}% or more of at least {q.nonAnswer.minAnswers} labelled answers, across{" "}
            {fmt(q.nonAnswer.variables)} questions with such codes.
          </p>
        ) : (
          <p className="text-muted">Not measured: the file does not label which codes are &quot;Don&apos;t know&quot; or &quot;Refused&quot;.</p>
        )}
      </Section>

      <Section title="Speeders" testId="rq-speeders">
        {d.variable ? (
          <p className="text-muted">
            From <strong className="text-foreground">{d.variable}</strong>, median {fmt(d.median, 1)}: {fmt(d.speeders ?? 0)} respondents took less than
            half the median ({fmt(d.speederBelow, 1)}), {fmt(d.superSpeeders ?? 0)} of them less than 30% ({fmt(d.superSpeederBelow, 1)}).{" "}
            {fmt(d.long ?? 0)} took more than three times the median (noted, not flagged).
          </p>
        ) : (
          <p className="text-muted">Not measured: no interview length variable was found (a name such as duration, LOI or interview time).</p>
        )}
      </Section>

      <Section title="Interviewers" testId="rq-interviewers">
        {q.interviewers.variable ? (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                <th className="py-1 pr-2">Interviewer ({q.interviewers.variable})</th>
                <th className="py-1 pr-2 text-right">Cases</th>
                <th className="py-1 pr-2 text-right">Straightliners</th>
                <th className="py-1 pr-2 text-right">Median length</th>
                <th className="py-1">To check</th>
              </tr>
            </thead>
            <tbody>
              {q.interviewers.rows.map((r) => (
                <tr key={r.interviewer} className="border-b border-border last:border-0">
                  <td className="py-1 pr-2 font-medium">{r.interviewer}</td>
                  <td className="py-1 pr-2 text-right">{fmt(r.cases)}</td>
                  <td className="py-1 pr-2 text-right">{fmt(100 * r.straightlinerRate, 1)}%</td>
                  <td className="py-1 pr-2 text-right">{fmt(r.medianDuration, 1)}</td>
                  <td className="py-1 text-muted">{r.check.length ? r.check.join("; ") : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">Not measured: no interviewer variable was found.</p>
        )}
        {q.interviewers.variable && (
          <p className="mt-1 text-muted">An interviewer&apos;s cases can differ because of where or whom they interviewed, not only how.</p>
        )}
      </Section>

      {q.topCases.length > 0 && (
        <details className="rounded-lg border border-border bg-slate-50 p-2" data-testid="rq-cases">
          <summary className="cursor-pointer font-medium">
            Respondents to look at ({q.topCases.length < q.flaggedCases ? `first ${q.topCases.length} of ${fmt(q.flaggedCases)}` : fmt(q.flaggedCases)})
          </summary>
          <ul className="mt-2 space-y-1">
            {q.topCases.map((c) => (
              <li key={c.row}>
                <span className="font-medium">{q.idVariable && c.id !== null ? `${q.idVariable} ${c.id}` : `Row ${c.row}`}</span>
                <span className="text-muted">: {c.reasons.join("; ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Section({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId}>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">{title}</div>
      {children}
    </div>
  );
}
