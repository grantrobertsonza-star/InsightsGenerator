// R6 CSM extension: Journey continuity and the customer benchmark, from one wave's Relationship file only
// (customer grain, one customer counted once). The contract is claude/csm-extension.md ("Journey continuity",
// "Customer benchmark").
//
// The journey is the respondent's own anchored task (J1 to J8): recent customers are journey_recent30 = 1, and every
// journey figure is computed on them. Its path, contacts, channels and outcome come only from the journey fields;
// the latest-experience rows of the Channel file are never joined into a journey (they may concern different
// tasks), and channel CSAT is never averaged into journey CSAT.
//   - completion is journey_completed (1 completed; 0 partly completed or unresolved; blank when pending), so its
//     base is known final outcomes; the pending share (status 9 among all valid outcomes) is shown beside it;
//   - transfers and repeated information are shares of 1 among valid 0 and 1 (99 disclosed, a 0 is an answer);
//   - ordered paths are journey_sequence as written ("3>3>2" is three contacts: digital, digital, branch), read from
//     the file's table with the same weight; distinct channels are the distinct codes in it, checked against the
//     journey_channel flags (a disagreement is counted and shown, never repaired);
//   - a customer-level score with the journey filter (company satisfaction among recent customers) is a different
//     population and says so beside the all-customers figure.
// Benchmark (B1 to B3): eligible when benchmark_recent_same_task30 = 1, the alternative provider differs from the
// main provider, the alternative task equals journey_task, benchmark_days_ago is 0 to 30 and both satisfaction
// ratings are valid; the figure is the weighted mean of the within-person benchmark_gap5 (scale points, positive
// favours the main provider), never a difference of separately filtered means. The task and provider rules are
// row-wise, so they are checked on the recorded comparisons: any comparison breaking them makes the figure Not
// measured with the count (it cannot be excluded by a code filter). A channel comparison additionally requires a
// single-channel journey in the benchmark's channel. Descriptive only: no causal, ROI or ranking claim.
import type { CrosstabFilter, CrosstabResult } from "./parseStatsFile";
import { found, relationshipFields, type Field } from "./csmExtensionRoles";
import type { CsmFile, Row } from "./csmExtensionKeys";
import { codeFilter, codeCounts, distributionOf, figureOf, rangeFilter, readCountMean, tableOrReason, tabulate, type CsmDistribution, type CsmFigure } from "./csmExtensionMetrics";

export type JourneyFilters = { company: string | null; task: string | null; journeyChannel: string | null };

export type PathRow = { path: string; text: string; contacts: number; share: number; weighted: number; raw: number };

export type JourneySection = {
  status: "ok";
  documentId: string;
  filename: string;
  weightVar: string | null;
  /** The population every journey figure is computed on, in words, with its bases. */
  population: { text: string; rawBase: number | null; weightedBase: number | null };
  recentShare: CsmFigure;
  completion: CsmFigure;
  pending: CsmFigure;
  outcomes: CsmDistribution;
  journeyCsat: CsmFigure;
  journeyCsatMean: CsmFigure;
  journeyCsatDistribution: CsmDistribution;
  contacts: { status: "ok"; mean: number | null; rawBase: number; weightedBase: number; nonresponse: number; baseLevel: string } | { status: "not_measured"; reason: string } | { status: "failed"; error: string };
  multichannel: CsmFigure;
  channelsUsed: CsmFigure[];
  digitalMode: CsmDistribution;
  transferred: CsmFigure;
  repeatInfo: CsmFigure;
  paths: { status: "ok"; rows: PathRow[]; distinct: { channels: number; share: number; raw: number }[]; weightedBase: number; rawBase: number; flagMismatches: number; others: number } | { status: "not_measured"; reason: string };
  /** Company satisfaction for all customers and among recent customers: the journey filter changes the population. */
  companyCsat: { all: CsmFigure; recent: CsmFigure; note: string };
  /** The options the filters may take (codes and labels from the answer lists). */
  options: { companies: { code: string; label: string }[]; tasks: { code: string; label: string }[]; channels: { code: string; label: string }[] };
  applied: { text: string; filters: CrosstabFilter[] };
};

