// The knowledge base's table of contents. To add a guide: write its component
// in content/, register it in registry.tsx, and add one entry here. The
// sidebar, the index page and the prev/next links all read this list. Keep it
// in the same order as the run page sidebar: Setup, Analysis, Findings, Decisions.
export type ArticleCategory = "Method guides" | "Research practice";

export type ArticleMeta = {
  slug: string;
  title: string;
  blurb: string;
  category: ArticleCategory;
  updated: string; // ISO date of the last substantive edit
  minutes: number; // rough reading time
};

export const articles: ArticleMeta[] = [
  {
    slug: "import",
    title: "How import works",
    blurb: "What we accept, how files are classified, viewing and downloading originals, the quality checks, questionnaire links, statistical output sets, wave comparison, and where they stop",
    category: "Method guides",
    updated: "2026-10-22",
    minutes: 16,
  },
  {
    slug: "preparing-files",
    title: "Preparing your files for import",
    blurb: "How to lay out each kind of file, and what to change in your documents, so the app extracts them accurately",
    category: "Method guides",
    updated: "2026-10-11",
    minutes: 8,
  },
  {
    slug: "research-quality",
    title: "How the research quality review works",
    blurb: "Reviewing a brief or proposal against research practice, how the scores are built, the Overview and its Show filter, Improvements, and where it stops",
    category: "Method guides",
    updated: "2026-10-22",
    minutes: 7,
  },
  {
    slug: "objectives",
    title: "How objectives are framed and checked",
    blurb: "Stated and deduced objectives, filling from a brief or proposal once, reading it again, scoring on four dimensions, checking against insights, and where it stops",
    category: "Method guides",
    updated: "2026-10-22",
    minutes: 14,
  },
  {
    slug: "crosstabs",
    title: "How our cross tabulation works",
    blurb: "Weighted tables, bases, rating scales, multiple response, nets, SemanticTabs and StarterTabs, significance, and where they stop",
    category: "Method guides",
    updated: "2026-10-22",
    minutes: 18,
  },
  {
    slug: "qualitative-analysis",
    title: "How our qualitative analysis works",
    blurb: "From transcripts to codes and themes, what the numbers mean, and where they stop",
    category: "Method guides",
    updated: "2026-10-08",
    minutes: 14,
  },
  {
    slug: "reports",
    title: "How reports are built",
    blurb: "How the Insights Report is built from reviewed evidence only, the Word report and slide deck layouts, the SCQA story narrative, caveats, exports, and where they stop",
    category: "Method guides",
    updated: "2026-10-08",
    minutes: 9,
  },
  {
    slug: "findings",
    title: "How findings are produced and checked",
    blurb: "Atomic claims, where they come from, the four verdicts, caveat tags, and where they stop",
    category: "Method guides",
    updated: "2026-10-08",
    minutes: 10,
  },
  {
    slug: "insights",
    title: "How insights are made and tested",
    blurb: "From verified findings to synthesised insights, the six-point gate, confidence, and where they stop",
    category: "Method guides",
    updated: "2026-10-08",
    minutes: 11,
  },
  {
    slug: "decisions",
    title: "How decisions are framed and linked to evidence",
    blurb: "Two-pass candidate proposals, how decisions link to objectives and insights, the review workflow, and where they stop",
    category: "Method guides",
    updated: "2026-10-08",
    minutes: 11,
  },
  {
    slug: "research-assistant",
    title: "How the Research assistant works",
    blurb: "Asking from any page, what it reads, how-the-app questions from the guides, answering data questions with draft tables you can open, sample sizes and margins of error from a tested calculator, method advice, report edits, and where it stops",
    category: "Method guides",
    updated: "2026-10-22",
    minutes: 9,
  },
];

export function knowledgeHref(slug: string): string {
  return slug ? `/knowledge/${slug}` : "/knowledge";
}
