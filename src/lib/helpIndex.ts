import index from "./helpIndex.generated.json";

/**
 * The Knowledge base and Manual as text, for the Research assistant (Grant, 2026-10-22). The index
 * is generated from the rendered pages by scripts/build-help-index.mjs; helpIndex.test.ts fails when
 * it is out of date, so the assistant reads what a reader of the pages sees.
 *
 * Search is plain word matching over sections, weighted towards headings and titles. It finds the
 * sections that use the question's words; it does not understand synonyms, so the assistant is told
 * to search again with other words when nothing fits.
 */

export type HelpSection = { id: string; heading: string; href: string; text: string };
export type HelpPage = { ref: string; kind: "knowledge" | "manual"; title: string; blurb: string; href: string; sections: HelpSection[] };

const pages = (index as { pages: HelpPage[] }).pages;

const STOP = new Set(
  "the and for are but not you your with this that what how does from have has can was were will into its our out about which when where who why".split(" "),
);

/** The words a search matches on (shared with technical-document search, technicalDocuments.ts). */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

/** A crude stem, so "weights" finds "weighted" and "weighting": the first six letters of longer words. */
export const stem = (w: string) => (w.length > 6 ? w.slice(0, 6) : w);

export type HelpHit = { ref: string; title: string; heading: string; href: string; snippet: string; score: number };

/** Up to `limit` sections that best match the query, best first. Ties keep the pages' order. */
export function searchHelp(query: string, limit = 6): HelpHit[] {
  const terms = [...new Set(words(query).map(stem))];
  if (terms.length === 0) return [];
  const hits: HelpHit[] = [];
  for (const page of pages) {
    const titleStems = new Set(words(page.title).map(stem));
    for (const section of page.sections) {
      const headingStems = new Set(words(section.heading).map(stem));
      const bodyStems = words(section.text).map(stem);
      const counts = new Map<string, number>();
      for (const w of bodyStems) counts.set(w, (counts.get(w) ?? 0) + 1);
      let score = 0;
      let matched = 0;
      for (const t of terms) {
        const inBody = counts.get(t) ?? 0;
        const s = (headingStems.has(t) ? 3 : 0) + (titleStems.has(t) ? 2 : 0) + Math.min(inBody, 5) * 0.5;
        if (s > 0) matched++;
        score += s;
      }
      if (matched === 0) continue;
      // Sections that match more of the question's words come first.
      score *= matched / terms.length;
      hits.push({
        ref: section.id ? `${page.ref}#${section.id}` : page.ref,
        title: page.title,
        heading: section.heading,
        href: section.href,
        snippet: snippet(section.text, terms),
        score: Math.round(score * 100) / 100,
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function snippet(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  const piece = text.slice(start, start + 280).replace(/\n/g, " ");
  return `${start > 0 ? "..." : ""}${piece}${start + 280 < text.length ? "..." : ""}`;
}

/** Longest text read_help returns, so one long page (the glossary) cannot crowd out the answer. */
export const MAX_HELP_TEXT = 12_000;

/**
 * One section ("knowledge/crosstabs#significance") or a whole page ("manual/limits"), as text with
 * its title and link; null when the reference is not in the index.
 */
export function readHelp(ref: string): { title: string; href: string; text: string; truncated: boolean } | null {
  const [pageRef, sectionId] = ref.trim().split("#");
  const page = pages.find((p) => p.ref === pageRef);
  if (!page) return null;
  const chosen = sectionId ? page.sections.filter((s) => s.id === sectionId) : page.sections;
  if (chosen.length === 0) return null;
  const full = chosen.map((s) => `## ${s.heading}\n${s.text}`).join("\n\n");
  const truncated = full.length > MAX_HELP_TEXT;
  return {
    title: sectionId ? `${page.title}: ${chosen[0].heading}` : page.title,
    href: sectionId ? chosen[0].href : page.href,
    text: truncated ? `${full.slice(0, MAX_HELP_TEXT)}\n[The rest of this page is not shown; read one of its sections instead.]` : full,
    truncated,
  };
}

/** The pages in the index, for the assistant to see what exists. */
export function helpContents(): string {
  return pages.map((p) => `${p.ref}: ${p.title}. ${p.blurb}. Sections: ${p.sections.map((s) => (s.id ? `#${s.id}` : "") || s.heading).join(", ")}`).join("\n");
}
