import type { QualityStatus } from "@/lib/dataQuality";
import type { TranscriptImportQuality } from "@/lib/qualImportQuality";
import type { AggregatedQuality } from "@/lib/aggregatedQuality";

const statusLabel: Record<QualityStatus, string> = { pass: "Pass", warn: "Check", fail: "Problem" };
const statusClass: Record<QualityStatus, string> = {
  pass: "bg-success-light text-success",
  warn: "bg-amber-50 text-amber-700",
  fail: "bg-rose-50 text-rose-700",
};

function StatusPill({ status }: { status: QualityStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${statusClass[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

function Stat({ value, label }: { value: string | number; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function CheckTable({ checks }: { checks: { id: string; label: string; status: QualityStatus; detail: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="border-b border-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-muted">
            <th className="w-56 px-3 py-2">Check</th>
            <th className="px-3 py-2">Result</th>
            <th className="w-24 px-3 py-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.id} className="border-b border-border last:border-0">
              <td className="px-3 py-2 align-middle font-medium text-foreground">{c.label}</td>
              <td className="px-3 py-2 align-middle text-muted">{c.detail}</td>
              <td className="px-3 py-2 text-right align-middle">
                <StatusPill status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const n = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? "n/a" : x.toLocaleString(undefined, { maximumFractionDigits: digits });
const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);

/** What was imported from a transcript, before any coding. Counted from the text, nothing judged by a model. */
export function TranscriptImportQualityPanel({ q }: { q: TranscriptImportQuality }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-muted">
          Counted from the text as it will be read for coding, not judged by a model. A Check or Problem flag is a prompt
          to look, it does not block anything. Saturation and coding quality are reported later, under Coding.
        </p>
        <StatusPill status={q.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={q.respondents} label={q.sessionType === "focus_group" ? "Respondents (group)" : "Respondents"} />
        <Stat value={n(q.totalWords)} label="Words" />
        <Stat value={`${q.moderatorTurns} / ${q.participantTurns}`} label="Moderator / participant turns" />
        <Stat value={pct(q.moderatorWordShare)} label="Moderator share of words" />
        <Stat value={q.wordsPerRespondent ? n(q.wordsPerRespondent.median) : "n/a"} label="Median words per respondent" />
        <Stat value={q.questions.asked} label="Questions asked" />
        <Stat
          value={q.questions.medianAnswerWords === null ? "n/a" : n(q.questions.medianAnswerWords)}
          label="Median words in first answer"
        />
        <Stat value={q.unlabelledTurns} label="Turns without a speaker" />
      </div>
      <CheckTable checks={q.checks} />
      {q.respondentLines.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none font-medium text-muted">
            Respondents by words ({q.respondentLines.length})
          </summary>
          <div className="mt-2 max-h-72 overflow-auto">
            <table className="w-full min-w-[360px] text-left">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="py-1 pr-3">Respondent</th>
                  <th className="py-1 pr-3 text-right">Turns</th>
                  <th className="py-1 pr-3 text-right">Words</th>
                  <th className="py-1 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {q.respondentLines.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-0">
                    <td className="py-1 pr-3 text-foreground">{r.label}</td>
                    <td className="py-1 pr-3 text-right text-muted">{r.turns}</td>
                    <td className="py-1 pr-3 text-right text-muted">{n(r.words)}</td>
                    <td className="py-1 text-right text-muted">{pct(r.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {q.notes.map((note) => (
        <p key={note} className="text-xs text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

/** What was imported from already-aggregated tables. Counting and arithmetic only. */
export function AggregatedQualityPanel({ q }: { q: AggregatedQuality }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-muted">
          These tables arrive already calculated, so the checks ask whether they carry what is needed to use them safely:
          a base, a stated weighting, figures that add up, and no extraction damage. A Check or Problem flag does not
          block anything.
        </p>
        <StatusPill status={q.status} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={q.tables} label="Tables" />
        <Stat value={`${q.withBase} of ${q.tables}`} label="Tables with a base" />
        <Stat value={q.bases.median === null ? "n/a" : n(q.bases.median)} label="Median base" />
        <Stat value={q.bases.min === null ? "n/a" : n(q.bases.min)} label="Smallest base" />
        <Stat value={q.bases.under30} label="Bases under 30" />
        <Stat value={q.duplicateTables} label="Duplicate tables" />
        <Stat value={q.percentColumns.checked === 0 ? "n/a" : `${q.percentColumns.addTo100} of ${q.percentColumns.checked}`} label="% columns adding to 100" />
        <Stat value={q.bannerSignatures.distinct} label="Column layouts" />
      </div>
      <CheckTable checks={q.checks} />
    </div>
  );
}
