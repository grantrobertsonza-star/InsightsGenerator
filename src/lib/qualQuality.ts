// Data quality and sample sufficiency checks for a coded transcript. Pure
// functions over turns and code assignments: no model calls, no database.
// These describe the data; none of them is a pass or fail test. In particular
// the saturation curves are evidence about sample sufficiency, not proof.

export type QualitySegment = {
  id: string;
  index: number;
  speaker: string | null;
  role: "participant" | "moderator" | string;
  text: string;
};

export type Spread = {
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
};

export type ThemeSaturation = {
  codeId: string;
  codeName: string;
  participants: number;
  firstSeenAt: number | null; // 1-based position of the first respondent who voiced it
  cumulative: number[]; // respondents with the theme after each added respondent
  inFirstHalf: number; // of its participants, how many were among the first half
  addedInLastThird: number;
};

export type DataQuality = {
  respondents: number;
  participantTurns: number;
  moderatorTurns: number;
  unlabelledTurns: number;
  totalWords: number;
  participantWords: number;
  moderatorWordShare: number | null;
  wordsPerRespondent: Spread | null;
  wordsPerTurn: Spread | null;
  sentencesPerTurn: number | null;
  topSpeakerShare: number | null;
  topThreeShare: number | null;
  thinRespondents: { label: string; words: number }[]; // under THIN_WORDS words
  duplicateTurns: number;
  codedShare: number | null;
  thinThemes: { codeName: string; participants: number }[];
  truncated: boolean | null; // null when unknown
  saturation: {
    order: string[];
    newCodesPerRespondent: number[];
    cumulativeCodes: number[];
    permuted: { median: number[]; low: number[]; high: number[] } | null;
    totalCodes: number;
    simple: {
      base: number;
      run: number;
      baseCodes: number;
      newInRun: number;
      ratio: number | null;
      threshold: number;
    } | null;
    lastThreeNewCodes: number | null;
    themes: ThemeSaturation[];
  } | null;
  notes: string[];
};

export const THIN_WORDS = 50;
export const THIN_THEME_PARTICIPANTS = 3;
export const SIMPLE_BASE = 4;
export const SIMPLE_RUN = 2;
export const SIMPLE_THRESHOLD = 0.05;
export const PERMUTATIONS = 200;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function countSentences(text: string): number {
  const parts = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim().length > 0);
  return Math.max(1, parts.length);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function spread(values: number[]): Spread | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    median: quantile(s, 0.5),
    min: s[0],
    max: s[s.length - 1],
    q1: quantile(s, 0.25),
    q3: quantile(s, 0.75),
  };
}

// Small seedable generator so the shuffled curves are the same on every load.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cumulativeDistinct(
  order: string[],
  codesOf: Map<string, Set<string>>,
) {
  const seen = new Set<string>();
  const cumulative: number[] = [];
  const added: number[] = [];
  for (const r of order) {
    let n = 0;
    for (const c of codesOf.get(r) ?? []) {
      if (!seen.has(c)) {
        seen.add(c);
        n += 1;
      }
    }
    added.push(n);
    cumulative.push(seen.size);
  }
  return { cumulative, added };
}

