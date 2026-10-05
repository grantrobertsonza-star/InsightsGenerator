import { H1, Lede, H2, P, DoesDoesNot, WhyBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function RecommendationsPage() {
  return (
    <div>
      <H1>Recommendations</H1>
      <Lede>What gets turned into a proposed action, and why the choice of what to actually do stays yours.</Lede>

      <H2>Two layers, matching the two insight layers</H2>
      <P>
        Every pre-insight gets its own recommendation, part of the full audit trail. Every accepted
        synthesized insight also gets at least one recommendation of its own, the headline recommendations
        a client is actually meant to read. A synthesized insight can produce more than one recommendation
        if more than one genuinely distinct action is actually warranted; the system doesn&apos;t force a
        single action where two real ones exist.
      </P>

      <H2>What a recommendation actually contains</H2>
      <P>
        Each one includes the proposed action itself, a suggested owner role, a feasibility note, a
        timeline, a success metric, and the assumptions or risks behind it. The idea is a recommendation
        you could hand to someone and have them know what to do next, not a vague directional statement
        like &quot;improve customer experience.&quot;
      </P>

      <WhyBox>
        A recommendation is a proposal built from the evidence, not a decision made on your behalf. It
        names a specific owner and a specific metric so it&apos;s easy to evaluate and easy to say no to,
        but the system has no visibility into your organisation&apos;s politics, capacity, or competing
        priorities, the things that actually decide whether a recommendation is the right call right now.
        That judgment is yours.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Proposes a specific, owned, timed action for every surviving insight, with a stated success metric",
          "Allows more than one recommendation per insight when more than one distinct action is genuinely warranted",
          "Keeps the full recommendation set generated for every pre-insight, not only the headline ones",
        ]}
        doesNot={[
          "Decide for you whether a recommendation is worth acting on: it proposes, you decide",
          "Know your organisation's internal constraints, budget, or politics: the feasibility note is a starting estimate, not a verified plan",
          "Guarantee the suggested owner role actually has authority over what's being asked: check that before assigning it",
        ]}
      />

      <ManualPageFooter currentSlug="recommendations" />
    </div>
  );
}
