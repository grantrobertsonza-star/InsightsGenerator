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

      <H2>Initial import exclusions</H2>
      <P>
        SAS files and columns-as-cases workbooks with a separate Codebook declaring weights or
        multiple-response sets are excluded pending verification. The latter combination is refused
        before analytical results are produced. Re-export with one row per respondent, retain the
        Codebook definitions, upload again and verify the weight and multiple-response setup.
        Removing those definitions to bypass the check is not a supported recovery.
      </P>

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

      <H2>Survey design is modelled only where you name it</H2>
      <P>
        Cross tabs and the Net Promoter Score take a survey design into account when you name a PSU
        (cluster) variable, and ideally a strata variable, for the data file: their variances use Taylor
        series linearisation and the result is tagged <code>survey_design_modelled</code>. Without a named
        design, and in the automatic scan of an aggregated table or a banner plan against raw data, every
        check (margin of error, significance tests, base-size flags) assumes a simple random or quota
        sample. Results are still computed and still useful, and they are tagged{" "}
        <code>sampling_assumed_random</code> to say so.
      </P>

      <H2>Correction for testing many things at once is not applied everywhere</H2>
      <P>
        Cross tabs built in the app correct their column tests for the many comparisons in a table, with
        a false discovery rate correction by default (the setting is under Table settings). The
        automatic scan of an aggregated table and a banner plan against raw data apply no such
        correction: the risk that testing more things makes something look significant by chance is
        disclosed every time, via the <code>uncorrected_multiple_comparisons</code> caveat, rather than
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
