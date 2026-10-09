import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what-qual", title: "What qualitative analysis is" },
  { id: "what-quant", title: "What quantitative analysis is, and how the two fit together" },
  { id: "data", title: "What the data usually looks like" },
  { id: "reading", title: "How the app reads a transcript" },
  { id: "themes", title: "How codes and themes are created" },
  { id: "meaning", title: "What the codes, themes and numbers mean" },
  { id: "checks", title: "The checks that sit on top" },
  { id: "limits", title: "Limitations" },
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
      "Braun, V., & Clarke, V. (2019). Reflecting on reflexive thematic analysis. Qualitative Research in Sport, Exercise and Health, 11(4), 589-597.",
    url: "https://doi.org/10.1080/2159676X.2019.1628806",
  },
  {
    citation:
      "Guest, G., Bunce, A., & Johnson, L. (2006). How many interviews are enough? An experiment with data saturation and variability. Field Methods, 18(1), 59-82.",
    url: "https://doi.org/10.1177/1525822X05279903",
  },
  {
    citation:
      "Hennink, M. M., Kaiser, B. N., & Marconi, V. C. (2017). Code saturation versus meaning saturation: How many interviews are enough? Qualitative Health Research, 27(4), 591-608.",
    url: "https://doi.org/10.1177/1049732316665344",
  },
  {
    citation:
      "Landis, J. R., & Koch, G. G. (1977). The measurement of observer agreement for categorical data. Biometrics, 33(1), 159-174.",
    url: "https://doi.org/10.2307/2529310",
  },
  {
    citation:
      "O'Connor, C., & Joffe, H. (2020). Intercoder reliability in qualitative research: Debates and practical guidelines. International Journal of Qualitative Methods, 19. ",
    url: "https://doi.org/10.1177/1609406919899220",
  },
  {
    citation:
      "Pangakis, N., & Wolken, S. (2024). Keeping humans in the loop: Human-centered automated annotation with generative AI [Preprint]. arXiv:2409.09467.",
    url: "https://arxiv.org/abs/2409.09467",
  },
  {
    citation:
      "Byrt, T., Bishop, J., & Carlin, J. B. (1993). Bias, prevalence and kappa. Journal of Clinical Epidemiology, 46(5), 423-429.",
    url: "https://pubmed.ncbi.nlm.nih.gov/8501467",
  },
];

