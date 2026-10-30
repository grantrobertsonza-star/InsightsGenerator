// R6 CSM extension: emotions, experience-led preference and reasons for staying (claude/csm-extension.md,
// "Emotions, preference and reasons for staying").
//   - Emotions at two grains, never mixed: the journey grain (Relationship file, recent tasks, one customer once)
//     and the channel grain (Channel file, latest experience per customer per channel; a customer with several
//     channels counts once per channel, so event n and distinct customers are both shown). Reassured, valued,
//     frustrated and anxious are each their own figure on their own valid 1 to 5 base (mean and the five intensity
//     labels); they are never inverted or combined into an index.
//   - Preference is agreement (1 to 5): top two is Agree or Strongly agree, not satisfaction. Each is labelled by
//     its recall and grain: experiences in the past three months (customer), the whole recent task (journey), this
//     latest channel experience (channel record).
//   - Reasons for staying are a multiple response: each reason's share of all current customers, which need not add
//     to 100; None and Do not know are exclusive; the primary reason is its own distribution (97 None and 99 Do not
//     know carried as answers there). Preference and constraints can coexist, shown as the share of those citing
//     genuine preference who also cite each constraint. Continuing use is never called loyalty.
//   - Verbatims are the file's own text beside the record's own ratings, never written or edited here.
import type { CrosstabFilter } from "./parseStatsFile";
import { EMOTIONS, EMOTION_TEXT, channelFields, found, relationshipFields, type Emotion, type Field } from "./csmExtensionRoles";
import type { CsmFile, Row } from "./csmExtensionKeys";
import { codeFilter, columnOf, distributionOf, figureOf, tableOrReason, tabulate, type ColumnRef, type CsmDistribution, type CsmFigure } from "./csmExtensionMetrics";
import type { CrosstabResult } from "./parseStatsFile";

export type EmotionFigure = { emotion: Emotion; mean: CsmFigure; distribution: CsmDistribution };
export type Verbatim = { id: string; text: string; ratings: { emotion: Emotion; code: string | null; label: string | null }[]; context: string };
export type ChannelGrain = {
  code: string | null;
  label: string;
  emotions: EmotionFigure[];
  preference: CsmFigure;
  /** Records with any valid emotion rating and the distinct customers behind them (channel grain only). */
  records: number | null;
  distinctCustomers: number | null;
};

export type ExperienceSection = {
  journey: { status: "ok"; populationText: string; emotions: EmotionFigure[]; preference: CsmFigure; verbatims: Verbatim[] } | { status: "not_measured"; reason: string };
  channel: { status: "ok"; filename: string; all: ChannelGrain; byChannel: ChannelGrain[]; verbatims: Verbatim[] } | { status: "not_measured"; reason: string };
  experiencePreference: CsmFigure;
  reasons: {
    shares: CsmFigure[];
    none: CsmFigure;
    dontKnow: CsmFigure;
    primary: CsmDistribution;
    /** Among customers citing genuine preference, the share also citing each constraint. */
    coexist: CsmFigure[];
  };
};

const INTENSITY = ["1", "2", "3", "4", "5"];
const VERBATIM_LIMIT = 6;

function emotionFigures(fields: Record<Emotion, Field>, table: CrosstabResult | { notMeasured: string } | { failed: string }, grain: string, column: ColumnRef): EmotionFigure[] {
  return EMOTIONS.map((e) => ({
    emotion: e,
    mean: figureOf({ id: `${grain}-${e}`, label: EMOTION_TEXT[e], definition: `Mean intensity of feeling ${e} (1 Not at all to 5 Extremely) among valid answers to this item only, ${grain} grain.` }, fields[e], table, "mean5", column),
    distribution: distributionOf({ id: `${grain}-${e}-dist`, label: EMOTION_TEXT[e], definition: `Share at each intensity among valid answers to this item, ${grain} grain.` }, fields[e], table, INTENSITY, column),
  }));
}

/** The file's own explanation texts beside the record's own emotion ratings (first records in file order). Pure. */
export function verbatimsOf(rows: Row[], textVar: string, emotionVars: Record<Emotion, Field>, select: (r: Row) => boolean, context: (r: Row) => string): Verbatim[] {
  const out: Verbatim[] = [];
  for (const r of rows) {
    if (out.length >= VERBATIM_LIMIT) break;
    const text = r[textVar];
    if (typeof text !== "string" || !text.trim() || !select(r)) continue;
    out.push({
      id: String(r.experience_id ?? r.journey_id ?? r.respondent_id ?? out.length),
      text: text.trim(),
      context: context(r),
      ratings: EMOTIONS.map((e) => {
        const f = emotionVars[e];
        if (f.status !== "found") return { emotion: e, code: null, label: null };
        const v = r[f.variable];
        const code = v === null || v === undefined ? null : String(v);
        return { emotion: e, code, label: code === null ? null : (f.answers.find((a) => a.code === code)?.label ?? code) };
      }),
    });
  }
  return out;
}

