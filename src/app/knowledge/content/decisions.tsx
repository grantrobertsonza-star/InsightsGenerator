import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What a decision brief is" },
  { id: "proposing", title: "How candidates are proposed" },
  { id: "inputs", title: "What the framer reads" },
  { id: "links", title: "How decisions link to objectives and insights" },
  { id: "review", title: "The review workflow" },
  { id: "regenerate", title: "Regenerating suggestions" },
  { id: "downstream", title: "What changes when a decision is accepted" },
  { id: "limits", title: "Where it stops" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Tversky, A., & Kahneman, D. (1981). The framing of decisions and the psychology of choice. Science, 211(4481), 453-458.",
    url: "https://doi.org/10.1126/science.7455683",
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

export default function DecisionsGuide() {
  return (
    <Article
      slug="decisions"
      title="How decisions are framed and linked to evidence"
      lede="What the decision brief is, how candidate decisions are proposed from your evidence, how they connect to objectives, insights and recommendations, and where the connection is looser than it may look. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What a decision brief is</H2>
      <P>
        The decision brief is the screen where a project states the choices its research is meant to inform. A decision
        here is a fork a stakeholder faces, with a real option on each side. &quot;Whether to launch the loyalty tier
        in Q2 or hold until after the rebrand&quot; is a decision. &quot;Understand member attitudes to the loyalty
        programme&quot; is a research question, and the framer is explicitly told not to produce those.
      </P>
      <P>
        The wording matters more than it may seem. How a choice is framed can change what people prefer, even when the
        underlying options are the same (Tversky &amp; Kahneman, 1981). Writing each decision as a named choice, not a
        yes/no question, is an attempt to keep the framing neutral between the options.
      </P>
      <WhyBox>
        Decisions give the later stages something to be judged against. Without one, a recommendation can only be
        general advice. With one, the app can ask whether an insight pushes toward one option, complicates the choice,
        or leaves it alone.
      </WhyBox>

      <H2 id="proposing">How candidates are proposed</H2>
      <P>
        Candidates are proposed by a model in two separate passes. They are kept apart on purpose. A decision written
        straight from finding-level facts tends to come out shaped like a research question, so the first pass states
        what the evidence shows and the second pass works from that statement.
      </P>
      <OL>
        <li>
          <strong>Synthesis.</strong> The model writes two to four sentences on what the evidence collectively points
          to, hedged, and connected to your business problem or research objective when you gave one. This is saved on
          the run and shown on the left of the screen as &quot;What the evidence shows&quot;, so you can judge whether a
          candidate follows from it.
        </li>
        <li>
          <strong>Candidates.</strong> From that synthesis, the model proposes three to five decisions. Each comes with
          a short rationale naming the themes that bear on it and why a stakeholder would plausibly face the choice. It
          is told not to invent a decision the evidence has nothing to say about, and not to offer two candidates that
          are the same choice reworded.
        </li>
      </OL>
      <P>
        The framer runs automatically once documents have been processed and findings exist. You can also trigger it
        yourself with the button on the screen, labelled &quot;Get suggestions&quot; the first time and
        &quot;Regenerate suggestions&quot; afterwards. A failure in the automatic run is logged and does not interrupt
        whatever you were doing. A failure from the button is shown on the screen.
      </P>

      <H2 id="inputs">What the framer reads</H2>
      <P>What it reads depends on how the project was started.</P>
      <Table
        rows={[
          ["Project mode", "Evidence the framer reads", "If there is none"],
          ["Generate (mining raw data)", "Insights, each with its observation, tension and implication", "It stops with an error. It does not fall back to raw findings, because the ordering of findings, then insights, then a decision is deliberate."],
          ["Validate (testing a report's claims)", "Findings directly, since no insights exist yet at this point", "It stops with an error asking for at least one document's worth of findings."],
        ]}
      />
      <P>
        In both modes it is also given your business problem, your research objective and the intended audience, where
        you supplied them. It is told to treat the problem and objective as the strongest signal of what matters. If you
        gave neither, it works from the evidence alone and favours the more commercially concrete reading. At most 120
        findings or insights are passed in, ordered by theme.
      </P>
      <P>
        Your own upfront text is not treated as a decision. A business problem or an objective says why the research
        exists. It is rarely a choice between options. If you do have a decision in mind, add it yourself on the review
        screen.
      </P>

      <H2 id="links">How decisions link to objectives and insights</H2>
      <P>
        There are three kinds of link, and they differ in strength. It helps to know which is which.
      </P>
      <Table
        rows={[
          ["Link", "How it is made", "How strong it is"],
          ["Decision to evidence", "The framer reads the evidence, writes a synthesis, and names themes in each rationale", "Thematic. The rationale mentions themes, but no candidate is tied to specific finding or insight records."],
          ["Decision to objective", "The framer reads the objective text on the run, and the validation step later lists objectives and decisions side by side", "Textual. The framer reads the objective as a piece of text, not the accepted objective candidates as records."],
          ["Decision to insight", "In validate mode, each insight is written in light of the accepted decisions and stores them as its decision context. After analysis, each decision is checked against the accepted synthesized insights", "Judged by a model, and the result is stored with the insights it cites."],
        ]}
      />
      <H3>The disposition of each decision</H3>
      <P>
        Once synthesized insights have been accepted, the validation step takes every research objective and every
        accepted decision as a separate item and gives each one a status: resolved, partial, or gap. It also writes a
        short conclusion and records which insights it relied on. A decision that no accepted insight bears on is
        marked as a gap, which is a useful result in its own right. Decisions that came from the framer are flagged as
        inferred, so reports can show that their coverage is somewhat circular: the insights helped suggest the
        decision that they are then checked against.
      </P>
      <ExampleBox title="Reading a gap">
        <p>
          Suppose one accepted decision concerns pricing and none of your accepted insights touch price. The decision
          shows as a gap. Either the research did not cover pricing, or the framer proposed a decision the evidence
          could only loosely inform. The conclusion text and the rationale together usually show which.
        </p>
      </ExampleBox>

      <H2 id="review">The review workflow</H2>
      <P>
        Review works by exception, in the same spirit as findings. Every suggested decision lands already accepted, so
        the project can carry on without waiting for a click. You then edit, remove or add. More than one decision can be
        accepted at once, and a project can be organised around several.
      </P>
      <Table
        rows={[
          ["Action", "What it does"],
          ["Edit, then Save and accept", "Changes the wording and marks the candidate as edited. Edited candidates are protected from being replaced when suggestions are regenerated."],
          ["Reject (on a candidate that is not accepted)", "Moves it to a collapsed Rejected list, where it is kept and can be restored. Rejecting one never affects the others."],
          ["Restore", "Puts a rejected candidate back as accepted."],
          ["Accept all / Delete all", "Applies to every candidate that is still pending. Deleting is permanent."],
          ["Delete", "Removes a candidate for good. If it was accepted, the project decision statement is rebuilt from whatever remains accepted."],
          ["Add your own decision", "Writes a candidate labelled Your text, accepted straight away."],
        ]}
      />
      <P>
        Behind the screen, the accepted candidates are joined into one decision statement for the project. With a single
        accepted decision it is that text. With several, it becomes a numbered list. That statement is what the
        downstream stages read.
      </P>

      <H2 id="regenerate">Regenerating suggestions</H2>
      <P>
        Regenerating replaces the framer&apos;s earlier suggestions with a fresh batch. It removes suggested candidates
        that you have not edited, whether pending or accepted, and leaves alone anything you rejected, anything you
        edited, and anything you wrote yourself. The removal and the new insert happen together, so a failed attempt
        leaves the earlier list as it was. If the model returns nothing usable, you see an error and nothing changes.
      </P>
      <P>
        The new batch is also told which decisions are already accepted and asked not to restate them. Since that list
        can include suggestions about to be replaced, a regenerated set may drift away from the first set even when the
        evidence has not changed. If a particular candidate matters, edit it or write it yourself so it is kept.
      </P>

      <H2 id="downstream">What changes when a decision is accepted</H2>
      <UL>
        <li>
          <strong>Insights, validate mode.</strong> Insight generation waits for a decision. Once one is accepted,
          insights are generated against it, and each stores the decision text it was judged against.
        </li>
        <li>
          <strong>Insights, generate mode.</strong> Insights were already produced earlier without a decision, so
          accepting one mainly changes what comes after.
        </li>
        <li>
          <strong>Recommendations.</strong> In both modes, recommendations need a confirmed decision. Each action is
          written to serve the accepted decision or decisions.
        </li>
        <li>
          <strong>Objective and decision coverage.</strong> The dispositions described above are produced from the
          accepted decisions and the accepted synthesized insights.
        </li>
      </UL>
      <P>
        Accepting, restoring, adding or editing a decision triggers a refresh of insights and recommendations.
        Rejecting or deleting one updates the decision statement but, as the code stands, does not trigger that refresh,
        so downstream items may still reflect the earlier set until the next analysis run.
      </P>

      <H2 id="limits">Where it stops</H2>
      <Limit title="The link to evidence is thematic">
        A rationale names themes. It does not point to the particular findings or insights behind a candidate, so you
        cannot click through from a decision to its supporting records. Judging whether a candidate really follows from
        the evidence means reading the synthesis and the themes yourself.
      </Limit>
      <Limit title="Model proposals can be plausible and wrong">
        Both passes are written by a model, which can overstate, merge or misread (Ji et al., 2023). The only checks on
        the output are that each candidate has non-empty text and a rationale. Nothing verifies that a candidate is
        genuinely a choice between options, or that the wording avoids favouring one side.
      </Limit>
      <Limit title="The framer may read evidence you have set aside">
        From the queries it uses, the framer does not appear to filter findings or insights by review status or
        verdict. A finding you rejected, or one rated not supported, may still shape the synthesis. Treat the
        synthesis as a reading of everything extracted, not only of what you accepted.
      </Limit>
      <Limit title="Coverage of large projects is partial">
        Only 120 items are read, ordered by theme, so on a large project later themes may not be seen at all. The
        synthesis cannot be assumed to represent the whole body of evidence.
      </Limit>
      <Limit title="Auto-accepted does not mean endorsed">
        Suggestions arrive accepted so that work is not blocked, which means an unreviewed suggestion can steer
        recommendations. Skimming the list is worth doing early. It is easy to anchor on whichever framing arrives first
        and then read the evidence in its favour (Nickerson, 1998).
      </Limit>
      <Limit title="Taking back an acceptance is awkward">
        On a candidate that is already accepted, the controls are Edit, Unaccept and Delete. From the code, Unaccept
        appears to call the same action as Restore, which sets a candidate to accepted, so it may not change anything.
        Deleting is the dependable way to remove an accepted candidate, and it is permanent.
      </Limit>
      <Limit title="Circular coverage">
        In generate mode, decisions are suggested from the insights and then checked against the same insights. A
        resolved status on a suggested decision is weaker evidence than one on a decision you or a client stated
        independently.
      </Limit>
      <DoesDoesNot
        does={[
          "Proposes three to five decisions from a stated synthesis of the evidence, each with a rationale.",
          "Shows the synthesis so the reasoning can be checked.",
          "Lets you accept, edit, reject, restore, delete or add decisions, with several active at once.",
          "Passes the accepted decisions to insight generation, recommendations and coverage checks.",
          "Keeps your edited, rejected and self-written candidates through a regenerate.",
        ]}
        doesNot={[
          "Know which decision your client actually faces. Only you can supply that.",
          "Link a candidate to specific findings or insight records.",
          "Check that a candidate is a real choice, or that its wording is neutral.",
          "Exclude rejected or unsupported evidence from the synthesis.",
          "Prove that the evidence is enough to settle a decision. A resolved status is a model judgement.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Fill in the business problem and research objective before processing, since they carry the most weight.</li>
        <li>Read &quot;What the evidence shows&quot; first, and ask whether you would have said the same.</li>
        <li>Go through each candidate and check that it is a choice with two real sides. Edit the wording where it is not.</li>
        <li>Delete or reject candidates that belong to no real stakeholder, and add the ones the framer missed.</li>
        <li>After the insights are accepted, read the resolved, partial and gap statuses, and look hardest at the gaps.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
