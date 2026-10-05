import { H1, Lede, H2, P, WhyBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function LimitsPage() {
  return (
    <div>
      <H1>What this doesn&apos;t do yet</H1>
      <Lede>
        A plain, consolidated list of real current boundaries. Trusting a system&apos;s output starts
        with knowing exactly where that trust should stop.
      </Lede>

      <H2>No memory across engagements, yet</H2>
      <P>
        Checking happens within a single run, against the material you&apos;ve supplied for that run.
        There is no persistent store yet of everything a client has ever given you, which a new report
        could be cross-checked against. If a new report contradicts something from an earlier
        engagement, the system won&apos;t catch that on its own today.
      </P>

      <H2>No simulated respondents, bias auditor, or gap-finder</H2>
      <P>
        The original design for this system includes agents that generate persona-grounded reactions to
        a draft narrative, audit for consumer-psychology and stakeholder cognitive biases, and identify
        what the original research didn&apos;t cover. None of those three are built yet. What exists
        today covers extraction, verification, insight generation, synthesis, and recommendations.
      </P>

      <H2>No genuine stratified survey-design statistics, yet</H2>
      <P>
        Every statistical check today, margin of error, significance tests, base-size flags, assumes a
        simple random or quota sample. If your data actually comes from a stratified probability sample
        with design weights, that detail isn&apos;t recovered: results are still computed and still
        useful, but they&apos;re computed as though the simpler sampling assumption held, and tagged{" "}
        <code>sampling_assumed_random</code> to say so. A genuine stratified-design statistical path is
        scoped for later, not approximated now.
      </P>

      <H2>No automatic correction for testing many things at once</H2>
      <P>
        When several comparisons are tested together, whether in an exploratory scan of an aggregated
        table or a banner plan against raw data, no statistical correction (like a Bonferroni adjustment)
        is applied to account for the fact that testing more things increases the odds something looks
        significant by chance. The risk is disclosed, via the{" "}
        <code>uncorrected_multiple_comparisons</code> caveat, every time it applies, rather than
        corrected away.
      </P>

      <H2>Output isn&apos;t perfectly identical on every rerun</H2>
      <P>
        The judgment-type steps, clustering related findings, scoring quality, assigning a verdict, are
        set to run with minimal randomness, which sharply reduces run-to-run variation on the same
        material. It does not guarantee byte-for-byte identical output every time: large hosted AI
        models retain a small amount of residual variation in how requests are processed. The honest
        claim is &quot;much more consistent,&quot; not &quot;perfectly deterministic.&quot;
      </P>

      <H2>Extraction can still make mistakes</H2>
      <P>
        Reading a narrative document for claims is a genuinely hard task, and it is done by an AI model,
        not a fixed parser. It is good at this, not infallible. This is the actual reason every finding
        starts as pending rather than accepted, and why a human review step exists at all: it is the
        real safeguard, not a formality.
      </P>

      <WhyBox>
        Every item on this page is a real, specific boundary, not a blanket disclaimer. Each one is tied
        to a caveat, a status field, or a described future piece of work you can track, rather than a
        vague &quot;AI can be wrong&quot; warning that tells you nothing about where to actually be
        careful.
      </WhyBox>

      <ManualPageFooter currentSlug="limits" />
    </div>
  );
}
