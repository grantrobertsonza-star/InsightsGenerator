import { Article, H2, P, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What an insight is" },
  { id: "inputs", title: "What goes in" },
  { id: "preinsights", title: "Step one: a pre-insight for each finding" },
  { id: "modes", title: "Generate or validate" },
  { id: "synthesis", title: "Step two: synthesis" },
  { id: "gate", title: "The six-point gate" },
  { id: "confidence", title: "Confidence and thin evidence" },
  { id: "quality", title: "Quality scores" },
  { id: "statuses", title: "Accepting and rejecting" },
  { id: "limits", title: "Limitations" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Bender, E. M., Gebru, T., McMillan-Major, A., & Shmitchell, S. (2021). On the dangers of stochastic parrots: Can language models be too big? Proceedings of the 2021 ACM Conference on Fairness, Accountability, and Transparency, 610-623.",
    url: "https://doi.org/10.1145/3442188.3445922",
  },
  {
    citation:
      "Hill, A. B. (1965). The environment and disease: Association or causation? Proceedings of the Royal Society of Medicine, 58(5), 295-300.",
    url: "https://doi.org/10.1177/003591576505800503",
  },
  {
    citation:
      "Nickerson, R. S. (1998). Confirmation bias: A ubiquitous phenomenon in many guises. Review of General Psychology, 2(2), 175-220.",
    url: "https://doi.org/10.1037/1089-2680.2.2.175",
  },
  {
    citation:
      "Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), Article 248.",
    url: "https://doi.org/10.1145/3571730",
  },
];

