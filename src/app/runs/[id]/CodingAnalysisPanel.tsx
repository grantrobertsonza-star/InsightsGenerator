"use client";

import CodingProgressBar from "./CodingProgressBar";
import { kappaBand } from "@/lib/qualAudit";
import { useState, useTransition } from "react";
import {
  addLinkAction,
  proposeLinksAction,
  resegmentTranscriptAction,
  resetCalibrationAction,
  resolveStabilityTurnAction,
  runStabilityCheckAction,
  applyMajorityCodingAction,
  saveBlindStabilityTurnAction,
  saveCalibrationTurnAction,
  searchNegativeCasesAction,
  setCaseMappingAction,
  setLinkStatusAction,
  setNegativeCaseStatusAction,
  setRespondentKeyAction,
  setSessionTypeAction,
  startCalibrationAction,
  type ActionResult,
} from "@/lib/codingAnalysisActions";
import QuotesTab from "./QuotesTab";
import CrosstabTab from "./CrosstabTab";
import { formatCount } from "@/lib/qualAnalysis";
import type { SegmentMode } from "@/lib/qualCoding";
import type {
  CalibrationTurn,
  CodeAnalysis,
  CodingAnalysisView,
  LinkView,
  StabilityTurn,
} from "@/lib/codingAnalysis";

type Tab =
  | "counts"
  | "crosstabs"
  | "quotes"
  | "calibration"
  | "stability"
  | "respondents"
  | "negative";

const pill =
  "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide";
const button =
  "rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-slate-400 hover:text-foreground disabled:opacity-50";
const primaryButton =
  "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-hover disabled:opacity-50";
const select =
  "rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const th =
  "px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wide text-muted";
const td = "px-2 py-1.5 align-top text-xs text-foreground";

function pct(n: number | null) {
  return n === null ? "n/a" : `${Math.round(n * 100)}%`;
}

/**
 * The checks that sit on a coded transcript: counts with their denominators,
 * agreement with the researcher's own coding, the respondent by theme matrix
 * joined to closed survey answers, and the search for negative cases. Nothing
 * here changes the coded findings; it is there so the researcher can judge
 * how far to trust them.
 */
export default function CodingAnalysisPanel({
  runId,
  view,
}: {
  runId: string;
  view: CodingAnalysisView;
}) {
  const [tab, setTab] = useState<Tab>("counts");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error);
      else if (result.message) setMessage(result.message);
    });
  }

  const focus = view.sessionType === "focus_group";
  const tabs: { id: Tab; label: string }[] = [
    { id: "counts", label: "Counts" },
    { id: "crosstabs", label: "Cross-tabs" },
    { id: "quotes", label: "Quotes by theme" },
    { id: "calibration", label: "Agreement with you" },
    { id: "stability", label: "Stability check" },
    { id: "respondents", label: "Respondents" },
    { id: "negative", label: "Negative cases" },
  ];

  const cal = view.calibration;
  const audited =
    cal && cal.kind === "audit" && cal.drawn > 0 && cal.reviewed >= cal.drawn;
  const auditStarted = cal && cal.kind === "audit" && cal.reviewed > 0;
  return (
    <>
    {!view.setupMissing && (
      <div
        className={`mb-2 rounded-lg border px-3 py-2 text-xs ${
          audited
            ? "border-success bg-success-light text-success"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {audited ? (
          <>
            Audited: you checked {cal!.reviewed} randomly drawn turns
            {cal!.estimate
              ? `; the model's themes matched yours exactly on about ${Math.round(cal!.estimate.accuracy * 100)}% (${Math.round(cal!.estimate.low * 100)}% to ${Math.round(cal!.estimate.high * 100)}%).`
              : "."}
          </>
        ) : auditStarted ? (
          <>
            Audit in progress: {cal!.reviewed} of {cal!.drawn} turns judged.
            Treat these themes as unchecked until it is finished.
          </>
        ) : (
          <>
            Not yet audited. These themes are the model&apos;s coding and no one
            has checked a random sample of it. Open Coding checks, then
            Agreement with you, and draw a random audit.
          </>
        )}
      </div>
    )}
    <details className="rounded-lg border border-border bg-slate-50 p-2 text-xs">
      <summary className="cursor-pointer select-none font-medium text-muted">
        Coding checks
        {view.calibration && view.calibration.reviewed > 0
          ? ` · ${view.calibration.reviewed} turns judged by you`
          : ""}
      </summary>

      <div className="mt-3 space-y-3">
        {view.setupMissing && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 font-medium text-amber-800">
            The calibration, survey and negative case tools need database
            migration 0044. The counts below work without it.
          </div>
        )}

        <ReadingBox runId={runId} view={view} run={run} busy={isPending} />

        <div className="flex flex-wrap items-center gap-2">
          <label
            className="text-[11px] font-medium text-muted"
            htmlFor={`st-${view.documentId}`}
          >
            This transcript is
          </label>
          <select
            id={`st-${view.documentId}`}
            className={select}
            value={view.sessionType}
            disabled={isPending || view.setupMissing}
            onChange={(e) =>
              run(() =>
                setSessionTypeAction(
                  runId,
                  view.documentId,
                  e.target.value as "individual" | "focus_group",
                ),
              )
            }
          >
            <option value="individual">An individual interview</option>
            <option value="focus_group">A focus group</option>
          </select>
          <span className="text-[11px] text-muted">
            {focus
              ? "Counts are reported by group, and replies that echo another speaker are flagged."
              : "Each speaker is counted as one respondent."}
          </span>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-xs font-medium transition ${
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "counts" && <CountsTab view={view} focus={focus} />}
        {tab === "crosstabs" && <CrosstabTab view={view} />}
        {tab === "quotes" && (
          <QuotesTab runId={runId} view={view} run={run} busy={isPending} />
        )}
        {tab === "calibration" && (
          <CalibrationTab
            runId={runId}
            view={view}
            run={run}
            busy={isPending}
          />
        )}
        {tab === "stability" && (
          <StabilityTab
            runId={runId}
            view={view}
            run={run}
            busy={isPending}
          />
        )}
        {tab === "respondents" && (
          <RespondentsTab
            runId={runId}
            view={view}
            run={run}
            busy={isPending}
          />
        )}
        {tab === "negative" && (
          <NegativeTab runId={runId} view={view} run={run} busy={isPending} />
        )}

        {message && (
          <div className="rounded-lg border border-border bg-white px-3 py-2 text-foreground">
            {message}
          </div>
        )}
        {error && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-danger bg-danger-light px-3 py-2 text-danger">
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="shrink-0 font-medium underline"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </details>
    </>
  );
}

