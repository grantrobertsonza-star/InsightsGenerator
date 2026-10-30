// Page 02's Moment profile view (Grant, 30 October 2026): which moments and brands are drawn, in which order, and the
// card's remembered view. Display and choice only: the figures come from trackerMomentProfile.loadMomentProfile and
// are never changed here. Safe for the browser (no server imports).

/** At most this many brands are drawn at once (Grant: "up to 5 brands"), so the lines stay readable. */
export const PROFILE_MAX_BRANDS = 5;
/** "The six most relevant": the same count as the recall table's rows (trackerMoments.RECALL_MOMENTS, pinned equal by
 * momentProfileView.test.ts; not imported here because trackerMoments is server code). */
export const PROFILE_TOP_MOMENTS = 6;

export type ProfileMoment = { group: string; item: string };
export type OrderedMoment = ProfileMoment & { relevance: number | null };

/**
 * The moments on the x axis, ordered by category relevance (page 02's left card): highest unrounded relevance first,
 * equal relevance in the grid's order; a moment whose relevance is unknown (not linked to the relevance question, or
 * its share not readable) after every ranked one, in the grid's order, never ranked as 0. When relevance is not
 * available at all (`relevance` null) the grid's order is kept and `byRelevance` is false, so the screen can say so.
 * Moments are matched by identity (the grid item's group, `gridGroup` on the relevance side), never by wording.
 */
export function orderProfileMoments(
  moments: ProfileMoment[],
  relevance: { gridGroup: string | null; share: number | null }[] | null,
): { moments: OrderedMoment[]; byRelevance: boolean } {
  if (relevance === null) return { moments: moments.map((m) => ({ ...m, relevance: null })), byRelevance: false };
  const shareOf = new Map<string, number | null>();
  for (const r of relevance) if (r.gridGroup !== null) shareOf.set(r.gridGroup, r.share);
  const withShare = moments.map((m, i) => ({ m: { ...m, relevance: shareOf.get(m.group) ?? null }, i }));
  withShare.sort((a, b) => {
    const x = a.m.relevance;
    const y = b.m.relevance;
    if (x !== null && y !== null && x !== y) return y - x;
    if (x === null && y !== null) return 1;
    if (x !== null && y === null) return -1;
    return a.i - b.i;
  });
  return { moments: withShare.map((w) => w.m), byRelevance: true };
}

export type MomentChoice = { kind: "all" } | { kind: "top" } | { kind: "chosen"; groups: string[] };

/**
 * The moments drawn, in the axis order: all; the six most relevant (the first six with a relevance figure, the rows
 * of the recall table; none when relevance is not available); or a chosen set, kept in the axis order whatever order
 * it was chosen in. A chosen moment the file no longer has is dropped.
 */
export function selectProfileMoments(ordered: OrderedMoment[], choice: MomentChoice): OrderedMoment[] {
  if (choice.kind === "all") return ordered;
  if (choice.kind === "top") return ordered.filter((m) => m.relevance !== null).slice(0, PROFILE_TOP_MOMENTS);
  const chosen = new Set(choice.groups);
  return ordered.filter((m) => chosen.has(m.group));
}

/** The brands first drawn: the client's brand first, then the brands compared (page 02's Compare chip), by code,
 * only codes in the brand list, at most PROFILE_MAX_BRANDS. */
export function defaultProfileBrands(focal: string | null, compared: string[], brandList: string[]): string[] {
  const known = new Set(brandList);
  const out: string[] = [];
  for (const c of [...(focal ? [focal] : []), ...compared]) if (known.has(c) && !out.includes(c) && out.length < PROFILE_MAX_BRANDS) out.push(c);
  return out;
}

/**
 * A brand ticked or unticked in the picker. The client's brand stays (it is the profile the others are read
 * against); a sixth brand is refused with the reason, never silently dropped or swapped. The result keeps the client's
 * brand first and the others in the brand list's order.
 */
export function toggleProfileBrand(current: string[], code: string, focal: string | null, brandList: string[]): { brands: string[]; refused?: string } {
  if (code === focal) return { brands: current, refused: "Your brand is always shown." };
  if (current.includes(code)) return { brands: current.filter((c) => c !== code) };
  if (current.length >= PROFILE_MAX_BRANDS) return { brands: current, refused: `Up to ${PROFILE_MAX_BRANDS} brands at a time. Remove one to add another.` };
  const next = [...current, code];
  const pos = (c: string) => (c === focal ? -1 : brandList.indexOf(c));
  return { brands: next.sort((a, b) => pos(a) - pos(b)) };
}

