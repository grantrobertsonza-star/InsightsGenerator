import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What an objective is here" },
  { id: "origins", title: "Where objectives come from" },
  { id: "framing", title: "How suggested objectives are framed" },
  { id: "rules", title: "The rules that apply on the way in" },
  { id: "scoring", title: "Quality scoring: four dimensions" },
  { id: "coverage", title: "Coverage against the insights" },
  { id: "workflow", title: "The review workflow" },
  { id: "limits", title: "Where it stops" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Braun, V., & Clarke, V. (2006). Using thematic analysis in psychology. Qualitative Research in Psychology, 3(2), 77-101.",
    url: "https://doi.org/10.1191/1478088706qp063oa",
  },
  {
    citation:
      "Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), Article 248.",
    url: "https://doi.org/10.1145/3571730",
  },
  {
    citation:
      "Kerr, N. L. (1998). HARKing: Hypothesizing after the results are known. Personality and Social Psychology Review, 2(3), 196-217.",
    url: "https://doi.org/10.1207/s15327957pspr0203_4",
  },
];

export default function ObjectiveGuide() {
  return (
    <Article
      slug="objectives"
      title="How objectives are framed and checked"
      lede="Where a project's research objectives come from, how the app words, scores and tracks them, and how it checks whether the accepted insights answer them. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What an objective is here</H2>
      <P>
        An objective is a statement of what the project set out to learn, written as a question or an aim rather than
        a result. &quot;To determine whether price or service quality drives lapsed-member churn more&quot; is an
        objective. &quot;Price is the main driver of churn&quot; is a finding wearing an objective&apos;s clothes, and
        the app steers away from that form.
      </P>
      <P>
        Objectives matter because they are the yardstick for the rest of the work. Findings and insights are
        discovered without reference to them. Objectives come in at the end, as the test of whether the project
        delivered what it was commissioned to deliver. Each objective is kept as its own item, so it can be accepted,
        edited, scored and checked one at a time.
      </P>
      <WhyBox>
        Discovery stays objective-agnostic on purpose. If findings and insights were steered toward the objectives
        from the start, anything that did not fit the nearest objective would be forced into it or never surface. The
        thematic analysis literature warns about exactly this kind of early fitting (Braun &amp; Clarke, 2006).
        Mapping against objectives once, at the end, lets one insight bear on several objectives, lets one objective
        need several insights, and lets some insights bear on none.
      </WhyBox>

      <H2 id="origins">Where objectives come from</H2>
      <P>
        Every objective carries a source, and the source shapes how much the app trusts it.
      </P>
      <Table
        rows={[
          ["Tag in the table", "Where it comes from", "Starting status"],
          ["Stated", "Typed by you at project set-up or added later in the review table, or taken from a brief or proposal you uploaded", "Accepted straight away"],
          ["Inferred", "Proposed by the app from the project's findings, when you stated no objective of your own", "Accepted automatically"],
          ["Suggested", "Proposed by the app from the findings, when you did already state at least one objective", "Pending until you accept it"],
        ]}
      />
      <H3>Provided: typed or read from a brief</H3>
      <P>
        At set-up you can type objectives, upload a brief, upload a proposal, or combine them. When a document is
        supplied, a model reads it and returns two things: the business problem, and the research objectives, numbered
        if there is more than one. If both a brief and a proposal are given, the proposal is treated as the more
        considered statement where it is sharper, and the two are reconciled into one set. Anything you typed takes
        priority over what was extracted. If the document cannot be read, what you typed is still saved and the failure
        is logged quietly.
      </P>
      <P>
        The objective box only adds. Lines you save are split into separate objectives, ignoring bullets and numbering,
        and a line identical to one already saved is not added twice. Editing or removing a saved objective is done
        one at a time from the list.
      </P>
      <H3>Deduced: proposed from the evidence</H3>
      <P>
        Once a project has findings, you can ask for suggestions. The app reads up to 120 of the project&apos;s
        findings, grouped by theme, together with the business problem and any objectives you stated, and proposes
        three to five candidates. Each comes with a short rationale naming the themes that support it. You can ask for
        more at any time with <em>Suggest objectives from these findings</em>, and from the coverage panel for
        insights that no objective points at.
      </P>
      <P>
        Re-running replaces the earlier suggestions that you never touched. Suggestions you edited, objectives you
        stated and anything you rejected are left alone. The app is also told not to restate an objective that has
        already been accepted.
      </P>

      <H2 id="framing">How suggested objectives are framed</H2>
      <P>
        The model is asked to write each candidate in ordinary research-brief form: &quot;To determine
        whether...&quot;, &quot;To assess the relationship between...&quot;, &quot;To understand...&quot;. It is told
        to state what the project sets out to learn and not a conclusion already reached, and to keep the wording of the
        objective itself free of hedging. The reasoning about which evidence supports it belongs in the rationale.
      </P>
      <P>
        There is a methodological reason behind this. Proposing a hypothesis after seeing the results, then presenting
        the same results as a test of it, is a recognised problem (Kerr, 1998). The app works on documents that already
        exist, so a deduced objective is a reconstruction of the question the evidence appears to address. It is not a
        hypothesis that the evidence has confirmed. For that reason the model is told to be guided by your own stated
        objective far more than by the findings list, and the checks below treat deduced objectives differently from
        stated ones.
      </P>
      <ExampleBox title="Objective or finding?">
        <p>
          &quot;To determine whether price sensitivity or service dissatisfaction is the stronger driver of member
          churn&quot; names the question and leaves the answer open. &quot;Price sensitivity is the main driver of
          member churn&quot; states an answer, so it would be treated as a claim to verify and not as an objective.
        </p>
      </ExampleBox>

      <H2 id="rules">The rules that apply on the way in</H2>
      <P>
        Most of the framing guidance lives in the instructions given to the model. The rules enforced in code are
        fewer and plainer.
      </P>
      <UL>
        <li>A suggested candidate is kept only if it has both objective text and a rationale. Candidates missing either are dropped. If none survive, nothing is changed and you are asked to try again.</li>
        <li>Suggestions need at least one extracted, generated or coded finding to work from. With none, the request fails with a message saying so.</li>
        <li>Your own starting objective is carried into the list as a candidate in its own right, matched on trimmed text so it never appears twice.</li>
        <li>Suggestions arrive accepted only when you stated no objective. Otherwise they wait as pending, because you have already said what the project is for.</li>
        <li>The project&apos;s working objective is rebuilt from the accepted items every time one changes: a single objective as written, several as a numbered list, with stated ones ahead of suggested ones.</li>
      </UL>
      <P>
        Nothing in code tests whether a typed objective is well formed. Wording quality is the job of the scoring step.
      </P>

      <H2 id="scoring">Quality scoring: four dimensions</H2>
      <P>
        Each accepted objective is scored from 1 to 5 on four dimensions, but only the values 1, 3 and 5 are allowed.
        There is no 2 or 4, which keeps the scorer from hedging in the middle. The four are added to give a total out
        of 20.
      </P>
      <Table
        rows={[
          ["Dimension", "1 means", "5 means"],
          ["Specific", "A topic or a wish, such as &quot;understand customers&quot;", "Names who, which behaviour or attitude, and in what context, so two researchers would read it the same way"],
          ["Measurable", "No observation could tell you it had been answered", "Implies a clear measure or comparison, and what result would answer it"],
          ["Answerable with the data supplied", "Nothing the project holds could speak to it", "The uploaded documents, findings or variables plainly contain what is needed"],
          ["Relevant to the decision", "No clear link to the decision", "Its answer would directly inform or change the decision"],
        ]}
      />
      <P>
        A total of 16 or more is rated <strong>Strong</strong>, 12 to 15 <strong>Workable</strong>, and below 12{" "}
        <strong>Needs work</strong>. Each objective also gets a one-sentence rationale naming the reason for its
        weakest score and, unless every dimension scored 5, a one-sentence suggestion for rewording it. These appear
        under the objective as &quot;To sharpen it&quot;, and the rationale shows when you hover over the rating.
      </P>
      <H3>What &quot;answerable&quot; looks at</H3>
      <P>
        This dimension is judged against an inventory the app builds at scoring time: the names and kinds of the
        uploaded documents, the number of non-rejected findings by origin and type, and up to 60 distinct variable
        names from imported tables. It lists what exists and says nothing about what it shows, so the score is about
        coverage and not about results. If nothing has been uploaded, the dimension is scored 3 and the rationale says
        so. Likewise, relevance is scored 3 when there is neither a decision statement nor a business problem to
        judge against.
      </P>
      <H3>When scoring runs</H3>
      <P>
        Scores are tied to the objective&apos;s text. An unchanged list is not rescored, an edited one is, and
        <em> Rescore objectives</em> forces a fresh pass. Scoring also runs after you accept, restore or add an
        objective. Because the inventory is read at the moment of scoring, rescore after adding data. Up to 20
        objectives are scored in a single pass. A failure in the automatic run is logged and does not interrupt what
        you were doing.
      </P>

      <H2 id="coverage">Coverage against the insights</H2>
      <P>
        Coverage asks whether the project&apos;s <em>accepted synthesized insights</em> actually answer each
        objective and each confirmed decision. It needs at least one accepted insight and at least one objective or
        decision, and it runs only after synthesis, against the final accepted set.
      </P>
      <Table
        rows={[
          ["Status shown", "Meaning"],
          ["Answered", "The evidence gives a clear, well-supported answer"],
          ["Partly answered", "Some relevant evidence exists, but it does not fully settle the question or rests on weaker confidence"],
          ["Gap", "No accepted insight bears on this item. The model is told to say so plainly and not to stretch a loosely related insight"],
        ]}
      />
      <P>
        Every item gets a short conclusion (capped at 35 words) and a list of the insights that bear on it. The
        mapping is many to many. If the model returns nothing usable for an item, that item defaults to Gap with a note
        that it has not been assessed, which is why a Gap on a fresh run is worth rechecking before you act on it.
      </P>
      <H3>Inferred objectives get no verdict</H3>
      <P>
        An objective the app deduced from this project&apos;s own evidence cannot fairly be tested against that same
        evidence, because the test would be circular. In the coverage panel these items are labelled <strong>Inferred</strong>{" "}
        and show no Answered, Partly answered or Gap status. The same applies to decisions the app proposed. Add an
        objective of your own if you want a real check.
      </P>
      <H3>Evidence without an objective</H3>
      <P>
        The panel also lists accepted insights that no <em>stated</em> objective or decision points at. These are real
        findings the project did not ask about. Because the list is built from stated items only, it appears once at
        least one stated objective exists and the check has run. If every objective was inferred, the panel says
        nothing falls outside them, since that would be true by construction. The button beside the list asks the
        framer for objectives that these insights would answer, and names the insights in the rationale.
      </P>

      <H2 id="workflow">The review workflow</H2>
      <P>
        Objectives are reviewed in one table, with a row per objective showing its tag, the four scores, the total, the
        rating and the actions.
      </P>
      <Table
        rows={[
          ["Action", "What it does"],
          ["Accept / Unaccept", "Puts an objective in or out of play. Only accepted objectives are scored and checked"],
          ["Edit", "Saves your wording and accepts it. A changed text is marked Edited, which protects it from being cleared when suggestions are regenerated"],
          ["Reject / Restore", "Sets an objective aside without deleting it. Restoring returns it to accepted"],
          ["Delete", "Removes it permanently, after a confirmation"],
          ["Accept all suggested", "Accepts every pending suggestion as it stands"],
          ["Regenerate suggestions", "Asks the framer for a fresh set, replacing untouched suggestions only"],
          ["Remove suggested", "Deletes suggestions you have not edited. Stated and edited objectives stay"],
          ["Score / Rescore", "Runs the four-dimension scorer"],
          ["Check now / Check again", "Runs the coverage check"],
        ]}
      />
      <P>
        Accepting, restoring, adding and regenerating also trigger scoring and a coverage refresh in the background.
        Rejecting and deleting do not, so after either one the coverage panel may still reflect the earlier list until
        you press <em>Check again</em>. Likewise, new insights accepted after the last check are not reflected until the
        check is run again.
      </P>

      <H2 id="limits">Where it stops</H2>
      <Limit title="Scores are a model&apos;s judgement">
        The four scores and the coverage statuses come from a language model working to written criteria. A borderline
        objective can land in a neighbouring band on a second run, and models can misread or overstate (Ji et al.,
        2023). Treat the score as a prompt to reread the wording, not as a measurement. The rationale is there so you
        can disagree with it.
      </Limit>
      <Limit title="A strong score is not a good objective">
        The score judges wording, fit with the uploaded data and link to the decision. It cannot tell whether the
        objective is the right one for your client, or whether the study design could ever answer it.
      </Limit>
      <Limit title="Answerable depends on what has been uploaded">
        The inventory lists documents, finding counts and variable names. It does not read the contents, and it caps
        the variable list at 60. An objective can score well on this dimension because a relevant-sounding variable
        exists, even when the data behind it is too thin to answer.
      </Limit>
      <Limit title="Deduced objectives are reconstructions">
        They describe what the evidence looks arranged to address. They are useful for spotting what a report implicitly
        asked, and they are not a substitute for the question you commissioned. The app does not test them, for the
        circularity reason given above.
      </Limit>
      <Limit title="Coverage is only as good as the accepted insights">
        A Gap may mean the project did not answer the question, or that the relevant insight was rejected, never
        generated, or not yet synthesized. A model-written conclusion can also overstate how much a loosely related
        insight settles. Read the linked insights before relying on a status.
      </Limit>
      <Limit title="Checks can go stale">
        Scores reflect the data at the time of scoring, and coverage reflects the accepted insights at the time of the
        last check. Neither updates itself after every change.
      </Limit>
      <DoesDoesNot
        does={[
          "Takes objectives from what you type, from a brief or proposal, or from suggestions drawn from the findings.",
          "Words suggested objectives as research-brief aims, with a rationale naming the supporting themes.",
          "Scores each accepted objective on four dimensions and gives a reason and a rewording suggestion.",
          "Checks each stated objective and decision against the accepted insights and marks it Answered, Partly answered or Gap.",
          "Lists accepted insights that no stated objective points at.",
        ]}
        doesNot={[
          "Decide whether an objective is the right question for the client.",
          "Test deduced objectives against the evidence they were deduced from.",
          "Read the contents of your data when judging whether an objective is answerable.",
          "Refresh scores and coverage after every change, or guarantee a Gap is a true gap.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>State your objectives at set-up, or upload the brief or proposal and check the objectives it extracted.</li>
        <li>Add the data, then score the objectives so that the answerable dimension reflects what you hold.</li>
        <li>Reword anything rated Needs work using the suggestion, and read the rationale before accepting it.</li>
        <li>If you stated none, review the suggested objectives critically and edit or reject the ones that are not your question.</li>
        <li>After synthesis, run the coverage check and read the insights behind each status.</li>
        <li>Look at the evidence without an objective, since it is either a missed question or noise.</li>
        <li>Check again after any change to objectives or accepted insights.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
