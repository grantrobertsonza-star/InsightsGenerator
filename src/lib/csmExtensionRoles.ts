// R6 CSM extension (Grant, 30 October 2026; fixtures/packs-2026-10-30/csm, Banking_ and
// Telecoms_CSM_Claude_Instructions.docx): which CSM data grain a file is, and which of the extension's
// constructs (journey continuity, emotions, experience-led preference, reasons for staying, the customer
// benchmark and the focal-noncustomer profile) it measures. The contract is claude/csm-extension.md.
//
// Grain (workbook family). The pack ships three families per wave, imported as separate data files:
//   - Relationship ("Respondents" sheet): one current customer rating one main provider.
//   - Channel ("Experiences" sheet): the latest experience per customer per used channel in 30 days.
//   - Noncustomer ("Noncustomers" sheet): an independent supplement of focal-provider noncustomers.
// The grain is derived here from the file itself, never from a source column (the pack has no sample_type
// column): the structure decides (a channel file has experience_id and channel; a noncustomer file has
// current_focal_use and focal_company), and the data sheet's name, when it is one of the three, must agree.
// A disagreement, or no customer key, is "unknown" with the reason; nothing is computed on a guess.
// sample_type follows from the grain: Relationship and Channel are Current customers, Noncustomer is
// Focal noncustomers. The three are never one population.
//
// Constructs are found by the variable names of the pack's codebook, each confirmed by its answer list (a
// 1 to 5 intensity scale must declare codes 1 to 5, an outcome must declare its pending code 9, and so on).
// A name with a different answer list, or no answer list, is "not measured" with the reason, never read on a
// guess. A file without a construct (the earlier CSM fixtures, a raw file) shows that construct as Not measured.
// Recognising the same constructs from wording alone in other files is not done (open question for Grant).
import type { RoleVariable } from "./trackerRoles";

export type CsmGrain = "relationship" | "channel" | "noncustomer";
export type CsmSampleType = "current_customers" | "focal_noncustomers";

export const SAMPLE_TYPE_OF: Record<CsmGrain, CsmSampleType> = { relationship: "current_customers", channel: "current_customers", noncustomer: "focal_noncustomers" };
export const SAMPLE_TYPE_TEXT: Record<CsmSampleType, string> = { current_customers: "Current customers", focal_noncustomers: "Focal noncustomers" };
export const GRAIN_TEXT: Record<CsmGrain, string> = {
  relationship: "Relationship (one current customer)",
  channel: "Channel (latest experience per customer per channel)",
  noncustomer: "Noncustomer supplement (focal-provider noncustomers)",
};

/** The data sheet names the pack uses for each family (first data sheet only). */
const SHEET_GRAIN: Record<string, CsmGrain> = { respondents: "relationship", experiences: "channel", noncustomers: "noncustomer" };

export type GrainReading = { grain: CsmGrain; sampleType: CsmSampleType; evidence: string } | { grain: null; reason: string };

/**
 * The grain of one data file from its variables and the sheet the reader used. Pure.
 *   channel: experience_id and channel present (the channel record key and its dimension);
 *   noncustomer: current_focal_use and focal_company present (the supplement's screening fields);
 *   relationship: neither, with respondent_id present.
 * Both markers, no respondent_id, or a sheet named for another family: unknown, with the reason.
 */