const COLUMN_HELP = {
  turns:
    "Participant turns carrying this theme, out of all participant turns. Moderator turns are never counted.",
  participants:
    "Distinct people with at least one turn coded to this theme, out of everyone who spoke. A theme from one talkative person shows up here as a low number.",
  episodes:
    "Separate stretches of conversation where the theme came up. Coded turns more than three turns apart start a new episode, so many turns in one burst count as one episode.",
  independent:
    "Focus groups only. Participants with at least one coded turn that is not an echo of someone else, so a view that really is theirs.",
  echoes:
    "Focus groups only. Coded turns that look like repeating the previous speaker: short replies (15 words or fewer) or ones sharing half their words, within four turns after another speaker's coded turn. A flag to read, not a ruling.",
  groups:
    "Focus groups only. Groups where the theme came up, out of all focus groups in the project. A file holding several groups (\"Focus group 1\", \"Focus group 2\") counts each separately; otherwise each file is one group. Groups are matched on theme name.",
};

const MODE_LABEL: Record<SegmentMode, string> = {
  auto: "Work it out automatically",
  labels: 'Speakers are labelled ("Name: ...")',
  headings: 'Headings mark each respondent ("Interview 1")',
  sessions:
    'Several interviews or groups in one file ("FOCUS GROUP 1: ...", "U01: ...")',
  paragraphs: "Each paragraph is one respondent",
  none: "No structure: unlabelled paragraphs",
};

/**
 * Says how the file was split into respondents and turns, warns when that
 * looks doubtful, and lets the researcher pick a different reading or mark
 * which speakers are the moderator. Saving reads the text again and applies
 * the current codebook to the new turns.
 */