export default function QualitativeAnalysisGuide() {
  return (
    <Article
      slug="qualitative-analysis"
      title="How our qualitative analysis works"
      lede="A plain account of how a transcript becomes codes, themes and findings in this app, what each number means, and where the method stops. It is a working document and will grow."
      toc={toc}
    >
      <H2 id="what-qual">What qualitative analysis is</H2>
      <P>
        Qualitative analysis works with words, not counts. People are asked open questions in an interview or a
        group discussion, and what they say is read for meaning: what matters to them, how they explain their
        choices, what worries them, and what they take for granted. Its strength is depth. It can show why people
        behave as they do and surface ideas nobody thought to ask about. Its weakness is the flip side of that
        strength: the samples are small, they are rarely chosen at random, and the reading involves judgement.
      </P>
      <P>
        In this app the method is closest to <strong>codebook thematic analysis</strong> (Braun &amp; Clarke,
        2006), with some of the counting habits of qualitative content analysis. A <em>code</em> is a short label
        for an idea that recurs. A <em>theme</em> is a broader pattern of meaning that several codes are facets
        of. The app is called &quot;content analysis&quot; in everyday talk, and that is fine, but it helps to know
        that the reading is interpretive and that the counts describe the sample you have, not a wider population.
      </P>

      <H2 id="what-quant">What quantitative analysis is, and how the two fit together</H2>
      <P>
        Quantitative analysis works with numbers from a structured questionnaire: everyone answers the same closed
        questions, usually with a fixed set of answer options, and the results are counted, compared and tested.
        Its strength is breadth and comparability. With a well-drawn sample, a percentage can be generalised to a
        population, within a margin of error. Its weakness is shallowness: it can tell you that 40% of people use a
        mobile wallet, but not why the other 60% do not.
      </P>
      <P>
        The two work best together. Quantitative results tell you what is happening and how much. Qualitative
        results help explain why. The cross tabulation guide in this knowledge base covers the numbers side. This
        guide covers the words side, and the app can link the two (see the checks below).
      </P>

      <H2 id="data">What the data usually looks like</H2>
      <P>
        The raw material is a <strong>transcript</strong>: a verbatim record of an interview or a focus group,
        usually typed from an audio recording. It is a sequence of <em>turns</em>, each one a speaker saying
        something. A typical fragment:
      </P>
      <ExampleBox title="A transcript fragment">
        <p>Moderator: How do you usually pay your electricity?</p>
        <p>Thandi: I buy prepaid at the shop, because I never know what the bill will be. With the app I get scared
          I will overspend.</p>
        <p>Sipho: Same for me. I trust the shop. I can see the slip.</p>
      </ExampleBox>
      <P>Three features of this kind of data shape everything that follows.</P>
      <UL>
        <li>
          <strong>Moderator turns are context, participant turns are evidence.</strong> What the moderator says
          shapes the answer but is not a finding. Themes are drawn only from what participants said.
        </li>
        <li>
          <strong>Short replies lean on the question before them.</strong> &quot;Same for me&quot; only means
          something because of what came just before. The app shows the preceding question when it codes such a
          turn.
        </li>
        <li>
          <strong>Respondents come with attributes.</strong> A respondent may be linked to a profile (province, age
          group, customer type) and, where you have the survey data, to their answers to closed questions.
        </li>
      </UL>

      <H2 id="reading">How the app reads a transcript</H2>
      <P>
        Before any coding, the transcript is split into turns. The app recognises speaker labels such as
        &quot;Moderator:&quot; or a name followed by a colon, timestamps, and headings such as &quot;Interview
        3&quot;. Labels like Moderator, Interviewer, Facilitator or Q are treated as the moderator; the rest are
        participants. Very long turns are cut at sentence boundaries so every piece is still a verbatim stretch of
        the original. If the automatic reading is wrong, you can re-read the same transcript with a different
        reading (labels, headings, paragraphs, or none) and choose which speakers are moderators. That replaces
        the turns, which clears anything tied to the old turns (calibration samples, negative cases, respondent
        links), so it is best done before the detailed checks.
      </P>

      <H2 id="themes">How codes and themes are created</H2>
      <P>
        This is the core of the method. It runs in four steps, plus a grouping step, and every step leaves a
        record. A language model does the reading at each step, and a researcher can inspect and change the
        result.
      </P>

      <H3>Step 1: open coding, three independent times</H3>
      <P>
        The model reads the transcript the way a qualitative researcher would on a first pass. It notes recurring
        ideas, reactions and concerns, and proposes a small number of themes (roughly four to eight), each with a
        short name, a one or two sentence statement of what the transcript shows, and one representative quote.
        The quote must be a participant&apos;s words, copied exactly, from within a single turn.
      </P>
      <P>
        This pass is run <strong>three times</strong>, independently. A single pass can name different themes from
        a second pass over the same text, and one run cannot show that. Three runs is the smallest number that
        shows whether a theme is stable (found in all three, in some, or in only one). It also triples the cost of
        this step. For very long transcripts each run is shown the first 60,000 characters, cut at a turn
        boundary, and the cut is recorded. The codebook is still applied to the whole transcript in step 3.
      </P>
      <P>
        <strong>Quote check.</strong> Each theme&apos;s quote is looked up in the participant turns. A theme whose
        quote is not really in the transcript is dropped before anything is merged. This is why every quote you
        see in a finding is verbatim by construction.
      </P>

      <H3>Step 2: consolidation into a codebook</H3>
      <P>
        The themes from the three runs are merged into one <strong>codebook</strong>: ideas that appear in several
        runs under different names become one code, and genuinely different ideas stay separate. The model may not
        add an idea that no run found. A codebook holds at most 12 codes. Each code has:
      </P>
      <UL>
        <li>a short name (two to five words);</li>
        <li>a definition that stands alone, so someone who has not seen the transcript could decide whether a
          remark belongs;</li>
        <li>an inclusion rule (when to code a remark here);</li>
        <li>an exclusion rule (what looks similar but does not belong, naming the nearest other code).</li>
      </UL>
      <P>
        The app also records how many of the three runs found each code. That count is computed from the merge, not
        asserted by the model, and it is shown as &quot;found in 2 of 3 runs&quot;.
      </P>

      <H3>Step 3: applying the codebook to every participant turn</H3>
      <P>
        The codebook is now applied to <em>every</em> participant turn of the whole transcript, not only the part
        the open runs saw. For each turn the model lists the codes it clearly expresses. A turn can carry more than
        one code, or none. It judges only what the participant said in that turn, a short reply is coded only if
        the preceding question makes its meaning clear, and an exclusion rule always wins over an inclusion rule.
        The codebook is versioned. If you edit it (rename a code, tighten a definition, merge two codes), the edit
        becomes a new version, the old one is kept, and the codebook is applied again to the stored turns.
      </P>

      <H3>Step 4: findings</H3>
      <P>
        Each code that is applied to <strong>at least two turns</strong> becomes a finding, tagged as coded. Its
        quote is taken from a turn the code was actually applied to. A code seen in only one turn is kept in the
        codebook but does not become a finding, because one remark is an anecdote, not a pattern.
      </P>

      <H3>Grouping codes into themes</H3>
      <P>
        A flat list of codes is not yet an analysis. Following Braun and Clarke&apos;s phase of generating themes,
        the app groups related codes under broader themes, so the result is a tree: <em>Theme &gt; code</em>. The
        rules are deliberate. Use between two and seven themes. Every theme holds at least two codes. A code
        belongs to at most one theme. A code that fits nowhere is left out and stands as a theme of its own. And
        a theme is a shared idea, not a topic heading, so it is named as a short noun phrase such as &quot;Cost of
        unreliable connectivity&quot; rather than &quot;Connectivity&quot;. The app also offers a second look that
        merges themes that overlap. You can edit the grouping in the codebook panel, or ask for it to be redone.
      </P>

      <H3>Across several transcripts</H3>
      <P>
        When a study has two or more coded transcripts, the app can group the codes of all of them under{" "}
        <strong>main themes</strong> that hold across the study. It needs at least two coded transcripts and at
        least four codes. Each code keeps its link to its own transcript, so a main theme can always be traced back
        to who said what.
      </P>

      <H3>Coding you did yourself</H3>
      <P>
        If you coded a transcript elsewhere (ATLAS.ti, NVivo, Dedoose or a spreadsheet), you can import it. No
        model does the coding: each quote in your file is looked up in the transcript, the turn it sits in gets
        your code, and your codes become the codebook (up to 40 per transcript). From there the counts, quotes and
        findings are built the same way as for model-coded transcripts. Counts in your file are never trusted; they
        are recounted from the transcript.
      </P>

      <WhyBox>
        The app does not ask the model to simply summarise. It asks it to code against explicit definitions, then
        counts what was coded, and every quote can be checked against the source. The purpose is that a researcher
        can disagree with a code, edit it, and see exactly what changes, which a free-form summary would not allow.
        Every model call is logged with a fingerprint of its instructions and its input, so a coding run can be
        audited later.
      </WhyBox>

      <H2 id="meaning">What the codes, themes and numbers mean</H2>
      <Table
        rows={[
          ["Term", "What it is", "How to read it"],
          ["Turn", "One speaker saying something, in the order spoken", "The unit that gets coded. A turn can carry several codes or none."],
          ["Code", "A named idea with a definition and inclusion and exclusion rules", "A label for a recurring idea. It is a tool for reading, not a fact about the world."],
          ["Theme", "A pattern of meaning that several codes are facets of", "A claim about what the codes add up to. It is an interpretation and should be read as one."],
          ["Turns coded", "How many participant turns carry the code", "Volume of talk. One talkative person can inflate this."],
          ["Respondents", "How many different people voiced the code, out of how many in the study", "Spread across people. Usually the better guide to how widespread an idea is."],
          ["Found in n of 3 runs", "How many of the three independent open-coding passes found the idea", "Stability of the code. Found in 3 of 3 is steadier than 1 of 3, which deserves a closer look."],
        ]}
      />
      <P>
        Counts are always shown with their base, for example &quot;7 of 12 respondents&quot;. A number without its
        base is not interpretable. These counts describe <em>this sample</em>. They are not percentages of a
        population, and the app deliberately does not run significance tests on them.
      </P>

      <H2 id="checks">The checks that sit on top</H2>
      <P>
        Coding by a model is a proposal, and the app gives you ways to test it. None of these is a pass or fail
        gate. They are evidence to weigh.
      </P>
      <Table
        rows={[
          ["Check", "What it does", "How to read it"],
          [
            "Agreement with your own coding",
            "You judge a sample of turns yourself. The app compares your judgement with the model's, code by code, using Cohen's kappa (agreement beyond chance).",
            "Bands follow Landis and Koch (1977): up to 0.20 slight, 0.21 to 0.40 fair, 0.41 to 0.60 moderate, 0.61 to 0.80 substantial, above 0.80 almost perfect. Below 20 judged turns, or with very few positives, the app warns that kappa is unstable.",
          ],
          [
            "Random audit",
            "An alternative to the targeted sample. Turns are drawn at random within groups (turns with no theme, and turns grouped by their rarest theme), you code them blind, and the app estimates how often the model's themes match yours exactly across the whole transcript, with a range.",
            "Because the draw is random, this is the only check that speaks for the transcript as a whole. The suggested size is about 15% of participant turns, between 30 and 120, in line with the 10 to 25% of units that O'Connor and Joffe (2020) suggest double coding. The per-theme rows rest on few turns each. A wide range means judge more turns.",
          ],
          [
            "Fuller agreement per theme",
            "Beside kappa, the app shows agreement on the turns where either of you applied the theme, raw agreement, and a note when a theme is rare or very common.",
            "Kappa falls when a theme is rare or very common even if two coders almost always agree (Byrt et al., 1993), so read it with the other figures and not alone.",
          ],
          [
            "Stability check",
            "The app applies the same codebook to the same turns again, once or more, and shows which turns came out differently. Those turns go to a queue for you to settle.",
            "Turns the model codes differently from run to run are where it is least reliable; in one study, annotations that were perfectly consistent across repeats were more accurate (Pangakis & Wolken, 2024). It flags where to look. It does not show that a stable turn is right, because repeated runs share blind spots.",
          ],
          [
            "Settling flagged turns",
            "For each flagged turn you first tick the themes you think apply, before the model's themes or the other runs are shown. That first answer is locked. Then the model's side appears and you settle the turn.",
            "Seeing a suggestion first pulls people towards it, so the first judgement is yours. The app also tracks how often you change the model's coding and how fast you decide, and shows a prompt if nearly everything is accepted quickly. It is a prompt, not a verdict.",
          ],
          [
            "Negative cases",
            "The app searches for passages that cut against a code, up to three per code, and shows them with the quote.",
            "A pattern that survives its counter-examples is stronger. Read them, then decide whether to tighten the code.",
          ],
          [
            "Data quality",
            "Words per respondent, how much the moderator talks, how dominant the most talkative speakers are, duplicate turns, how much of the transcript was coded.",
            "Respondents with under 50 words are flagged as thin. A moderator who talks a lot, or one speaker who dominates, changes what the themes represent.",
          ],
          [
            "Saturation",
            "Code saturation: after each added respondent, did new codes still appear? Meaning saturation: did later respondents add a new dimension within a theme, shown with a verbatim excerpt?",
            "Evidence about whether the sample was big enough, not proof (Guest et al., 2006; Hennink et al., 2017). It is a prompt to read, not a verdict.",
          ],
          [
            "Focus group echoes",
            "In a group, a turn that echoes another speaker's coded turn is flagged.",
            "Agreement in a group is not always independent agreement. Echoes are counted separately so they do not look like extra evidence.",
          ],
          [
            "Link to survey answers",
            "The model proposes which closed survey questions a theme should relate to. Respondents who voiced a theme but answered on the unexpected side of the median are flagged.",
            "A flag is a prompt to reread the transcript. It could mean a say-do gap, a misread question or a wrong code. It is not a finding.",
          ],
          [
            "Themes by respondent attribute",
            "Which themes go with which respondent groups, and which themes appear together.",
            "Counts only, with their base. Groups with fewer than 5 respondents are flagged as small. No significance tests, because with interview-sized samples a p-value would imply more certainty than the data can carry.",
          ],
        ]}
      />

      <H2 id="limits">Limitations</H2>
      <P>
        Every method has edges. These are the ones that matter most here, stated so you can judge how far to rely
        on a result.
      </P>
      <Limit title="a model does the first reading">
        The codes are proposed by a language model, which can misread irony, local expressions, code-switching or a
        short reply that depends on context. It can also miss an idea or over-split one. That is why the codebook is
        editable, quotes are verified, and agreement checks exist. Treat the first codebook as a draft.
      </Limit>
      <Limit title="runs are not identical">
        Running the same transcript again can produce somewhat different codes. The three-run design makes this
        visible, as the &quot;found in n of 3 runs&quot; count, but it does not remove it. Once you have edited and
        accepted a codebook, that version is what is applied, and it is stable.
      </Limit>
      <Limit title="themes are interpretations">
        A theme is a researcher&apos;s (here, partly a model&apos;s) account of what the codes mean together. Two
        careful analysts can group the same codes differently. Reflexive approaches treat this as a feature of the
        method, not a flaw to remove (Braun &amp; Clarke, 2019), which is why the grouping is editable rather than
        final.
      </Limit>
      <Limit title="small, non-random samples">
        Interview and focus group samples are usually small and purposively chosen. Counts describe who you
        spoke to. They cannot be read as how common an idea is in the population, and a theme voiced by two of
        twelve people may still be important.
      </Limit>
      <Limit title="long transcripts are only partly seen in the open pass">
        Each open coding run reads up to the first 60,000 characters. A theme that appears only late in a very long
        transcript may not make it into the draft codebook, although the codebook is applied to the whole text once
        it exists. Check the data quality panel for a recorded cut.
      </Limit>
      <Limit title="a turn is a coarse unit">
        Coding works at the level of a whole turn. A long turn can contain several ideas, and a code applied to it
        marks the turn, not the exact sentence. Turns over 1,200 characters are split, which helps, but the unit is
        still approximate.
      </Limit>
      <Limit title="the sample can be dominated by a few voices">
        Turns coded counts talk, not people. In a focus group one confident speaker can account for most of a
        theme. Use the respondent counts and the echo and speaker-share checks alongside the turn counts.
      </Limit>
      <Limit title="agreement statistics depend on small numbers">
        Kappa can swing sharply when it rests on few judged turns or on a code that is rarely applied. The app says
        so when that is the case. A moderate kappa on a rare code is not a reason to discard it, and a high kappa on
        a trivial code is not a reason to trust it.
      </Limit>
      <Limit title="the audit is one researcher's reading">
        The audit and the settled turns compare the model with you. You are one reader, not a gold standard, and a
        low match can mean a vague definition as easily as a poor model call. Until an audit has been drawn and
        judged, the app labels the themes as not yet audited.
      </Limit>
      <Limit title="no claim of causation or representativeness">
        A theme such as &quot;price sensitivity&quot; says people talked about price in a certain way. It does not
        show that price caused anything. Findings are written as what participants said and did, not why events
        happened across a market.
      </Limit>

      <DoesDoesNot
        does={[
          "Reads transcripts turn by turn and keeps moderator turns as context only.",
          "Builds a versioned codebook with definitions, inclusion and exclusion rules.",
          "Checks every quote against the source and counts codes from the transcript.",
          "Lets you edit, re-apply, import your own coding, and test the model against your judgement.",
        ]}
        doesNot={[
          "Replace a researcher's judgement about what a theme means.",
          "Tell you how common an idea is in a population.",
          "Run significance tests on interview-sized counts.",
          "Guarantee identical codes on every rerun before a codebook is accepted.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Check that the transcript was read correctly (speakers, moderator turns) before anything else.</li>
        <li>Run the coding, then read the draft codebook as a researcher would. Rename, merge or tighten codes.</li>
        <li>Draw a random audit and judge it. Read the overall match and the agreement per code, and fix definitions where agreement is poor.</li>
        <li>Run the stability check and settle the flagged turns, coding each one yourself before looking at the model.</li>
        <li>Read the negative cases and the thin respondents. Decide what each means for the claim.</li>
        <li>Group codes into themes and edit the grouping until the themes say something you would defend.</li>
        <li>Report themes with the number of respondents and the quote, and state the sample and its limits.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