export default function InsightsGuide() {
  return (
    <Article
      slug="insights"
      title="How insights are made and tested"
      lede="How verified findings become insights, what the synthesis step and its gate do, how confidence and quality are worked out, and where the method stops. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What an insight is</H2>
      <P>
        A finding says what the evidence shows. An insight says what it means and why it matters. The test the app
        applies is demanding: an insight should be supported by the evidence, not obvious, name a tension, and point
        to something someone could do. A statement that merely restates a number does not qualify, however accurate it
        is.
      </P>
      <P>
        Each insight in the app has four parts. A <strong>headline</strong> you could say in a sentence. An{" "}
        <strong>observation</strong> that states what the evidence shows. A <strong>tension</strong>, the thing that
        pulls two ways or does not add up, which is what makes it more than a fact. And an{" "}
        <strong>implication</strong>, what follows for the decision at hand.
      </P>
      <ExampleBox title="Finding versus insight">
        <p>
          Finding: &quot;Most small traders say they trust mobile money, yet most keep their working cash in a tin.&quot;
          That is two facts side by side.
        </p>
        <p className="mt-2">
          Insight: trust is not the barrier, so campaigns that build trust will probably not move behaviour. What
          may matter instead is how easily money moves back to cash when a supplier needs paying on the spot. The
          tension is between stated trust and revealed behaviour, and the implication is to test cash-out convenience
          before spending on reassurance.
        </p>
      </ExampleBox>

      <H2 id="inputs">What goes in</H2>
      <P>
        Only findings that passed verification as robust or use with caution feed insight generation. Not supported
        and insufficient information findings are left out, as are rejected ones. That filter matters: whatever weakness
        a finding has is carried forward into anything built on it, so the app stops it at the door.
      </P>
      <P>
        The insights stage also reads the framing you gave the run: the research objective, the business problem and,
        where one exists, the decision to be made. The more specific that framing is, the more targeted the insights
        will be.
      </P>

      <H2 id="preinsights">Step one: a pre-insight for each finding</H2>
      <P>
        For each eligible finding, a model drafts one pre-insight with the four parts above. This is done in batches
        of 15, up to 60 findings per pass. At this point the app has a lot of candidates and no judgement about which
        deserve to be kept: a pre-insight is a working note, not a conclusion. Many will be near the surface, because a
        single finding rarely supports much interpretation on its own.
      </P>
      <WhyBox>
        Going one finding to one insight produces a data dump. Ninety findings in and seventy-five &quot;insights&quot;
        out means nothing was generalised or selected. The second step exists to force that selection.
      </WhyBox>

      <H2 id="modes">Generate or validate</H2>
      <P>
        A run starts in one of two modes, and the mode changes the order of work.
      </P>
      <Table
        rows={[
          ["Mode", "Starting point", "What happens"],
          ["Generate", "You have data and no fixed question yet", "Insights are drawn from the evidence first. A decision is proposed afterwards, and you confirm or change it."],
          ["Validate", "You already know the decision, usually from a brief", "The decision is confirmed first and recorded as the decision context. Insights are written and filtered against it."],
        ]}
      />
      <P>
        Generate mode is better for exploring a new dataset. Validate mode is better when a client has a clear question,
        because relevance can be judged against something specific. The cost of generate mode is that interesting but
        unrelated insights can crowd the list.
      </P>

      <H2 id="synthesis">Step two: synthesis</H2>
      <P>
        Synthesis turns many pre-insights into fewer, stronger insights. It has three stages.
      </P>
      <OL>
        <li>
          <strong>Cluster.</strong> One model call sees every eligible pre-insight together (up to 60) and groups them
          the way you would group sticky notes on a wall: by shared underlying pattern, not by topic label. It has to
          see them all at once, because patterns across themes are only visible when everything is in view. Decision
          relevance is deliberately not applied here, since an early version that did so tended to exclude almost
          everything before grouping even began.
        </li>
        <li>
          <strong>Reframe and test.</strong> Each cluster with at least two members is reinterpreted around the
          tension that connects its members, then checked against the six-point gate below, plus a materiality test:
          would the decision change if this insight went away? A cluster of one is not promoted, because nothing has
          been compared against anything.
        </li>
        <li>
          <strong>Record.</strong> This stage is plain code. It counts how many pre-insights back each insight and how
          many distinct themes they come from, links the insight to every pre-insight behind it, and works out a
          confidence tier from the counts.
        </li>
      </OL>
      <P>
        A cluster that fails the gate is simply not promoted. Its pre-insights stay visible and nothing is deleted, so
        you can see what was considered and left behind. Synthesis is also incremental: a later pass only clusters
        pre-insights that have not been used yet. It will not quietly rewrite insights you have already reviewed or
        built recommendations on.
      </P>

      <H2 id="gate">The six-point gate</H2>
      <Table
        rows={[
          ["Test", "The question it asks"],
          ["Evidence-grounded", "Does the claim follow from the findings behind it, and nothing beyond them?"],
          ["Non-obvious", "Would a reasonable reader already have guessed it? A truism fails."],
          ["Names a tension", "Does it explain something that pulls two ways, rather than restate a fact?"],
          ["Feels true", "Would someone who knows this audience recognise it?"],
          ["Actionable", "Does a concrete next step follow? If not, it must be explicitly kept as no action."],
          ["Communicable", "Can it be said in one or two sentences?"],
        ]}
      />
      <P>
        The &quot;actionable&quot; test has a deliberate exit. An insight that is real and well evidenced but has no
        sensible action is kept and marked <em>retained, no action</em>, so it is not forced into a made-up
        recommendation. Insights with a clear next step are marked <em>has action</em>.
      </P>

      <H2 id="confidence">Confidence and thin evidence</H2>
      <P>
        Confidence is worked out by counting, not by asking the model how sure it is. Two numbers drive it: how many
        pre-insights support the insight (triangulation), and how many different themes they come from.
      </P>
      <Table
        rows={[
          ["Tier", "Rule"],
          ["Strong", "Supported by at least three pre-insights, drawn from at least two themes"],
          ["Moderate", "Either at least two themes, or at least three pre-insights, but not both"],
          ["Exploratory", "Neither: a small cluster from a single theme"],
        ]}
      />
      <P>
        An insight resting on the bare minimum of two supporting pre-insights carries a <strong>Thin evidence</strong>{" "}
        badge. Losing one finding could undo it. A fuller reproducibility check is available too: the app drops a
        quarter of the evidence at random, re-runs the grouping five times, and looks at whether the same insight
        reappears with at least half of its surviving members together. An insight that keeps reappearing is less
        likely to be an accident of one particular grouping. If every resample removes too much of its evidence, the
        result is reported as inconclusive, which is not a failure.
      </P>

      <H2 id="quality">Quality scores</H2>
      <P>
        Separately from the verdict on the underlying finding, each pre-insight is scored on how good an insight it
        actually is. There are five dimensions, each scored 1, 3 or 5: why (does it explain), actionability, novelty,
        synthesis (does it bring things together) and evidentiary proportionality (does the explanation stay within
        what the finding shows). The total runs from 5 to 25 and maps to a tier.
      </P>
      <Table
        rows={[
          ["Total", "Tier", "Reading"],
          ["15 or more", "Qualified", "A real insight"],
          ["12 to 14", "Partial", "Promising, needs sharpening"],
          ["Under 12", "Finding", "Still essentially a restated observation"],
        ]}
      />
      <P>
        Scoring never deletes or hides anything. A low score pushes an insight down the list and is a prompt to sharpen
        or drop it, but the decision stays with you. Recommendations built from insights have their own score on
        actionability, feasibility and evidence, with impact shown alongside but kept out of the total.
      </P>

      <H2 id="statuses">Accepting and rejecting</H2>
      <P>
        Insights are reviewed, not just produced. You can accept an insight, reject it, or leave it pending, and the
        status decides what flows on to recommendations and reports. Rejected insights stay visible rather than disappearing,
        and every insight keeps its links to the findings underneath it.
      </P>

      <H2 id="limits">Limitations</H2>
      <Limit title="The interpretation is a model&apos;s proposal">
        Naming a tension is an act of interpretation, and a model will find one if asked, even where the evidence is
        thin. Language models can produce fluent, confident text that is not well grounded in their inputs (Bender et
        al., 2021; Ji et al., 2023). The gate and the counts reduce that risk. They do not remove it, which is why
        every insight links back to its findings and why reading those findings is part of the job.
      </Limit>
      <Limit title="Triangulation counts are not independence">
        Three supporting pre-insights may all come from one report or one survey. The count shows how many pieces of
        evidence agree, not whether they were gathered independently. The theme count helps, but it is a rough proxy.
      </Limit>
      <Limit title="Clustering is not perfectly repeatable">
        Run again, the grouping can shift, particularly for borderline patterns. That is the reason for the
        reproducibility check, and also a reason to be wary of an insight that appears in one run and never again.
      </Limit>
      <Limit title="Association is not cause">
        Most evidence here is correlational. An insight that implies a cause (&quot;trust is not the barrier&quot;) is
        a hypothesis to test. Causal claims need more than co-occurrence; classic criteria such as consistency,
        plausibility and temporality are a useful checklist (Hill, 1965), and a pilot or experiment is
        better still.
      </Limit>
      <Limit title="Readers have biases too">
        An insight that fits what stakeholders already believe will be accepted too easily, and one that cuts against
        them will be questioned harder than the evidence deserves (Nickerson, 1998). Reviewers should apply the same
        scrutiny both ways, including to insights that please them.
      </Limit>
      <Limit title="Framing shapes the output">
        In validate mode, relevance is judged against the decision you gave. A poorly framed decision produces
        well-evidenced answers to the wrong question.
      </Limit>
      <DoesDoesNot
        does={[
          "Uses only verified findings, and carries their caveats forward.",
          "Groups related evidence and promotes only patterns that pass the six-point gate.",
          "Counts support in code and shows confidence, thin evidence and stability.",
          "Scores insight quality as a separate axis from evidence quality.",
          "Keeps rejected insights and unpromoted pre-insights visible.",
        ]}
        doesNot={[
          "Establish cause, or tell you what the client should do. It proposes, you decide.",
          "Guarantee that supporting evidence is independent.",
          "Replace reading the underlying findings and sources.",
          "Delete anything on a low score.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Fix the framing first. Write the decision or objective as precisely as you can.</li>
        <li>Review and verify findings before generating insights. Fixing a bad finding later costs more.</li>
        <li>Read each insight alongside its supporting findings. Ask whether the tension is really in the evidence.</li>
        <li>Treat thin evidence and exploratory tiers as questions worth testing, not conclusions.</li>
        <li>Run the reproducibility check on the insights you intend to lead with.</li>
        <li>Accept, reject or edit, then move on to recommendations with only the insights you would defend.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
