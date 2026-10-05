import { H1, Lede, H2, P, DoesDoesNot, WhyBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function InsightsPage() {
  return (
    <div>
      <H1>Insights and synthesis</H1>
      <Lede>From one finding at a time to the smaller number of things actually worth telling someone.</Lede>

      <H2>Pre-insights: one per finding</H2>
      <P>
        Every finding that is verified and accepted becomes one pre-insight. This is a direct, one-to-one
        translation, nothing is combined or reframed yet. Pre-insights are the complete, detailed layer,
        the full audit trail of everything the system found and checked.
      </P>

      <H2>Synthesized insights: the bigger picture</H2>
      <P>
        A full report built from one insight per finding would usually be too long and too repetitive to
        actually use. Synthesis groups related pre-insights together and reframes each group into one
        higher-level, cross-cutting insight, the kind of observation a person would actually lead with in
        a meeting. Each synthesized insight has to clear a specific set of tests before it&apos;s kept:
        it has to be grounded in real evidence, say something non-obvious, name an actual tension rather
        than just restate a number, and be something you could plausibly act on or explicitly decide not
        to.
      </P>

      <H2>Why the final count is much smaller than the finding count</H2>
      <P>
        If a run produces 60 findings and surfaces 8 synthesized insights, that is not 52 findings being
        silently dropped. All 60 still exist as pre-insights, visible in the audit trail. The synthesis
        step is specifically designed to compress many related, overlapping findings into a small number
        of genuinely distinct, useful observations, the same way a good analyst would summarise a pile
        of data points into a handful of real takeaways rather than reading every number aloud.
      </P>

      <WhyBox>
        Quality scoring runs on both layers, pre-insights and synthesized insights, against a fixed
        rubric, so the system is checking its own synthesis work rather than assuming a grouped, reframed
        insight is automatically better just because it sounds more polished.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Keeps every pre-insight, even ones not used in any synthesized insight, visible in the audit trail",
          "Only keeps a synthesized insight that clears an explicit, multi-point validity check",
          "Lets you re-run synthesis without silently reprocessing or rewriting insights you've already accepted",
        ]}
        doesNot={[
          "Delete or hide a pre-insight just because it wasn't used in the final synthesized set",
          "Guarantee a synthesized insight is more important than one that stayed at the pre-insight level: synthesis groups for clarity, it doesn't rank by importance",
          "Produce identical synthesized insights on every rerun over the same material: see What this doesn't do yet for what's actually guaranteed about consistency",
        ]}
      />

      <ManualPageFooter currentSlug="insights" />
    </div>
  );
}