export function csmGrainOf(variableNames: Iterable<string>, sheetName: string | null): GrainReading {
  const names = new Set(variableNames);
  const isChannel = names.has("experience_id") && names.has("channel");
  const isNoncustomer = names.has("current_focal_use") && names.has("focal_company");
  if (!names.has("respondent_id")) return { grain: null, reason: "The file has no respondent_id, so its records cannot be keyed to customers." };
  if (isChannel && isNoncustomer) return { grain: null, reason: "The file has both channel record fields (experience_id, channel) and noncustomer screening fields (current_focal_use, focal_company), so its grain is unclear." };
  const structural: CsmGrain = isChannel ? "channel" : isNoncustomer ? "noncustomer" : "relationship";
  const fromSheet = sheetName ? SHEET_GRAIN[sheetName.trim().toLowerCase()] : undefined;
  if (fromSheet && fromSheet !== structural) {
    return { grain: null, reason: `The data sheet "${sheetName}" names the ${fromSheet} family, but the file's fields are those of the ${structural} family.` };
  }
  const blocks = channelBlocksOf(names);
  const evidence =
    structural === "channel"
      ? "experience_id and channel fields"
      : structural === "noncustomer"
        ? "current_focal_use and focal_company fields"
        : blocks.length
          ? `one record per respondent_id with channel blocks ${blocks.map(blockPrefix).join(", ")} (combined company and channel file)`
          : "one record per respondent_id, no channel or noncustomer fields";
  return { grain: structural, sampleType: SAMPLE_TYPE_OF[structural], evidence: fromSheet ? `${evidence}; data sheet "${sheetName}"` : evidence };
}

// ---- Fields ---------------------------------------------------------------------------------------------------

/** What a field's answer list must declare. */
export type FieldKind =
  | { kind: "scale"; lo: number; hi: number } // a rating, intensity or agreement scale: every code lo..hi labelled
  | { kind: "binary" } // 0/1
  | { kind: "codes"; required: number[] } // a categorical answer list declaring at least these codes
  | { kind: "number" } // a count or a number of days, read as numbers
  | { kind: "text" }; // free text or an ordered code string, read as written

export type FieldFound = { status: "found"; variable: string; label: string; answers: { code: string; label: string }[] };
export type FieldMissing = { status: "not_measured"; variable: string; reason: string };
export type Field = FieldFound | FieldMissing;

const codeOrder = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

/** One field of the pack's codebook found in a file and checked against what its answer list must declare. Pure. */
export function fieldOf(variables: RoleVariable[], name: string, expect: FieldKind): Field {
  const v = variables.find((x) => x.name === name);
  if (!v) return { status: "not_measured", variable: name, reason: `${name} is not in this file.` };
  const labels = v.valueLabels ?? {};
  const answers = Object.keys(labels).sort(codeOrder).map((code) => ({ code, label: labels[code] }));
  const found: FieldFound = { status: "found", variable: name, label: v.label || name, answers };
  const declared = new Set(Object.keys(labels).map((c) => Number(c)).filter((n) => Number.isFinite(n)));
  const lacks = (codes: number[]) => codes.filter((c) => !declared.has(c));
  switch (expect.kind) {
    case "text":
      return found;
    case "number":
      return v.numeric ? found : { status: "not_measured", variable: name, reason: `${name} is not read as numbers in this file.` };
    case "binary": {
      if (!v.numeric) return { status: "not_measured", variable: name, reason: `${name} is not read as numbers in this file.` };
      // A 0/1 flag may carry no answer list (an MR member with "1 Selected" in its set only); its values decide.
      if (answers.length === 0) return v.distinct !== undefined && v.distinct <= 2 ? found : { status: "not_measured", variable: name, reason: `${name} has no answer list and holds more than two values, so it is not a 0/1 answer.` };
      // Its answers (non-answer codes 90 and up aside) are 0 and 1, or one of them: a screening field whose other
      // answer was screened out (current_focal_use declares only 0 No in the noncustomer supplement).
      const answerCodes = [...declared].filter((c) => c < 90);
      return answerCodes.length > 0 && answerCodes.every((c) => c === 0 || c === 1) ? found : { status: "not_measured", variable: name, reason: `${name}'s answer list declares ${answerCodes.join(", ") || "no answer"}, so it is not read as a 0/1 answer.` };
    }
    case "scale": {
      if (!v.numeric) return { status: "not_measured", variable: name, reason: `${name} is not read as numbers in this file.` };
      const want = Array.from({ length: expect.hi - expect.lo + 1 }, (_, i) => expect.lo + i);
      if (answers.length === 0) return { status: "not_measured", variable: name, reason: `${name} has no answer list, so its ${expect.lo} to ${expect.hi} scale is not stated.` };
      const missing = lacks(want);
      return missing.length === 0 ? found : { status: "not_measured", variable: name, reason: `${name}'s answer list does not declare the ${expect.lo} to ${expect.hi} scale (missing ${missing.join(", ")}).` };
    }
    case "codes": {
      if (answers.length === 0) return { status: "not_measured", variable: name, reason: `${name} has no answer list.` };
      const missing = lacks(expect.required);
      return missing.length === 0 ? found : { status: "not_measured", variable: name, reason: `${name}'s answer list does not declare code${missing.length === 1 ? "" : "s"} ${missing.join(", ")}.` };
    }
  }
}

