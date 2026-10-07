import { createHash } from "node:crypto";

// Pure helpers for the transcript coding pipeline (extractThemes.ts): turn a
// transcript into speaker segments, check a quote against those segments,
// merge the themes from repeated coding runs into a codebook, and batch the
// segments for applying it. No model calls and no database here, so all of
// it can be tested directly.

export type SegmentRole = "participant" | "moderator" | "unknown";

export type TranscriptSegment = {
  index: number;
  speaker: string | null;
  role: SegmentRole;
  text: string;
};

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// --- Segmenting -------------------------------------------------------

export const MAX_SEGMENT_CHARS = 1200;

// "Moderator:", "Interviewer:", "Q:", "[00:01:12] Facilitator:" and so on.
const LABEL_LINE =
  /^\s*(?:[[(]?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?[\])]?\s*)?([A-Za-z][A-Za-z0-9 .'_-]{0,39}?)\s*:\s+(\S.*)$/;

// "Interview 1", "Interview 2 Transcript", "Respondent 3", "Participant #4".
const RESPONDENT_HEADING =
  /^(Interview(?:ee)?|Respondent|Participant|Case)\s*#?(\d{1,3})\b(?:\s+(?:transcript|notes?|summary))?\s*$/i;

const MODERATOR_LABEL =
  /^(moderator|interviewer|facilitator|researcher|host|mod|int|m|q)\b/i;

// Once a transcript is clearly labelled, a speaker who talks only once still
// needs to count as a speaker. A label qualifies if it reads like a name or a
// role: at most three words, each starting with a capital letter or a digit
// ("Thandi", "Participant 3", "Dr Smith"). Prose such as "the reason:" does not.
function isNameLike(label: string): boolean {
  const words = label.trim().split(/\s+/);
  return words.length <= 3 && words.every((w) => /^[A-Z0-9]/.test(w));
}

function roleFor(speaker: string | null): SegmentRole {
  if (speaker === null) return "unknown";
  return MODERATOR_LABEL.test(speaker.trim()) ? "moderator" : "participant";
}

function splitLongText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (current && current.length + 1 + sentence.length > limit) {
      parts.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) parts.push(current);
  // A single sentence longer than the limit is cut at a word boundary, so
  // every piece is still a verbatim stretch of the original.
  const out: string[] = [];
  for (const part of parts) {
    let rest = part;
    while (rest.length > limit) {
      const cut = rest.lastIndexOf(" ", limit);
      const at = cut > limit / 2 ? cut : limit;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export type SegmentMode =
  "auto" | "labels" | "headings" | "sessions" | "paragraphs" | "none";
export type ResolvedSegmentMode = Exclude<SegmentMode, "auto">;
export const SEGMENT_MODES: SegmentMode[] = [
  "auto",
  "labels",
  "headings",
  "sessions",
  "paragraphs",
  "none",
];

export type SegmentOptions = {
  mode?: SegmentMode;
  // Speaker labels to treat as the moderator, matched case-insensitively.
  moderators?: string[];
};

// A respondent's profile lines, lifted out of the text so they are not coded
// as if they were speech: "Sex: Male", "Age Group: 25-34".
export type RespondentProfile = {
  speaker: string;
  fields: Record<string, string>;
};

export type SegmentationResult = {
  segments: TranscriptSegment[];
  requested: SegmentMode;
  mode: ResolvedSegmentMode;
  profiles: RespondentProfile[];
  notes: string[];
};

const PROFILE_HEADING =
  /^(demographics|respondent profile|participant profile|profile|background)$/i;
const PROFILE_FIELD =
  /^[-\u2022*\u2013]?\s*([A-Za-z][A-Za-z0-9 /&'()-]{0,40}?)\s*:\s*(\S.{0,120})$/;

// "FOCUS GROUP 2: CONTRACT CUSTOMERS", "Session 3", "Interview 4: Cape Town".
const SESSION_KEYWORD =
  /^(focus group|group|session|interview)\s*#?(\d{1,3})\s*(?:[:.\u2013-]\s*(\S.*))?$/i;
// "U01: Unstructured interview". Only counts when the id opens one line in
// the whole file, so a speaker such as "P1" who talks many times is not one.
const SESSION_ID = /^([A-Z]{1,3}\d{1,3})\s*:\s*(\S.*)$/;
// Header-like "labels" that are not people.
const NON_SPEAKER_LABEL =
  /^(format|setting|setting assumed|note|notes|source|date|title|duration|location|venue|topic|agenda|summary|context|common discussion route|synthetic transcript|synthetic data)$/i;
// "[00:00-06:00] Introductions": a section marker, not speech.
const TIME_BLOCK =
  /^\[\d{1,2}:\d{2}(?::\d{2})?\s*[\u2013-]\s*\d{1,2}:\d{2}(?::\d{2})?\]/;
const RESPONDENT_LABEL = /^(r|resp|respondent|interviewee)$/i;

type SessionHead = { id: string; title: string | null };

function sessionHeadFor(
  line: string,
  labelCounts: Map<string, number>,
): SessionHead | null {
  const t = line.trim();
  const k = SESSION_KEYWORD.exec(t);
  if (k) {
    const kw = k[1].toLowerCase();
    return {
      id: `${kw.charAt(0).toUpperCase()}${kw.slice(1)} ${Number(k[2])}`,
      title: k[3]?.trim() || null,
    };
  }
  const m = SESSION_ID.exec(t);
  if (m && (labelCounts.get(m[1].toLowerCase()) ?? 0) === 1) {
    return { id: m[1], title: m[2].trim() };
  }
  return null;
}

/**
 * Splits transcript text into speaker turns and says how it read the file.
 *
 * Auto mode picks the first that fits: respondent headings ("Interview 1",
 * notes with no speaker labels), then several sessions in one file (headings
 * such as "FOCUS GROUP 2: ..." or "U01: ..." with "Name:" turns inside, where
 * the same labels such as P1 or R repeat in every session), then "Name:"
 * labels, then plain paragraphs of unknown speaker. A "Name:" prefix only
 * counts as a speaker label when the same label opens at least two lines, so
 * a stray colon in running prose is not mistaken for one. A person can force a
 * mode, and name which speakers are the moderator, when the guess is wrong.
 * Long turns are split at sentence boundaries.
 */
export function segmentTranscriptDetailed(
  text: string,
  options: SegmentOptions = {},
): SegmentationResult {
  const requested = options.mode ?? "auto";
  const moderators = new Set(
    (options.moderators ?? [])
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
  );
  const notes: string[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  const labelCounts = new Map<string, number>();
  for (const line of lines) {
    const m = LABEL_LINE.exec(line);
    if (m) {
      const key = m[1].trim().toLowerCase();
      labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
    }
  }
  const validLabels = new Set(
    [...labelCounts.entries()].filter(([, n]) => n >= 2).map(([k]) => k),
  );
  let labelled = 0;
  for (const key of validLabels) labelled += labelCounts.get(key) ?? 0;
  const autoLabels = labelled >= 3;

  // "I" is the interviewer when the respondent is "R".
  const interviewerIsI =
    labelCounts.has("i") &&
    [...labelCounts.keys()].some((k) => RESPONDENT_LABEL.test(k));
  const isModerator = (label: string | null): boolean => {
    if (label === null) return false;
    const key = label.trim().toLowerCase();
    return (
      moderators.has(key) ||
      roleFor(label) === "moderator" ||
      (interviewerIsI && key === "i")
    );
  };

  const headingAt = lines.map((l) => RESPONDENT_HEADING.exec(l.trim()));
  const headingCount = headingAt.filter(Boolean).length;
  const sessionAt = lines.map((l) => sessionHeadFor(l, labelCounts));
  const sessionCount = sessionAt.filter(Boolean).length;

  let mode: ResolvedSegmentMode;
  if (requested === "auto") {
    mode =
      headingCount >= 2
        ? "headings"
        : sessionCount >= 2 && autoLabels
          ? "sessions"
          : autoLabels
            ? "labels"
            : "none";
  } else if (requested === "headings" && headingCount === 0) {
    mode = "none";
    notes.push(
      'No headings such as "Interview 1" were found, so the file was read as plain paragraphs.',
    );
  } else if (requested === "sessions" && sessionCount === 0) {
    mode = "none";
    notes.push(
      'No session headings such as "FOCUS GROUP 1: ..." or "U01: ..." were found, so the file was read as plain paragraphs.',
    );
  } else if (requested === "labels" && labelCounts.size === 0) {
    mode = "none";
    notes.push(
      'No "Name:" speaker labels were found, so the file was read as plain paragraphs.',
    );
  } else {
    mode = requested;
  }

  type Turn = {
    speaker: string | null;
    text: string;
    raw?: string | null;
    session?: string;
  };
  const turns: Turn[] = [];
  const profiles: RespondentProfile[] = [];

  const isHeaderLike = (line: string, label: string | null): boolean =>
    TIME_BLOCK.test(line.trim()) ||
    (label !== null &&
      (NON_SPEAKER_LABEL.test(label.trim()) ||
        SESSION_KEYWORD.test(line.trim())));

  if (mode === "headings") {
    let current: Turn | null = null;
    let profile: RespondentProfile | null = null;
    let inProfile = false;
    lines.forEach((line, i) => {
      const h = headingAt[i];
      const trimmed = line.trim();
      if (h) {
        current = { speaker: `${h[1]} ${h[2]}`, text: "" };
        turns.push(current);
        profile = { speaker: current.speaker as string, fields: {} };
        inProfile = false;
        return;
      }
      if (trimmed === "" || !current) return;
      if (PROFILE_HEADING.test(trimmed.replace(/^[-\u2022*\u2013]\s*/, ""))) {
        inProfile = true;
        return;
      }
      if (inProfile && profile) {
        const f = PROFILE_FIELD.exec(trimmed);
        if (f) {
          profile.fields[f[1].trim()] = f[2].trim();
          if (!profiles.includes(profile)) profiles.push(profile);
          return;
        }
        inProfile = false;
      }
      current.text = `${current.text} ${trimmed}`.trim();
    });
  } else if (mode === "sessions") {
    let session: SessionHead | null = null;
    let current: Turn | null = null;
    let profileLine: string | null = null;
    const profileLineBySession = new Map<string, string>();
    const titleBySession = new Map<string, string>();
    let skippedPreamble = 0;
    lines.forEach((line, i) => {
      const head = sessionAt[i];
      const trimmed = line.trim();
      if (head) {
        session = head;
        current = null;
        profileLine = null;
        if (head.title) titleBySession.set(head.id, head.title);
        return;
      }
      if (trimmed === "") return;
      if (!session) {
        skippedPreamble += 1;
        return;
      }
      const m = LABEL_LINE.exec(line);
      if (isHeaderLike(line, m ? m[1] : null)) {
        current = null;
        return;
      }
      if (
        m &&
        (validLabels.has(m[1].trim().toLowerCase()) || isNameLike(m[1]))
      ) {
        current = {
          speaker: null,
          raw: m[1].trim(),
          session: session.id,
          text: m[2].trim(),
        };
        turns.push(current);
      } else if (current) {
        current.text = `${current.text} ${trimmed}`;
      } else if (trimmed.includes(" | ") && profileLine === null) {
        profileLine = trimmed;
        profileLineBySession.set(session.id, trimmed);
      }
    });
    if (skippedPreamble > 0) {
      notes.push(
        `${skippedPreamble} line${skippedPreamble === 1 ? "" : "s"} before the first session heading (an index, guide or introduction) were not coded.`,
      );
    }
    // The same label (P1, R) means a different person in every session, so a
    // participant is keyed by session. A session with a single participant
    // label is simply that person: the session id.
    const labelsBySession = new Map<string, Set<string>>();
    for (const t of turns) {
      if (isModerator(t.raw ?? null)) continue;
      const set = labelsBySession.get(t.session as string) ?? new Set();
      set.add(t.raw as string);
      labelsBySession.set(t.session as string, set);
    }
    for (const t of turns) {
      if (isModerator(t.raw ?? null)) {
        t.speaker = t.raw as string;
      } else {
        const only = labelsBySession.get(t.session as string)?.size === 1;
        t.speaker = only ? (t.session as string) : `${t.raw} (${t.session})`;
      }
    }
    const seen = new Set<string>();
    for (const t of turns) {
      const sp = t.speaker as string;
      if (isModerator(t.raw ?? null) || seen.has(sp)) continue;
      seen.add(sp);
      const fields: Record<string, string> = { Session: t.session as string };
      const title = titleBySession.get(t.session as string);
      if (title) fields["Session title"] = title;
      const pl = profileLineBySession.get(t.session as string);
      if (pl && labelsBySession.get(t.session as string)?.size === 1) {
        fields.Profile = pl;
      }
      profiles.push({ speaker: sp, fields });
    }
  } else if (mode === "labels") {
    let current: Turn | null = null;
    let skippedLead = 0;
    for (const line of lines) {
      const m = LABEL_LINE.exec(line);
      if (line.trim() === "") continue;
      if (isHeaderLike(line, m ? m[1] : null)) {
        current = null;
        continue;
      }
      if (
        m &&
        (requested === "labels"
          ? isNameLike(m[1])
          : validLabels.has(m[1].trim().toLowerCase()) || isNameLike(m[1]))
      ) {
        current = { speaker: m[1].trim(), text: m[2].trim() };
        turns.push(current);
      } else if (current) {
        current.text = `${current.text} ${line.trim()}`;
      } else if (turns.length === 0) {
        skippedLead += 1; // title or introduction before the first speaker
      } else {
        current = { speaker: null, text: line.trim() };
        turns.push(current);
      }
    }
    if (skippedLead > 0) {
      notes.push(
        `${skippedLead} line${skippedLead === 1 ? "" : "s"} before the first speaker label (a title or introduction) were not coded.`,
      );
    }
  } else {
    let n = 0;
    for (const paragraph of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/)) {
      const cleaned = paragraph.replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      n += 1;
      turns.push({
        speaker: mode === "paragraphs" ? `Respondent ${n}` : null,
        text: cleaned,
      });
    }
  }

  const segments: TranscriptSegment[] = [];
  for (const turn of turns) {
    const role: SegmentRole =
      turn.speaker !== null && (turn.raw ?? turn.speaker) !== null
        ? isModerator(turn.raw ?? turn.speaker)
          ? "moderator"
          : roleFor(turn.speaker)
        : roleFor(turn.speaker);
    for (const piece of splitLongText(turn.text, MAX_SEGMENT_CHARS)) {
      if (!piece.trim()) continue;
      segments.push({
        index: segments.length,
        speaker: turn.speaker,
        role,
        text: piece.trim(),
      });
    }
  }
  return { segments, requested, mode, profiles, notes };
}

export function segmentTranscript(
  text: string,
  options: SegmentOptions = {},
): TranscriptSegment[] {
  return segmentTranscriptDetailed(text, options).segments;
}

export type SegmentationSummary = {
  respondents: number | null;
  participantTurns: number;
  moderatorTurns: number;
  unlabelledTurns: number;
  warnings: string[];
};

/** A plain description of how a file was read, with warnings when it looks doubtful. */
export function summariseSegmentation(
  segments: Pick<TranscriptSegment, "speaker" | "role" | "text">[],
  mode: ResolvedSegmentMode,
  notes: string[] = [],
): SegmentationSummary {
  const participant = segments.filter((s) => s.role !== "moderator");
  const moderatorTurns = segments.length - participant.length;
  const unlabelledTurns = participant.filter((s) => s.speaker === null).length;
  const chars = new Map<string, number>();
  for (const s of participant) {
    if (s.speaker === null) continue;
    chars.set(s.speaker, (chars.get(s.speaker) ?? 0) + s.text.length);
  }
  const respondents = chars.size > 0 ? chars.size : null;
  const warnings = [...notes];
  if (respondents === null) {
    warnings.push(
      "No speakers were detected, so respondents cannot be counted and every theme will show as coming from an unknown speaker.",
    );
  } else if (unlabelledTurns > 0) {
    warnings.push(
      `${unlabelledTurns} participant turn${unlabelledTurns === 1 ? " has" : "s have"} no speaker, usually text before the first label.`,
    );
  }
  if (moderatorTurns === 0 && (mode === "labels" || mode === "none")) {
    warnings.push(
      "No moderator or interviewer turns were found. If the file contains interviewer questions, they are being coded as participant speech.",
    );
  }
  if (respondents === 1) {
    warnings.push(
      "Only one respondent was found. Counts across people will not mean much.",
    );
  }
  if (respondents !== null && respondents >= 3) {
    const total = [...chars.values()].reduce((a, b) => a + b, 0);
    const top = Math.max(...chars.values());
    if (total > 0 && top / total > 0.7) {
      warnings.push(
        "One respondent supplies more than 70% of the participant text, so themes may mostly reflect that person.",
      );
    }
  }
  return {
    respondents,
    participantTurns: participant.length,
    moderatorTurns,
    unlabelledTurns,
    warnings,
  };
}

// --- Quote matching ---------------------------------------------------

export function normalizeText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/­/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

function tokens(text: string): string[] {
  return normalizeText(text)
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      row[j] =
        a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
    }
    prev = row;
  }
  return prev[b.length];
}

export type QuoteMatch = {
  match: "exact" | "near" | "none";
  segmentIndex: number | null;
  speaker: string | null;
  role: SegmentRole | null;
  // Share of the quote's words found in order in the best segment, 0 to 1.
  score: number;
  // True when the words appear across more than one turn instead of in one.
  spansTurns: boolean;
};

export const NEAR_MATCH_THRESHOLD = 0.85;

/**
 * Checks a model-supplied quote against the transcript's segments.
 *  exact: the quote sits verbatim inside one segment (an ellipsis may join
 *         fragments of the same segment)
 *  near:  most of its words appear in order in one segment, or it runs
 *         across turns; worth a human look
 *  none:  nothing close
 * Participant segments are preferred, so a quote that also appears in the
 * moderator's words reports the participant turn, and one found only in
 * moderator text reports role "moderator" for the caller to reject.
 */
export function matchQuote(
  quote: string,
  segments: TranscriptSegment[],
): QuoteMatch {
  const none: QuoteMatch = {
    match: "none",
    segmentIndex: null,
    speaker: null,
    role: null,
    score: 0,
    spansTurns: false,
  };
  const fragments = quote
    .split(/\.{3}|…/)
    .map((f) =>
      normalizeText(f)
        .replace(/^["']+|["']+$/g, "")
        .trim(),
    )
    .filter((f) => f.length >= 8);
  if (fragments.length === 0) return none;

  const ordered = [
    ...segments.filter((s) => s.role !== "moderator"),
    ...segments.filter((s) => s.role === "moderator"),
  ];
  const normalized = new Map(
    segments.map((s) => [s.index, normalizeText(s.text)]),
  );

  for (const segment of ordered) {
    const haystack = normalized.get(segment.index) ?? "";
    let cursor = 0;
    let ok = true;
    for (const fragment of fragments) {
      const at = haystack.indexOf(fragment, cursor);
      if (at < 0) {
        ok = false;
        break;
      }
      cursor = at + fragment.length;
    }
    if (ok) {
      return {
        match: "exact",
        segmentIndex: segment.index,
        speaker: segment.speaker,
        role: segment.role,
        score: 1,
        spansTurns: false,
      };
    }
  }

  const joined = segments.map((s) => normalized.get(s.index) ?? "").join(" ");
  if (fragments.every((f) => joined.includes(f))) {
    return { ...none, match: "near", score: 1, spansTurns: true };
  }

  const quoteTokens = tokens(fragments.join(" "));
  if (quoteTokens.length < 4) return none;
  const quoteSet = new Set(quoteTokens);
  let best: QuoteMatch = none;
  for (const segment of ordered) {
    const segTokens = tokens(segment.text);
    const shared = segTokens.filter((t) => quoteSet.has(t)).length;
    if (shared / quoteTokens.length < 0.6) continue;
    const score = lcsLength(quoteTokens, segTokens) / quoteTokens.length;
    if (score > best.score) {
      best = {
        match: score >= NEAR_MATCH_THRESHOLD ? "near" : "none",
        segmentIndex: segment.index,
        speaker: segment.speaker,
        role: segment.role,
        score: Math.round(score * 1000) / 1000,
        spansTurns: false,
      };
    }
  }
  return best.match === "near" ? best : { ...none, score: best.score };
}

export type QuoteTally = {
  exact: number;
  near: number;
  none: number;
  moderator: number;
};

export function tallyQuoteMatches(matches: QuoteMatch[]): QuoteTally {
  const tally: QuoteTally = { exact: 0, near: 0, none: 0, moderator: 0 };
  for (const m of matches) {
    if (m.match === "exact" && m.role === "moderator") tally.moderator += 1;
    else tally[m.match] += 1;
  }
  return tally;
}

// --- Merging repeated coding runs into a codebook ----------------------

export type RunTheme = {
  theme: string;
  finding_text: string;
  illustrative_quote: string;
};

export type ConsolidatedCode = {
  name: string;
  definition: string;
  inclusion: string;
  exclusion: string;
  // Distinct runs in which at least one theme was merged into this code.
  reproducedRuns: number;
};

export const MAX_CODES = 12;

type RawCode = {
  name?: unknown;
  definition?: unknown;
  inclusion_criteria?: unknown;
  exclusion_criteria?: unknown;
  members?: unknown;
};

/**
 * Cleans the consolidation call's output. Members point at the run and theme
 * they were merged from, as { run, theme } with 1-based numbers; anything
 * that points outside the runs actually made is dropped, and a code left with
 * no valid member is dropped with it. reproducedRuns is computed here from
 * the surviving members, never taken from the model.
 */
export function validateConsolidation(
  raw: unknown,
  themesPerRun: number[],
): ConsolidatedCode[] {
  if (!Array.isArray(raw)) return [];
  const out: ConsolidatedCode[] = [];
  const seenNames = new Set<string>();
  for (const item of raw as RawCode[]) {
    if (typeof item?.name !== "string" || !item.name.trim()) continue;
    if (typeof item.definition !== "string" || !item.definition.trim())
      continue;
    const name = item.name.trim();
    if (seenNames.has(name.toLowerCase())) continue;
    const runs = new Set<number>();
    if (Array.isArray(item.members)) {
      for (const member of item.members as {
        run?: unknown;
        theme?: unknown;
      }[]) {
        const run = member?.run;
        const theme = member?.theme;
        if (typeof run !== "number" || typeof theme !== "number") continue;
        if (!Number.isInteger(run) || !Number.isInteger(theme)) continue;
        if (run < 1 || run > themesPerRun.length) continue;
        if (theme < 1 || theme > themesPerRun[run - 1]) continue;
        runs.add(run);
      }
    }
    if (runs.size === 0) continue;
    seenNames.add(name.toLowerCase());
    out.push({
      name,
      definition: item.definition.trim(),
      inclusion:
        typeof item.inclusion_criteria === "string"
          ? item.inclusion_criteria.trim()
          : "",
      exclusion:
        typeof item.exclusion_criteria === "string"
          ? item.exclusion_criteria.trim()
          : "",
      reproducedRuns: runs.size,
    });
  }
  return out
    .sort((a, b) => b.reproducedRuns - a.reproducedRuns)
    .slice(0, MAX_CODES);
}

// --- Applying a codebook ----------------------------------------------

export type ApplyItem = { index: number; text: string; context: string | null };

export type ApplyBatch = { items: ApplyItem[] };

const CONTEXT_CHARS = 240;

/**
 * Groups the participant (and unknown-speaker) segments into batches for the
 * apply step. Moderator segments are never coded; the moderator turn just
 * before a participant turn rides along as context, since "yes, that one"
 * means nothing without the question.
 */
export function buildApplyBatches(
  segments: TranscriptSegment[],
  options: { maxChars?: number; maxItems?: number } = {},
): ApplyBatch[] {
  const maxChars = options.maxChars ?? 14000;
  const maxItems = options.maxItems ?? 60;
  const batches: ApplyBatch[] = [];
  let current: ApplyItem[] = [];
  let used = 0;
  let lastModerator: string | null = null;
  for (const segment of segments) {
    if (segment.role === "moderator") {
      lastModerator = segment.text;
      continue;
    }
    const context = lastModerator
      ? lastModerator.slice(0, CONTEXT_CHARS)
      : null;
    lastModerator = null;
    const cost = segment.text.length + (context?.length ?? 0) + 20;
    if (
      current.length > 0 &&
      (used + cost > maxChars || current.length >= maxItems)
    ) {
      batches.push({ items: current });
      current = [];
      used = 0;
    }
    current.push({ index: segment.index, text: segment.text, context });
    used += cost;
  }
  if (current.length > 0) batches.push({ items: current });
  return batches;
}

/**
 * Reads the apply call's output: [{ index, codes: [1-based code numbers] }].
 * An index that was not in the batch, or a code number outside the codebook,
 * is ignored; duplicates are collapsed.
 */
export function parseAssignments(
  raw: unknown,
  allowedIndexes: Set<number>,
  codeCount: number,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!Array.isArray(raw)) return out;
  for (const item of raw as { index?: unknown; codes?: unknown }[]) {
    if (typeof item?.index !== "number" || !allowedIndexes.has(item.index))
      continue;
    if (!Array.isArray(item.codes)) continue;
    const codes = [
      ...new Set(
        (item.codes as unknown[]).filter(
          (c): c is number =>
            typeof c === "number" &&
            Number.isInteger(c) &&
            c >= 1 &&
            c <= codeCount,
        ),
      ),
    ];
    if (codes.length > 0) out.set(item.index, codes);
  }
  return out;
}

const EXEMPLAR_TARGET = 220;
const EXEMPLAR_MAX = 500;

/**
 * Picks the segment to show as a code's illustrative quote: a participant
 * turn of readable length, nearest 220 characters, earliest on a tie. The
 * text is cut at a sentence or word boundary if it runs long, so it stays a
 * verbatim stretch of what was said.
 */
export function pickExemplar(
  candidates: TranscriptSegment[],
): { segment: TranscriptSegment; quote: string } | null {
  const participants = candidates.filter((s) => s.role !== "moderator");
  if (participants.length === 0) return null;
  let best = participants[0];
  let bestScore = Infinity;
  for (const segment of participants) {
    const score =
      Math.abs(segment.text.length - EXEMPLAR_TARGET) +
      (segment.text.length < 40 ? 200 : 0);
    if (score < bestScore) {
      best = segment;
      bestScore = score;
    }
  }
  let quote = best.text.trim();
  if (quote.length > EXEMPLAR_MAX) {
    const window = quote.slice(0, EXEMPLAR_MAX);
    const sentenceEnd = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
    );
    if (sentenceEnd > EXEMPLAR_MAX / 3)
      quote = window.slice(0, sentenceEnd + 1);
    else quote = window.slice(0, window.lastIndexOf(" ")).trim();
  }
  return { segment: best, quote };
}

// --- Pages ---------------------------------------------------------------

export type PageIndexEntry = { pageNumber: number; normalized: string };

export function buildPageIndex(
  pages: { pageNumber: number; text: string }[],
): PageIndexEntry[] {
  return pages.map((p) => ({
    pageNumber: p.pageNumber,
    normalized: normalizeText(p.text),
  }));
}

/**
 * The page a segment starts on, found by looking for its opening words in
 * each page's text. Null when the document has no pages or nothing matches.
 */
export function pageForSegment(
  text: string,
  index: PageIndexEntry[],
): number | null {
  if (index.length === 0) return null;
  const probe = normalizeText(text).slice(0, 60);
  if (probe.length < 12) return null;
  const hit = index.find((p) => p.normalized.includes(probe));
  return hit ? hit.pageNumber : null;
}