export type Benchmark = {
  customer: CsmFigure;
  /** Recent customers asked B1, those reporting a comparable task (B1 = 1), those without one (0 or 99). */
  recorded: { asked: number; comparable: number; noComparableUse: number } | null;
  /** Comparisons recorded but not eligible (outside the window, a rating missing, 99): counted, never zero. */
  noncomparable: number | null;
  byChannel: { code: string; label: string; figure: CsmFigure }[];
  problems: string[];
};

const defs = {
  recent: "Share of all current customers who started or attempted a specific service task with the provider in the past 30 days (journey_recent30 = 1).",
  completion: "Completed tasks among recent tasks with a known final outcome (journey_completed: 1 completed; 0 partly completed or unresolved). Pending tasks are outside this base and shown beside it.",
  pending: "Still pending (journey_status 9) among all recent tasks with a valid outcome.",
  outcomes: "Outcome of the anchored task at interview among recent tasks with a valid outcome, pending kept as its own answer.",
  csat: "End-to-end satisfaction with the whole task (journey_csat5): Satisfied or Very satisfied among valid 1 to 5. Not an average of channel ratings.",
  csatMean: "Mean end-to-end satisfaction with the whole task, valid 1 to 5.",
  multichannel: "Recent tasks using two or more distinct channels (journey_multichannel).",
  transferred: "Recent tasks where the customer was transferred or directed to another team or channel (journey_transferred = 1 among valid 0 and 1; 99 excluded and disclosed).",
  repeat: "Recent tasks where the customer had to repeat information already given (journey_repeat_info = 1 among valid 0 and 1; a 0 is a valid answer).",
  digital: "Digital self service mode on tasks that used digital self service (app, website, or both). Digital self service is not always an app.",
  gap: "Weighted mean of the within-person difference journey_csat5 minus benchmark_csat5, in scale points (positive favours the main provider), among eligible comparisons only. Descriptive recalled evidence, not a causal provider effect.",
} as const;

const PATH_LIMIT = 10;

/** Ordered paths and distinct channel counts of the recent tasks in the filtered population, read from the file's
 * table as the engine read it. Rows are selected by raw code, the same rule as the engine filters. Pure. */
export function journeyPaths(rows: Row[], weightVar: string | null, select: (r: Row) => boolean, channelName: (code: string) => string) {
  const byPath = new Map<string, { weighted: number; raw: number }>();
  const byDistinct = new Map<number, { weighted: number; raw: number }>();
  let weightedBase = 0;
  let rawBase = 0;
  let flagMismatches = 0;
  for (const r of rows) {
    if (String(r.journey_recent30) !== "1" || !select(r)) continue;
    const seq = typeof r.journey_sequence === "string" ? r.journey_sequence.trim() : "";
    if (!seq) continue;
    const w = weightVar ? Number(r[weightVar]) : 1;
    if (!(w > 0)) continue;
    const steps = seq.split(">").map((s) => s.trim());
    const distinct = new Set(steps);
    for (const c of ["1", "2", "3", "4"]) {
      const flag = r[`journey_channel_c0${c}`];
      if (flag !== null && flag !== undefined && String(flag) !== (distinct.has(c) ? "1" : "0")) {
        flagMismatches++;
        break;
      }
    }
    const p = byPath.get(seq) ?? { weighted: 0, raw: 0 };
    p.weighted += w;
    p.raw += 1;
    byPath.set(seq, p);
    const d = byDistinct.get(distinct.size) ?? { weighted: 0, raw: 0 };
    d.weighted += w;
    d.raw += 1;
    byDistinct.set(distinct.size, d);
    weightedBase += w;
    rawBase += 1;
  }
  const sorted = [...byPath.entries()].sort((a, b) => b[1].weighted - a[1].weighted || a[0].localeCompare(b[0]));
  const rowsOut: PathRow[] = sorted.slice(0, PATH_LIMIT).map(([path, v]) => ({
    path,
    text: path.split(">").map((c) => channelName(c.trim())).join(" > "),
    contacts: path.split(">").length,
    share: weightedBase > 0 ? (v.weighted / weightedBase) * 100 : 0,
    weighted: v.weighted,
    raw: v.raw,
  }));
  return {
    rows: rowsOut,
    distinct: [...byDistinct.entries()].sort((a, b) => a[0] - b[0]).map(([channels, v]) => ({ channels, share: weightedBase > 0 ? (v.weighted / weightedBase) * 100 : 0, raw: v.raw })),
    weightedBase,
    rawBase,
    flagMismatches,
    others: Math.max(0, sorted.length - PATH_LIMIT),
  };
}