/** The six emotions (the second pack of 30 October 2026 added angry and disappointed), kept separate: never inverted
 * or combined into an index. A file from the first pack has four; the other two are Not measured there. */
export const EMOTIONS = ["reassured", "valued", "frustrated", "anxious", "angry", "disappointed"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const EMOTION_TEXT: Record<Emotion, string> = { reassured: "Reassured", valued: "Valued", frustrated: "Frustrated", anxious: "Anxious", angry: "Angry", disappointed: "Disappointed" };
/** High intensity (4 or 5) of these is a negative outcome, never a favourable one. */
export const NEGATIVE_EMOTIONS: readonly Emotion[] = ["frustrated", "anxious", "angry", "disappointed"];

const SCALE5: FieldKind = { kind: "scale", lo: 1, hi: 5 };
const BINARY: FieldKind = { kind: "binary" };
const CHANNEL_CODES = [1, 2, 3, 4];

/** The extension's fields in a Relationship (customer) file. */
export function relationshipFields(variables: RoleVariable[]) {
  const f = (name: string, k: FieldKind) => fieldOf(variables, name, k);
  return {
    company: f("company", { kind: "codes", required: [] }),
    companyCsat: f("company_csat5", SCALE5),
    recent: f("journey_recent30", BINARY),
    task: f("journey_task", { kind: "codes", required: [] }),
    sequence: f("journey_sequence", { kind: "text" }),
    contacts: f("journey_contacts", { kind: "number" }),
    journeyChannels: CHANNEL_CODES.map((c) => f(`journey_channel_c0${c}`, BINARY)),
    multichannel: f("journey_multichannel", BINARY),
    digitalMode: f("journey_digital_mode", { kind: "codes", required: [1, 2] }),
    transferred: f("journey_transferred", BINARY),
    repeatInfo: f("journey_repeat_info", BINARY),
    status: f("journey_status", { kind: "codes", required: [1, 2, 3, 9] }),
    completed: f("journey_completed", BINARY),
    journeyCsat: f("journey_csat5", SCALE5),
    journeyEmotions: Object.fromEntries(EMOTIONS.map((e) => [e, f(`journey_${e}5`, SCALE5)])) as Record<Emotion, Field>,
    journeyEmotionWhy: f("journey_emotion_why_text", { kind: "text" }),
    journeyPreference: f("journey_preference5", SCALE5),
    experiencePreference: f("experience_preference5", SCALE5),
    stayReasons: [1, 2, 3, 4, 5, 6].map((r) => f(`stay_reason_r0${r}`, BINARY)),
    stayNone: f("stay_none", BINARY),
    stayDk: f("stay_dk", BINARY),
    stayPrimary: f("stay_primary", { kind: "codes", required: [1, 2, 3, 4, 5, 6] }),
    benchmarkRecent: f("benchmark_recent_same_task30", BINARY),
    benchmarkProvider: f("benchmark_provider", { kind: "codes", required: [] }),
    benchmarkTask: f("benchmark_task", { kind: "codes", required: [] }),
    benchmarkDays: f("benchmark_days_ago", { kind: "number" }),
    benchmarkChannel: f("benchmark_channel", { kind: "codes", required: [] }),
    benchmarkCsat: f("benchmark_csat5", SCALE5),
    benchmarkGap: f("benchmark_gap5", { kind: "number" }),
    drivers: [1, 2, 3, 4, 5, 6].map((d) => f(`company_driver_d0${d}`, SCALE5)),
    importance: [1, 2, 3, 4, 5, 6].map((d) => f(`importance_d0${d}`, SCALE5)),
  };
}
export type RelationshipFields = ReturnType<typeof relationshipFields>;

/** The extension's fields of a latest channel experience: in a Channel file (no prefix), or in one channel block of
 * a combined file (prefix ch01_ to ch04_, the block's channel code). */
export function channelFields(variables: RoleVariable[], prefix = "") {
  const f = (name: string, k: FieldKind) => fieldOf(variables, `${prefix}${name}`, k);
  return {
    channel: f("channel", { kind: "codes", required: [] }),
    company: fieldOf(variables, "company", { kind: "codes", required: [] }),
    experienceId: f("experience_id", { kind: "text" }),
    emotions: Object.fromEntries(EMOTIONS.map((e) => [e, f(`channel_${e}5`, SCALE5)])) as Record<Emotion, Field>,
    emotionWhy: f("channel_emotion_why_text", { kind: "text" }),
    preference: f("channel_preference5", SCALE5),
  };
}
export type ChannelFields = ReturnType<typeof channelFields>;

/** The channel blocks of a combined file (company and channel answers on one customer row, the combined pack): the
 * codes k with a ch0k_channel field, in code order. Empty for any other file. */
export function channelBlocksOf(variableNames: Iterable<string>): string[] {
  const out: string[] = [];
  for (const n of variableNames) {
    const m = /^ch0(\d)_channel$/.exec(n);
    if (m) out.push(m[1]);
  }
  return out.sort();
}
export const blockPrefix = (code: string) => `ch0${code}_`;
/** The fields of the focal-noncustomer supplement. */
export function noncustomerFields(variables: RoleVariable[]) {
  const f = (name: string, k: FieldKind) => fieldOf(variables, name, k);
  return {
    company: f("company", { kind: "codes", required: [] }),
    focalCompany: f("focal_company", { kind: "codes", required: [] }),
    currentFocalUse: f("current_focal_use", BINARY),
    awareness: f("focal_awareness", BINARY),
    consider: f("focal_consider5", SCALE5),
    preferredChannel: f("expect_preferred_channel", { kind: "codes", required: [] }),
    expectLevel: [1, 2, 3, 4, 5, 6].map((d) => f(`expect_level_d0${d}`, SCALE5)),
    expectImportance: [1, 2, 3, 4, 5, 6].map((d) => f(`expect_importance_d0${d}`, SCALE5)),
    alternativeRecent: f("alternative_recent30", BINARY),
    alternativeTask: f("alternative_task", { kind: "codes", required: [] }),
    alternativeDays: f("alternative_days_ago", { kind: "number" }),
    alternativeChannel: f("alternative_channel", { kind: "codes", required: [] }),
    alternativeCsat: f("alternative_csat5", SCALE5),
  };
}
export type NoncustomerFields = ReturnType<typeof noncustomerFields>;

/** The extension's own fields by the pack's codebook names: journey (J), benchmark (B), experience and channel
 * preference, emotions, reasons for staying and the noncustomer supplement. The existing CSM recogniser never reads
 * them as a company role (trackerRoles.recogniseTracker). */
const EXTENSION_FIELD =
  /^(journey_(recent30|id|task|start_days_ago|last_days_ago|channel_c\d+|digital_mode|sequence|contacts|multichannel|transferred|repeat_info|status|completed|csat5|reassured5|valued5|frustrated5|anxious5|angry5|disappointed5|emotion_why_text|preference5)|benchmark_(recent_same_task30|provider|task|days_ago|channel|csat5|gap5)|stay_reason_r\d+|stay_(none|dk|primary)|experience_preference5|(ch\d\d_)?channel_(reassured|valued|frustrated|anxious|angry|disappointed|preference)5|(ch\d\d_)?channel_emotion_why_text|focal_(company|awareness|consider5)|current_focal_use|expect_(preferred_channel|level_d\d+|importance_d\d+|reason_text)|alternative_(recent30|task|days_ago|channel|csat5))$/;
export const isCsmExtensionField = (name: string) => EXTENSION_FIELD.test(name);

/** The found variable's name, or null. */
export const found = (f: Field): string | null => (f.status === "found" ? f.variable : null);
