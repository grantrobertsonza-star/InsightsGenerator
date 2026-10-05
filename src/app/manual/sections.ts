// Shared table of contents for the user manual, read by the sidebar layout
// and by each page for its prev/next links. One entry per manual page,
// in the order a new user should actually read them: roughly the order
// material moves through the app itself (upload, extract, verify, raw
// data, insights, recommendations, audit trail), with the limits page and
// glossary at the end as reference material rather than a step in the
// sequence.
export type ManualSection = {
  slug: string;
  title: string;
  blurb: string;
};

export const manualSections: ManualSection[] = [
  { slug: "", title: "Start here", blurb: "What Insights Elevator is, and isn't" },
  { slug: "uploading", title: "Uploading your material", blurb: "Reports, tables, and transcripts" },
  { slug: "extraction", title: "How findings are extracted", blurb: "Turning documents into checkable claims" },
  { slug: "verification", title: "Verification and verdicts", blurb: "How each claim gets checked, and what the caveats mean" },
  { slug: "raw-data", title: "Raw data and banner plans", blurb: "Why case-level data is handled differently" },
  { slug: "insights", title: "Insights and synthesis", blurb: "From individual claims to the bigger picture" },
  { slug: "recommendations", title: "Recommendations", blurb: "What gets proposed, and what's left to you" },
  { slug: "working-data", title: "The audit trail", blurb: "Nothing is deleted, everything stays traceable" },
  { slug: "limits", title: "What this doesn't do yet", blurb: "The honest list of current boundaries" },
  { slug: "glossary", title: "Glossary", blurb: "Every term used in this manual, in one place" },
];

export function manualHref(slug: string): string {
  return slug ? `/manual/${slug}` : "/manual";
}
