import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what-quant", title: "What quantitative analysis is" },
  { id: "what-qual", title: "What qualitative analysis is, and how the two fit together" },
  { id: "data", title: "What survey data usually looks like" },
  { id: "crosstab", title: "What a cross tabulation is" },
  { id: "weights", title: "Weights and bases" },
  { id: "types", title: "Kinds of questions and how each is tabulated" },
  { id: "nets", title: "Nets and grouped categories" },
  { id: "sig", title: "Significance: what the arrows mean" },
  { id: "findings", title: "From tables to findings" },
  { id: "limits", title: "Limitations" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Benjamini, Y., & Hochberg, Y. (1995). Controlling the false discovery rate: A practical and powerful approach to multiple testing. Journal of the Royal Statistical Society: Series B (Methodological), 57(1), 289-300.",
    url: "https://doi.org/10.1111/j.2517-6161.1995.tb02031.x",
  },
  {
    citation:
      "Rao, J. N. K., & Scott, A. J. (1981). The analysis of categorical data from complex sample surveys: Chi-squared tests for goodness of fit and independence in two-way tables. Journal of the American Statistical Association, 76(374), 221-230.",
    url: "https://doi.org/10.1080/01621459.1981.10477633",
  },
];

export default function CrosstabGuide() {
  return (
    <Article
      slug="crosstabs"
      title="How our cross tabulation works"
      lede="A plain account of how survey data becomes weighted tables in this app, how to read them, how tables become findings, and where the method stops. It is a working document and will grow."
      toc={toc}
    >
      <H2 id="what-quant">What quantitative analysis is</H2>
      <P>
        Quantitative analysis works with numbers from a structured questionnaire. Everyone is asked the same closed
        questions, usually with a fixed list of answers, and the results are counted, compared and tested. Done on a
        well-drawn sample, a percentage can be generalised to a population within a margin of error. That breadth and
        comparability is its strength. Its limit is depth: it shows how many people do something and how groups
        differ, and it is much weaker at saying why.
      </P>

      <H2 id="what-qual">What qualitative analysis is, and how the two fit together</H2>
      <P>
        Qualitative analysis works with words from interviews and group discussions, read for meaning. It is deep,
        small-sample and interpretive. Tables tell you what and how much. Transcripts help you understand why. The
        qualitative guide in this knowledge base covers that side, and the two can be linked: a theme from the
        interviews can be compared with respondents&apos; answers to a closed question.
      </P>

      <H2 id="data">What survey data usually looks like</H2>
      <P>
        Survey data comes as a file from SPSS (.sav), Stata or SAS, or as a CSV or Excel sheet with one row per person. Think of one big grid. <strong>Each row is a
        respondent and each column is a variable</strong>, usually one question or one answer option. Large national
        surveys have thousands of rows and thousands of columns. The app never loads the whole grid into the page.
        It keeps your file in storage, reads only the list of variables for the picker, and computes each table
        when you ask for it, from just the columns that table needs.
      </P>
      <P>Four features of survey files matter for everything below.</P>
      <UL>
        <li>
          <strong>Labels.</strong> Answers are stored as codes (1, 2, 3) with value labels (&quot;Yes&quot;,
          &quot;No&quot;), and every variable has a question label. The app shows the labels.
        </li>
        <li>
          <strong>Missing values.</strong> A file can flag some codes as missing (refused, not asked). Those are left
          out of the base. A &quot;Don&apos;t know&quot; that is stored as an ordinary answer stays in the table as its
          own row for a single-choice question, but is left out of averages.
        </li>
        <li>
          <strong>Weights.</strong> Surveys are usually weighted so the sample matches the population (for example by
          age, sex and province). Each respondent has a weight, and weighted tables count a respondent as many
          people, not as one.
        </li>
        <li>
          <strong>Question families.</strong> A multiple-response question is stored as several yes/no columns (for
          example C8_1 to C8_14). A rating battery is stored as one column per item. The app recognises these
          families from their names and labels and offers them as one unit.
        </li>
      </UL>

      <H2 id="crosstab">What a cross tabulation is</H2>
      <P>
        A cross tabulation (crosstab) splits the answers to one question by the groups of another. The groups go
        across the top (the <strong>banner</strong>, or columns), and the answers to the question go down the side (the{" "}
        <strong>stub</strong>, or rows). Each cell shows how many respondents, or what share, gave that answer in that
        group.
      </P>
      <ExampleBox title="A small example">
        <p>
          Columns: Province (Gauteng, Limpopo, Western Cape). Rows: &quot;Do you own a smartphone?&quot; (Yes, No).
          The cell for Limpopo and Yes might read 58%, meaning that, weighted, 58% of people in Limpopo said yes.
        </p>
      </ExampleBox>
      <P>You can switch each table between three views:</P>
      <Table
        rows={[
          ["View", "What the cell shows", "Use it to answer"],
          ["Column %", "Of the people in this column, the share who gave this answer", "How do groups differ? (the default, and the one with significance marks)"],
          ["Row %", "Of the people who gave this answer, the share who sit in this column", "Who are the people who say this?"],
          ["Weighted count", "The estimated number of people in the population", "How many people is that?"],
        ]}
      />
      <P>
        Several banner variables can sit side by side in one table (for example province and age group), each as its
        own block of columns. A variable can have up to 15 groups, and a table up to 60 columns in total.
      </P>

      <H2 id="weights">Weights and bases</H2>
      <P>
        Every percentage has a <strong>base</strong>: the people it is a percentage of. Getting the base right is the
        most important thing in a table, and most disagreements between two sets of numbers come from different
        bases. In a weighted table:
      </P>
      <UL>
        <li>
          the percentage is the sum of the weights of the people who gave the answer, divided by the sum of the
          weights of everyone in the base;
        </li>
        <li>
          each column shows its <strong>unweighted n</strong> (how many real respondents), which is the honest guide
          to how much evidence stands behind it;
        </li>
        <li>
          the app also computes an <strong>effective base</strong>, which is how many equally weighted respondents
          the weighted sample is worth. It uses the standard approximation (sum of weights) squared, divided by the
          sum of squared weights. Unequal weights make the effective base smaller than the real count, and it is
          what the significance test uses.
        </li>
      </UL>
      <P>
        If you choose no weight the table is unweighted, and it is labelled so when it is saved. The app proposes
        the survey&apos;s person-level or benchmarked weight when it can find one, and variables that only describe
        the sample design (weights, area codes, identifiers) are never offered as things to measure.
      </P>
      <H3>When a base is too small</H3>
      <P>
        Cells fall into three tiers by unweighted base. With <strong>30 or more</strong> cases a cell is shown
        normally and can be tested. With <strong>10 to 29</strong> cases the figure is shown in grey italics, and the
        column header says &quot;indicative only&quot;. It is not tested, carries no arrows, and cannot produce a
        finding. With <strong>under 10</strong> a dash replaces the figure, because a percentage of a handful of
        people is mostly noise and could also point to individuals. If several adjacent columns are thin, group them
        (for example &quot;Four or more&quot;) to get a base large enough to read.
      </P>

      <H2 id="types">Kinds of questions and how each is tabulated</H2>
      <Table
        rows={[
          ["Kind", "How it appears in the data", "How the table treats it"],
          ["Single choice", "One column, one answer per person", "One row per answer. Column percentages add to 100%. Up to 30 answers; a numeric variable with 25 or fewer distinct values is also treated as categories."],
          ["Multiple response", "Several yes/no columns, one per option", "One row per option. Each option is a percentage of the people who answered that option. A row at the top, \"Base: answered this question\", shows the people who answered at least one option. Percentages are of people, so they can add to more than 100%."],
          ["Rating grid", "Several numeric columns without value labels (a 1 to 10 battery)", "One row per item showing the average. Codes labelled don't know, refused or not applicable are left out of the average."],
          ["Battery", "Several labelled, non yes/no columns that share a stem", "Each item becomes its own question with its own answers and its own base."],
          ["Numeric", "One numeric column with many values (age, income)", "A single row with the average. Group it into bands first if you want shares."],
        ]}
      />
      <WhyBox>
        For multiple response, the choice of base changes the answer, so it is stated rather than hidden. Each option
        uses the people who answered that option, and the base row shows the people who answered at least one. This
        follows standard survey practice: percentages of respondents (&quot;cases&quot;) are the right ones for
        comparing groups, even though they can exceed 100%. Percentages of responses (a share of all mentions) are
        a different statistic and are not used here.
      </WhyBox>

      <H2 id="nets">Nets and grouped categories</H2>
      <P>
        A <strong>net</strong> combines several things into one row so you can read the combination as a unit.
      </P>
      <H3>Net of yes/no options</H3>
      <P>
        Tick two or more yes/no options in the variable list, name the net (for example &quot;Any government
        grant&quot;) and add it. A person is in the net if they chose <em>at least one</em> of its options, and they
        are counted once, however many they chose. The base is everyone who answered at least one of those options.
        Two checks are always true: a net is never smaller than its largest member, and never larger than the sum of
        its members. If a net is larger than the sum, something is wrong. Adding the members&apos; percentages
        together would double count anyone who chose several, which is why the app does not do that.
      </P>
      <H3>Grouped categories</H3>
      <P>
        For a single-choice question, use <strong>Group</strong> on its chip to combine answer categories. On a
        <em> row</em> variable, each group is added as a NET row under the categories (for example &quot;Top 2
        box&quot;), using everyone with a valid answer as the base, so a net of categories equals the sum of its
        categories. On a <em>column</em> variable, grouped categories become a single column and the rest stay as
        they are, which is the usual fix when several columns have too few people (&quot;Three or more SIM cards&quot;
        instead of three thin columns). A category can sit in only one column group, but may appear in more than one
        row net.
      </P>

      <H2 id="sig">Significance: what the arrows mean</H2>
      <P>
        In the column % view, a green ▲ or a red ▼ marks a cell that differs from the other columns beyond what
        chance would plausibly produce. The test compares the column with <strong>all other people in the same
        banner variable</strong> (the rest of the sample), using a two-proportion test on the effective bases, at the
        95% level. For averages it compares the column&apos;s mean with the mean of the rest. A column is never
        compared with the Total column, because the Total already contains it, and that would make differences look
        more significant than they are. Both groups need an effective base of at least 30 for a test to run.
      </P>
      <P>Three things to keep in mind when you read an arrow.</P>
      <UL>
        <li>
          <strong>It tests chance, not importance.</strong> With a large sample, a gap of one or two points can be
          marked. Look at the size of the gap, not only the arrow.
        </li>
        <li>
          <strong>Many tests mean some false alarms.</strong> At the 95% level, about 1 comparison in 20 is marked
          even when there is no real difference. A big table has hundreds of cells. The app does not correct for this
          yet (see limitations), so treat an isolated arrow in a large table with caution, and weigh a repeated
          pattern more heavily.
        </li>
        <li>
          <strong>Built-in links can mislead.</strong> When the columns and rows are related by construction, the
          marks are not informative. People with more SIM cards, for instance, will name more networks. Think about
          whether the pattern is real or mechanical before reporting it.
        </li>
      </UL>

      <H2 id="findings">From tables to findings</H2>
      <P>
        <strong>Nothing is tabulated automatically when you upload a file.</strong> A large survey crossed against even
        a few groups means thousands of tests, and a few will look significant by chance alone, so which comparisons
        to run is left to you. To get going quickly, the workspace offers an optional <strong>starter set</strong>:
        the usual demographic splits (gender, age, province and similar) against the questions in the file, built as
        drafts. Under about 100 variables it is offered up front and covers up to 40 questions. In larger files it is
        a smaller, capped suggestion (20 questions). Because a starter set tests so many cells, only differences that
        survive a false discovery rate correction (Benjamini &amp; Hochberg, 1995) at 5% become findings from it, and
        those findings say so. &quot;Delete all drafts&quot; clears the set in one click.
      </P>
      <P>
        Tables are built as a <strong>set</strong>. Each time you press &quot;Add table to set&quot; the table is
        added below the previous ones as a <em>draft</em>. Nothing is turned into findings yet, so you can roll
        tables up, delete any you do not want, and add more. Each table card has a roll up button, a delete button
        and its own switch between column %, row % and weighted count. Hiding a row or column changes only what you
        see.
      </P>
      <P>
        When the set is right, press <strong>Commit</strong>. The app then writes findings from the committed
        tables: for each question it takes up to three of the largest marked differences (ranked by the gap between
        a column and the overall figure), up to 40 findings per table. Each finding states the figures, the base, the
        effective base, the weight used and the test, and carries three caveats: comparisons were not corrected for
        testing many things, the test used the weighted effective base, and the sample was assumed random. Deleting a
        table archives the findings that came from it; nothing is destroyed.
      </P>

      <H2 id="limits">Limitations</H2>
      <Limit title="the sample design is only as good as what you tell the app">
        If you name a PSU (cluster) variable, and ideally a strata variable, the app uses Taylor series linearised
        standard errors, the method behind the R survey package. On the FinScope 2024 file, with the strata rebuilt
        as in the original R run, those standard errors matched R to within 0.3% in every cell tested. Without a
        design the app uses the Kish effective base, which only reflects unequal weights. On the same file that
        understated or overstated the design-based error by up to a third, depending on the cell, so treat a
        weights-only arrow as indicative. Strata that contain a single PSU are pooled, which can only widen
        intervals. Finite population corrections are not applied.
      </Limit>
      <Limit title="the correction is a choice">
        Many columns are tested at once, so some differences appear by chance. The default is the Benjamini-Hochberg
        false discovery rate (Benjamini &amp; Hochberg, 1995), applied across the columns of each banner variable for
        each row. Bonferroni is stricter and no correction is available. A correction can only remove marks, never add
        them. The correction does not cover the many rows and banners in a workbook, so a finding should still be
        read as a lead.
      </Limit>
      <Limit title="the whole-table test is first order">
        Each question gets a whole-table test against each banner variable, using a first-order Rao-Scott adjustment
        (Rao &amp; Scott, 1981): the chi-square is divided by an average design effect. It is an approximation, and
        without a design the effect comes from the weights alone, which is optimistic for a clustered sample.
      </Limit>
      <Limit title="tables describe association, not cause">
        A difference between groups can reflect something else that differs between them (age, income, access). A
        table cannot separate those explanations. Findings describe differences, not reasons.
      </Limit>
      <Limit title="a base reflects who was asked, which the file may not say">
        The app can tell who answered a question. It cannot always tell who was <em>supposed</em> to be asked. A
        missing answer might mean a refusal, or that the question was skipped by routing. If the file does not mark
        the difference, a base can be smaller or larger than the intended universe. Check the questionnaire for
        routing on any question where the base looks odd.
      </Limit>
      <Limit title="grouping is your decision">
        Net and group definitions are analyst choices. Combining categories changes the result, and the same
        categories can be grouped in different defensible ways. State the grouping when you report a net.
      </Limit>
      <Limit title="small groups hide real differences, and show false ones">
        With few people in a column the test has little power, so real differences go unmarked, and figures on
        bases under 30 are indicative only (under 10 are hidden). Combine thin categories before concluding that groups do not
        differ.
      </Limit>

      <DoesDoesNot
        does={[
          "Weights each cell, states the base, and shows unweighted, weighted and effective bases.",
          "Keeps every option of a multiple-response question, each on the correct base.",
          "Builds nets and grouped categories from respondent-level data, never by adding percentages.",
          "Offers an optional starter set of demographic tables, with false discovery rate control on the findings it yields.",
          "Tests each column against the rest of its banner variable (Taylor series variance when a design is given), shows column-pair letters, a whole-table test, a correction setting and an Excel export, marks bases under 30 as indicative only, and hides figures under 10.",
          "Keeps tables as drafts until you commit, and archives findings if a table is deleted.",
        ]}
        doesNot={[
          "Know your sampling design unless you name the PSU and strata variables.",
          "Correct for the many tables and banners across a whole workbook.",
          "Replace a statistician's review of a complex-sample analysis.",
          "Tell you why two groups differ.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Open the workspace and choose the banner: the groups you care about, such as province or age band.</li>
        <li>Check the weight proposed. Use it unless you have a reason not to.</li>
        <li>Add the questions to measure. Add a whole family at once, or tick yes/no options to build a net.</li>
        <li>Look at the bases first, then the percentages, then the marks. Group thin categories where needed.</li>
        <li>Delete tables that only show a mechanical relationship, and add the cuts that answer your questions.</li>
        <li>Commit the set, then review the findings and caveats before using any of them in a report.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
