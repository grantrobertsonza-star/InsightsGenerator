import { Article, H2, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What the assistant is for" },
  { id: "anywhere", title: "Asking from any page" },
  { id: "reads", title: "What it reads" },
  { id: "guides", title: "Questions about how the app works" },
  { id: "data", title: "Questions about the data" },
  { id: "sample", title: "Sample sizes and margins of error" },
  { id: "advice", title: "General research advice" },
  { id: "report", title: "Changes to the report" },
  { id: "limits", title: "Where it stops" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation: "Cochran, W. G. (1977). Sampling techniques (3rd ed.). Wiley.",
    url: "https://www.wiley.com/en-us/Sampling+Techniques%2C+3rd+Edition-p-9780471162407",
  },
  {
    citation: "Kish, L. (1965). Survey sampling. Wiley.",
    url: "https://gov.wiley.com/WileyCDA/WileyTitle/productCd-0471109495,descCd-authorInfo.html",
  },
  {
    citation:
      "Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), Article 248.",
    url: "https://doi.org/10.1145/3571730",
  },
];

export default function ResearchAssistantGuide() {
  return (
    <Article
      slug="research-assistant"
      title="How the Research assistant works"
      lede="What the assistant reads, how it answers questions about your data with tables you can open, how it works out sample sizes and margins of error, and where its answers should be checked. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What the assistant is for</H2>
      <P>
        The Research assistant is a chat for one project, under Tools, and from the Ask the assistant button on every
        page. It answers questions about the project&apos;s accepted evidence and report, answers questions about the
        project&apos;s data by building cross tables, explains how the app works from this Knowledge base and the
        Manual, gives general research advice, and rewrites a part of the Insights Report when you ask.
      </P>
      <WhyBox>
        A model is good at planning and explaining and unreliable at arithmetic. So the assistant plans the table and
        the app builds it; it chooses the inputs for a sample size and the app works it out. Any figure it quotes about
        your data or your sample should trace back to a table or a calculation you can see.
      </WhyBox>

      <H2 id="anywhere">Asking from any page</H2>
      <P>
        The Ask the assistant button sits in the bottom-right corner of every page. It opens the assistant in a small
        window on the right, so most of the page you are working on stays in view and usable. Drag the window by its
        title bar to move it out of the way, or use the arrow keys on its move handle. Drag its bottom-left corner to make
        it bigger or smaller (or use the arrow keys on that corner). A double-click on the title bar, or Home, puts it back
        as it opened. Where you leave it, and its size, are remembered in this browser. Esc or the
        close button puts it away. On a phone it fills the bottom of the screen instead.
      </P>
      <UL>
        <li>
          <strong>Inside a project</strong> it is the same conversation as the Research assistant section, saved with the
          project, and it is told which section you asked from, so &quot;what does this mean?&quot; on Findings is read as
          a question about Findings. The button is hidden on the Research assistant section itself, where the
          conversation is already on the page.
        </li>
        <li>
          <strong>Outside a project</strong> (the dashboard, Programs, this Knowledge base, the Manual) it answers questions
          about how the app works and about research method. It has no project data there, and the chat is not saved:
          it lasts until the browser tab is closed or reloaded.
        </li>
      </UL>

      <P>
        A question that cannot be answered (a lost connection, an error) stays in the panel of the project you asked it
        in, with the reason and a Send again button, also after you move to another page and back (not after a reload).
        When the connection drops, the answer may already have been saved: the panel reads the project&apos;s
        conversation again and shows the saved answer if it is there. Sending a question again never stores it twice;
        an answer already saved is shown instead of being asked again. An answer that was cut off for length, or came
        back empty, is not shown: the assistant says so and asks you to ask again.
      </P>

      <H2 id="reads">What it reads</H2>
      <P>
        Each message is answered from the project&apos;s business problem, objective, decision statement and audience,
        the generated report narrative if there is one, accepted insights and recommendations, the objective coverage
        statuses, and accepted findings rated robust or use with caution. Larger projects are cut to the first 80
        findings, 60 insights and 40 recommendations. The last 20 messages of the conversation go with it, so a follow-up
        such as &quot;and by region?&quot; is read in context.
      </P>

      <H2 id="guides">Questions about how the app works</H2>
      <P>
        For a question about a screen, a method or a limit, the assistant searches the Knowledge base and the Manual and
        reads the sections that fit, then answers from them. The reply ends with a line naming the guides it read, with
        links, so you can read the source yourself. When the guides do not cover something, it is told to say so rather
        than describe behaviour it has not read.
      </P>

      <H2 id="data">Questions about the data</H2>
      <P>
        When a question needs figures, the assistant lists the project&apos;s data files, searches their variables, and
        asks for a table. The request goes through the same checks as SemanticTabs: every variable must exist in the
        file, and filters must use real categories. The table is then built by the same engine as every other cross
        table, with the file&apos;s weight unless you ask for unweighted figures, and with its saved survey design for
        the significance tests.
      </P>
      <P>
        Each table is saved as a draft under Cross tabs, All tables, with a Research assistant badge. The reply ends with
        a line naming the tables built for it, so you can open the table, check the base and the marks, and then commit
        it into findings or delete it. At most four tables are built for one message.
      </P>
      <ExampleBox>
        &quot;Is satisfaction different by gender?&quot; builds Overall satisfaction by Gender. The reply quotes the
        shares from that table, says whether it was weighted, and calls a difference significant only when the table
        marks it.
      </ExampleBox>
      <P>
        If a step fails (the variables cannot be read, the design set-up cannot be read, a variable does not exist), the
        assistant is told so and no table is built. It is not given a default design or weight in place of the one that
        could not be read.
      </P>

      <H2 id="sample">Sample sizes and margins of error</H2>
      <P>
        Questions such as &quot;what sample do I need for a 5% margin of error?&quot; or &quot;what is the margin of
        error on 400 interviews?&quot; are worked out by a calculator in the app, and the reply shows its working and
        assumptions. The method is the standard one for a proportion (Cochran, 1977), with one model used in both
        directions, so the sample size for a margin gives that margin back:
      </P>
      <UL>
        <li>The margin for n interviews: e = z × √(deff × p × (1 − p) ÷ n), with p = 50% unless you give an expected share.</li>
        <li>
          The design effect (deff) for clustered or weighted samples (Kish, 1965) sits inside the variance; it is 1 for a
          simple random sample.
        </li>
        <li>With a known population N, the margin is multiplied by √((N − n) ÷ (N − 1)).</li>
        <li>
          The sample for a margin is that formula solved for n: n0 = z² × deff × p × (1 − p) ÷ e², then n0 ÷ (1 + (n0 − 1)
          ÷ N) when N is known, rounded up. That is the smallest sample whose margin is at most e, and it is never more
          than the population. It is never fewer than two interviews either, the smallest sample a margin can be worked
          out from, so a very wide margin with a very small expected share gives two.
        </li>
        <li>
          Divided by a response rate, it gives the number of people to approach; when that is more people than the
          population holds, the calculator says so instead of giving a number.
        </li>
      </UL>
      <Table
        caption="Reference values the calculator is tested against (95% confidence, p = 50%)"
        rows={[
          ["Question", "Answer"],
          ["Interviews for a 5% margin", "385"],
          ["Interviews for a 3% margin", "1,068"],
          ["Interviews for a 5% margin, population 1,000", "278"],
          ["Interviews for a 5% margin, design effect 1.5", "577"],
          ["Interviews for a 5% margin, design effect 2, population 1,000", "435"],
          ["Margin on 1,000 interviews", "±3.1 points"],
          ["Margin on 400 interviews", "±4.9 points"],
        ]}
      />
      <P>
        A value the calculator cannot use, such as a confidence level other than 90, 95 or 99 percent, or a figure sent
        as words, is refused with the reason rather than replaced by a default.
      </P>
      <P>
        Confidence can be 90, 95 or 99 percent. The margin applies to the whole sample: a subgroup you plan to report on
        its own, such as one province, needs its own sample size, and the assistant is told to say so.
      </P>

      <H2 id="advice">General research advice</H2>
      <P>
        The assistant also answers method questions as a methodologist would: questionnaire wording, sampling, weighting,
        significance testing, qualitative approaches. It is told to say when advice is general practice rather than drawn
        from this project, and to name the assumptions it rests on.
      </P>

      <H2 id="report">Changes to the report</H2>
      <P>
        Asked to shorten, tighten or rewrite a part of the Insights Report (the executive summary, a pillar&apos;s
        headline, the caveats), the assistant writes new text for exactly that part. Fields you did not mention are left
        alone.
      </P>

      <H2 id="limits">Where it stops</H2>
      <Limit title="The wording is still a model's">
        The figures come from tables, but the sentence around them is written by a model, which can misread or overstate
        (Ji et al., 2023). Open the table named at the end of the reply before quoting a figure.
      </Limit>
      <Limit title="A margin of error assumes a probability sample">
        For a quota or opt-in panel sample there is no sampling margin in the strict sense. The calculator&apos;s figure
        then describes the precision a random sample of that size would have, not the error of your survey. It covers a
        proportion, not a mean.
      </Limit>
      <Limit title="Design effects are your estimate">
        The calculator uses the design effect you give, or 1. It does not estimate one from your data, so a clustered or
        heavily weighted sample will look more precise than it is unless you supply a realistic figure.
      </Limit>
      <Limit title="Long projects are read in part">
        Only the capped numbers of findings, insights and recommendations are read, so a question about a late theme on
        a large project may get &quot;not covered&quot;.
      </Limit>
      <Limit title="Guide search matches words">
        The guides are searched by the words in the question, not their meaning, so a question worded very differently
        from the guide may not find it. Asking again with the term the app uses usually does.
      </Limit>
      <Limit title="Outside a project nothing is kept">
        The chat outside a project is not saved. Its use is counted for your organisation and shown on the dashboard
        (the last 30 days, with the part read from the cache and an estimated cost), not on a project&apos;s API usage
        page, which counts only that project&apos;s calls.
      </Limit>
      <Limit title="Drafts accumulate">
        Each data question can add up to four draft tables. They stay until you commit or delete them. A table saved
        whose figures could not be read back is still listed under the reply, marked as such, and counts towards the
        four.
      </Limit>
      <DoesDoesNot
        does={[
          "Builds the tables it quotes, through the same checks and engine as SemanticTabs, and saves them as drafts.",
          "Uses the file's weight and saved survey design, and stops when either cannot be read.",
          "Works out sample sizes and margins of error with a tested calculator and shows the working.",
          "Rewrites only the report fields you name.",
          "Answers how-the-app questions from the Knowledge base and Manual, and links the guides it read.",
        ]}
        doesNot={[
          "Compute a figure itself, or guarantee its sentence matches the table it built.",
          "Estimate a design effect from your data.",
          "Give a margin of error that applies to a non-probability sample.",
          "Commit its tables into findings for you.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Ask one question at a time, naming the variables and groups when you know them.</li>
        <li>Open each table listed at the end of the reply and check the base and whether it was weighted.</li>
        <li>For sample sizes, give the population, expected response rate and a design effect when you have them.</li>
        <li>Commit the tables worth keeping, and delete the rest from All tables.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
