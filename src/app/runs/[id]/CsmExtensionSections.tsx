"use client";

// R6 CSM extension: the CSM dashboard's added sections (Journey, Emotions and preference, Competitive and
// noncustomers), inside the dashboard's own navigation and with its cards, chips, font and #2563eb accent. Figures
// come from loadCsmExtensionAction (src/lib/csmExtension.ts); this screen formats them and never computes a figure.
// A figure that is not measured says so with the reason, never 0. Bases are shown raw and weighted.
// Late responses: each request carries a sequence number and only the newest one's answer is shown, so a slow answer
// for an earlier section, filter or file never replaces a newer one.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadCsmExtensionAction } from "@/lib/csmExtensionActions";
import type { CsmExtensionSectionId, CsmExtensionView } from "@/lib/csmExtension";
import type { CsmDistribution, CsmFigure } from "@/lib/csmExtensionMetrics";
import type { EmotionFigure } from "@/lib/csmExperience";
import { exportCsv, exportRows } from "@/lib/csmExtensionExport";

export const CSM_EXTENSION_TABS: { id: CsmExtensionSectionId; label: string }[] = [
  { id: "journey", label: "Journey" },
  { id: "experience", label: "Emotions and preference" },
  { id: "competitive", label: "Competitive and noncustomers" },
];

/** An answer, with the request it answers. While a newer request is computed, the last answer for the same section
 * stays on screen (its filters with it) marked as updating; it is never shown for another section. */
type Answer = { key: string; section: CsmExtensionSectionId; result: { ok: true; view: CsmExtensionView } | { ok: false; error: string } };

const pct = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(1)}%`);
const mean = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));
const signed = (v: number | null) => (v === null ? "n/a" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`);
const int = (n: number) => n.toLocaleString("en-GB");
const w1 = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 1 });

function valueOf(f: CsmFigure): string {
  if (f.status !== "ok") return "";
  const r = f.reading;
  if (r.statistic === "mean_gap") return signed(r.value);
  if (r.statistic.startsWith("mean")) return mean(r.value);
  return pct(r.value);
}

function BaseLine({ f }: { f: CsmFigure }) {
  if (f.status !== "ok") return null;
  const r = f.reading;
  return (
    <p className="mt-1 text-[11px] text-slate-500" data-testid="csmx-base">
      n = {int(r.rawBase)} · weighted {w1(r.weightedBase)}
      {r.nonresponse > 0 ? ` · ${int(r.nonresponse)} don't know excluded` : ""}
      {r.baseLevel === "very_small" ? " · below 30: descriptive only" : r.baseLevel === "small" ? " · below 50: small base" : ""}
    </p>
  );
}

function NotMeasured({ title, reason, testId = "csmx-not-measured" }: { title?: string; reason: string; testId?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4" data-testid={testId} data-status="not_measured">
      <p className="text-sm font-semibold text-slate-700">{title ? `${title}: not measured` : "Not measured"}</p>
      <p className="mt-1 text-xs text-slate-500">{reason}</p>
    </div>
  );
}

function Tile({ f, title, extra, testId = "csmx-tile" }: { f: CsmFigure; title?: string; extra?: ReactNode; testId?: string }) {
  const name = title ?? f.label;
  if (f.status === "not_measured") return <NotMeasured title={name} reason={f.reason} testId={testId} />;
  if (f.status === "failed")
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4" data-testid={testId} data-failed="true">
        <p className="text-sm text-red-900">{name}</p>
        <p className="mt-1 text-xs text-red-800">Could not be calculated: {f.error}</p>
      </div>
    );
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={testId} data-figure={f.id} title={f.definition}>
      <p className="text-sm text-slate-500">{name}</p>
      <p className="mt-1 text-[1.7rem] font-bold leading-tight text-slate-900" data-testid="csmx-value">
        {f.reading.value === null ? "n/a" : valueOf(f)}
      </p>
      {extra}
      <BaseLine f={f} />
    </div>
  );
}

