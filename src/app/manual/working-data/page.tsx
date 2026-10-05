import { H1, Lede, H2, P, DoesDoesNot, WhyBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function WorkingDataPage() {
  return (
    <div>
      <H1>The audit trail</H1>
      <Lede>Why nothing in this app is ever silently deleted, and where to find it if it isn&apos;t.</Lede>

      <H2>Three tabs, three complete records</H2>
      <P>
        Beneath the main report sits the working data section, split into three tabs: every pre-insight
        generated, every recommendation generated, and a history of anything removed or superseded.
        Each tab is computed in full regardless of which one you&apos;re currently looking at, so
        switching tabs never triggers new processing, it just changes what&apos;s shown.
      </P>

      <H2>What happens to a rejected finding</H2>
      <P>
        Rejecting a finding doesn&apos;t erase it. It moves into the history record, with the reason it
        was superseded or removed, so the fact that it was considered and why it didn&apos;t make the cut
        stays visible. If you re-run extraction or synthesis later, nothing that was already accepted
        gets silently regenerated or overwritten either: the system only processes material that is
        genuinely new since the last time it ran.
      </P>

      <WhyBox>
        A system whose core promise is trustworthy evidence has to hold its own internal record to the
        same standard. If a &quot;regenerate&quot; or &quot;re-run&quot; action could quietly erase or
        rewrite something you&apos;d already reviewed and accepted, every review you&apos;d ever done
        would be worth less than it looks. The audit trail exists specifically so that re-running a stage
        is always safe.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Keeps a complete, append-only record of every finding, insight, and recommendation ever generated",
          "Shows exactly why something was removed or superseded, not just that it was",
          "Only reprocesses genuinely new material on a re-run, leaving already-accepted work untouched",
        ]}
        doesNot={[
          "Permanently delete a finding when you reject it: it moves to history, it doesn't vanish",
          "Silently overwrite an accepted insight if you click re-run on an earlier stage",
          "Hide the fact that something was dropped: a drop is always a visible, explained event, never a quiet omission",
        ]}
      />

      <ManualPageFooter currentSlug="working-data" />
    </div>
  );
}
