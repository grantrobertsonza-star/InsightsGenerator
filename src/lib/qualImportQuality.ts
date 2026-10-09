// Import-stage data quality for a transcript (interview or focus group), read
// before any coding. Pure functions over speaker segments: no model calls, no
// database. These describe how usable the file is as evidence. Whether the
// coding is sound, and whether the sample has saturated, is judged later under
// Coding (see qualQuality.ts) because that needs the codes.

import {
  countWords,
  spread,
  THIN_WORDS,
  type QualitySegment,
  type Spread,
} from "./qualQuality";
import type { QualityStatus } from "./dataQuality";

export type ImportQualityCheck = {
  id: string;
  label: string;
  status: QualityStatus;
  detail: string;
};

export type RespondentLine = {
  label: string;
  turns: number;
  words: number;
  share: number; // of all labelled participant words
};

export type TranscriptImportQuality = {
  sessionType: "individual" | "focus_group";
  respondents: number;
  respondentLines: RespondentLine[]; // longest first
  participantTurns: number;
  moderatorTurns: number;
  unlabelledTurns: number;
  totalWords: number;
  participantWords: number;
  moderatorWordShare: number | null;
  wordsPerRespondent: Spread | null;
  wordsPerParticipantTurn: Spread | null;
  thinRespondents: { label: string; words: number }[];
  topSpeakerShare: number | null;
  topThreeShare: number | null;
  quietRespondents: { label: string; turns: number }[]; // focus groups only
  duplicateTurns: number;
  longestParticipantTurnWords: number;
  monologues: number;
  questions: {
    asked: number;
    open: number;
    closed: number;
    other: number;
    leading: number;
    closedShare: number | null; // of open + closed
    shortAnswerShare: number | null; // answers under SHORT_ANSWER_WORDS to a moderator question
    answered: number;
    medianAnswerWords: number | null;
  };
  markers: { inaudible: number; per1000Words: number | null };
  timestamps: { lines: number; share: number | null };
  profiles: { respondentsWithProfile: number; fields: string[] };
  confusableLabels: { a: string; b: string }[];
  moderatorLookingParticipants: string[];
  /** Words the open-coding pass would have to read, for the length check. */
  codingInputChars: number;
  checks: ImportQualityCheck[];
  status: QualityStatus;
  notes: string[];
};

// Plain, visible thresholds so a researcher can argue with them.
export const MODERATOR_SHARE_WARN = 0.4;
export const MODERATOR_SHARE_FAIL = 0.6;
export const UNLABELLED_WARN = 0.1;
export const UNLABELLED_FAIL = 0.3;
export const THIN_RESPONDENT_WARN = 0.25;
export const DOMINANCE_WARN = 0.5;
export const DOMINANCE_FAIL = 0.7;
export const MONOLOGUE_WORDS = 400;
export const SHORT_ANSWER_WORDS = 10;
export const SHORT_ANSWER_WARN = 0.4;
export const CLOSED_WARN = 0.5;
export const QUIET_TURNS = 3;
export const INAUDIBLE_PER_1000_WARN = 2;
export const OPEN_CODING_MAX_CHARS = 60000; // mirrors extractThemes.ts

const MODERATOR_NAME =
  /^(moderator|interviewer|facilitator|researcher|host|mod|int|interviewer\s*\d*|moderator\s*\d*|m)$/i;

const OPEN_STEM =
  /^(?:(?:so|and|okay|ok|right|now|then|well|alright)[,\s]+)*(what|how|why|tell|describe|explain|walk|talk|take me|help me|in what way|which|where|when|who|can you (?:tell|describe|explain|walk|talk)|could you (?:tell|describe|explain|walk|talk)|would you (?:tell|describe|explain|walk|talk))\b/i;
const CLOSED_STEM =
  /^(?:(?:so|and|okay|ok|right|now|then|well|alright)[,\s]+)*(do|does|did|is|are|was|were|have|has|had|can|could|would|will|should|shall|isn't|aren't|wasn't|don't|doesn't|didn't|wouldn't|won't|haven't)\b/i;
const LEADING =
  /\b(don't you|doesn't it|isn't it|aren't you|wouldn't you|wouldn't it|didn't you|surely|obviously|of course)\b|,\s*(right|yes|correct|no|isn't it|don't you)\s*\?$/i;
const INAUDIBLE =
  /[\[(](?:inaudible|unclear|crosstalk|cross-talk|indistinct|unintelligible|overlapping|redacted)[^\])]*[\])]/gi;
