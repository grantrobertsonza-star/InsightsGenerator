import { H1, Lede, H2, P, DoesDoesNot, WhyBox, ExampleBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function RawDataPage() {
  return (
    <div>
      <H1>Raw data and banner plans</H1>
      <Lede>Why a respondent-level dataset is not scanned automatically, and how to tell the app which comparisons you actually want.</Lede>

      <H2>The problem this solves</H2>
      <P>
        An already-aggregated table, a small cross-tab someone has already built, is safe to scan
        automatically for interesting patterns: there are only a handful of columns, and that kind of
        exploratory pass is standard, accepted practice in market research. A raw, respondent-level
        file is a different animal. It might have dozens or hundreds of columns, which means thousands
        of possible pairs to compare. Testing all of them automatically and reporting whatever comes out
        &quot;significant&quot; would produce a report full of findings that are, statistically, mostly
        noise dressed up as signal.
      </P>

      <ExampleBox>
        Flip ten fair coins ten separate times. Purely by chance, one of those ten tries will probably
        land mostly heads. That run doesn&apos;t mean the coin is biased, it means that trying enough
        things eventually produces something that looks notable. Scanning every column pair in a large
        raw dataset is the statistical equivalent of running that coin-flip experiment hundreds of
        times and reporting every unusual-looking result as a finding.
      </ExampleBox>

      <H2>What happens instead: a banner plan</H2>
      <P>
        When a table is flagged as raw, it is stored but not scanned. Instead, you tell the app which
        columns are the <strong>banner</strong> columns (the segmenting variables you actually want to
        compare across, like Gender or Age band) and which are the <strong>stub</strong> columns (the
        outcome measures you want to test against them, like satisfaction score or preferred channel).
        Naming a banner column compares every category inside it against every other by default,
        Male versus Female, say, which matches how a market-research tab plan is normally built: the
        discipline is in which columns you choose to name, not in restricting the pairs within one once
        you&apos;ve named it.
      </P>
      <P>
        Once you save a plan and click &quot;Compute banner comparisons,&quot; the app runs an actual
        statistical test (a two-proportion comparison for categorical outcomes, a difference-of-means
        test for numeric ones) for every category pair in each banner column against each stub column,
        and only keeps the ones that come out statistically significant. Every result it keeps carries
        two caveats as standard: <code>uncorrected_multiple_comparisons</code>, because even a chosen,
        bounded set of comparisons still carries some of that same chance-finding risk, just at a scale
        you control, and <code>sampling_assumed_random</code>, for the reason explained below.
      </P>

      <H2>SPSS, Stata, and SAS files</H2>
      <P>
        If your raw data comes from labelled statistical software, a <code>.sav</code>, <code>.dta</code>,
        or <code>.sas7bdat</code> file, the app reads it directly, including the variable labels (so a
        column literally named <code>Q7a</code> shows up as &quot;Preferred channel&quot; if that&apos;s
        its label) and value labels (so a code like <code>1</code> shows up as &quot;Male&quot; rather
        than a bare number) wherever your file defines them.
      </P>

      <WhyBox>
        The honest option, when a genuinely rigorous answer (a true stratified survey design, with
        design weights) isn&apos;t built yet, is to say so plainly rather than quietly approximate it
        and let a caveat tag do the disclosing on its own. That is exactly the situation here: a
        stratified-design statistical path is scoped for later, not built yet, see{" "}
        <em>What this doesn&apos;t do yet</em> for what that specifically means for your results today.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Lets you name exactly which columns to compare, rather than scanning everything automatically",
          "Runs a real statistical test for every comparison it produces, not a guess or an estimate",
          "Reads SPSS, Stata, and SAS files directly, labels and all",
          "Flags every banner-plan result as part of a multiple-comparisons batch, honestly, every time",
        ]}
        doesNot={[
          "Scan a raw table automatically the way it does an aggregated one: that is a deliberate choice, not a missing feature",
          "Apply a statistical correction (like a Bonferroni adjustment) for the multiple comparisons it runs: the risk is disclosed, not adjusted away, for now",
          "Account for a genuine stratified or weighted survey design yet: today's checks assume a simple random or quota sample",
        ]}
      />

      <ManualPageFooter currentSlug="raw-data" />
    </div>
  );
}