function ReadingBox({
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
  const r = view.reading;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SegmentMode>(r.requested);
  const [mods, setMods] = useState<string[]>(
    r.speakers.filter((s) => s.moderator).map((s) => s.label),
  );
  const s = r.summary;
  const changed =
    mode !== r.requested ||
    mods.slice().sort().join("|") !==
      r.speakers
        .filter((x) => x.moderator)
        .map((x) => x.label)
        .sort()
        .join("|");
  const readAs =
    r.resolved === "headings"
      ? "respondent headings"
      : r.resolved === "sessions"
        ? "several sessions in one file"
        : r.resolved === "labels"
          ? "speaker labels"
          : r.resolved === "paragraphs"
            ? "one respondent per paragraph"
            : r.resolved === "none"
              ? "plain paragraphs"
              : "an unrecorded reading";
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-[11px] text-muted">
          <span className="font-bold text-foreground">
            How this file was read:
          </span>{" "}
          {s.respondents === null
            ? "no respondents found"
            : `${s.respondents} respondent${s.respondents === 1 ? "" : "s"}`}
          , {s.participantTurns} participant turn
          {s.participantTurns === 1 ? "" : "s"}
          {s.moderatorTurns > 0
            ? `, ${s.moderatorTurns} moderator turn${s.moderatorTurns === 1 ? "" : "s"} left out`
            : ""}
          , from {readAs}
          {r.requested !== "auto" ? " (set by you)" : ""}.
        </p>
        <button
          type="button"
          className={button}
          disabled={busy || !r.controlsAvailable}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Close" : "Change"}
        </button>
      </div>
      {s.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {s.warnings.map((w) => (
            <li
              key={w}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800"
            >
              {w}
            </li>
          ))}
        </ul>
      )}
      {!r.controlsAvailable && (
        <p className="mt-2 text-[11px] text-amber-700">
          Changing how a file is read needs database migration 0046.
        </p>
      )}
      {open && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <div>
            <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted">
              Read the file as
            </label>
            <select
              className={select}
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as SegmentMode)}
            >
              {(Object.keys(MODE_LABEL) as SegmentMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </div>
          {r.speakers.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                Who is the moderator or interviewer
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {r.speakers.map((sp) => (
                  <label
                    key={sp.label}
                    className="flex items-center gap-1.5 text-xs text-foreground"
                  >
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={mods.includes(sp.label)}
                      onChange={(e) =>
                        setMods((cur) =>
                          e.target.checked
                            ? [...cur, sp.label]
                            : cur.filter((x) => x !== sp.label),
                        )
                      }
                    />
                    {sp.label}
                    <span className="text-muted">({sp.turns})</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy || !changed}
              onClick={() =>
                run(() =>
                  resegmentTranscriptAction(runId, view.documentId, mode, mods),
                )
              }
            >
              {busy ? "Reading again..." : "Read again and re-apply codebook"}
            </button>
            <span className="text-[11px] text-muted">
              One model call per batch of turns. Calibration samples, negative
              cases and survey matches for this transcript are cleared, because
              the turns change. The codebook stays as it is.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Counts ---------------------------------------------------------------

function CountsTab({
  view,
  focus,
}: {
  view: CodingAnalysisView;
  focus: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-muted">
        Every count is out of what could have supported the theme: all
        participant turns, and all participants who spoke. A theme resting on
        one talkative person looks very different from one shared across the
        room.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[640px]">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Theme</th>
              <th className={th} title={COLUMN_HELP.turns}>Turns</th>
              <th className={th} title={COLUMN_HELP.participants}>Participants</th>
              <th className={th} title={COLUMN_HELP.episodes}>Episodes</th>
              {focus && <th className={th} title={COLUMN_HELP.independent}>Independent</th>}
              {focus && <th className={th} title={COLUMN_HELP.echoes}>Echoes</th>}
              {focus && <th className={th} title={COLUMN_HELP.groups}>Groups</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {view.codes.map((c) => (
              <tr key={c.id}>
                <td className={`${td} font-medium`}>
                  {c.name}
                  {c.theme && (
                    <div className="text-[10px] font-normal text-muted">
                      Under: {c.theme}
                    </div>
                  )}
                </td>
                <td className={td}>
                  {formatCount(c.stats.turns, c.stats.participantTurns, "turn")}
                </td>
                <td className={td}>
                  {c.stats.speakersWith === null ||
                  c.stats.speakersTotal === null
                    ? "No speaker labels"
                    : formatCount(
                        c.stats.speakersWith,
                        c.stats.speakersTotal,
                        "participant",
                      )}
                </td>
                <td
                  className={td}
                  title="Runs of coded turns. Turns more than three apart start a new episode."
                >
                  {c.stats.episodes}
                </td>
                {focus && (
                  <td
                    className={td}
                    title="Participants with at least one coded turn that is not an echo of someone else."
                  >
                    {c.stats.independentSpeakers === null
                      ? "n/a"
                      : formatCount(
                          c.stats.independentSpeakers,
                          c.stats.speakersTotal ?? 0,
                          "participant",
                        )}
                  </td>
                )}
                {focus && (
                  <td
                    className={td}
                    title="Short or near-repeating replies that follow another speaker's coded turn."
                  >
                    {c.stats.echoTurns}
                  </td>
                )}
                {focus && (
                  <td
                    className={td}
                    title={
                      c.groups && c.groups.names.length > 0
                        ? `Came up in: ${c.groups.names.join("; ")}`
                        : "Focus groups in this project where a theme of the same name was coded."
                    }
                  >
                    {c.groups
                      ? formatCount(c.groups.with, c.groups.total, "group")
                      : "n/a"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.themes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-foreground">
            Themes (all their sub-themes together)
          </p>
          <p className="text-[11px] text-muted">
            A turn or participant counts once for a theme even when it carries
            several of that theme&apos;s sub-themes.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[520px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  <th className={th}>Sub-themes</th>
                  <th className={th}>Turns</th>
                  <th className={th}>Participants</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.themes.map((t) => (
                  <tr key={t.theme}>
                    <td className={`${td} font-medium`}>{t.theme}</td>
                    <td className={td}>{t.codeNames.join("; ")}</td>
                    <td className={td}>
                      {formatCount(
                        t.stats.turns,
                        t.stats.participantTurns,
                        "turn",
                      )}
                    </td>
                    <td className={td}>
                      {t.stats.speakersWith === null ||
                      t.stats.speakersTotal === null
                        ? "No speaker labels"
                        : formatCount(
                            t.stats.speakersWith,
                            t.stats.speakersTotal,
                            "participant",
                          )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {view.codes.some((c) => c.keywordCounts.length > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-foreground">
            Keyword counts
          </p>
          <p className="text-[11px] text-muted">
            Whole-word, case-insensitive counts over all participant turns,
            whether or not the turn was coded. Mentions are occurrences; turns
            and participants are how many contain the word.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[520px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  <th className={th}>Keyword</th>
                  <th className={th}>Mentions</th>
                  <th className={th}>Turns</th>
                  <th className={th}>Participants</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.codes.flatMap((c) =>
                  c.keywordCounts.map((k) => (
                    <tr key={`${c.id}-${k.term}`}>
                      <td className={td}>{c.name}</td>
                      <td className={`${td} font-medium`}>{k.term}</td>
                      <td className={td}>{k.mentions}</td>
                      <td className={td}>{k.turns}</td>
                      <td className={td}>{k.speakers ?? "n/a"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <details className="rounded-lg border border-border bg-white p-3 text-[11px] text-muted">
        <summary className="cursor-pointer font-medium text-foreground">
          What the columns mean
        </summary>
        <dl className="mt-2 space-y-1.5">
          {(
            [
              ["Turns", COLUMN_HELP.turns],
              ["Participants", COLUMN_HELP.participants],
              ["Episodes", COLUMN_HELP.episodes],
              ...(focus
                ? ([
                    ["Independent", COLUMN_HELP.independent],
                    ["Echoes", COLUMN_HELP.echoes],
                    ["Groups", COLUMN_HELP.groups],
                  ] as [string, string][])
                : []),
            ] as [string, string][]
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="inline font-bold text-foreground">{k}: </dt>
              <dd className="inline">{v}</dd>
            </div>
          ))}
        </dl>
      </details>
      {focus && (
        <p className="text-[11px] text-muted">
          An echo is a flag, not a ruling: a short reply from a different
          speaker within four turns of a coded turn, or a longer one sharing
          half its words. Read them before discounting them. Groups are matched
          on theme name, so rename themes consistently across transcripts for
          that count to be meaningful, and mark every focus group transcript as
          one.
        </p>
      )}
    </div>
  );
}

// --- Calibration ----------------------------------------------------------

function CalibrationTab({
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
  const [confirmReset, setConfirmReset] = useState(false);
  const cal = view.calibration;
  const [auditSize, setAuditSize] = useState<number>(view.suggestedAuditSize);
  if (!cal) {
    const maxSize = Math.max(1, view.participantTurns);
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-muted">
          Code a sample of turns yourself, without seeing what the model
          decided, and the two sets of coding are compared theme by theme.
          Choose how the sample is drawn.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-primary/40 bg-white p-3">
            <div className="text-xs font-semibold text-foreground">
              Random audit (recommended)
            </div>
            <p className="text-[11px] text-muted">
              Turns are drawn at random within groups: turns the model gave no
              theme, and turns grouped by their rarest theme, so small themes
              are not lost. Because it is random, the result can be read as an
              estimate for the whole transcript, with an interval. Sources on
              double coding suggest checking roughly 10 to 25% of the units.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="text-[11px] font-medium text-muted"
                htmlFor={`aud-${view.codebookId}`}
              >
                Turns to code
              </label>
              <input
                id={`aud-${view.codebookId}`}
                type="number"
                min={1}
                max={maxSize}
                value={auditSize}
                onChange={(e) =>
                  setAuditSize(
                    Math.min(maxSize, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                className="w-20 rounded-lg border border-border bg-white px-2 py-1 text-xs"
              />
              <span className="text-[11px] text-muted">
                of {view.participantTurns} participant turns (suggested{" "}
                {view.suggestedAuditSize})
              </span>
            </div>
            <button
              type="button"
              className={primaryButton}
              disabled={busy || view.setupMissing || view.participantTurns === 0}
              onClick={() =>
                run(() =>
                  startCalibrationAction(runId, view.documentId, view.codebookId, {
                    kind: "audit",
                    size: auditSize,
                  }),
                )
              }
            >
              Draw a random audit
            </button>
          </div>
          <div className="space-y-2 rounded-lg border border-border bg-white p-3">
            <div className="text-xs font-semibold text-foreground">
              Targeted check
            </div>
            <p className="text-[11px] text-muted">
              A few turns the model gave each theme, some it gave nothing, and
              the rest by seeded order. Good for testing whether each theme
              definition is workable, but it leans towards turns the model
              coded, so it says nothing about how often the model is right
              across the transcript.
            </p>
            <button
              type="button"
              className={button}
              disabled={busy || view.setupMissing}
              onClick={() =>
                run(() =>
                  startCalibrationAction(runId, view.documentId, view.codebookId, {
                    kind: "targeted",
                  }),
                )
              }
            >
              Draw a targeted sample
            </button>
          </div>
        </div>
      </div>
    );
  }
  const withAgreement = view.codes.filter((c) => c.agreement);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-muted">
          {cal.reviewed} of {cal.drawn} sampled turns judged. The model&apos;s
          coding of a turn stays hidden until you have saved yours.
        </span>
        {confirmReset ? (
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-danger">
              This deletes your judgements.
            </span>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => {
                setConfirmReset(false);
                run(() => resetCalibrationAction(runId, view.codebookId));
              }}
            >
              Confirm
            </button>
            <button
              type="button"
              className={button}
              onClick={() => setConfirmReset(false)}
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            className={button}
            onClick={() => setConfirmReset(true)}
          >
            Start over
          </button>
        )}
      </div>

      {cal.kind === "audit" && (
        <AuditEstimateBox cal={cal} total={view.participantTurns} />
      )}

      <div className="space-y-2">
        {cal.turns.map((t) => (
          <CalibrationCard
            key={`${t.segmentId}-${t.reviewed}`}
            runId={runId}
            codebookId={view.codebookId}
            turn={t}
            codes={view.codes}
            run={run}
            busy={busy}
          />
        ))}
      </div>

      {withAgreement.length > 0 && (
        <div className="space-y-1">
          <div className="overflow-x-auto rounded-lg border border-border bg-white">
            <table className="w-full min-w-[560px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className={th}>Theme</th>
                  <th className={th}>Turns judged</th>
                  <th className={th}>Agree</th>
                  <th className={th}>Kappa</th>
                  <th className={th}>Agree on yes</th>
                  <th className={th}>Model only</th>
                  <th className={th}>You only</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {withAgreement.map((c) => {
                  const a = c.agreement!;
                  return (
                    <tr key={c.id}>
                      <td className={`${td} font-medium`}>
                        {c.name}
                        {a.caveat && (
                          <div className="mt-0.5 font-normal text-amber-700">
                            {a.caveat}
                          </div>
                        )}
                      </td>
                      <td className={td}>{a.counts.n}</td>
                      <td className={td}>{pct(a.counts.agreement)}</td>
                      <td className={td}>
                        {a.counts.kappa === null
                          ? "n/a"
                          : a.counts.kappa.toFixed(2)}
                        <span className="ml-1 text-muted">{a.band}</span>
                      </td>
                      <td className={td}>
                        {pct(a.extended.positiveAgreement)}
                        {a.extended.skewed && (
                          <div className="mt-0.5 text-amber-700">
                            Rare or very common: kappa can read low even when
                            agreement is high. Raw agreement {pct(a.counts.agreement)}.
                          </div>
                        )}
                      </td>
                      <td className={td}>{a.counts.modelOnly}</td>
                      <td className={td}>{a.counts.researcherOnly}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted">
            Kappa is agreement beyond what chance alone would give. It falls
            when a theme is rare or very common even if the two of you almost
            always agree, so read it beside the plain agreement and the
            agreement on the turns where either of you applied the theme.{" "}
            {cal.kind === "audit"
              ? "This sample is random within groups, so the overall estimate above speaks for the transcript; the per-theme rows rest on few turns each."
              : "This sample leans towards turns the model coded, so read these as how the codebook behaves on these turns, not as the model's hit rate across the transcript."}{" "}
            The bands are conventions, and one researcher is not a gold
            standard: a low figure can mean a vague definition as easily as a
            poor model call. Tighten the definition in the codebook and
            re-apply it, then draw a new sample.
          </p>
        </div>
      )}
    </div>
  );
}

function CalibrationCard({
  runId,
  codebookId,
  turn,
  codes,
  run,
  busy,
}: {
  runId: string;
  codebookId: string;
  turn: CalibrationTurn;
  codes: CodeAnalysis[];
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<Set<string>>(
    new Set(turn.researcherCodeIds),
  );
  const dirty =
    !turn.reviewed ||
    picked.size !== turn.researcherCodeIds.length ||
    turn.researcherCodeIds.some((id) => !picked.has(id));
  return (
    <div className="space-y-2 rounded-lg border border-border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted">
          {turn.speaker ?? "Speaker unknown"} &middot; turn {turn.index + 1}
        </span>
        {turn.reviewed && (
          <span className={`${pill} bg-success-light text-success`}>
            Judged
          </span>
        )}
      </div>
      <p className="text-xs text-foreground">{turn.text}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {codes.map((c) => {
          const model = turn.modelCodeIds.includes(c.id);
          const mine = picked.has(c.id);
          return (
            <label
              key={c.id}
              className="flex items-center gap-1.5 text-xs text-foreground"
            >
              <input
                type="checkbox"
                checked={mine}
                disabled={busy}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  setPicked(next);
                }}
              />
              {c.name}
              {turn.reviewed && !dirty && (
                <span
                  className={`${pill} ${model === mine ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}
                >
                  {model === mine
                    ? model
                      ? "Both"
                      : "Neither"
                    : model
                      ? "Model only"
                      : "You only"}
                </span>
              )}
            </label>
          );
        })}
      </div>
      <button
        type="button"
        className={primaryButton}
        disabled={busy || !dirty}
        onClick={() =>
          run(() =>
            saveCalibrationTurnAction(runId, codebookId, turn.segmentId, [
              ...picked,
            ]),
          )
        }
      >
        {turn.reviewed ? "Update my coding" : "Save my coding"}
      </button>
    </div>
  );
}

function AuditEstimateBox({
  cal,
  total,
}: {
  cal: NonNullable<CodingAnalysisView["calibration"]>;
  total: number;
}) {
  const e = cal.estimate;
  if (!e) {
    return (
      <div className="rounded-lg border border-border bg-white px-3 py-2 text-[11px] text-muted">
        Judge some of the {cal.drawn} sampled turns and an estimate for the
        whole transcript appears here.
      </div>
    );
  }
  return (
    <div className="space-y-1 rounded-lg border border-border bg-white px-3 py-2">
      <div className="text-xs text-foreground">
        On about{" "}
        <span className="font-semibold">{Math.round(e.accuracy * 100)}%</span>{" "}
        of participant turns, the model&apos;s themes match yours exactly
        (plausible range {Math.round(e.low * 100)}% to {Math.round(e.high * 100)}%
        ), from {e.reviewed} of the {cal.drawn} sampled turns, out of {total}{" "}
        in the transcript.
      </div>
      <p className="text-[11px] text-muted">
        Exact means no theme missed and none added. {" "}
        {e.reviewed < cal.drawn &&
          `${cal.drawn - e.reviewed} sampled turns are still to judge, so this will move. `}
        {e.missingStrata > 0 &&
          `${e.missingStrata} group${e.missingStrata === 1 ? "" : "s"} of turns ha${e.missingStrata === 1 ? "s" : "ve"} no judged turn yet and ${e.missingStrata === 1 ? "is" : "are"} left out. `}
        {e.wide &&
          "The range is wide, so treat the figure as rough; judging more turns narrows it. "}
        It is your coding against the model&apos;s, and yours is one reading,
        not a gold standard.
      </p>
    </div>
  );
}

function StabilityTab({
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
  const [reruns, setReruns] = useState(2);
  const st = view.stability;
  const [showResolved, setShowResolved] = useState(false);
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <label
        className="text-[11px] font-medium text-muted"
        htmlFor={`rr-${view.codebookId}`}
      >
        Apply the codebook again
      </label>
      <select
        id={`rr-${view.codebookId}`}
        className={select}
        value={reruns}
        disabled={busy}
        onChange={(e) => setReruns(Number(e.target.value))}
      >
        <option value={1}>1 more time</option>
        <option value={2}>2 more times (recommended)</option>
        <option value={3}>3 more times</option>
      </select>
      <button
        type="button"
        className={primaryButton}
        disabled={busy || view.setupMissing}
        onClick={() =>
          run(() =>
            runStabilityCheckAction(runId, view.documentId, view.codebookId, reruns),
          )
        }
      >
        {busy ? "Working..." : st ? "Run again" : "Run the check"}
      </button>
      <div className="basis-full">
        <CodingProgressBar runId={runId} active={busy} />
      </div>
    </div>
  );
  if (!st) {
    return (
      <div className="space-y-2">
        <p className="text-[11px] text-muted">
          Applies the same codebook to the same turns again and shows which
          turns came out differently. Where repeated runs disagree, the coding
          is least trustworthy, so those turns go to you to settle. Each re-run
          costs as much as the original application and changes nothing until
          you decide on a turn.
        </p>
        {controls}
      </div>
    );
  }
  const open = st.queue.filter((q) => !q.resolved);
  const done = st.queue.filter((q) => q.resolved);
  const s = st.summary;
  return (
    <div className="space-y-3">
      {controls}
      <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground">
        <span className="font-semibold">
          {st.codeAgreement === null ? "n/a" : pct(st.codeAgreement)}
        </span>{" "}
        average agreement per theme across {st.runs} runs. For each theme, that
        is the share of the turns it came up in where every run gave it. Themes
        that came up in fewer than 10 turns are left out of this figure.
        {st.kappaAverage !== null && (
          <p className="mt-1 text-[11px] text-muted">
            Chance-corrected: average kappa {st.kappaAverage.toFixed(2)}. Kappa
            discounts the agreement you would get by luck, so it is the figure
            to compare with research benchmarks, where 0.80 or above is usually
            read as strong. The percentage above is not on that scale.
          </p>
        )}
        <p className="mt-1 text-[11px] text-muted">
          Read this theme by theme. A low overall figure does not mean all of
          the coding is unreliable: it is an average, and a few fuzzy themes
          can pull it down while the rest are solid. Report strong themes with
          confidence and weak ones as tentative. These figures show
          consistency, not correctness; your audit sample is the check on that.
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Stricter whole-turn check: {s.share === null ? "n/a" : pct(s.share)}{" "}
          of {s.turns} participant turns got exactly the same set of themes in
          every run. {s.medium} came out differently in one run, {s.low} in
          most.
        </p>
        <p className="mt-1 text-[11px] text-muted">
          Agreement between runs flags turns worth a second look. It does not
          show that a stable turn is right: runs share the same blind spots,
          so a turn the model gets wrong the same way every time looks stable.
          Your own audit above is the check on that.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-white px-3 py-2 text-xs">
        <p className="font-medium text-foreground">Settle by majority of runs</p>
        <p className="mt-0.5 text-[11px] text-muted">
          A theme stays on a turn, or is added to it, when more than half of the runs gave it. This steadies the coding
          without more checking from you and costs nothing extra, because the runs are already done. Turns you have settled
          and themes you changed by hand are left alone.
        </p>
        {st.majority.available ? (
          <button
            type="button"
            className={`${primaryButton} mt-1.5`}
            disabled={busy}
            onClick={() => run(() => applyMajorityCodingAction(runId, view.documentId, view.codebookId))}
          >
            {st.majority.applied ? "Settle by majority again" : "Settle by majority"}
          </button>
        ) : (
          <p className="mt-1 text-[11px] text-amber-700">
            {st.runs < 3
              ? "Needs at least three runs: the original and two more. Run the check with 2 more times."
              : "Run the check again so each run is kept (needs database migration 0074)."}
          </p>
        )}
        {st.majority.applied && (
          <p className="mt-1 text-[11px] text-emerald-700">
            Majority coding has been applied. The list below now shows turns where the runs disagreed; reviewing them is
            optional.
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[420px]">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Theme</th>
              <th className={th}>Turns it came up in</th>
              <th className={th}>Same in every run</th>
              <th className={th}>Kappa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {st.perCode.map((c) => (
              <tr key={c.codeId}>
                <td className={`${td} font-medium`}>{c.name}</td>
                <td className={td}>{c.usedTurns}</td>
                <td className={td}>
                  {c.usedTurns === 0
                    ? "n/a"
                    : `${c.consistent} (${pct(c.consistent / c.usedTurns)})`}
                  {c.tooFew ? (
                    <span className="ml-1 text-muted">
                      Too few turns to judge.
                    </span>
                  ) : (
                    c.usedTurns >= 5 &&
                    c.consistent / c.usedTurns < 0.6 && (
                      <span className="ml-1 text-amber-700">
                        Read differently from run to run; the definition may
                        need tightening.
                      </span>
                    )
                  )}
                </td>
                <td className={td}>
                  {c.kappa === null
                    ? "n/a"
                    : `${c.kappa.toFixed(2)}${c.tooFew ? "" : ` (${kappaBand(c.kappa, false).toLowerCase()})`}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {st.attention && st.attention.flagged && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Take a second look at how these are being settled:{" "}
          {st.attention.reasons.length > 0
            ? st.attention.reasons.join(", and ")
            : `all ${st.attention.decisions} decisions so far left the model's themes as they were`}
          . People shown a model&apos;s suggestions tend to accept most of
          them. If that is not what is happening, carry on; if it is, slow
          down on the next few.
        </div>
      )}
      {st.attention && !st.attention.flagged && st.attention.decisions >= 8 && (
        <p className="text-[11px] text-muted">
          {st.attention.decisions} turns settled, and you changed the model on{" "}
          {pct(st.attention.changeRate)} of them.
        </p>
      )}

      <div className="text-xs font-medium text-foreground">
        Turns to settle ({open.length})
      </div>
      {open.length === 0 && (
        <p className="text-[11px] text-muted">
          Nothing left to settle. Every turn the runs disagreed on has a
          decision from you.
        </p>
      )}
      <div className="space-y-2">
        {open.map((t) => (
          <StabilityCard
            key={t.segmentId}
            runId={runId}
            view={view}
            turn={t}
            run={run}
            busy={busy}
          />
        ))}
      </div>
      {done.length > 0 && (
        <div>
          <button
            type="button"
            className={button}
            onClick={() => setShowResolved(!showResolved)}
          >
            {showResolved ? "Hide" : "Show"} {done.length} settled
          </button>
          {showResolved && (
            <div className="mt-2 space-y-2">
              {done.map((t) => (
                <StabilityCard
                  key={t.segmentId}
                  runId={runId}
                  view={view}
                  turn={t}
                  run={run}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StabilityCard({
  runId,
  view,
  turn,
  run,
  busy,
}: {
  runId: string;
  view: CodingAnalysisView;
  turn: StabilityTurn;
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
}) {
  // Until the researcher has saved their own coding, the model's themes and
  // the other runs' stay hidden, so the first judgement is not anchored.
  const revealed = turn.blindCodeIds !== null;
  const [picked, setPicked] = useState<Set<string>>(
    new Set(turn.blindCodeIds ?? []),
  );
  const current = new Set(turn.currentCodeIds);
  const changes = [
    ...[...picked]
      .filter((id) => !current.has(id))
      .map((codeId) => ({ codeId, action: "add" as const })),
    ...[...current]
      .filter((id) => !picked.has(id))
      .map((codeId) => ({ codeId, action: "remove" as const })),
  ];
  const blind = new Set(turn.blindCodeIds ?? []);
  const differs = view.codes.filter((c) => blind.has(c.id) !== current.has(c.id));
  return (
    <div className="space-y-2 rounded-lg border border-border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted">
          {turn.speaker ?? "Speaker unknown"} &middot; turn {turn.index + 1}
        </span>
        {revealed && (
          <span
            className={`${pill} ${turn.confidence === "low" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
          >
            Same in {turn.agree} of {turn.runs} runs
          </span>
        )}
      </div>
      <p className="text-xs text-foreground">{turn.text}</p>
      {!revealed && (
        <p className="text-[11px] text-muted">
          Step 1 of 2. Tick the themes you think apply, before seeing what the
          model did. Your answer is locked once saved.
        </p>
      )}
      {revealed && (
        <p className="text-[11px] text-muted">
          Step 2 of 2.{" "}
          {differs.length === 0
            ? "Your coding matches the model's."
            : `You and the model differ on ${differs.length} theme${differs.length === 1 ? "" : "s"}.`}{" "}
          Settle it below: change your ticks if seeing the model&apos;s themes
          changed your mind, and save.
        </p>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {view.codes.map((c) => (
          <label
            key={c.id}
            className="flex items-center gap-1.5 text-xs text-foreground"
          >
            <input
              type="checkbox"
              checked={picked.has(c.id)}
              disabled={busy}
              onChange={(e) => {
                const next = new Set(picked);
                if (e.target.checked) next.add(c.id);
                else next.delete(c.id);
                setPicked(next);
              }}
            />
            {c.name}
            {revealed && current.has(c.id) && (
              <span className={`${pill} bg-slate-100 text-slate-600`}>
                Model coded
              </span>
            )}
            {revealed && turn.altCodeIds.includes(c.id) && (
              <span className={`${pill} bg-amber-50 text-amber-700`}>
                Another run added
              </span>
            )}
            {revealed && turn.droppedCodeIds.includes(c.id) && (
              <span className={`${pill} bg-amber-50 text-amber-700`}>
                Another run left out
              </span>
            )}
          </label>
        ))}
      </div>
      {!revealed ? (
        <button
          type="button"
          className={primaryButton}
          disabled={busy}
          onClick={() =>
            run(() =>
              saveBlindStabilityTurnAction(
                runId,
                view.codebookId,
                turn.segmentId,
                [...picked],
              ),
            )
          }
        >
          Save my coding and show the model&apos;s
        </button>
      ) : (
        <button
          type="button"
          className={primaryButton}
          disabled={busy}
          onClick={() =>
            run(() =>
              resolveStabilityTurnAction(
                runId,
                view.documentId,
                view.codebookId,
                turn.segmentId,
                changes,
              ),
            )
          }
        >
          {turn.resolved
            ? "Update my decision"
            : changes.length === 0
              ? "Settle: the model's themes stand"
              : "Settle: save my changes"}
        </button>
      )}
    </div>
  );
}

// --- Respondents ----------------------------------------------------------

function RespondentsTab({
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
  const table =
    view.surveyTables.find((t) => t.id === view.caseTableId) ?? null;
  const accepted = view.links.filter((l) => l.status === "accepted");
  const proposed = view.links.filter((l) => l.status === "proposed");
  const unmatched = view.respondents.filter((r) => r.matched === false).length;
  const profileFields = [
    ...new Set(view.respondents.flatMap((r) => Object.keys(r.attributes))),
  ];
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        Who raised which theme, set beside what the same people answered in the
        survey. Match each speaker to their survey row, then link themes to the
        closed questions they should move with.
      </p>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-white p-3">
        <div>
          <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted">
            Survey table
          </label>
          <select
            className={select}
            value={view.caseTableId ?? ""}
            disabled={busy || view.setupMissing}
            onChange={(e) =>
              run(() =>
                setCaseMappingAction(
                  runId,
                  view.documentId,
                  e.target.value || null,
                  null,
                ),
              )
            }
          >
            <option value="">Not matched to a survey</option>
            {view.surveyTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {table && (
          <div>
            <label className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-muted">
              Respondent id column
            </label>
            <select
              className={select}
              value={view.caseColumn ?? ""}
              disabled={busy}
              onChange={(e) =>
                run(() =>
                  setCaseMappingAction(
                    runId,
                    view.documentId,
                    table.id,
                    e.target.value || null,
                  ),
                )
              }
            >
              <option value="">Choose a column</option>
              {table.headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[600px]">
          <thead className="bg-slate-50">
            <tr>
              <th className={th}>Respondent</th>
              {table && view.caseColumn && <th className={th}>Survey id</th>}
              {profileFields.map((f) => (
                <th key={f} className={`${th} bg-slate-100`}>
                  {f}
                </th>
              ))}
              {view.codes.map((c) => (
                <th key={c.id} className={th} title={c.name}>
                  <span className="block max-w-[110px] truncate">{c.name}</span>
                </th>
              ))}
              {accepted.map((l) => (
                <th
                  key={l.id}
                  className={`${th} bg-slate-100`}
                  title={`Survey answer: ${l.variable}`}
                >
                  <span className="block max-w-[110px] truncate">
                    {l.variable}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {view.respondents.map((r) => (
              <tr key={r.key || "all"}>
                <td className={`${td} font-medium`}>
                  {r.label}
                  <span className="ml-1 font-normal text-muted">
                    {r.turns} turns
                  </span>
                </td>
                {table && view.caseColumn && (
                  <td className={td}>
                    <input
                      defaultValue={r.caseKey ?? ""}
                      disabled={busy}
                      placeholder="id"
                      onBlur={(e) => {
                        if (e.target.value.trim() !== (r.caseKey ?? ""))
                          run(() =>
                            setRespondentKeyAction(
                              runId,
                              view.documentId,
                              r.key,
                              e.target.value,
                            ),
                          );
                      }}
                      className="w-24 rounded-md border border-border px-1.5 py-1 text-xs focus:border-primary focus:outline-none"
                    />
                    {r.matched === false && r.caseKey && (
                      <span className="ml-1 text-amber-700">no match</span>
                    )}
                  </td>
                )}
                {profileFields.map((f) => (
                  <td key={f} className={`${td} bg-slate-50`}>
                    {r.attributes[f] ?? (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                ))}
                {view.codes.map((c) => (
                  <td key={c.id} className={td}>
                    {r.codeTurns[c.id] ? (
                      <span className={`${pill} bg-slate-100 text-slate-600`}>
                        {r.codeTurns[c.id]}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                ))}
                {accepted.map((l) => {
                  const flagged = view.dissonance?.flags.some(
                    (f) =>
                      f.respondent === r.label &&
                      f.variable === l.variable &&
                      f.codeName === l.codeName,
                  );
                  const v = r.values[l.variable];
                  return (
                    <td key={l.id} className={`${td} bg-slate-50`}>
                      {v === null || v === undefined ? (
                        <span className="text-slate-300">-</span>
                      ) : (
                        <span
                          className={flagged ? "font-bold text-amber-700" : ""}
                        >
                          {v}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table && view.caseColumn && unmatched > 0 && (
        <p className="text-[11px] text-amber-700">
          {unmatched} respondent{unmatched === 1 ? "" : "s"} could not be
          matched to a survey row. They are left out of the checks below, not
          assumed consistent.
        </p>
      )}

      {table && view.caseColumn && (
        <LinkReview
          runId={runId}
          view={view}
          run={run}
          busy={busy}
          proposed={proposed}
          numeric={table.numeric.filter((n) => n !== view.caseColumn)}
        />
      )}

      {view.dissonance && (
        <div className="space-y-1 rounded-lg border border-border bg-white p-3">
          <p className="text-xs font-medium text-foreground">
            {view.dissonance.flags.length} of {view.dissonance.checked} checked
            answers sit against what the theme implies
            {view.dissonance.unmatched > 0
              ? ` (${view.dissonance.unmatched} could not be checked)`
              : ""}
            .
          </p>
          {view.dissonance.flags.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground">
              {view.dissonance.flags.map((f, i) => (
                <li key={i}>
                  <span className="font-medium">{f.respondent}</span> raised
                  &ldquo;{f.codeName}&rdquo; but answered {f.value} on &ldquo;
                  {f.variable}&rdquo; (median {f.median}; the theme implies{" "}
                  {f.direction === "higher" ? "above" : "below"} it).
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-muted">
            A prompt to reread the transcript, not a finding. It can be a gap
            between what someone says and does, a question read differently from
            how it was meant, or a turn coded to the wrong theme. A value
            exactly on the median is never flagged.
          </p>
        </div>
      )}
    </div>
  );
}

function LinkReview({
  runId,
  view,
  run,
  busy,
  proposed,
  numeric,
}: {
  runId: string;
  view: CodingAnalysisView;
  run: (fn: () => Promise<ActionResult>) => void;
  busy: boolean;
  proposed: LinkView[];
  numeric: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [codeName, setCodeName] = useState("");
  const [variable, setVariable] = useState("");
  const [direction, setDirection] = useState<"higher" | "lower">("lower");
  const reviewable = view.links.filter((l) => l.status !== "accepted");
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const ids = [...selected];
  return (
    <div className="space-y-2 rounded-lg border border-border bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">
          Themes linked to survey questions
        </span>
        <button
          type="button"
          className={button}
          disabled={busy || numeric.length === 0 || !view.caseColumn}
          onClick={() =>
            run(() =>
              proposeLinksAction(runId, view.documentId, view.codebookId),
            )
          }
        >
          {busy ? "Working..." : "Propose links"}
        </button>
      </div>
      {numeric.length === 0 && (
        <p className="text-[11px] text-muted">
          This table has no numeric questions to link to.
        </p>
      )}

      {view.links.length === 0 && numeric.length > 0 && (
        <p className="text-[11px] text-muted">
          No links yet. Propose some for review, or add one yourself below. Only
          accepted links are used.
        </p>
      )}

      {view.links.length > 0 && (
        <ul className="divide-y divide-border">
          {view.links.map((l) => (
            <li key={l.id} className="flex items-start gap-2 py-1.5">
              {l.status !== "accepted" && (
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.has(l.id)}
                  onChange={() => toggle(l.id)}
                  disabled={busy}
                />
              )}
              <div className="min-w-0 flex-1 text-xs">
                <div className="text-foreground">
                  <span className="font-medium">{l.codeName}</span> goes with{" "}
                  <span className="font-medium">{l.direction}</span> answers on{" "}
                  <span className="font-medium">{l.variable}</span>
                </div>
                <div className="text-[11px] text-muted">
                  {l.rationale}
                  {l.source === "model" ? " (proposed by the model)" : ""}
                </div>
              </div>
              <span
                className={`${pill} ${
                  l.status === "accepted"
                    ? "bg-success-light text-success"
                    : l.status === "rejected"
                      ? "bg-slate-100 text-slate-400"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {l.status}
              </span>
              {l.status === "accepted" && (
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    run(() => setLinkStatusAction(runId, [l.id], "rejected"))
                  }
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {reviewable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={primaryButton}
            disabled={busy || ids.length === 0}
            onClick={() => {
              setSelected(new Set());
              run(() => setLinkStatusAction(runId, ids, "accepted"));
            }}
          >
            Accept selected
          </button>
          <button
            type="button"
            className={button}
            disabled={busy || ids.length === 0}
            onClick={() => {
              setSelected(new Set());
              run(() => setLinkStatusAction(runId, ids, "rejected"));
            }}
          >
            Reject selected
          </button>
          {proposed.length > 0 && (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                run(() =>
                  setLinkStatusAction(
                    runId,
                    proposed.map((l) => l.id),
                    "accepted",
                  ),
                )
              }
            >
              Accept all {proposed.length} proposed
            </button>
          )}
        </div>
      )}

      {numeric.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <span className="text-[11px] text-muted">Add your own:</span>
          <select
            className={select}
            value={codeName}
            onChange={(e) => setCodeName(e.target.value)}
          >
            <option value="">Theme</option>
            {view.codes.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-muted">goes with</span>
          <select
            className={select}
            value={direction}
            onChange={(e) => setDirection(e.target.value as "higher" | "lower")}
          >
            <option value="lower">lower</option>
            <option value="higher">higher</option>
          </select>
          <span className="text-[11px] text-muted">answers on</span>
          <select
            className={select}
            value={variable}
            onChange={(e) => setVariable(e.target.value)}
          >
            <option value="">Question</option>
            {numeric.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button}
            disabled={busy || !codeName || !variable}
            onClick={() => {
              run(() =>
                addLinkAction(runId, view.documentId, {
                  codeName,
                  variable,
                  direction,
                }),
              );
              setCodeName("");
              setVariable("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// --- Negative cases -------------------------------------------------------

function NegativeTab({
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
  const total = view.codes.reduce((n, c) => n + c.negativeCases.length, 0);
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted">
        A theme that every turn confirms has not been tested. This reads the
        transcript again looking for the opposite: turns where someone
        contradicts a theme or says it does not apply to them. You decide
        whether each one counts. A confirmed negative case is a reason to narrow
        the theme, not to hide it.
      </p>
      <button
        type="button"
        className={primaryButton}
        disabled={busy || view.setupMissing}
        onClick={() =>
          run(() =>
            searchNegativeCasesAction(runId, view.documentId, view.codebookId),
          )
        }
      >
        {busy
          ? "Searching..."
          : total > 0
            ? "Search again"
            : "Search for negative cases"}
      </button>
      {total > 0 && (
        <p className="text-[11px] text-muted">
          Searching again replaces cases still waiting for your decision and
          keeps the ones you confirmed or dismissed.
        </p>
      )}
      {view.codes.map((c) => (
        <div key={c.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">
              {c.name}
            </span>
            <span className={`${pill} bg-slate-100 text-slate-500`}>
              {c.negativeCases.filter((n) => n.status === "confirmed").length}{" "}
              confirmed
              {" · "}
              {c.negativeCases.filter((n) => n.status === "pending").length} to
              review
            </span>
          </div>
          {c.negativeCases.length === 0 ? (
            <p className="text-[11px] text-muted">
              None found or searched yet.
            </p>
          ) : (
            c.negativeCases.map((n) => (
              <div
                key={n.id}
                className="space-y-1.5 rounded-lg border border-border bg-white p-3"
              >
                <div className="text-[11px] font-medium text-muted">
                  {n.speaker ?? "Speaker unknown"} &middot; turn {n.index + 1}
                  {n.assignedToCode &&
                    " · also coded as supporting this theme, so it may qualify it"}
                </div>
                <p className="text-xs text-foreground">{n.text}</p>
                <p className="text-[11px] text-muted">
                  Why it may conflict: {n.reason}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={
                      n.status === "confirmed" ? primaryButton : button
                    }
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        setNegativeCaseStatusAction(runId, n.id, "confirmed"),
                      )
                    }
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        setNegativeCaseStatusAction(runId, n.id, "dismissed"),
                      )
                    }
                  >
                    Dismiss
                  </button>
                  {n.status !== "pending" && (
                    <span className="text-[11px] text-muted">{n.status}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
