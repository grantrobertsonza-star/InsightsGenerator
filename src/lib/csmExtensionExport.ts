// R6 CSM extension: the figures of one computed section as export rows (CSV), each carrying what the pack
// instructions require of an export: grain, sample_type, wave, provider and task or channel filters, the metric
// definition, the valid raw and weighted bases, the low-base flag and a data note. Pure, so the screen can build the
// file from the figures it shows, and the rows equal the screen's figures by construction.
//
// Synthetic-data label: the CSM demonstration packs' file names follow "<Sector>_CSM_<Family>_Wave_<n>" or
// "<Sector>_CSM_<Family>_All_Waves" (families Relationship, Channel, Noncustomer, Combined); a section
// computed from such files is labelled "Synthetic demonstration data (CSM pack)". Other files carry no label, since
// the files themselves do not say whether they are synthetic.
import type { CsmExtensionView } from "./csmExtension";
import type { CsmDistribution, CsmFigure } from "./csmExtensionMetrics";

export const EXPORT_COLUMNS = [
  "section", "figure", "label", "grain", "sample_type", "wave", "data_wave", "company_filter", "task_filter", "channel_filter", "population", "statistic", "value", "unit",
  "raw_base", "weighted_base", "nonresponse_excluded", "low_base", "status", "reason", "definition", "source_file", "data_note",
] as const;
export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>;

const PACK_NAME = /_CSM_(Relationship|Channel|Noncustomer|Combined)_(Wave_\d+|All_Waves)\.xlsx$/i;
const UNIT: Record<string, string> = { t2b: "percent", top: "percent", b2b: "percent", yes: "percent", ease: "percent", risk: "percent", nps: "score", mean5: "scale points (1 to 5)", mean7: "scale points (1 to 7)", mean_gap: "scale points" };
const LOW: Record<string, string> = { ok: "", small: "below 50: interpret with care", very_small: "below 30: descriptive only" };

export function exportRows(view: CsmExtensionView): ExportRow[] {
  const rows: ExportRow[] = [];
  const fileOf = (grain: string) => view.files.find((f) => f.grain === grain);
  const note = (grain: string) => (PACK_NAME.test(fileOf(grain)?.filename ?? "") ? "Synthetic demonstration data (CSM pack)" : "");
  const companyText = view.filters.company ?? "all";
  const base = (section: string, grain: string, sampleType: string, population: string, extra: Partial<ExportRow> = {}) => ({
    section, grain, sample_type: sampleType, wave: view.wave ?? "", data_wave: view.filters.dataWave ?? "", company_filter: companyText, task_filter: view.filters.task ?? "all", channel_filter: view.filters.journeyChannel ?? "all", population, source_file: fileOf(grain)?.filename ?? "", data_note: note(grain), ...extra,
  });
  const fig = (b: ReturnType<typeof base>, f: CsmFigure) => {
    const common = { figure: f.id, label: f.label, definition: f.definition };
    if (f.status === "ok") {
      const r = f.reading;
      rows.push({ ...b, ...common, statistic: r.statistic, value: r.value === null ? "" : String(r.value), unit: UNIT[r.statistic] ?? "", raw_base: String(r.rawBase), weighted_base: String(r.weightedBase), nonresponse_excluded: String(r.nonresponse), low_base: LOW[r.baseLevel], status: r.value === null ? "no value" : "ok", reason: r.reason ?? "" });
    } else rows.push({ ...b, ...common, statistic: "", value: "", unit: "", raw_base: "", weighted_base: "", nonresponse_excluded: "", low_base: "", status: f.status === "not_measured" ? "Not measured" : "Failed", reason: f.status === "not_measured" ? f.reason : f.error });
  };
  const dist = (b: ReturnType<typeof base>, d: CsmDistribution) => {
    if (d.status !== "ok") {
      fig(b, d);
      return;
    }
    for (const r of d.rows) {
      rows.push({ ...b, figure: `${d.id}:${r.code}`, label: `${d.label}: ${r.label}`, definition: d.definition, statistic: "share", value: r.share === null ? "" : String(r.share), unit: "percent", raw_base: String(d.rawBase), weighted_base: String(d.weightedBase), nonresponse_excluded: String(d.nonresponse), low_base: LOW[d.baseLevel], status: "ok", reason: "" });
    }
  };
  const C = "Current customers";
  if (view.journey && view.journey.status === "ok") {
    const j = view.journey;
    const b = base("Journey continuity", "relationship", C, j.population.text);
    const all = base("Journey continuity", "relationship", C, "All current customers");
    fig(all, j.recentShare);
    for (const f of [j.completion, j.pending, j.journeyCsat, j.journeyCsatMean, j.multichannel, ...j.channelsUsed, j.transferred, j.repeatInfo]) fig(b, f);
    for (const d of [j.outcomes, j.journeyCsatDistribution, j.digitalMode]) dist(b, d);
    fig(all, j.companyCsat.all);
    fig(b, j.companyCsat.recent);
  }
  if (view.experience) {
    const e = view.experience;
    if (e.journey.status === "ok") {
      const b = base("Emotions and preference", "relationship", C, e.journey.populationText);
      for (const em of e.journey.emotions) {
        fig(b, em.mean);
        fig(b, em.high);
        dist(b, em.distribution);
      }
      fig(b, e.journey.preference);
    }
    if (e.channel.status === "ok") {
      for (const g of [e.channel.all, ...e.channel.byChannel]) {
        const b = base("Emotions and preference", "channel", C, `${g.label} (channel records; each customer once per channel)`, { channel_filter: g.code ?? "all" });
        for (const em of g.emotions) {
          fig(b, em.mean);
          fig(b, em.high);
        }
        fig(b, g.preference);
      }
    }
    const all = base("Emotions and preference", "relationship", C, "All current customers");
    fig(all, e.experiencePreference);
    for (const f of [...e.reasons.shares, e.reasons.none, e.reasons.dontKnow, ...e.reasons.coexist]) fig(all, f);
    dist(all, e.reasons.primary);
  }
  if (view.competitive) {
    const c = view.competitive;
    if (!("status" in c.benchmark)) {
      const b = base("Competitive", "relationship", C, "Recent tasks with a comparable alternative task in 30 days");
      fig(b, c.benchmark.customer);
      for (const ch of c.benchmark.byChannel) fig(base("Competitive", "relationship", C, `Single-channel ${ch.label} journeys`, { channel_filter: ch.code }), ch.figure);
    }
    if (c.noncustomer.status === "ok") {
      const n = c.noncustomer;
      const b = base("Noncustomers", "noncustomer", "Focal noncustomers", `Focal noncustomers of ${n.focal.label} (unit weight)`, { company_filter: "not applied (separate sample)" });
      fig(b, n.awareness);
      fig(b, n.consider);
      for (const a of n.attributes) {
        fig(b, a.expected);
        fig(b, a.importance);
      }
      dist(b, n.preferredChannel);
      fig(b, n.alternative);
      const cust = base("Noncustomers", "relationship", C, `Current customers of ${n.focal.label} (separate profile, no gap computed)`, { company_filter: n.focal.code });
      for (const a of n.attributes) fig(cust, a.customerPerformance);
    }
  }
  return rows;
}

/** The rows as CSV text (RFC 4180 quoting). */
export function exportCsv(rows: ExportRow[]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [EXPORT_COLUMNS.join(","), ...rows.map((r) => EXPORT_COLUMNS.map((c) => q(r[c] ?? "")).join(","))].join("\r\n");
}
