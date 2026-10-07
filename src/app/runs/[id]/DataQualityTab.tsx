"use client";

import type { DataQuality, Spread } from "@/lib/qualQuality";
import type { CodingAnalysisView } from "@/lib/codingAnalysis";
import {
  checkMeaningSaturationAction,
  type ActionResult,
} from "@/lib/codingAnalysisActions";

const th = "px-3 py-2 text-left text-[11px] font-semibold text-muted";
const td = "px-3 py-2 align-top text-xs text-foreground";

const fmt = (n: number | null, d = 0) =>
  n === null ? "n/a" : n.toLocaleString("en-ZA", { maximumFractionDigits: d });
const pct = (n: number | null) =>
  n === null ? "n/a" : `${Math.round(n * 100)}%`;
const spreadText = (s: Spread | null) =>
  s
    ? `median ${fmt(s.median)} (middle half ${fmt(s.q1)} to ${fmt(s.q3)}, range ${fmt(s.min)} to ${fmt(s.max)})`
    : "n/a";

function Stat({
  label,
  value,
  help,
}: {
  label: string;
  value: string;
  help: string;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-white px-3 py-2"
      title={help}
    >
      <p className="text-[11px] text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function SaturationChart({ q }: { q: NonNullable<DataQuality["saturation"]> }) {
  const n = q.order.length;
  const w = 520;
  const h = 200;
  const pad = { l: 34, r: 12, t: 10, b: 28 };
  const maxY = Math.max(q.totalCodes, 1);
  const x = (i: number) =>
    pad.l + (n === 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => h - pad.b - (v / maxY) * (h - pad.t - pad.b);
  const line = (vals: number[]) =>
    vals.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
  const band =
    q.permuted &&
    `${q.permuted.high.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ")} ${[
      ...q.permuted.low,
    ]
      .map((v, i) => [v, i] as const)
      .reverse()
      .map(([v, i]) => `L${x(i)},${y(v)}`)
      .join(" ")} Z`;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="w-full max-w-xl"
      role="img"
      aria-label="Themes found as respondents are added"
    >
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={w - pad.r}
            y1={y(maxY * t)}
            y2={y(maxY * t)}
            stroke="#e2e8f0"
          />
          <text
            x={pad.l - 4}
            y={y(maxY * t) + 3}
            fontSize="9"
            textAnchor="end"
            fill="#64748b"
          >
            {Math.round(maxY * t)}
          </text>
        </g>
      ))}
      {band && <path d={band} fill="#a78bfa" opacity="0.18" />}
      {q.permuted && (
        <path
          d={line(q.permuted.median)}
          fill="none"
          stroke="#7c3aed"
          strokeWidth="1.5"
          strokeDasharray="4 3"
        />
      )}
      <path
        d={line(q.cumulativeCodes)}
        fill="none"
        stroke="#0f172a"
        strokeWidth="2"
      />
      {q.cumulativeCodes.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#0f172a">
          <title>{`${q.order[i]}: ${v} themes so far (+${q.newCodesPerRespondent[i]})`}</title>
        </circle>
      ))}
      <text x={pad.l} y={h - 8} fontSize="9" fill="#64748b">
        Respondents added, in file order (1 to {n})
      </text>
    </svg>
  );
}

