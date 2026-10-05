import { H1, Lede, H2, P, DoesDoesNot, WhyBox, ExampleBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function VerificationPage() {
  return (
    <div>
      <H1>Verification and verdicts</H1>
      <Lede>How each finding gets checked, what the four verdict tiers mean, and a plain-language reading of every caveat you&apos;ll see.</Lede>

      <H2>The four verdict tiers</H2>
      <P><strong>Robust.</strong> The claim is well-supported by the evidence actually available in this run.</P>
      <P><strong>Use with caution.</strong> The claim has some support, but carries a real limitation worth knowing before you act on it, a small base size, an unverified sampling assumption, and so on.</P>
      <P><strong>Not supported.</strong> The evidence available does not back up the claim as stated.</P>
      <P><strong>Insufficient information.</strong> There simply isn&apos;t enough in the source material to judge the claim either way.</P>

      <H2>Caveats, in plain language</H2>
      <P>
        A caveat is a short, specific flag attached to a finding, telling you exactly what kind of
        limitation applies, rather than a vague warning. You&apos;ll see these as small badges on each
        pre-insight in the Insights tab. Here is what each one actually means:
      </P>

      <div className="my-4 space-y-3">
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold text-foreground">sampling_assumed_random</div>
          <div className="text-sm text-muted">
            The statistical test behind this finding assumes a simple random or quota sample. If your
            data actually came from a more complex survey design (stratified sampling with design
            weights), that detail isn&apos;t accounted for yet, see <em>What this doesn&apos;t do yet</em>.
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold text-foreground">base_size_small / base_size_borderline / base_size_unknown</div>
          <div className="text-sm text-muted">
            The number of respondents behind this specific finding is small, on the edge of being
            usable, or simply wasn&apos;t stated. A finding built on 12 people deserves far less weight
            than one built on 1,200, even if both come out &quot;statistically significant.&quot;
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold text-foreground">std_unknown</div>
          <div className="text-sm text-muted">
            A report states a mean or average (&quot;average satisfaction was 7.2&quot;) with no standard
            deviation, standard error, confidence interval, or range given alongside it. The figure is
            reported as stated, but how spread out the underlying scores actually were can&apos;t be
            assessed from this alone.
          </div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="text-sm font-semibold text-foreground">uncorrected_multiple_comparisons</div>
          <div className="text-sm text-muted">
            This finding is one of several comparisons tested at once, and no statistical correction for
            that has been applied. The more comparisons you run, the more likely one looks
            &quot;significant&quot; purely by chance. See the uploading page for a worked example of why
            this matters.
          </div>
        </div>
      </div>

      <ExampleBox title="How to read a verdict in practice">
        &quot;Customers in Region A are 15% more likely to churn than Region B&quot;, tagged{" "}
        <strong>use with caution</strong> with <code>base_size_borderline</code> and{" "}
        <code>uncorrected_multiple_comparisons</code>, means: the gap is real in this data, it came out
        of a batch of several comparisons so there&apos;s a real chance it&apos;s one of the occasional
        false positives that batch testing produces, and the group it&apos;s based on is on the small
        side. Worth a second look before it drives a decision on its own, not worth dismissing outright.
      </ExampleBox>

      <WhyBox>
        A caveat is not an apology for the finding and it is not a reason to ignore it. It is the
        specific piece of context a careful human analyst would want before deciding how much weight to
        put on a number. Showing it by default, on every finding it applies to, is what lets you trust
        the findings that have no caveats attached at all.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Recomputes margin of error and significance directly from the numbers in your source, rather than trusting a report's own stated figures",
          "Flags small or unstated base sizes, and a mean reported with no spread measure, automatically on every finding they apply to",
          "Shows every caveat as a visible badge on each pre-insight in the Insights tab, not just a value sitting unseen in the database",
        ]}
        doesNot={[
          "Promise that a 'robust' verdict means the underlying research design itself was sound: it means the evidence actually supplied backs up the claim",
          "Apply a statistical correction for running many comparisons at once: that risk is disclosed via the caveat, not adjusted away",
          "Show these caveat badges on the raw pending-findings list before review, or on synthesized insights: those use their own separate checks",
        ]}
      />

      <ManualPageFooter currentSlug="verification" />
    </div>
  );
}