function Card({ title, subtitle, children, testId }: { title: string; subtitle?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-testid={testId} aria-label={title}>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Bars({ d, testId }: { d: CsmDistribution; testId?: string }) {
  if (d.status === "not_measured") return <NotMeasured title={d.label} reason={d.reason} />;
  if (d.status === "failed") return <p className="text-xs text-red-800">{d.label} could not be calculated: {d.error}</p>;
  return (
    <div data-testid={testId}>
      <ul className="flex flex-col gap-1.5">
        {d.rows.map((r) => (
          <li key={r.code} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm">
            <span className="truncate text-slate-700" title={r.label}>
              {r.label}
            </span>
            <span className="h-2.5 rounded-full bg-slate-100">
              <span className="block h-2.5 rounded-full bg-[#2563eb]" style={{ width: `${Math.max(0, Math.min(100, r.share ?? 0))}%` }} />
            </span>
            <span className="text-right tabular-nums text-slate-900">{pct(r.share)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-slate-500">
        n = {int(d.rawBase)} · weighted {w1(d.weightedBase)}
        {d.nonresponse > 0 ? ` · ${int(d.nonresponse)} don't know excluded` : ""}
      </p>
    </div>
  );
}

function EmotionTable({ emotions, testId }: { emotions: EmotionFigure[]; testId: string }) {
  return (
    <table className="w-full text-sm" data-testid={testId}>
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
          <th className="py-1 font-semibold">Emotion</th>
          <th className="py-1 text-right font-semibold">Mean (1 to 5)</th>
          <th className="py-1 text-right font-semibold">Very or extremely</th>
          <th className="py-1 pl-4 font-semibold">Intensity: Not at all, A little, Moderately, Very, Extremely</th>
          <th className="py-1 text-right font-semibold">Base</th>
        </tr>
      </thead>
      <tbody>
        {emotions.map((e) => (
          <tr key={e.emotion} className="border-t border-slate-100" data-testid="csmx-emotion-row" data-emotion={e.emotion}>
            <td className="py-2 font-medium text-slate-900">{e.mean.label}</td>
            {e.mean.status === "ok" ? (
              <>
                <td className="py-2 text-right tabular-nums">{mean(e.mean.reading.value)}</td>
                <td className="py-2 text-right tabular-nums" title={e.high.definition}>
                  {e.high.status === "ok" ? pct(e.high.reading.value) : "n/a"}
                </td>
                <td className="py-2 pl-4">
                  {e.distribution.status === "ok" ? (
                    <span className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100" title={e.distribution.rows.map((r) => `${r.label} ${pct(r.share)}`).join(", ")}>
                      {e.distribution.rows.map((r, i) => (
                        <span key={r.code} style={{ width: `${r.share ?? 0}%`, background: ["#dbeafe", "#bfdbfe", "#93c5fd", "#3b82f6", "#1d4ed8"][i] }} />
                      ))}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 text-right text-[11px] text-slate-500">n = {int(e.mean.reading.rawBase)} · w {w1(e.mean.reading.weightedBase)}</td>
              </>
            ) : (
              <td colSpan={4} className="py-2 text-xs text-slate-500">
                Not measured: {e.mean.status === "not_measured" ? e.mean.reason : e.mean.error}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Select({ label, value, onChange, options, testId }: { label: string; value: string; onChange: (v: string) => void; options: { code: string; label: string }[]; testId: string }) {
  return (
    <label className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
      <span className="text-slate-500">{label} </span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent font-medium text-slate-900 outline-none" data-testid={testId}>
        {options.map((o) => (
          <option key={o.code} value={o.code}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type Load = { state: "loading"; previous: CsmExtensionView | null } | { state: "ready"; view: CsmExtensionView } | { state: "failed"; error: string };

export function CsmExtensionSections({ runId, documentId, section, company, companyLabel }: { runId: string; documentId: string; section: CsmExtensionSectionId; company: string | null; companyLabel: string }) {
  // Filters belong to one file: a task code is an answer of that file's list, so another file starts with none.
  const [chosen, setChosen] = useState<{ documentId: string; task: string; journeyChannel: string; dataWave: string }>({ documentId, task: "", journeyChannel: "", dataWave: "" });
  const mine = chosen.documentId === documentId;
  const task = mine ? chosen.task : "";
  const journeyChannel = mine ? chosen.journeyChannel : "";
  const dataWave = mine ? chosen.dataWave : "";
  const setTask = (v: string) => setChosen({ documentId, task: v, journeyChannel, dataWave });
  const setJourneyChannel = (v: string) => setChosen({ documentId, task, journeyChannel: v, dataWave });
  const setDataWave = (v: string) => setChosen({ documentId, task, journeyChannel, dataWave: v });
  const [sample, setSample] = useState<"current_customers" | "focal_noncustomers">("current_customers");
  const [retry, setRetry] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const seq = useRef(0);
  const requestKey = JSON.stringify([documentId, section, company, task, journeyChannel, dataWave, retry]);

  useEffect(() => {
    const mine = ++seq.current;
    const done = (result: Answer["result"]) => {
      if (mine === seq.current) setAnswer({ key: requestKey, section, result });
    };
    loadCsmExtensionAction(runId, documentId, { section, company, task: task || null, journeyChannel: journeyChannel || null, dataWave: dataWave || null }).then(
      (r) => done(r.ok ? { ok: true, view: r.view } : { ok: false, error: r.error }),
      (e) => done({ ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  }, [runId, documentId, section, company, task, journeyChannel, dataWave, requestKey]);

  const current = answer?.key === requestKey ? answer : null;
  const previous = !current && answer?.section === section && answer.result.ok ? answer.result.view : null;
  const load: Load = current ? (current.result.ok ? { state: "ready", view: current.result.view } : { state: "failed", error: current.result.error }) : { state: "loading", previous };

  const download = (view: CsmExtensionView) => {
    const csv = exportCsv(exportRows(view));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `csm-${view.section}-${(view.wave ?? "wave").replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (load.state === "loading" && !load.previous)
    return (
      <p className="text-sm text-slate-500" role="status" data-testid="csmx-loading">
        Calculating this section from the wave&apos;s files...
      </p>
    );
  if (load.state === "failed")
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert" data-testid="csmx-failed">
        <p>This section could not be calculated: {load.error}</p>
        <button type="button" onClick={() => setRetry((n) => n + 1)} className="mt-2 rounded border border-red-300 bg-white px-2.5 py-1 text-xs">
          Try again
        </button>
      </div>
    );
  const view = load.state === "ready" ? load.view : load.previous!;
  const updating = load.state === "loading";
  const customersOnly = section !== "competitive" || sample === "current_customers";

  const header = (
    <div className="flex flex-col gap-3" data-testid="csmx-header">
      <div className="flex flex-wrap items-center gap-2.5">
        {section === "competitive" ? (
          <Select
            label="Sample"
            value={sample}
            onChange={(v) => setSample(v as typeof sample)}
            options={[
              { code: "current_customers", label: "Current customers" },
              { code: "focal_noncustomers", label: "Focal noncustomers" },
            ]}
            testId="csmx-sample"
          />
        ) : (
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm" data-testid="csmx-sample-chip">
            <span className="text-slate-500">Sample </span>
            <span className="font-medium text-slate-900">Current customers</span>
          </span>
        )}
        {customersOnly && (
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm">
            <span className="text-slate-500">Company </span>
            <span className="font-medium text-slate-900">{companyLabel}</span>
          </span>
        )}
        {view.dataWaves.length > 1 && (
          <Select label="Data wave" value={view.filters.dataWave ?? ""} onChange={setDataWave} options={view.dataWaves.map((w) => ({ code: w, label: `Wave ${w} of ${view.dataWaves.length} (pooled file)` }))} testId="csmx-data-wave" />
        )}
        {customersOnly && view.options.tasks.length > 0 && (
          <Select label="Task" value={task} onChange={setTask} options={[{ code: "", label: "All tasks" }, ...view.options.tasks]} testId="csmx-task" />
        )}
        {customersOnly && section !== "competitive" && view.options.journeyChannels.length > 0 && (
          <Select label="Channel used" value={journeyChannel} onChange={setJourneyChannel} options={[{ code: "", label: "Any channel" }, ...view.options.journeyChannels]} testId="csmx-journey-channel" />
        )}
        <span className="text-xs text-slate-500">{view.weighted ? "Current customers weighted by the file's weight; noncustomers unit weight" : "Unweighted"}</span>
        {updating && (
          <span className="text-xs font-medium text-[#2563eb]" role="status" data-testid="csmx-updating">
            Updating for the new filters...
          </span>
        )}
        <button type="button" onClick={() => download(view)} className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50" data-testid="csmx-export">
          Download figures (CSV)
        </button>
      </div>
      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" data-testid="csmx-files">
        <summary className="cursor-pointer text-slate-700">
          {view.wave ?? "No wave label"} · {view.files.filter((f) => f.used).length} of 3 data files linked ({view.files.map((f) => f.sampleTypeText === "Focal noncustomers" ? "noncustomers" : f.grain).join(", ") || "none"}) · samples kept separate, never pooled
        </summary>
        <ul className="mt-2 flex flex-col gap-1">
          {view.files.map((f) => (
            <li key={f.documentId} data-testid="csmx-file" data-grain={f.grain} data-used={String(f.used)}>
              <span className="font-medium text-slate-800">{f.grainText}</span> · {f.sampleTypeText} · {f.filename}
              {f.sheetName ? ` (sheet ${f.sheetName})` : ""} · {f.records !== null && f.distinctPeople !== null ? `${int(f.records)} records, ${int(f.distinctPeople)} distinct ${f.sampleType === "focal_noncustomers" ? "noncustomers" : "customers"}` : "keys not checked (rows are read for CSV, TSV and Excel files only)"}
              {f.reason ? <span className="text-amber-800"> · {f.reason}</span> : null}
            </li>
          ))}
          {(["relationship", "channel", "noncustomer"] as const)
            .filter((g) => !view.files.some((f) => f.grain === g) && view.absent[g])
            .map((g) => (
              <li key={g} className="text-slate-500">
                {view.absent[g]}
              </li>
            ))}
        </ul>
      </details>
      {view.linkProblems.length > 0 && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="alert" data-testid="csmx-link-problems">
          The wave&apos;s files do not link, so the channel and noncustomer figures are not used: {view.linkProblems.join(" ")}
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-5" data-testid={`csmx-section-${section}`} aria-busy={updating}>
      {header}
      <div className={`flex flex-col gap-5 ${updating ? "opacity-50" : ""}`}>
        {section === "journey" && <JourneyView view={view} />}
        {section === "experience" && <ExperienceView view={view} />}
        {section === "competitive" && (sample === "current_customers" ? <BenchmarkView view={view} /> : <NoncustomerView view={view} />)}
      </div>
    </div>
  );
}

function JourneyView({ view }: { view: CsmExtensionView }) {
  const j = view.journey;
  if (!j) return null;
  if (j.status !== "ok") return <NotMeasured title="Journey continuity" reason={j.reason} />;
  return (
    <>
      <p className="text-xs text-slate-500" data-testid="csmx-population">
        One anchored task per customer, from the journey questions only. The latest experiences in each channel are not joined into a journey, and channel ratings are not averaged into journey satisfaction. Population: {j.population.text}
        {j.population.rawBase !== null ? ` · n = ${int(j.population.rawBase)} · weighted ${w1(j.population.weightedBase ?? 0)}` : ""}.
      </p>
      <section aria-label="Journey continuity" className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="csmx-journey-tiles">
        <Tile f={j.recentShare} title="Recent task (all customers)" />
        <Tile f={j.completion} title="Completed (known outcomes)" extra={j.pending.status === "ok" ? <p className="text-xs text-slate-600" data-testid="csmx-pending">Pending beside it: {pct(j.pending.reading.value)} of all outcomes</p> : null} />
        <Tile f={j.journeyCsat} title="Journey satisfaction (top two)" extra={j.journeyCsatMean.status === "ok" ? <p className="text-xs text-slate-600">Mean {mean(j.journeyCsatMean.reading.value)} / 5</p> : null} />
        {j.contacts.status === "ok" ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="csmx-tile" data-figure="contacts">
            <p className="text-sm text-slate-500">Contacts on the task (mean)</p>
            <p className="mt-1 text-[1.7rem] font-bold leading-tight text-slate-900">{mean(j.contacts.mean)}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              n = {int(j.contacts.rawBase)} · weighted {w1(j.contacts.weightedBase)}
            </p>
          </div>
        ) : (
          <NotMeasured title="Contacts on the task" reason={j.contacts.status === "not_measured" ? j.contacts.reason : j.contacts.error} />
        )}
        <Tile f={j.multichannel} title="Used two or more channels" />
        <Tile f={j.transferred} title="Transferred or redirected" />
        <Tile f={j.repeatInfo} title="Had to repeat information" />
      </section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Task outcome" subtitle="Pending is kept as its own answer; completion above uses known outcomes only." testId="csmx-outcomes">
          <Bars d={j.outcomes} />
        </Card>
        <Card title="Journey satisfaction" subtitle="Whole task across all its contacts and channels, valid 1 to 5." testId="csmx-journey-csat">
          <Bars d={j.journeyCsatDistribution} />
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card title="Ordered paths" subtitle="Each step is one contact, in the order the customer gave (journey_sequence); share of recent tasks with a path." testId="csmx-paths">
          {j.paths.status !== "ok" ? (
            <NotMeasured reason={j.paths.reason} />
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="py-1 font-semibold">Path</th>
                    <th className="py-1 text-right font-semibold">Contacts</th>
                    <th className="py-1 text-right font-semibold">Share</th>
                    <th className="py-1 text-right font-semibold">n</th>
                  </tr>
                </thead>
                <tbody>
                  {j.paths.rows.map((p) => (
                    <tr key={p.path} className="border-t border-slate-100" data-testid="csmx-path-row">
                      <td className="py-1.5 text-slate-800">{p.text}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.contacts}</td>
                      <td className="py-1.5 text-right tabular-nums">{pct(p.share)}</td>
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{int(p.raw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-slate-500">
                n = {int(j.paths.rawBase)} · weighted {w1(j.paths.weightedBase)}
                {j.paths.others > 0 ? ` · ${int(j.paths.others)} less common paths not listed` : ""}
                {j.paths.flagMismatches > 0 ? ` · ${int(j.paths.flagMismatches)} paths disagree with the channels-used answers` : ""}
              </p>
              <p className="mt-2 text-xs text-slate-600" data-testid="csmx-distinct">
                Distinct channels: {j.paths.distinct.map((d) => `${d.channels} channel${d.channels === 1 ? "" : "s"} ${pct(d.share)}`).join(" · ")}
              </p>
            </>
          )}
        </Card>
        <Card title="Channels used for this task" subtitle="A task can use several channels. Digital self service includes apps and websites." testId="csmx-channels-used">
          <ul className="flex flex-col gap-2">
            {j.channelsUsed.map((f) => (
              <li key={f.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-slate-700">{f.label}</span>
                <span className="tabular-nums text-slate-900">{f.status === "ok" ? valueOf(f) : "Not measured"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs font-semibold text-slate-700">Digital self service mode</p>
          <div className="mt-2">
            <Bars d={j.digitalMode} />
          </div>
        </Card>
      </div>
      <Card title="Company satisfaction and the journey filter" subtitle={j.companyCsat.note} testId="csmx-population-change">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Tile f={j.companyCsat.all} title="All current customers" />
          <Tile f={j.companyCsat.recent} title="Customers with a recent task (journey filter: a different population)" />
        </div>
      </Card>
    </>
  );
}

function ExperienceView({ view }: { view: CsmExtensionView }) {
  const e = view.experience;
  if (!e) return null;
  return (
    <>
      <p className="text-xs text-slate-500">Reassured, valued, frustrated, anxious, angry and disappointed are shown separately on their own bases; they are never combined into one score. Positive and negative feelings can be mixed; a high share very or extremely angry, disappointed, frustrated or anxious is a negative outcome.</p>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Emotions: the whole recent task" subtitle={e.journey.status === "ok" ? `Journey grain, one customer once. ${e.journey.populationText}.` : "Journey grain"} testId="csmx-journey-emotions">
          {e.journey.status === "ok" ? <EmotionTable emotions={e.journey.emotions} testId="csmx-journey-emotion-table" /> : <NotMeasured reason={e.journey.reason} />}
        </Card>
        <Card title="Emotions: the latest channel experience" subtitle={`Channel grain: one record per customer per channel used in 30 days, so a customer can appear in several channels.${e.channel.status === "ok" ? ` From the ${e.channel.source}.` : ""}`} testId="csmx-channel-emotions">
          {e.channel.status === "ok" ? (
            <>
              <EmotionTable emotions={e.channel.all.emotions} testId="csmx-channel-emotion-table" />
              <p className="mt-2 text-[11px] text-slate-500" data-testid="csmx-channel-people">
                {int(e.channel.all.records ?? 0)} channel records from {int(e.channel.all.distinctCustomers ?? 0)} distinct customers.
              </p>
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="py-1 font-semibold">Channel</th>
                    {e.channel.all.emotions.map((x) => (
                      <th key={x.emotion} className="py-1 text-right font-semibold">
                        {x.mean.label}
                      </th>
                    ))}
                    <th className="py-1 text-right font-semibold">Records</th>
                  </tr>
                </thead>
                <tbody>
                  {e.channel.byChannel.map((g) => (
                    <tr key={g.code ?? "all"} className="border-t border-slate-100" data-testid="csmx-channel-row">
                      <td className="py-1.5 text-slate-800">{g.label}</td>
                      {g.emotions.map((x) => (
                        <td key={x.emotion} className="py-1.5 text-right tabular-nums">
                          {x.mean.status === "ok" ? mean(x.mean.reading.value) : "n/a"}
                        </td>
                      ))}
                      <td className="py-1.5 text-right tabular-nums text-slate-500">{int(g.records ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <NotMeasured reason={e.channel.reason} />
          )}
        </Card>
      </div>
      <Card title="Experience-led preference" subtitle="Agreement that experiences give a reason to choose the provider: Agree or Strongly agree. Not satisfaction, and not demonstrated choice." testId="csmx-preference">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Tile f={e.experiencePreference} title="Experiences in the past three months (all customers)" />
          {e.journey.status === "ok" ? <Tile f={e.journey.preference} title="The whole recent task (journey)" /> : <NotMeasured title="The whole recent task" reason={e.journey.reason} />}
          {e.channel.status === "ok" ? <Tile f={e.channel.all.preference} title="This latest channel experience (channel records)" /> : <NotMeasured title="Latest channel experience" reason={e.channel.reason} />}
        </div>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Reasons for staying" subtitle="Multiple answers: shares of all current customers need not add to 100. Continuing to use a provider is not the same as loyalty." testId="csmx-reasons">
          <ul className="flex flex-col gap-1.5">
            {[...e.reasons.shares, e.reasons.none, e.reasons.dontKnow].map((f) => (
              <li key={f.id} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_3.5rem] items-center gap-2 text-sm" data-testid="csmx-reason-row">
                <span className="truncate text-slate-700" title={f.definition}>
                  {f.label}
                </span>
                <span className="h-2.5 rounded-full bg-slate-100">
                  <span className="block h-2.5 rounded-full bg-[#2563eb]" style={{ width: `${f.status === "ok" ? Math.min(100, f.reading.value ?? 0) : 0}%` }} />
                </span>
                <span className="text-right tabular-nums">{f.status === "ok" ? valueOf(f) : "n/a"}</span>
              </li>
            ))}
          </ul>
          {e.reasons.shares[0]?.status === "ok" && <BaseLine f={e.reasons.shares[0]} />}
          <p className="mt-4 text-xs font-semibold text-slate-700">Preference and constraints together</p>
          <ul className="mt-1 flex flex-col gap-1 text-xs text-slate-600" data-testid="csmx-coexist">
            {e.reasons.coexist.map((f) => (
              <li key={f.id}>
                Of customers citing genuine preference, {f.status === "ok" ? valueOf(f) : "n/a"} {f.label.replace(/^Also cite: /, "also cite ").toLowerCase()}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Main reason for staying" subtitle="One main reason per customer among those they selected; None and Do not know carried as answers." testId="csmx-primary">
          <Bars d={e.reasons.primary} />
        </Card>
      </div>
      <Card title="What customers said about how they felt" subtitle="The file's own text beside that record's own ratings, not written or edited here." testId="csmx-verbatims">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[...(e.journey.status === "ok" ? e.journey.verbatims : []), ...(e.channel.status === "ok" ? e.channel.verbatims : [])].map((v) => (
            <figure key={v.id + v.context} className="rounded-xl border border-slate-200 p-3" data-testid="csmx-verbatim">
              <blockquote className="text-sm text-slate-800">{v.text}</blockquote>
              <figcaption className="mt-1 text-[11px] text-slate-500">
                {v.context} · {v.ratings.map((r) => `${r.emotion} ${r.label ?? "no answer"}`).join(", ")}
              </figcaption>
            </figure>
          ))}
        </div>
      </Card>
    </>
  );
}

function BenchmarkView({ view }: { view: CsmExtensionView }) {
  const c = view.competitive;
  if (!c) return null;
  const b = c.benchmark;
  if ("status" in b) return <NotMeasured title="Competitive comparison" reason={b.reason} />;
  return (
    <>
      <Card
        title="Same task with another provider"
        subtitle="Customers who personally used another provider for the same type of task in the past 30 days rated both. The figure is the mean of each person's own difference, in scale points: positive favours their main provider. Descriptive: task complexity, selection, timing and channel mix can differ, so it is not a causal effect or a ranking."
        testId="csmx-benchmark"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Tile f={b.customer} title="Main provider minus alternative (scale points)" />
          <div className="text-sm text-slate-700" data-testid="csmx-benchmark-bases">
            {b.recorded ? (
              <ul className="flex flex-col gap-1">
                <li>Recent tasks asked: {int(b.recorded.asked)}</li>
                <li>Reported a comparable task with another provider: {int(b.recorded.comparable)}</li>
                <li>No comparable use (or did not know): {int(b.recorded.noComparableUse)}</li>
                <li>Comparable but not eligible (outside 30 days or a rating missing): {b.noncomparable === null ? "n/a" : int(b.noncomparable)}</li>
              </ul>
            ) : null}
            {b.problems.length > 0 && <p className="mt-2 text-xs text-amber-900">{b.problems.join(" ")}</p>}
          </div>
        </div>
        <p className="mt-4 text-xs font-semibold text-slate-700">By channel (single-channel journeys in the same channel as the alternative)</p>
        <div className="mt-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {b.byChannel.map((x) => (
            <Tile key={x.code} f={x.figure} title={x.label} testId="csmx-benchmark-channel" />
          ))}
        </div>
      </Card>
    </>
  );
}

function NoncustomerView({ view }: { view: CsmExtensionView }) {
  const c = view.competitive;
  if (!c) return null;
  const n = c.noncustomer;
  if (n.status !== "ok") return <NotMeasured title="Focal noncustomers" reason={n.reason} />;
  return (
    <>
      <p className="text-xs text-slate-500" data-testid="csmx-nc-sample">
        A separate supplement of people who use the sector but not {n.focal.label} in any way ({n.filename}). Unit weight, so raw and weighted bases are equal. {int(n.records.inSample)} of {int(n.records.inFile)} records meet current focal use = 0 and focal provider {n.focal.label}
        {n.records.leftOut > 0 ? `; ${int(n.records.leftOut)} left out` : ""}. Never pooled with customers, and never asked to rate service they have not experienced.
      </p>
      <section aria-label="Focal noncustomers" className="grid grid-cols-2 gap-4 lg:grid-cols-3" data-testid="csmx-nc-tiles">
        <Tile f={n.awareness} />
        <Tile f={n.consider} title={`${n.consider.label} (aware only)`} />
        <Tile f={n.alternative} title="Satisfied with own provider on a recent task" />
      </section>
      <Card
        title="Expectations and importance, and customers' performance as a separate profile"
        subtitle={`Same six aspects and the same 1 to 5 scales. Noncustomers' expectations are about the future; customers' ratings are about the past three months. Different populations and periods, so no gap is computed. ${n.customerProfile.status === "ok" ? n.customerProfile.text : n.customerProfile.reason}`}
        testId="csmx-nc-attributes"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="py-1 font-semibold">Aspect</th>
              <th className="py-1 text-right font-semibold">Noncustomers: expected (1 to 5)</th>
              <th className="py-1 text-right font-semibold">Noncustomers: importance (1 to 5)</th>
              <th className="border-l border-slate-200 py-1 pl-3 text-right font-semibold">Current customers of {n.focal.label}: performance (1 to 5)</th>
            </tr>
          </thead>
          <tbody>
            {n.attributes.map((a) => (
              <tr key={a.code} className="border-t border-slate-100" data-testid="csmx-nc-attribute">
                <td className="py-2 text-slate-800">{a.label}</td>
                {[a.expected, a.importance, a.customerPerformance].map((f, i) => (
                  <td key={i} className={`py-2 text-right tabular-nums ${i === 2 ? "border-l border-slate-200 pl-3" : ""}`}>
                    {f.status === "ok" ? (
                      <>
                        {mean(f.reading.value)} <span className="text-[11px] text-slate-500">n = {int(f.reading.rawBase)}</span>
                      </>
                    ) : (
                      <span className="text-xs text-slate-500">Not measured</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Preferred channel for a future task" subtitle="A stated preference, not measured channel use." testId="csmx-nc-channel">
        <Bars d={n.preferredChannel} />
      </Card>
    </>
  );
}
