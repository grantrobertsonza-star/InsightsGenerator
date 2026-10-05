import { H1, Lede, H2, P, DoesDoesNot, WhyBox } from "./blocks";
import { ManualPageFooter } from "./ManualPageFooter";

export default function ManualOverviewPage() {
  return (
    <div>
      <H1>Start here</H1>
      <Lede>
        A short, honest explanation of what Insights Elevator does, in plain terms, before any of the
        detail pages. If you only read one page in this manual, read this one.
      </Lede>

      <P>
        Insights Elevator takes a research report or a dataset and turns it into a set of checked,
        traceable findings, insights, and recommendations. It does the reading, the cross-checking, and
        the organising. It does not do your thinking for you, and it is built to say so clearly whenever
        it is uncertain, rather than present every output with the same confidence.
      </P>

      <H2>The two ways to start</H2>
      <P>
        <strong>Generate from data</strong> starts from raw tables or a dataset with no existing
        findings. The app reads through it directly and looks for patterns worth reporting.
      </P>
      <P>
        <strong>Validate existing insights</strong> starts from a report that already makes claims, a
        deck, a write-up, a set of slides. The app checks each claim against the evidence actually
        supplied, rather than taking the report&apos;s own conclusions at face value.
      </P>

      <H2>The one idea that runs through everything else</H2>
      <P>
        Every finding, insight, and recommendation in this app carries a status: pending, accepted, or
        rejected, and a trail back to the exact document or table it came from. Nothing is presented as
        settled just because the system produced it. A finding stays pending until a person has looked
        at it, and a rejected finding is kept, not deleted, so the record of what was considered and set
        aside is never lost.
      </P>

      <WhyBox>
        An AI system that reads documents and draws conclusions from them can make mistakes, the same
        way a junior analyst can. The honest response to that is not to pretend it never happens, it is
        to build a process that catches it: statistical checks run automatically, every claim keeps its
        source, and a person reviews before anything is treated as final. That review step is the
        actual safeguard. The rest of this manual explains how each part of it works.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Extracts claims from your material and checks them against the evidence actually supplied",
          "Runs statistical checks (margin of error, base-size flags, significance tests) automatically",
          "Shows its working: every output traces back to a specific document, table, or finding",
          "Groups related findings into a smaller number of genuinely useful, cross-cutting insights",
        ]}
        doesNot={[
          "Guarantee a finding is correct just because it passed a check: checks catch specific, known failure modes, not every possible error",
          "Replace your own judgment about whether a recommendation is the right call for your organisation",
          "Treat every table the same way: raw, respondent-level data is deliberately handled more carefully than an already-summarised table (see Raw data and banner plans)",
        ]}
      />

      <H2>How to use this manual</H2>
      <P>
        The pages in the sidebar run in roughly the order your material moves through the app: upload,
        extraction, verification, raw data if you have it, insights, recommendations, and the audit
        trail. The last two pages, what this doesn&apos;t do and the glossary, are reference material you
        can jump to at any point.
      </P>

      <ManualPageFooter currentSlug="" />
    </div>
  );
}
