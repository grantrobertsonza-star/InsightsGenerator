import { H1, Lede } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

type Term = { term: string; definition: string };

const terms: Term[] = [
  { term: "Finding", definition: "One atomic, factual or statistical claim extracted from a document or table, with a link back to its exact source." },
  { term: "Pre-insight", definition: "One insight per verified, accepted finding. The full, one-to-one audit-trail layer, nothing grouped or reframed yet." },
  { term: "Synthesized insight", definition: "A smaller number of higher-level, cross-cutting insights, each produced by grouping and reframing a cluster of related pre-insights." },
  { term: "Verdict", definition: "The outcome of checking a finding: robust, use with caution, not supported, or insufficient information." },
  { term: "Caveat", definition: "A specific, named limitation attached to a finding, such as a small base size or an unstated sampling method. See the verification page for the full list." },
  { term: "Ingestion type", definition: "Whether an uploaded table is raw (one row per respondent) or aggregated (already summarised). Decides whether the table is scanned automatically or waits for a banner plan." },
  { term: "Banner column", definition: "In a banner plan, a column you name as a segmenting variable (e.g. Gender, Age band) whose categories get compared against each other." },
  { term: "Stub column", definition: "In a banner plan, a column you name as an outcome measure, tested across each banner column's categories." },
  { term: "Entry point", definition: "Generate (start from raw data with no existing findings) or Validate (start from a report that already makes claims)." },
  { term: "Status (pending / accepted / rejected)", definition: "Where a finding, insight, or recommendation sits in human review. Pending means not yet reviewed; rejected moves it to history rather than deleting it." },
];

export default function GlossaryPage() {
  return (
    <div>
      <H1>Glossary</H1>
      <Lede>Every term used across this manual, in one place, for a quick lookup.</Lede>

      <dl className="divide-y divide-border">
        {terms.map((t) => (
          <div key={t.term} className="py-3">
            <dt className="text-sm font-semibold text-foreground">{t.term}</dt>
            <dd className="mt-1 text-sm text-muted">{t.definition}</dd>
          </div>
        ))}
      </dl>

      <ManualPageFooter currentSlug="glossary" />
    </div>
  );
}