export default function DataQualityTab({
  runId,
  view,
  run,
  busy,
}: {
  runId: string;
  view: CodingAnalysisView;
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
}) {
  const q = view.quality;
  const focus = view.sessionType === "focus_group";
  const sat = q.saturation;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        These describe the data and the sample. None of them is a pass or fail
        test, and the saturation curves are evidence about whether the sample
        was big enough, not proof.
      </p>

      {q.notes.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {q.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Respondents"
          value={fmt(q.respondents)}
          help="Distinct participants who spoke."
        />
        <Stat
          label="Participant turns"
          value={fmt(q.participantTurns)}
          help="Turns spoken by participants. Moderator turns are not included."
        />
        <Stat
          label="Participant words"
          value={fmt(q.participantWords)}
          help="Words spoken by participants."
        />
        <Stat
          label="Themes found"
          value={fmt(view.codes.length)}
          help="Codes in the current codebook."
        />
        <Stat
          label="Turns carrying a code"
          value={pct(q.codedShare)}
          help="Share of participant turns with at least one code."
        />
        <Stat
          label="Moderator word share"
          value={pct(q.moderatorWordShare)}
          help="Share of all words spoken by the moderator. A high share can mean leading questions."
        />
        <Stat
          label="Top speaker's word share"
          value={pct(q.topSpeakerShare)}
          help="Share of participant words from the most talkative person."
        />
        <Stat
          label="Top three speakers"
          value={pct(q.topThreeShare)}
          help="Share of participant words from the three most talkative people."
        />
      </div>

      <div className="space-y-1 text-[11px] text-muted">
        <p>
          <span className="font-bold text-foreground">
            Words per respondent:{" "}
          </span>
          {spreadText(q.wordsPerRespondent)}
        </p>
        <p>
          <span className="font-bold text-foreground">Words per turn: </span>
          {spreadText(q.wordsPerTurn)}
          {q.sentencesPerTurn !== null &&
            `. About ${fmt(q.sentencesPerTurn, 1)} sentences per turn.`}
        </p>
        <p>
          <span className="font-bold text-foreground">Transcript checks: </span>
          {q.unlabelledTurns} unlabelled turn
          {q.unlabelledTurns === 1 ? "" : "s"}, {q.duplicateTurns} repeated turn
          {q.duplicateTurns === 1 ? "" : "s"}, {q.moderatorTurns} moderator turn
          {q.moderatorTurns === 1 ? "" : "s"} left out of coding.{" "}
          {q.truncated === true
            ? "Cut before coding."
            : q.truncated === false
              ? "Whole transcript was seen by open coding."
              : "Whether open coding saw all of it was not recorded."}
        </p>
        {q.thinRespondents.length > 0 && (
          <p>
            <span className="font-bold text-foreground">
              Very little to code:{" "}
            </span>
            {q.thinRespondents
              .map((r) => `${r.label} (${r.words} words)`)
              .join(", ")}
            .
          </p>
        )}
        {q.thinThemes.length > 0 && (
          <p>
            <span className="font-bold text-foreground">
              Themes held by fewer than 3 people:{" "}
            </span>
            {q.thinThemes
              .map((t) => `${t.codeName} (${t.participants})`)
              .join(", ")}
            .
          </p>
        )}
      </div>

      {sat ? (
        <div className="space-y-2">
          <p className="text-[11px] font-bold text-foreground">
            Are new respondents still adding new themes?
          </p>
          <SaturationChart q={sat} />
          <p className="text-[11px] text-muted">
            Solid line: themes found so far, adding respondents in the order
            they appear in the file. Dashed line and band: the same count with
            the order shuffled 200 times (median, and the middle 80%), so the
            result does not hang on who happened to be first.{" "}
            {sat.lastThreeNewCodes !== null &&
              `The last three respondents added ${sat.lastThreeNewCodes} new theme${sat.lastThreeNewCodes === 1 ? "" : "s"} to the file-order count.`}
          </p>
          {sat.simple && (
            <p className="text-[11px] text-muted">
              <span className="font-bold text-foreground">
                Simple rule check:{" "}
              </span>
              the first {sat.simple.base} respondents gave{" "}
              {sat.simple.baseCodes} themes. The next {sat.simple.run} added{" "}
              {sat.simple.newInRun}
              {sat.simple.ratio !== null &&
                ` (${pct(sat.simple.ratio)} new, against a 5% threshold)`}
              .
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  checkMeaningSaturationAction(
                    runId,
                    view.documentId,
                    view.codebookId,
                  ),
                )
              }
              className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
            >
              {busy
                ? "Checking..."
                : "Check for new meaning in later respondents"}
            </button>
            <span className="text-[11px] text-muted">
              Uses the model, one call per theme. Compares the last third of
              respondents with the earlier ones. Needs 6 or more labelled
              respondents and migration 0049.
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  <th
                    className={th}
                    title="Respondents with the theme, out of all respondents."
                  >
                    Respondents
                  </th>
                  <th
                    className={th}
                    title="Position in the file of the first respondent who voiced it."
                  >
                    First seen at
                  </th>
                  <th
                    className={th}
                    title="Of its respondents, how many were among the first half of the sample."
                  >
                    In first half
                  </th>
                  <th
                    className={th}
                    title="Of its respondents, how many were among the last third of the sample. Many here suggests the theme was still being picked up late."
                  >
                    Added in last third
                  </th>
                  <th
                    className={th}
                    title="Model-assisted. Whether the later respondents add a distinct dimension the earlier ones did not express. Read the quotes before relying on it."
                  >
                    Late respondents add new meaning?
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sat.themes.map((t) => (
                  <tr key={t.codeId}>
                    <td className={`${td} font-medium`}>{t.codeName}</td>
                    <td className={td}>
                      {t.participants} of {q.respondents}
                    </td>
                    <td className={td}>{t.firstSeenAt ?? "n/a"}</td>
                    <td className={td}>
                      {t.participants === 0
                        ? "n/a"
                        : `${t.inFirstHalf} of ${t.participants}`}
                    </td>
                    <td className={td}>
                      {t.participants === 0
                        ? "n/a"
                        : `${t.addedInLastThird} of ${t.participants}`}
                    </td>
                    <td className={td}>
                      {(() => {
                        const m = view.meaningChecks[t.codeId];
                        if (!m) return "Not checked";
                        if (m.verdict === "too_few_turns")
                          return "Too few turns to compare";
                        if (m.verdict === "no_new_meaning")
                          return "No new dimension found";
                        return (
                          <div className="space-y-1">
                            <span className="font-medium">
                              Possibly: {m.dimensions.length} new dimension
                              {m.dimensions.length === 1 ? "" : "s"}
                            </span>
                            {m.dimensions.map((d, i) => (
                              <p key={i} className="text-[11px] text-muted">
                                {d.description}
                                <br />
                                <span className="italic">
                                  &ldquo;{d.quote}&rdquo; (
                                  {d.speaker ?? "unlabelled"}, turn {d.turn})
                                </span>
                              </p>
                            ))}
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">
            The codebook was built from the whole transcript, not discovered
            respondent by respondent, so this approximates saturation rather
            than tracing it.{" "}
            {focus
              ? "In a focus group the turns are not independent, so read this by group where you can. "
              : ""}
            Theme labels can be saturated while the meaning within them is not;
            that needs your reading of the quotes.
          </p>
        </div>
      ) : (
        <p className="text-[11px] text-muted">
          Too few labelled respondents for a saturation curve.
        </p>
      )}
    </div>
  );
}