export function computeDataQuality(input: {
  segments: QualitySegment[];
  assignments: Map<string, string[]>; // segment id to code ids
  codes: { id: string; name: string }[];
  truncated?: boolean | null;
}): DataQuality {
  const { segments, assignments, codes } = input;
  const notes: string[] = [];
  const participants = segments.filter((s) => s.role !== "moderator");
  const moderators = segments.filter((s) => s.role === "moderator");
  const wordsOf = new Map(segments.map((s) => [s.id, countWords(s.text)]));
  const pWords = participants.reduce((n, s) => n + (wordsOf.get(s.id) ?? 0), 0);
  const mWords = moderators.reduce((n, s) => n + (wordsOf.get(s.id) ?? 0), 0);

  // Respondents in order of first speech.
  const order: string[] = [];
  const words = new Map<string, number>();
  for (const s of participants) {
    if (!s.speaker) continue;
    if (!words.has(s.speaker)) {
      words.set(s.speaker, 0);
      order.push(s.speaker);
    }
    words.set(
      s.speaker,
      (words.get(s.speaker) ?? 0) + (wordsOf.get(s.id) ?? 0),
    );
  }
  const perRespondent = order.map((r) => words.get(r) ?? 0);
  const labelledWords = perRespondent.reduce((a, b) => a + b, 0);
  const desc = [...perRespondent].sort((a, b) => b - a);
  const topShare = (n: number) =>
    labelledWords > 0
      ? desc.slice(0, n).reduce((a, b) => a + b, 0) / labelledWords
      : null;

  const seenText = new Set<string>();
  let duplicates = 0;
  for (const s of participants) {
    const key = `${s.speaker ?? ""}|${s.text.trim().toLowerCase()}`;
    if (s.text.trim().length > 0 && seenText.has(key)) duplicates += 1;
    seenText.add(key);
  }

  const codedParticipantTurns = participants.filter(
    (s) => (assignments.get(s.id)?.length ?? 0) > 0,
  ).length;

  // Which codes each respondent voiced.
  const codesOf = new Map<string, Set<string>>();
  for (const s of participants) {
    if (!s.speaker) continue;
    const set = codesOf.get(s.speaker) ?? new Set<string>();
    for (const c of assignments.get(s.id) ?? []) set.add(c);
    codesOf.set(s.speaker, set);
  }

  const thinThemes = codes
    .map((c) => ({
      codeName: c.name,
      participants: order.filter((r) => codesOf.get(r)?.has(c.id)).length,
    }))
    .filter((t) => t.participants < THIN_THEME_PARTICIPANTS);

  let saturation: DataQuality["saturation"] = null;
  if (order.length >= 3 && codes.length > 0) {
    const asIs = cumulativeDistinct(order, codesOf);
    const rand = mulberry32(20260101);
    const curves: number[][] = [];
    for (let p = 0; p < PERMUTATIONS; p++) {
      const shuffled = [...order];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      curves.push(cumulativeDistinct(shuffled, codesOf).cumulative);
    }
    const at = (i: number, q: number) =>
      quantile(
        curves.map((c) => c[i]).sort((a, b) => a - b),
        q,
      );
    const permuted = {
      median: order.map((_, i) => at(i, 0.5)),
      low: order.map((_, i) => at(i, 0.1)),
      high: order.map((_, i) => at(i, 0.9)),
    };

    let simple: NonNullable<DataQuality["saturation"]>["simple"] = null;
    if (order.length >= SIMPLE_BASE + SIMPLE_RUN) {
      const baseCodes = asIs.cumulative[SIMPLE_BASE - 1];
      const newInRun =
        asIs.cumulative[SIMPLE_BASE + SIMPLE_RUN - 1] - baseCodes;
      simple = {
        base: SIMPLE_BASE,
        run: SIMPLE_RUN,
        baseCodes,
        newInRun,
        ratio: baseCodes > 0 ? newInRun / baseCodes : null,
        threshold: SIMPLE_THRESHOLD,
      };
    }

    const half = Math.ceil(order.length / 2);
    const thirdStart = Math.floor((order.length * 2) / 3);
    const themes: ThemeSaturation[] = codes.map((c) => {
      let n = 0;
      let first: number | null = null;
      let inHalf = 0;
      let lastThird = 0;
      const cumulative = order.map((r, i) => {
        if (codesOf.get(r)?.has(c.id)) {
          n += 1;
          if (first === null) first = i + 1;
          if (i < half) inHalf += 1;
          if (i >= thirdStart) lastThird += 1;
        }
        return n;
      });
      return {
        codeId: c.id,
        codeName: c.name,
        participants: n,
        firstSeenAt: first,
        cumulative,
        inFirstHalf: inHalf,
        addedInLastThird: lastThird,
      };
    });

    saturation = {
      order,
      newCodesPerRespondent: asIs.added,
      cumulativeCodes: asIs.cumulative,
      permuted,
      totalCodes: codes.length,
      simple,
      lastThreeNewCodes: asIs.added.slice(-3).reduce((a, b) => a + b, 0),
      themes,
    };
    if (order.length < 8) {
      notes.push(
        `Only ${order.length} respondents, so the saturation curve is coarse and should be read with care.`,
      );
    }
  } else if (order.length < 3) {
    notes.push("Fewer than 3 labelled respondents, so no saturation curve.");
  }

  if (input.truncated === true) {
    notes.push(
      "The transcript was too long for one open-coding pass and was cut before coding, so themes may reflect only part of it.",
    );
  }
  if (
    moderators.length > 0 &&
    mWords + pWords > 0 &&
    mWords / (mWords + pWords) > 0.4
  ) {
    notes.push(
      "Moderator talk is over 40% of the words. Check for leading questions, or that moderator turns were separated correctly.",
    );
  }
  const tops = topShare(1);
  if (tops !== null && order.length >= 4 && tops > 0.3) {
    notes.push(
      "One speaker supplies over 30% of the participant words, so counts of turns may overstate how widely a theme is held.",
    );
  }

  return {
    respondents: order.length,
    participantTurns: participants.length,
    moderatorTurns: moderators.length,
    unlabelledTurns: participants.filter((s) => !s.speaker).length,
    totalWords: pWords + mWords,
    participantWords: pWords,
    moderatorWordShare:
      pWords + mWords > 0 && moderators.length > 0
        ? mWords / (pWords + mWords)
        : null,
    wordsPerRespondent: spread(perRespondent),
    wordsPerTurn: spread(participants.map((s) => wordsOf.get(s.id) ?? 0)),
    sentencesPerTurn:
      participants.length > 0
        ? participants.reduce((n, s) => n + countSentences(s.text), 0) /
          participants.length
        : null,
    topSpeakerShare: topShare(1),
    topThreeShare: topShare(3),
    thinRespondents: order
      .map((label) => ({ label, words: words.get(label) ?? 0 }))
      .filter((r) => r.words < THIN_WORDS),
    duplicateTurns: duplicates,
    codedShare:
      participants.length > 0
        ? codedParticipantTurns / participants.length
        : null,
    thinThemes,
    truncated: input.truncated ?? null,
    saturation,
    notes,
  };
}
