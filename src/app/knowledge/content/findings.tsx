import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What a finding is" },
  { id: "origins", title: "Where findings come from" },
  { id: "review", title: "Reviewing by exception" },
  { id: "duplicates", title: "Duplicates and look-alikes" },
  { id: "verification", title: "Verification: the four verdicts" },
  { id: "caveats", title: "Caveat tags" },
  { id: "corroboration", title: "Corroboration and contradiction" },
  { id: "limits", title: "Limitations" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Wasserstein, R. L., & Lazar, N. A. (2016). The ASA statement on p-values: Context, process, and purpose. The American Statistician, 70(2), 129-133.",
    url: "https://doi.org/10.1080/00031305.2016.1154108",
  },
  {
    citation:
      "Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: A practical and powerful approach to multiple testing. Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289-300.",
    url: "https://doi.org/10.1111/j.2517-6161.1995.tb02031.x",
  },
  {
    citation:
      "Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), Article 248.",
    url: "https://doi.org/10.1145/3571730",
  },
];

export default function FindingsGuide() {
  return (
    <Article
      slug="findings"
      title="How findings are produced and checked"
      lede="What a finding is in this app, where findings come from, how they are verified, and what the verdicts and caveat tags do and do not tell you. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What a finding is</H2>
      <P>
        A finding is one claim, kept small on purpose, with a link back to the place it came from. &quot;43% of
        Limpopo adults use mobile money&quot; is a finding. &quot;Mobile money is growing and people trust it&quot; is
        two or three findings stuck together, and it is much harder to check. Keeping each claim atomic means each one
        can be verified, accepted or rejected on its own, and later combined with others without carrying hidden
        baggage.
      </P>
      <P>
        Findings sit between raw material (documents, tables, transcripts) and insights. They are deliberately
        descriptive. A finding says what the material says. Why it matters, and what to do about it, comes later and
        is the job of the insights stage.
      </P>
      <WhyBox>
        The line between a finding and an insight is the most useful distinction in the whole app. A finding can be
        true and still not be interesting. An insight has to be both supported and worth acting on. Mixing the two is
        how reports end up with &quot;insights&quot; that are really just restated numbers.
      </WhyBox>

      <H2 id="origins">Where findings come from</H2>
      <P>
        Every finding carries an origin, because the origin decides how it can be checked.
      </P>
      <Table
        rows={[
          ["Origin", "How it is made", "Who or what does the work"],
          ["Stated", "Pulled out of a written report or deck: the claims the authors themselves make", "A model reads the document and extracts the claims. It is asked to quote, not to invent."],
          ["Generated", "Computed from a table in the cross tab workspace, for example a column that differs from the rest of its banner variable", "Code. The figures and the significance test come from the data, not from a model."],
          ["Coded", "Produced by the qualitative analysis, for example a code that appears on two or more participant turns", "The coding pipeline described in the qualitative guide."],
        ]}
      />
      <P>
        Findings are also tagged quantitative or qualitative, which is what the filter at the top of the Findings tab
        uses. A stated finding can be either, since a report may quote a statistic or a theme.
      </P>
      <H3>Findings from tables</H3>
      <P>
        Table findings are the cleanest because nothing is paraphrased. The wording is built from the table itself: the
        figure, its base, and the test used. Tables are only turned into findings once you commit them. Findings from
        a starter set are also filtered with a false discovery rate correction, because so many cells are tested at once. Cells on a base under 30 respondents are never turned into findings,
        because the figure would not be dependable enough to state. The cross tab guide explains the test and the base
        rules in detail.
      </P>
      <H3>Findings from documents</H3>
      <P>
        Stated findings depend on a model reading prose, so they carry more risk. Models can drop a qualifier, merge
        two sentences, or restate a number slightly differently (Ji et al., 2023). That is why every stated finding is
        linked to its source passage and why verification, covered below, treats them more cautiously than generated
        ones.
      </P>

      <H2 id="review">Reviewing by exception</H2>
      <P>
        New findings arrive as <strong>accepted</strong>, not pending. A run can easily produce well over a hundred of
        them, and nobody reads each one before the next stage can run. So the workflow is the reverse of an approval
        queue: you scan, and you reject the ones that are wrong, duplicated or irrelevant. Rejected findings are kept,
        not deleted, and drop out of everything built downstream.
      </P>
      <UL>
        <li>Accepted: in play, and eligible to feed verification and insights.</li>
        <li>Rejected: set aside. Still visible, and recoverable if you change your mind.</li>
        <li>Adjusted: you can change a finding&apos;s kind, theme or note. The source link stays.</li>
      </UL>
      <P>
        &quot;Regenerate rejected&quot; replaces only the findings you rejected and leaves everything accepted, and
        whatever has been built on it, untouched. If findings are about to be removed in a way that cannot be avoided
        (reprocessing a document, deleting a table), a snapshot is archived first so the earlier version can still be
        looked up.
      </P>
      <H3>When a change is saved, refused or fails</H3>
      <P>
        A change to a finding&apos;s status, kind, theme or note shows as saved only once it is. If the finding is no longer
        in the project (deleted, or replaced when its file was read again since you opened the page), the change is
        refused and says so; reload to see the current findings. Accept all and Reject all are all or nothing: if any
        finding in the batch is gone, none is changed, and a banner says how many were missing. When a save is refused
        or fails, the buttons return to what they showed, a note you were writing stays in its box with the reason
        beside it, and Save tries again with the same text. The rest of the page stays as it was. A blank theme or note
        clears it; a kind, once set, can be changed but not cleared.
      </P>

      <H2 id="duplicates">Duplicates and look-alikes</H2>
      <P>
        The same number often appears in a report and again in the deck built from it. The app compares findings by
        how much of their wording overlaps and flags the pairs that look like the same claim. It is a cheap, no-model
        comparison, and it is intentionally modest: it says &quot;these look alike, take a look&quot;. It does not
        decide whether two statements come from independent research, because that is a judgement about provenance
        that wording alone cannot settle.
      </P>
      <P>
        Flagged duplicates matter for the next step. A claim repeated across two documents is not the same as a claim
        confirmed by two studies, and the app tries not to confuse them.
      </P>

      <H2 id="verification">Verification: the four verdicts</H2>
      <P>
        Verification asks a narrow question of each finding: is the evidence behind it adequate for the claim as
        worded? It does not ask whether the finding is interesting. The answer is one of four verdicts.
      </P>
      <Table
        rows={[
          ["Verdict", "Meaning", "Feeds insights?"],
          ["Robust", "The evidence supports the claim as stated, with no material concerns", "Yes"],
          ["Use with caution", "Probably sound, but with a stated caveat such as a small base or a single source", "Yes, and the caveat travels with it"],
          ["Not supported", "The evidence does not support the claim, or conflicts with it", "No"],
          ["Insufficient information", "There is not enough in the material to judge either way", "No"],
        ]}
      />
      <P>
        The route to a verdict depends on the origin. Generated findings are judged by code, because the numbers are
        right there: the check looks at the base sizes behind the figure and applies informal bands around n=30 and
        n=50. Stated and coded findings are judged by a model, working through them in batches of 20 with a ceiling of
        100 per pass, and asked to look at plausibility and at contradictions with the other material. The model
        proposes the verdict and a reason, and the reason is stored so you can read why.
      </P>
      <WhyBox>
        Where a rule can be written down, it is done in code, not by a model. Base sizes, counts of sources and the
        corroboration status are all computed. The model is used only for the part that needs reading and judgement,
        and its output is checked for shape before anything is stored.
      </WhyBox>

      <H2 id="caveats">Caveat tags</H2>
      <P>
        A verdict is a summary. The caveat tags say what pulled it down, and they are worth reading before you rely on
        a finding.
      </P>
      <Table
        rows={[
          ["Tag", "What it is telling you"],
          ["Base size small / borderline / unknown", "The group behind the figure is small, near the threshold, or the base was not stated"],
          ["Standard deviation unknown", "A mean or difference was reported without a spread, so its reliability cannot be judged"],
          ["Uncorrected multiple comparisons", "Many cells were tested at once and none was adjusted (no correction chosen, or a check that does not correct, such as a banner plan), so a few will look significant by chance"],
          ["False discovery controlled (row)", "The finding survived a Benjamini-Hochberg correction across the columns of its banner variable, the cross tab default"],
          ["Bonferroni corrected (row)", "The finding survived the stricter Bonferroni correction, when that was chosen"],
          ["False discovery rate controlled within table", "The finding survived a Benjamini-Hochberg correction across every cell tested in its table"],
          ["Survey design modelled", "The test used the PSU and strata named for the data file (Taylor series variance)"],
          ["Sampling assumed random", "No survey design was modelled, so the test treats the sample as random, which may not hold for the survey design"],
          ["Insufficient n for a test", "There were too few cases for a significance test to mean anything"],
        ]}
      />
      <P>
        The multiple comparisons tag deserves particular attention in cross tab work. Test enough cells and a few
        will cross the 95% line by luck alone. An adjustment such as the false discovery rate procedure
        (Benjamini &amp; Hochberg, 1995) is a recognised remedy. Every cross table applies one by default, whether it
        came from StarterTabs or was built by hand: the false discovery rate across the columns of each banner
        variable, row by row. Bonferroni, or no correction, can be chosen instead, and the finding&apos;s tag says which
        ran. Findings from the starter set are also controlled across every cell of their table. A table built with no
        correction carries the uncorrected tag. Even with a correction, treat a lone significant cell inside a very
        large table with some suspicion, and prefer patterns that show up across several related cells.
      </P>

      <H2 id="corroboration">Corroboration and contradiction</H2>
      <P>
        Beyond each finding on its own, the app records how it relates to the rest of the evidence. Corroboration is
        decided in code from the links between findings: whether the same claim appears in more than one source, and
        whether one finding is grounded by another. The result is one of cross-source corroborated, single source, or
        contradicted.
      </P>
      <P>
        Stated insights, meaning the interpretations a report offers, are tested separately against the evidence the
        app holds. If the app&apos;s own evidence conflicts with a claim in a report, that claim is pulled down to
        not supported, whatever it scored before, and the earlier reasoning is kept alongside so nothing is lost.
      </P>
      <ExampleBox title="Reading a verdict">
        <p>
          A report says 62% of informal traders save weekly. The table behind it shows the figure on 41 respondents.
          The verdict is likely to be &quot;use with caution&quot;, tagged base size borderline. It still feeds
          insight generation, but the caution is attached and visible when someone reads the insight later.
        </p>
      </ExampleBox>

      <H2 id="limits">Limitations</H2>
      <Limit title="A verdict is a judgement, not a proof">
        &quot;Robust&quot; means the evidence in the material supports the claim as worded. It does not mean the claim
        is true of the world. A well-supported claim from a poorly designed study is still well supported on the page
        and weak in practice. Statistical significance in particular is a narrow statement and is easily over-read
        (Wasserstein &amp; Lazar, 2016).
      </Limit>
      <Limit title="Model-judged verdicts can vary">
        Verdicts on stated and coded findings come from a model. Run twice, a borderline case may land in a
        neighbouring tier. The stored reason lets you disagree sensibly, and you can always override by rejecting a
        finding.
      </Limit>
      <Limit title="Extraction can lose nuance">
        Atomising a claim means a hedge or condition in the original sentence can be dropped. Check the source link on
        anything that matters before you quote it.
      </Limit>
      <Limit title="Corroboration is not independence">
        Two documents repeating the same underlying survey count as one source of evidence, not two, but the app can
        only detect that when the findings look alike or are linked. Provenance you know about and the app does not is
        worth adding in a note.
      </Limit>
      <Limit title="Table findings inherit table limits">
        They use a complement comparison (a column against everyone else in the same banner variable), corrected only
        within the row (or the table) under the setting chosen, and a survey design only when one was named; their
        caveats say which. The correction does not cover the many tables of a project. Treat them as leads to examine,
        not as confirmed differences.
      </Limit>
      <DoesDoesNot
        does={[
          "Splits sources into atomic claims, each linked to where it came from.",
          "Computes table findings from the data, with the base and test stated.",
          "Rates each finding on evidence adequacy and attaches caveat tags.",
          "Flags look-alike findings and records corroboration and contradiction.",
          "Keeps rejected and archived findings so history is recoverable.",
        ]}
        doesNot={[
          "Prove that a claim is true in the real world.",
          "Decide whether two similar findings come from independent research.",
          "Correct for multiple comparisons across the many tables of a project (each table is corrected on its own).",
          "Judge whether a finding is interesting or useful. That is the next stage.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Skim the Findings tab with the quantitative and qualitative filters, and reject what is wrong or irrelevant.</li>
        <li>Open the source link on anything surprising, since surprises are where extraction errors hide.</li>
        <li>Run verification and read the caveat tags, not only the verdict.</li>
        <li>Look at findings marked contradicted or single source before you rely on them.</li>
        <li>Only then move to insights. Findings that are not supported will not carry through, by design.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
