import { H1, Lede, H2, P, DoesDoesNot, WhyBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function ExtractionPage() {
  return (
    <div>
      <H1>How findings are extracted</H1>
      <Lede>Turning a document into a list of checkable claims, and why that first pass is a reading task, not a fixed rule.</Lede>

      <H2>What a &quot;finding&quot; actually is</H2>
      <P>
        A finding is one atomic, factual or statistical claim pulled out of your material: a statistic,
        a stated relationship, a described pattern. One document can produce many findings. Each finding
        keeps a link back to exactly where it came from, the specific document or table, so nothing in
        the system is ever a claim floating free of its source.
      </P>

      <H2>This is a reading task, not a parser</H2>
      <P>
        Extracting findings from narrative text or a transcript is done by an AI model reading the
        document, not by a fixed set of rules matching patterns in the text. That matters, because it
        means extraction is genuinely good at understanding context and phrasing, but it is not
        infallible the way a spreadsheet formula is. It can occasionally miss a claim, misread a number,
        or pull out something that is not actually a standalone finding.
      </P>
      <P>
        Structured tables are different: a finding drawn from an aggregated table is computed, not
        read. The system runs an actual statistical test (a two-proportion comparison, a difference of
        means) against the numbers in the table itself, so a table-derived finding carries a real
        calculated result behind it, not a model&apos;s summary of one.
      </P>

      <H2>Every new finding starts as pending</H2>
      <P>
        A freshly extracted finding is never marked accepted by default. It sits as pending until the
        verification stage has assessed it and, ultimately, until a person has reviewed it. This is
        deliberate: the home page&apos;s reviewed count, and the &quot;regenerate unreviewed&quot;
        option, only mean something if pending genuinely means not yet looked at.
      </P>

      <WhyBox>
        Treating narrative extraction and table extraction differently is not an inconsistency, it is
        the point. A number computed directly from a table your data actually contains is a different
        kind of claim from a model&apos;s read of a sentence in a report, and the system is built to be
        honest about which kind each finding is, rather than presenting both with identical confidence.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Pulls out specific, checkable claims rather than summarising a document in general terms",
          "Keeps a source link on every finding, back to the exact document or table it came from",
          "Runs an actual statistical test against table data, rather than describing it in prose",
        ]}
        doesNot={[
          "Invent a finding not actually present in the source material: it extracts, it does not author new claims at this stage",
          "Guarantee every genuine claim in a long document was caught: a spot check against the source is worth doing on anything consequential",
          "Treat a narrative claim and a computed statistic as the same kind of evidence",
        ]}
      />

      <ManualPageFooter currentSlug="extraction" />
    </div>
  );
}