export async function loadExperienceSection(
  tenantId: string,
  runId: string,
  relationship: CsmFile | null,
  channel: CsmFile | null,
  weighting: (f: CsmFile) => string | null,
  journeyFilters: { company: string | null; journeyFilters: CrosstabFilter[]; populationText: string; select: (r: Row) => boolean },
  channelFilter: { company: string | null; channelName: (code: string) => string },
  absentReason: { relationship?: string; channel?: string },
): Promise<ExperienceSection> {
  const notMeasured = (reason: string) => ({ status: "not_measured" as const, reason });
  const rf = relationship ? relationshipFields(relationship.variables) : null;
  const meta = (id: string, label: string, definition: string) => ({ id, label, definition });

  // Journey grain.
  let journey: ExperienceSection["journey"] = notMeasured(absentReason.relationship ?? "No Relationship file is linked to this wave.");
  if (relationship && rf) {
    const vars = [...EMOTIONS.map((e) => found(rf.journeyEmotions[e])), found(rf.journeyPreference)].filter((x): x is string => !!x);
    if (!found(rf.recent)) journey = notMeasured(rf.recent.status === "not_measured" ? rf.recent.reason : "Not measured.");
    else if (vars.length === 0) journey = notMeasured("No journey emotion or journey preference question is in this file.");
    else {
      const t = await tableOrReason(() => tabulate(tenantId, runId, relationship.documentId, vars, weighting(relationship), journeyFilters.journeyFilters), "No customer in this population has a recent task");
      const why = found(rf.journeyEmotionWhy);
      journey = {
        status: "ok",
        populationText: journeyFilters.populationText,
        emotions: emotionFigures(rf.journeyEmotions, t, "journey", "total"),
        preference: figureOf(meta("journeyPreference", "The whole task gives a reason to choose the provider (journey grain)", "Agree or Strongly agree (4 or 5) among valid 1 to 5 answers about the whole recent task. Agreement, not satisfaction."), rf.journeyPreference, t, "t2b"),
        verbatims: why ? verbatimsOf(relationship.rows, why, rf.journeyEmotions, (r) => String(r.journey_recent30) === "1" && journeyFilters.select(r), () => "Whole recent task") : [],
      };
    }
  }

  // Channel grain.
  let channelOut: ExperienceSection["channel"] = notMeasured(absentReason.channel ?? "No Channel file is linked to this wave.");
  if (channel) {
    const cf = channelFields(channel.variables);
    const vars = [...EMOTIONS.map((e) => found(cf.emotions[e])), found(cf.preference)].filter((x): x is string => !!x);
    if (cf.channel.status !== "found") channelOut = notMeasured(cf.channel.reason);
    else if (vars.length === 0) channelOut = notMeasured("No channel emotion or channel preference question is in this file.");
    else {
      if (channelFilter.company !== null && !(cf.company.status === "found" && cf.company.answers.some((a) => a.code === channelFilter.company))) {
        throw new Error(`Answer code ${channelFilter.company} is not in the company answer list of ${channel.filename}.`);
      }
      const filters = channelFilter.company !== null ? [codeFilter("company", channelFilter.company)] : [];
      const t = await tableOrReason(() => tabulate(tenantId, runId, channel.documentId, vars, weighting(channel), filters, "channel"), "No channel record meets the company filter");
      const prefMeta = meta("channelPreference", "This channel experience gives a reason to choose the provider (channel record)", "Agree or Strongly agree (4 or 5) among valid 1 to 5 answers about this latest channel experience. Agreement, not satisfaction.");
      const inCompany = (r: Row) => channelFilter.company === null || String(r.company) === channelFilter.company;
      const counts = (code: string | null) => {
        const rows = channel.rows.filter((r) => inCompany(r) && (code === null || String(r.channel) === code) && EMOTIONS.some((e) => {
          const v = cf.emotions[e].status === "found" ? r[(cf.emotions[e] as { variable: string }).variable] : null;
          return typeof v === "number" && v >= 1 && v <= 5;
        }));
        return { records: rows.length, distinctCustomers: new Set(rows.map((r) => String(r.respondent_id))).size };
      };
      const grain = (code: string | null, label: string, column: ColumnRef | null): ChannelGrain => {
        const tbl = column === null ? { notMeasured: `No ${label} records in this population.` } : t;
        const col = column ?? "total";
        return { code, label, emotions: emotionFigures(cf.emotions, tbl, "channel", col), preference: figureOf(prefMeta, cf.preference, tbl, "t2b", col), ...counts(code) };
      };
      const byChannel = cf.channel.answers.map((a) => grain(a.code, channelFilter.channelName(a.code), "questions" in t ? columnOf(t, "channel", a.code) : "total"));
      const why = found(cf.emotionWhy);
      channelOut = {
        status: "ok",
        filename: channel.filename,
        all: grain(null, "All channel records", "total"),
        byChannel,
        verbatims: why ? verbatimsOf(channel.rows, why, cf.emotions, inCompany, (r) => `Latest ${channelFilter.channelName(String(r.channel))} experience`) : [],
      };
    }
  }

  // Customer grain: experience-led preference and reasons for staying (every current customer).
  const reasonsDefault: ExperienceSection["reasons"] = { shares: [], none: { ...meta("stayNone", "None of these", ""), status: "not_measured", reason: "Not measured." }, dontKnow: { ...meta("stayDk", "Do not know", ""), status: "not_measured", reason: "Not measured." }, primary: { ...meta("stayPrimary", "Main reason", ""), status: "not_measured", reason: "Not measured." }, coexist: [] };
  if (!relationship || !rf) {
    const reason = absentReason.relationship ?? "No Relationship file is linked to this wave.";
    return { journey, channel: channelOut, experiencePreference: { ...meta("experiencePreference", "Experiences give a reason to choose the provider", ""), status: "not_measured", reason }, reasons: reasonsDefault };
  }
  const companyFilters = journeyFilters.company !== null ? [codeFilter("company", journeyFilters.company)] : [];
  const reasonVars = [...rf.stayReasons, rf.stayNone, rf.stayDk, rf.stayPrimary, rf.experiencePreference].map(found).filter((x): x is string => !!x);
  const t = reasonVars.length ? await tableOrReason(() => tabulate(tenantId, runId, relationship.documentId, reasonVars, weighting(relationship), companyFilters), "No customers meet the company filter") : { notMeasured: "No reasons-for-staying or experience preference question is in this file." };
  const preferenceVar = found(rf.stayReasons[0]);
  const constraints = [rf.stayReasons[2], rf.stayReasons[3], rf.stayReasons[4]];
  const coexistTable = preferenceVar && constraints.some(found)
    ? await tableOrReason(() => tabulate(tenantId, runId, relationship.documentId, constraints.map(found).filter((x): x is string => !!x), weighting(relationship), companyFilters, preferenceVar), "No customers meet the company filter")
    : { notMeasured: "Genuine preference or the constraints are not in this file." };
  const preferenceColumn = "questions" in coexistTable && preferenceVar ? columnOf(coexistTable, preferenceVar, "1") : null;
  const reasonLabel = (fld: Field, fallback: string) => (fld.status === "found" ? fld.label : fallback);
  return {
    journey,
    channel: channelOut,
    experiencePreference: figureOf(meta("experiencePreference", "Experiences in the past three months give a reason to choose the provider (customer)", "Agree or Strongly agree (4 or 5) among valid 1 to 5 answers, all current customers. Stated experience-led preference: agreement, not satisfaction, not demonstrated choice."), rf.experiencePreference, t, "t2b"),
    reasons: {
      shares: rf.stayReasons.map((fld, i) => figureOf(meta(`stay${i + 1}`, reasonLabel(fld, `Reason ${i + 1}`), "Share of all current customers selecting this reason (multiple response; shares need not add to 100)."), fld, t, "yes")),
      none: figureOf(meta("stayNone", "None of these", "Share of all current customers giving no stated reason (exclusive)."), rf.stayNone, t, "yes"),
      dontKnow: figureOf(meta("stayDk", "Do not know", "Share of all current customers who do not know why they keep using the provider (exclusive)."), rf.stayDk, t, "yes"),
      primary: distributionOf(meta("stayPrimary", "Main reason for continuing use", "One main reason per customer among the reasons they selected; None (97) and Do not know (99) carried from the exclusive answers."), rf.stayPrimary, t, rf.stayPrimary.status === "found" ? rf.stayPrimary.answers.map((a) => a.code) : null),
      coexist: constraints.map((fld, i) =>
        figureOf(
          meta(`coexist${i + 3}`, `Also cite: ${reasonLabel(fld, `reason ${i + 3}`)}`, "Among customers selecting genuine preference, the share also selecting this constraint. Preference and constraint can coexist."),
          fld,
          preferenceColumn === null ? ("questions" in coexistTable ? { notMeasured: "No customer selected genuine preference in this population." } : coexistTable) : coexistTable,
          "yes",
          preferenceColumn ?? "total",
        ),
      ),
    },
  };
}