/** The top of the value axis: the next 10 above the highest value drawn, at least 20, at most 100. */
export function profileAxisMax(values: (number | null)[]): number {
  const top = Math.max(0, ...values.filter((v): v is number => v !== null));
  return Math.min(100, Math.max(20, Math.ceil(top / 10) * 10));
}

/**
 * Line segments of one brand: consecutive moments both with a value are joined by a straight segment; a moment
 * without a value (n/a) breaks the line, so nothing is drawn through an unknown value. Indexes into the moments.
 */
export function profileSegments(values: (number | null)[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 1; i < values.length; i += 1) if (values[i - 1] !== null && values[i] !== null) out.push([i - 1, i]);
  return out;
}

export type MomentCardView = "recall" | "profile";
/** The card's view is remembered per browser and per data file (not saved for others). */
export const momentCardViewKey = (documentId: string) => `insights-elevator:moment-card-view:${documentId}`;

/** The remembered view, "recall" (today's table, the default) when nothing valid is stored or storage cannot be read. */
export function readMomentCardView(storage: Pick<Storage, "getItem"> | null | undefined, documentId: string): MomentCardView {
  try {
    return storage?.getItem(momentCardViewKey(documentId)) === "profile" ? "profile" : "recall";
  } catch {
    return "recall";
  }
}

/** Remember the view; false when storage is unavailable (the page works without it). */
export function writeMomentCardView(storage: Pick<Storage, "setItem"> | null | undefined, documentId: string, view: MomentCardView): boolean {
  try {
    if (!storage) return false;
    storage.setItem(momentCardViewKey(documentId), view);
    return true;
  } catch {
    return false;
  }
}

/** The browser's localStorage, or null where it cannot be reached (private mode, blocked site data, the server). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ---- Moment reach card (page 02, 30 October 2026): ranking and headline. Display only; the figures come from
// trackerMomentReach.loadMomentReach and are never changed here.

export type ReachMeasure = "perPerson" | "penetration" | "perLinker" | "shareOfLinks";
export const REACH_MEASURES: { key: ReachMeasure; label: string; unit: "count" | "pct" }[] = [
  { key: "perPerson", label: "Moments per person", unit: "count" },
  { key: "penetration", label: "Moment penetration", unit: "pct" },
  { key: "perLinker", label: "Moments per linker", unit: "count" },
  { key: "shareOfLinks", label: "Share of moment links", unit: "pct" },
];
export const reachValueText = (measure: ReachMeasure, v: number | null) =>
  v === null ? "n/a" : REACH_MEASURES.find((m) => m.key === measure)!.unit === "pct" ? `${v.toFixed(1)}%` : v.toFixed(2);

type ReachRow = { code: string } & Record<ReachMeasure, number | null>;

/**
 * Brands ranked by one measure: highest unrounded value first, equal values in the brand list's order (the order
 * given), unknown values after every known one in the same order, never ranked as 0. `rank` is the position among
 * brands with a value (null for an unknown value); `of` is how many have one.
 */
export function rankReach<T extends ReachRow>(brands: T[], measure: ReachMeasure): { brand: T; rank: number | null; of: number }[] {
  const indexed = brands.map((b, i) => ({ b, i }));
  indexed.sort((x, y) => {
    const a = x.b[measure];
    const c = y.b[measure];
    if (a !== null && c !== null && a !== c) return c - a;
    if (a === null && c !== null) return 1;
    if (a !== null && c === null) return -1;
    return x.i - y.i;
  });
  const of = brands.filter((b) => b[measure] !== null).length;
  let known = 0;
  return indexed.map(({ b }) => ({ brand: b, rank: b[measure] === null ? null : ++known, of }));
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
};

/**
 * The card's one-line headline for the client's brand, always on moments per person and penetration (Grant: "Toyota:
 * 1.8 moments per person, 4th of 10; linked to at least one moment by 42%"). Figures rounded once for display
 * (moments per person to one decimal, penetration to a whole percent); the rank from the unrounded values. Null when
 * the client's brand is not known or its figure is unknown, so the screen says why instead.
 */
export function reachHeadline<T extends ReachRow>(brands: T[], focal: string | null, labelOf: (code: string) => string): string | null {
  if (!focal) return null;
  const ranked = rankReach(brands, "perPerson");
  const me = ranked.find((r) => r.brand.code === focal);
  if (!me || me.rank === null || me.brand.perPerson === null) return null;
  const pen = me.brand.penetration === null ? "" : `; linked to at least one moment by ${Math.round(me.brand.penetration)}%`;
  return `${labelOf(focal)}: ${me.brand.perPerson.toFixed(1)} moments per person, ${ordinal(me.rank)} of ${me.of}${pen}`;
}
