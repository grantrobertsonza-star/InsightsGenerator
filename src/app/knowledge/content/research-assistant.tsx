import { Article, H2, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What the assistant is for" },
  { id: "reads", title: "What it reads" },
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
        The Research assistant, under Tools, is a chat for one project. It does four things: it answers questions about
        the project&apos;s accepted evidence and report, it answers questions about the project&apos;s data by building
        cross tables, it gives general research advice, and it rewrites a part of the Insights Report when you ask.
      </P>
      <WhyBox>
        A model is good at planning and explaining and unreliable at arithmetic. So the assistant plans the table and
        the app builds it; it chooses the inputs for a sample size and the app works it out. Any figure it quotes about
        your data or your sample should trace back to a table or a calculation you can see.
      </WhyBox>

      <H2 id="reads">What it reads</H2>
      <P>
        Each message is answered from the project&apos;s business problem, objective, decision statement and audience,
        the generated report narrative if there is one, accepted insights and recommendations, the objective coverage
        statuses, and accepted findings rated robust or use with caution. Larger projects are cut to the first 80
        findings, 60 insights and 40 recommendations. The last 20 messages of the conversation go with it, so a follow-up
        such as &quot;and by region?&quot; is read in context.
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
        assumptions. The method is the standard one for a proportion (Cochran, 1977):
      </P>
      <UL>
        <li>Sample for a margin e: n = z² × p × (1 − p) ÷ e², with p = 50% unless you give an expected share.</li>
        <li>With a known population N, the finite population correction n ÷ (1 + (n − 1) ÷ N).</li>
        <li>
          Times a design effect for clustered or weighted samples (Kish, 1965), then divided by a response rate to give
          the number of people to approach.
        </li>
        <li>The reverse, the margin for n interviews: e = z × √(deff × p × (1 − p) ÷ n).</li>
      </UL>
      <Table
        caption="Reference values the calculator is tested against (95% confidence, p = 50%, design effect 1)"
        rows={[
          ["Question", "Answer"],
          ["Interviews for a 5% margin", "385"],
          ["Interviews for a 3% margin", "1,068"],
          ["Interviews for a 5% margin, population 1,000", "278"],
          ["Interviews for a 5% margin, design effect 1.5", "577"],
          ["Margin on 1,000 interviews", "±3.1 points"],
          ["Margin on 400 interviews", "±4.9 points"],
        ]}
      />
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
      <Limit title="Drafts accumulate">
        Each data question can add up to four draft tables. They stay until you commit or delete them.
      </Limit>
      <DoesDoesNot
        does={[
          "Builds the tables it quotes, through the same checks and engine as SemanticTabs, and saves them as drafts.",
          "Uses the file's weight and saved survey design, and stops when either cannot be read.",
          "Works out sample sizes and margins of error with a tested calculator and shows the working.",
          "Rewrites only the report fields you name.",
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