const TIMESTAMP_LINE = /^\s*[\[(]?\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?[\])]?(?:\s|$)/;

function questionsIn(text: string): string[] {
  // Split on sentence ends, keep those ending in a question mark.
  const out: string[] = [];
  const parts = text.replace(/\s+/g, " ").match(/[^.!?]*[.!?]+|[^.!?]+$/g) ?? [];
  for (const p of parts) {
    const s = p.trim();
    if (s.endsWith("?")) out.push(s);
  }
  return out;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function norm(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function computeTranscriptImportQuality(input: {
  segments: QualitySegment[];
  sessionType: "individual" | "focus_group";
  /** Profile lines found by the reader, one entry per respondent. */
  profiles?: { speaker: string; fields: Record<string, string> }[];
  /** The raw extracted text, for timestamp counting. */
  rawText?: string | null;
}): TranscriptImportQuality {
  const { segments, sessionType } = input;
  const notes: string[] = [];
  const participants = segments.filter((s) => s.role !== "moderator");
  const moderators = segments.filter((s) => s.role === "moderator");
  const words = (s: QualitySegment) => countWords(s.text);

  const pWords = participants.reduce((n, s) => n + words(s), 0);
  const mWords = moderators.reduce((n, s) => n + words(s), 0);
  const totalWords = pWords + mWords;
  const moderatorWordShare = totalWords > 0 && moderators.length > 0 ? mWords / totalWords : null;

  // Respondents in order of first speech.
  const order: string[] = [];
  const perWords = new Map<string, number>();
  const perTurns = new Map<string, number>();
  for (const s of participants) {
    if (!s.speaker) continue;
    if (!perWords.has(s.speaker)) {
      perWords.set(s.speaker, 0);
      perTurns.set(s.speaker, 0);
      order.push(s.speaker);
    }
    perWords.set(s.speaker, (perWords.get(s.speaker) ?? 0) + words(s));
    perTurns.set(s.speaker, (perTurns.get(s.speaker) ?? 0) + 1);
  }
  const labelledWords = order.reduce((n, r) => n + (perWords.get(r) ?? 0), 0);
  const respondentLines: RespondentLine[] = order
    .map((r) => ({
      label: r,
      turns: perTurns.get(r) ?? 0,
      words: perWords.get(r) ?? 0,
      share: labelledWords > 0 ? (perWords.get(r) ?? 0) / labelledWords : 0,
    }))
    .sort((a, b) => b.words - a.words);
  const desc = respondentLines.map((r) => r.words);
  const topShare = (n: number) =>
    labelledWords > 0 ? desc.slice(0, n).reduce((a, b) => a + b, 0) / labelledWords : null;

  const unlabelledTurns = participants.filter((s) => !s.speaker).length;
  const thinRespondents = respondentLines
    .filter((r) => r.words < THIN_WORDS)
    .map((r) => ({ label: r.label, words: r.words }));
  const quietRespondents =
    sessionType === "focus_group"
      ? respondentLines.filter((r) => r.turns < QUIET_TURNS).map((r) => ({ label: r.label, turns: r.turns }))
      : [];

  const seen = new Set<string>();
  let duplicateTurns = 0;
  for (const s of participants) {
    const key = `${s.speaker ?? ""}|${s.text.trim().toLowerCase()}`;
    if (s.text.trim().length > 0 && seen.has(key)) duplicateTurns += 1;
    seen.add(key);
  }

  const turnWords = participants.map(words);
  const longest = turnWords.length ? Math.max(...turnWords) : 0;
  const monologues = turnWords.filter((w) => w >= MONOLOGUE_WORDS).length;

  // Questions and what followed them.
  let asked = 0, open = 0, closed = 0, other = 0, leading = 0;
  for (const m of moderators) {
    for (const q of questionsIn(m.text)) {
      asked += 1;
      const body = q.replace(/^["'“‘\s]+/, "");
      if (LEADING.test(body)) leading += 1;
      if (OPEN_STEM.test(body)) open += 1;
      else if (CLOSED_STEM.test(body)) closed += 1;
      else other += 1;
    }
  }
  const answerWords: number[] = [];
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  let awaiting = false;
  for (const s of ordered) {
    if (s.role === "moderator") {
      awaiting = questionsIn(s.text).length > 0;
    } else if (awaiting) {
      answerWords.push(words(s));
      awaiting = false;
    }
  }
  const classified = open + closed;

  // Markers of lost evidence.
  const allText = segments.map((s) => s.text).join("\n");
  const inaudible = (allText.match(INAUDIBLE) ?? []).length;

  // Timestamps, from the raw text because segments strip them.
  let tsLines = 0;
  let nonEmpty = 0;
  if (input.rawText) {
    for (const line of input.rawText.split(/\r?\n/)) {
      if (!line.trim()) continue;
      nonEmpty += 1;
      if (TIMESTAMP_LINE.test(line)) tsLines += 1;
    }
  }

  // Labels that are probably the same person written two ways.
  const confusable: { a: string; b: string }[] = [];
  const byNorm = new Map<string, string>();
  for (const r of order) {
    const k = norm(r);
    if (!k) continue;
    const prev = byNorm.get(k);
    if (prev && prev !== r) confusable.push({ a: prev, b: r });
    else byNorm.set(k, r);
  }
  const moderatorLooking = order.filter((r) => MODERATOR_NAME.test(r.trim()));

  const profileList = input.profiles ?? [];
  const fieldSet = new Set<string>();
  for (const p of profileList) for (const f of Object.keys(p.fields)) fieldSet.add(f);

  // What the open-coding pass would read (lines of "speaker: text").
  const codingInputChars = segments.reduce(
    (n, s) => n + s.text.length + (s.speaker ? s.speaker.length + 2 : 0) + 1,
    0,
  );

  const respondents = order.length;
  const checks: ImportQualityCheck[] = [];
  const add = (id: string, label: string, status: QualityStatus, detail: string) =>
    checks.push({ id, label, status, detail });

  // Respondents.
  if (respondents === 0) {
    add("respondents", "Respondents found", "fail", "No speakers were detected, so respondents cannot be counted and every theme would come from an unknown speaker. Check the layout choice above.");
  } else if (sessionType === "focus_group" && respondents === 1) {
    add("respondents", "Respondents found", "warn", "Only one respondent was found in a focus group. Speaker labels may be missing or the layout choice may be wrong.");
  } else if (sessionType === "individual" && respondents > 1) {
    add("respondents", "Respondents found", "warn", `${respondents} respondents were found in a file set up as an individual interview. If it holds several interviews, the counts below describe all of them together.`);
  } else {
    add("respondents", "Respondents found", "pass", `${respondents} respondent${respondents === 1 ? "" : "s"}, ${participants.length} participant turn${participants.length === 1 ? "" : "s"}, ${moderators.length} moderator turn${moderators.length === 1 ? "" : "s"}.`);
  }

  // Unlabelled turns.
  if (participants.length > 0) {
    const share = unlabelledTurns / participants.length;
    add("unlabelled", "Turns without a speaker",
      share > UNLABELLED_FAIL ? "fail" : share > UNLABELLED_WARN || unlabelledTurns > 0 && respondents === 0 ? "warn" : "pass",
      unlabelledTurns === 0 ? "Every participant turn has a speaker." : `${unlabelledTurns} of ${participants.length} participant turns (${pct(share)}) have no speaker, usually text before the first label.`);
  }

  // Label problems.
  if (confusable.length > 0 || moderatorLooking.length > 0) {
    const parts: string[] = [];
    if (confusable.length > 0) parts.push(`possible duplicates: ${confusable.slice(0, 3).map((c) => `"${c.a}" and "${c.b}"`).join(", ")}`);
    if (moderatorLooking.length > 0) parts.push(`counted as respondents but look like the moderator: ${moderatorLooking.slice(0, 3).map((m) => `"${m}"`).join(", ")}`);
    add("labels", "Speaker labels", "warn", `Check ${parts.join("; ")}.`);
  } else if (respondents > 0) {
    add("labels", "Speaker labels", "pass", "No look-alike labels, and no moderator-style names among the respondents.");
  }

  // Moderator share.
  if (moderators.length === 0) {
    add("moderator", "Moderator word share", "warn", "No moderator or interviewer turns were found. If the file contains questions, they are being treated as participant speech.");
  } else if (moderatorWordShare !== null) {
    add("moderator", "Moderator word share",
      moderatorWordShare > MODERATOR_SHARE_FAIL ? "fail" : moderatorWordShare > MODERATOR_SHARE_WARN ? "warn" : "pass",
      `${pct(moderatorWordShare)} of the words are the moderator's.${moderatorWordShare > MODERATOR_SHARE_WARN ? " Over 40% can mean leading questions, or that turns were split wrongly." : ""}`);
  }

  // Thin respondents.
  if (respondents > 0) {
    const share = thinRespondents.length / respondents;
    add("thin", "Thin respondents", share > THIN_RESPONDENT_WARN ? "warn" : "pass",
      thinRespondents.length === 0
        ? `No respondent has under ${THIN_WORDS} words.`
        : `${thinRespondents.length} of ${respondents} respondents have under ${THIN_WORDS} words: ${thinRespondents.slice(0, 4).map((t) => `${t.label} (${t.words})`).join(", ")}${thinRespondents.length > 4 ? ", ..." : ""}.`);
  }

  // Dominance.
  if (respondents >= 3) {
    const top = topShare(1) ?? 0;
    add("dominance", "Who does the talking",
      top > DOMINANCE_FAIL ? "fail" : top > DOMINANCE_WARN ? "warn" : "pass",
      `The most talkative respondent supplies ${pct(top)} of participant words and the top three ${pct(topShare(3) ?? 0)}.${top > DOMINANCE_WARN ? " Themes may mostly reflect that person." : ""}`);
  }
  if (sessionType === "focus_group" && respondents >= 3) {
    add("quiet", "Quiet group members", quietRespondents.length > 0 ? "warn" : "pass",
      quietRespondents.length === 0
        ? `Every respondent spoke at least ${QUIET_TURNS} times.`
        : `${quietRespondents.length} respondent${quietRespondents.length === 1 ? "" : "s"} spoke fewer than ${QUIET_TURNS} times: ${quietRespondents.slice(0, 4).map((q) => `${q.label} (${q.turns})`).join(", ")}${quietRespondents.length > 4 ? ", ..." : ""}.`);
  }

  // Duplicates and monologues.
  add("duplicates", "Duplicate turns", duplicateTurns > 0 ? "warn" : "pass",
    duplicateTurns === 0 ? "No repeated turns." : `${duplicateTurns} participant turn${duplicateTurns === 1 ? " repeats" : "s repeat"} an earlier one word for word. Often a pasting or export fault.`);
  if (participants.length > 0) {
    add("monologues", "Very long turns", monologues > 0 ? "warn" : "pass",
      monologues === 0 ? `The longest participant turn is ${longest.toLocaleString()} words.` : `${monologues} participant turn${monologues === 1 ? " runs" : "s run"} to ${MONOLOGUE_WORDS}+ words (longest ${longest.toLocaleString()}). These can be several speakers merged.`);
  }

  // Questions.
  if (moderators.length > 0) {
    const closedShare = classified > 0 ? closed / classified : null;
    const shortShare = answerWords.length > 0 ? answerWords.filter((w) => w < SHORT_ANSWER_WORDS).length / answerWords.length : null;
    const bits = [`${asked} question${asked === 1 ? "" : "s"} asked`];
    if (classified > 0) bits.push(`${open} open, ${closed} closed${other > 0 ? `, ${other} other` : ""}`);
    if (leading > 0) bits.push(`${leading} that look leading`);
    const warn = (closedShare !== null && closedShare > CLOSED_WARN) || leading > 0 || (shortShare !== null && shortShare > SHORT_ANSWER_WARN);
    add("questions", "Questions asked", asked === 0 ? "warn" : warn ? "warn" : "pass",
      asked === 0 ? "The moderator has turns but none contain a question mark." : `${bits.join(", ")}.${closedShare !== null && closedShare > CLOSED_WARN ? " More than half are closed, which tends to draw short answers." : ""}${shortShare !== null && shortShare > SHORT_ANSWER_WARN ? ` ${pct(shortShare)} of first answers are under ${SHORT_ANSWER_WORDS} words.` : ""} Counted from question marks and opening words, so treat as a guide.`);
  }

  // Lost evidence markers.
  const per1000 = totalWords > 0 ? (inaudible / totalWords) * 1000 : null;
  add("markers", "Inaudible or crosstalk markers", per1000 !== null && per1000 > INAUDIBLE_PER_1000_WARN ? "warn" : "pass",
    inaudible === 0 ? "None found." : `${inaudible} marker${inaudible === 1 ? "" : "s"} (${(per1000 ?? 0).toFixed(1)} per 1,000 words). Each is a place where evidence was lost.`);

  // Length for coding.
  add("length", "Length for coding", codingInputChars > OPEN_CODING_MAX_CHARS ? "warn" : "pass",
    codingInputChars > OPEN_CODING_MAX_CHARS
      ? `About ${codingInputChars.toLocaleString()} characters, more than the ${OPEN_CODING_MAX_CHARS.toLocaleString()} one open-coding pass reads, so themes may reflect only part of the file.`
      : `About ${totalWords.toLocaleString()} words, which fits in one open-coding pass.`);

  // Profiles and timestamps are informational.
  if (respondents > 0) {
    const have = profileList.filter((p) => order.includes(p.speaker)).length;
    add("profiles", "Respondent profile lines",
      have > 0 && have < respondents ? "warn" : "pass",
      have === 0 ? "No profile lines (age, sex and so on) were found, so themes cannot be compared across groups of respondents." : `${have} of ${respondents} respondents have profile lines (${[...fieldSet].slice(0, 6).join(", ")}${fieldSet.size > 6 ? ", ..." : ""}).`);
  }
  if (input.rawText && nonEmpty > 0) {
    add("timestamps", "Timestamps", "pass",
      tsLines === 0 ? "None found. That is fine, but airtime and pacing cannot be checked." : `${tsLines} timestamped lines (${pct(tsLines / nonEmpty)} of lines).`);
  }

  if (respondents > 0 && respondents < 5 && sessionType === "individual") {
    notes.push("A handful of interviews can still be informative, but counts of respondents per theme will be small.");
  }

  const status: QualityStatus = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "pass";

  return {
    sessionType,
    respondents,
    respondentLines,
    participantTurns: participants.length,
    moderatorTurns: moderators.length,
    unlabelledTurns,
    totalWords,
    participantWords: pWords,
    moderatorWordShare,
    wordsPerRespondent: spread(order.map((r) => perWords.get(r) ?? 0)),
    wordsPerParticipantTurn: spread(turnWords),
    thinRespondents,
    topSpeakerShare: topShare(1),
    topThreeShare: topShare(3),
    quietRespondents,
    duplicateTurns,
    longestParticipantTurnWords: longest,
    monologues,
    questions: {
      asked, open, closed, other, leading,
      closedShare: classified > 0 ? closed / classified : null,
      shortAnswerShare: answerWords.length > 0 ? answerWords.filter((w) => w < SHORT_ANSWER_WORDS).length / answerWords.length : null,
      answered: answerWords.length,
      medianAnswerWords: median(answerWords),
    },
    markers: { inaudible, per1000Words: per1000 },
    timestamps: { lines: tsLines, share: nonEmpty > 0 ? tsLines / nonEmpty : null },
    profiles: { respondentsWithProfile: profileList.filter((p) => order.includes(p.speaker)).length, fields: [...fieldSet] },
    confusableLabels: confusable,
    moderatorLookingParticipants: moderatorLooking,
    codingInputChars,
    checks,
    status,
    notes,
  };
}