const answers = (f: Field) => (f.status === "found" ? f.answers : []);
const labelOf = (f: Field, code: string | null) => (code === null ? null : (answers(f).find((a) => a.code === code)?.label ?? code));

/** Off-diagonal (or diagonal) unweighted counts of a row variable against a banner variable, by raw code. Pure. */
export function codeAgreement(result: CrosstabResult, rowVariable: string, bannerVariable: string): { same: number; differ: number } {
  const q = result.questions.find((x) => x.key === rowVariable);
  let same = 0;
  let differ = 0;
  if (!q) return { same, differ };
  result.columns.forEach((col, j) => {
    if (col.var !== bannerVariable || col.rawCode === undefined) return;
    for (const c of codeCounts(q, j)) {
      if (!c.raw) continue;
      if (c.code === col.rawCode) same += c.raw;
      else differ += c.raw;
    }
  });
  return { same, differ };
}

/**
 * The journey population for the filters: recent tasks (journey_recent30 = 1), and the company, task and journey
 * channel chosen, each by raw code. The codes are checked against the file's answer lists here (an unknown code is
 * refused, never dropped). `select` is the same rule for the file's rows (paths, verbatims). Shared by the Journey,
 * Emotions and Competitive sections so a filter means the same customers in each.
 */
export function journeyPopulation(file: CsmFile, filters: JourneyFilters, channelName: (code: string) => string) {
  const f = relationshipFields(file.variables);
  for (const [name, field, code] of [["company", f.company, filters.company], ["task", f.task, filters.task]] as const) {
    if (code !== null && !answers(field).some((a) => a.code === code)) throw new Error(`Answer code ${code} is not in the ${name} answer list of ${file.filename}.`);
  }
  if (filters.journeyChannel !== null && !["1", "2", "3", "4"].includes(filters.journeyChannel)) throw new Error(`Channel code ${filters.journeyChannel} is not a journey channel.`);
  if (filters.journeyChannel !== null && f.journeyChannels[Number(filters.journeyChannel) - 1].status !== "found") throw new Error(`The file has no journey_channel_c0${filters.journeyChannel}, so the channel filter cannot be applied.`);
  const companyFilters: CrosstabFilter[] = filters.company !== null ? [codeFilter("company", filters.company)] : [];
  const recentVar = found(f.recent);
  const journeyFilters: CrosstabFilter[] = [
    ...(recentVar ? [codeFilter(recentVar, 1)] : []),
    ...companyFilters,
    ...(filters.task !== null ? [codeFilter("journey_task", filters.task)] : []),
    ...(filters.journeyChannel !== null ? [codeFilter(`journey_channel_c0${filters.journeyChannel}`, 1)] : []),
  ];
  const text = [
    "Recent tasks (journey_recent30 = 1)",
    filters.company !== null ? `company ${labelOf(f.company, filters.company)}` : null,
    filters.task !== null ? `task ${labelOf(f.task, filters.task)}` : null,
    filters.journeyChannel !== null ? `tasks that used ${channelName(filters.journeyChannel)}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const select = (r: Row) =>
    (filters.company === null || String(r.company) === filters.company) &&
    (filters.task === null || String(r.journey_task) === filters.task) &&
    (filters.journeyChannel === null || String(r[`journey_channel_c0${filters.journeyChannel}`]) === "1");
  return { companyFilters, journeyFilters, text, select };
}

export async function loadJourneySection(tenantId: string, runId: string, file: CsmFile, weightVar: string | null, filters: JourneyFilters, channelName: (code: string) => string): Promise<JourneySection> {
  const f = relationshipFields(file.variables);
  const doc = file.documentId;
  const pop = journeyPopulation(file, filters, channelName);
  const { companyFilters, journeyFilters, select } = pop;
  const appliedText = pop.text;
  const recentVar = found(f.recent);

  const allTable = await tableOrReason(
    () => tabulate(tenantId, runId, doc, [recentVar, found(f.companyCsat)].filter((x): x is string => !!x), weightVar, companyFilters),
    "No customers meet the company filter",
  );
  const journeyVars = [f.status, f.completed, f.journeyCsat, f.contacts, f.multichannel, ...f.journeyChannels, f.digitalMode, f.transferred, f.repeatInfo, f.companyCsat, f.benchmarkRecent]
    .map(found)
    .filter((x): x is string => !!x);
  const journeyTable = recentVar
    ? await tableOrReason(() => tabulate(tenantId, runId, doc, journeyVars, weightVar, journeyFilters), "No customer in this population has a recent task")
    : { notMeasured: f.recent.status === "not_measured" ? f.recent.reason : "Not measured." };

  const meta = (id: string, label: string, definition: string) => ({ id, label, definition });
  const statusCodes = answers(f.status).filter((a) => ["1", "2", "3", "9"].includes(a.code)).map((a) => a.code);
  const pendingFigure = ((): CsmFigure => {
    const m = meta("pending", "Still pending", defs.pending);
    const d = distributionOf(m, f.status, journeyTable, statusCodes);
    if (d.status !== "ok") return d;
    const row = d.rows.find((r) => r.code === "9");
    const value = row?.share ?? null;
    return {
      ...m,
      status: "ok",
      variable: d.variable,
      reading: { statistic: "yes", value, numerator: row?.weighted ?? 0, weightedBase: d.weightedBase, rawBase: d.rawBase, nonresponse: d.nonresponse, outsideDomain: d.outsideDomain, baseLevel: d.baseLevel },
    };
  })();

  const contacts = ((): JourneySection["contacts"] => {
    if (f.contacts.status !== "found") return { status: "not_measured", reason: f.contacts.reason };
    if ("notMeasured" in journeyTable) return { status: "not_measured", reason: journeyTable.notMeasured };
    if ("failed" in journeyTable) return { status: "failed", error: journeyTable.failed };
    const q = journeyTable.questions.find((x) => x.key === "journey_contacts");
    if (!q) return { status: "failed", error: "journey_contacts was not tabulated." };
    const m = readCountMean(q, "total", 1);
    return { status: "ok", mean: m.value, rawBase: m.rawBase, weightedBase: m.weightedBase, nonresponse: m.nonresponse, baseLevel: m.baseLevel };
  })();

  const paths: JourneySection["paths"] =
    f.sequence.status !== "found" ? { status: "not_measured", reason: f.sequence.reason } : !file.rowsRead ? { status: "not_measured", reason: `Ordered paths are read from the file's rows, which are read for CSV, TSV and Excel files only (${file.filename}).` } : !recentVar ? { status: "not_measured", reason: "journey_recent30 is not in this file." } : { status: "ok", ...journeyPaths(file.rows, weightVar, select, channelName) };

  const population =
    "notMeasured" in journeyTable || "failed" in journeyTable
      ? { text: appliedText, rawBase: null, weightedBase: null }
      : { text: appliedText, rawBase: journeyTable.total.n, weightedBase: journeyTable.total.w };

  return {
    status: "ok",
    documentId: doc,
    filename: file.filename,
    weightVar,
    population,
    recentShare: figureOf(meta("recent", "Recent task in the past 30 days", defs.recent), f.recent, allTable, "yes"),
    completion: figureOf(meta("completion", "Completed (known outcomes)", defs.completion), f.completed, journeyTable, "yes"),
    pending: pendingFigure,
    outcomes: distributionOf(meta("outcomes", "Task outcome", defs.outcomes), f.status, journeyTable, statusCodes.length ? statusCodes : null),
    journeyCsat: figureOf(meta("journeyCsat", "Journey satisfaction (top two)", defs.csat), f.journeyCsat, journeyTable, "t2b"),
    journeyCsatMean: figureOf(meta("journeyCsatMean", "Journey satisfaction (mean of 5)", defs.csatMean), f.journeyCsat, journeyTable, "mean5"),
    journeyCsatDistribution: distributionOf(meta("journeyCsatDistribution", "Journey satisfaction", "Each answer's share of valid 1 to 5 ratings of the whole task."), f.journeyCsat, journeyTable, ["1", "2", "3", "4", "5"]),
    contacts,
    multichannel: figureOf(meta("multichannel", "Used two or more channels", defs.multichannel), f.multichannel, journeyTable, "yes"),
    channelsUsed: f.journeyChannels.map((field, i) =>
      figureOf(meta(`channel${i + 1}`, `Used ${channelName(String(i + 1))}`, `Recent tasks that used ${channelName(String(i + 1))} at least once (journey_channel_c0${i + 1}); a task can use several channels.`), field, journeyTable, "yes"),
    ),
    digitalMode: distributionOf(meta("digitalMode", "Digital self service mode", defs.digital), f.digitalMode, journeyTable, null),
    transferred: figureOf(meta("transferred", "Transferred or redirected", defs.transferred), f.transferred, journeyTable, "yes"),
    repeatInfo: figureOf(meta("repeatInfo", "Had to repeat information", defs.repeat), f.repeatInfo, journeyTable, "yes"),
    paths,
    companyCsat: {
      all: figureOf(meta("companyCsatAll", "Company satisfaction, all customers", "Company satisfaction top two (company_csat5 4 or 5 among valid 1 to 5), every current customer."), f.companyCsat, allTable, "t2b"),
      recent: figureOf(meta("companyCsatRecent", "Company satisfaction, customers with a recent task", "The same company satisfaction top two among customers with a recent task only. The journey filter changes the population."), f.companyCsat, journeyTable, "t2b"),
      note: "Company satisfaction is a customer-level score. Restricted to customers with a recent task it describes a different population, not the company score.",
    },
    options: {
      companies: answers(f.company),
      tasks: answers(f.task),
      channels: f.journeyChannels.map((x, i) => (x.status === "found" ? { code: String(i + 1), label: channelName(String(i + 1)) } : null)).filter((x): x is { code: string; label: string } => x !== null),
    },
    applied: { text: appliedText, filters: journeyFilters },
  };
}

/** The customer benchmark among recent tasks in the journey population (journeyFilters: recent, company, task). */
export async function loadBenchmark(tenantId: string, runId: string, file: CsmFile, weightVar: string | null, journeyFilters: CrosstabFilter[], channelName: (code: string) => string): Promise<Benchmark> {
  const f = relationshipFields(file.variables);
  const meta = { id: "benchmark", label: "Main provider minus alternative, same task (scale points)", definition: defs.gap };
  const needed = [f.recent, f.benchmarkRecent, f.benchmarkProvider, f.benchmarkTask, f.benchmarkDays, f.benchmarkCsat, f.benchmarkGap, f.journeyCsat, f.task, f.company];
  const missing = needed.find((x) => x.status !== "found");
  const none = (reason: string): Benchmark => ({ customer: { ...meta, status: "not_measured", reason }, recorded: null, noncomparable: null, byChannel: [], problems: [] });
  if (missing && missing.status === "not_measured") return none(`Not measured: ${missing.reason}`);
  const doc = file.documentId;
  const problems: string[] = [];
  // Who was asked B1 and what they said.
  const asked = await tableOrReason(() => tabulate(tenantId, runId, doc, ["benchmark_recent_same_task30"], weightVar, journeyFilters), "No customer in this population has a recent task");
  if (!("questions" in asked)) return none("notMeasured" in asked ? asked.notMeasured : asked.failed);
  const b1 = codeCounts(asked.questions[0], "total");
  const askedN = b1.reduce((s, c) => s + (c.raw ?? 0), 0);
  const comparable = b1.find((c) => c.code === "1")?.raw ?? 0;
  const recorded = { asked: askedN, comparable, noComparableUse: askedN - comparable };
  if (comparable === 0) return { ...none("Not measured: no customer in this population personally used another provider for the same type of task in the past 30 days."), recorded };
  const comparableFilters = [...journeyFilters, codeFilter("benchmark_recent_same_task30", 1)];
  // The row-wise rules, on every recorded comparison: the alternative's task is the journey's task; the
  // alternative provider is not the main provider.
  const [taskCheck, providerCheck, eligible] = await Promise.all([
    tableOrReason(() => tabulate(tenantId, runId, doc, ["benchmark_task"], null, comparableFilters, "journey_task"), "No recorded comparison"),
    tableOrReason(() => tabulate(tenantId, runId, doc, ["benchmark_provider"], null, comparableFilters, "company"), "No recorded comparison"),
    tableOrReason(() => tabulate(tenantId, runId, doc, ["benchmark_gap5"], weightVar, [...comparableFilters, rangeFilter("benchmark_days_ago", 0, 30)]), "No recorded comparison is within 0 to 30 days"),
  ]);
  if ("questions" in taskCheck) {
    const a = codeAgreement(taskCheck, "benchmark_task", "journey_task");
    if (a.differ > 0) problems.push(`${a.differ} recorded comparison${a.differ === 1 ? " is" : "s are"} for a different type of task than the journey's.`);
  } else problems.push("notMeasured" in taskCheck ? taskCheck.notMeasured : taskCheck.failed);
  if ("questions" in providerCheck) {
    const a = codeAgreement(providerCheck, "benchmark_provider", "company");
    if (a.same > 0) problems.push(`${a.same} recorded comparison${a.same === 1 ? " names" : "s name"} the customer's own main provider as the alternative.`);
  } else problems.push("notMeasured" in providerCheck ? providerCheck.notMeasured : providerCheck.failed);
  const gapField = f.benchmarkGap as Field;
  let customer = figureOf(meta, gapField, eligible, "mean_gap");
  if (problems.length) customer = { ...meta, status: "not_measured", reason: `Not measured: comparisons that break the same-task or different-provider rule cannot be excluded by code. ${problems.join(" ")}` };
  const noncomparable = customer.status === "ok" ? comparable - customer.reading.rawBase : null;

  // Channel comparisons: a single-channel journey in the benchmark's channel.
  const byChannel: Benchmark["byChannel"] = [];
  const channelField = f.benchmarkChannel;
  if (channelField.status === "found" && f.multichannel.status === "found") {
    for (let k = 1; k <= 4; k++) {
      const jc = f.journeyChannels[k - 1];
      const label = channelName(String(k));
      const cm = { id: `benchmark-c${k}`, label: `${label} only`, definition: `${defs.gap} Single-channel journeys in ${label} compared with an alternative task in the same channel.` };
      if (jc.status !== "found") {
        byChannel.push({ code: String(k), label, figure: { ...cm, status: "not_measured", reason: jc.reason } });
        continue;
      }
      if (problems.length) {
        byChannel.push({ code: String(k), label, figure: { ...cm, status: "not_measured", reason: customer.status === "not_measured" ? customer.reason : "Not measured." } });
        continue;
      }
      const t = await tableOrReason(
        () => tabulate(tenantId, runId, doc, ["benchmark_gap5"], weightVar, [...comparableFilters, rangeFilter("benchmark_days_ago", 0, 30), codeFilter("journey_multichannel", 0), codeFilter(jc.variable, 1), codeFilter("benchmark_channel", k)]),
        `Not measured: no single-channel ${label} journey has a comparable ${label} task with another provider`,
      );
      byChannel.push({ code: String(k), label, figure: figureOf(cm, gapField, t, "mean_gap") });
    }
  }
  return { customer, recorded, noncomparable, byChannel, problems };
}
