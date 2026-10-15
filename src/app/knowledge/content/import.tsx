import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "why", title: "What Import is for" },
  { id: "kinds", title: "What you can bring, and what each kind gets" },
  { id: "accept", title: "Reading and accepting data files" },
  { id: "quality", title: "What the quality panels check" },
  { id: "instruments", title: "Questionnaires and guides" },
  { id: "output", title: "Statistical output sets" },
  { id: "checks", title: "The checks on an output set" },
  { id: "findings", title: "From output to findings" },
  { id: "waves", title: "Related sets and waves" },
  { id: "limits", title: "Limitations" },
  { id: "practice", title: "A sensible way to work with it" },
];

const sources: Source[] = [
  {
    citation:
      "Albert, A., & Anderson, J. A. (1984). On the existence of maximum likelihood estimates in logistic regression models. Biometrika, 71(1), 1-10.",
    url: "https://doi.org/10.1093/biomet/71.1.1",
  },
  {
    citation:
      "Fox, J., & Monette, G. (1992). Generalized collinearity diagnostics. Journal of the American Statistical Association, 87(417), 178-183.",
    url: "https://doi.org/10.1080/01621459.1992.10475190",
  },
  {
    citation:
      "Gelman, A., & Stern, H. (2006). The difference between \"significant\" and \"not significant\" is not itself statistically significant. The American Statistician, 60(4), 328-331.",
    url: "https://doi.org/10.1198/000313006X152649",
  },
  {
    citation:
      "Groves, R. M., & Lyberg, L. (2010). Total survey error: Past, present, and future. Public Opinion Quarterly, 74(5), 849-879.",
    url: "https://doi.org/10.1093/poq/nfq065",
  },
  {
    citation:
      "Heinze, G., & Schemper, M. (2002). A solution to the problem of separation in logistic regression. Statistics in Medicine, 21(16), 2409-2419.",
    url: "https://doi.org/10.1002/sim.1047",
  },
  {
    citation:
      "Rousseeuw, P. J. (1987). Silhouettes: A graphical aid to the interpretation and validation of cluster analysis. Journal of Computational and Applied Mathematics, 20, 53-65.",
    url: "https://doi.org/10.1016/0377-0427(87)90125-7",
  },
  {
    citation:
      "Wasserstein, R. L., & Lazar, N. A. (2016). The ASA statement on p-values: Context, process, and purpose. The American Statistician, 70(2), 129-133.",
    url: "https://doi.org/10.1080/00031305.2016.1154108",
  },
];

export default function ImportGuide() {
  return (
    <Article
      slug="import"
      title="How import works"
      lede="What happens to a file between upload and analysis: how it is read, checked and accepted, how a questionnaire or guide is attached, and how a set of statistical output (models, clusters, diagnostics) becomes checked findings. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="why">What Import is for</H2>
      <P>
        Import is the step where material is looked at before anything is built on it. Most problems in a finished
        analysis were visible at this stage: a weight variable that is empty for a fifth of the file, a transcript that
        is mostly the moderator talking, a table whose percentages do not add to 100, an odds ratio file that comes from
        a different model run than the coefficients beside it. The aim is to show these early, in plain words, while
        they are cheap to fix. The thinking behind it is the total survey error view: a result can be wrong for many
        reasons besides sampling, and the reasons are easiest to catch where the data enters (Groves &amp; Lyberg,
        2010).
      </P>
      <P>
        How well a file reads depends a good deal on how it is laid out. The{" "}
        <a href="/knowledge/preparing-files" className="text-primary hover:underline">
          guide to preparing your files
        </a>{" "}
        gives layout tips for each kind.
      </P>
      <P>
        Import does not decide whether the evidence is good enough. It reports what it found, with the figures, and
        leaves the judgement to you.
      </P>

      <H2 id="kinds">What you can bring, and what each kind gets</H2>
      <Table
        rows={[
          ["Kind", "What it is", "What Import does with it"],
          ["Report", "A narrative document, deck or PDF that makes claims", "Reads it and extracts atomic claims for verification (see the findings guide)."],
          ["Data file", "Case-level data (.sav, .dta, .sas7bdat, .csv, .xlsx) or an already summarised table", "Case-level files are read, checked and held for the cross tab tool. Summarised tables get their own table checks and can generate findings."],
          ["Transcript", "An interview or group discussion", "Checks it before coding: who speaks, how much, how the moderator behaves, and whether it is long enough to code."],
          ["Questionnaire or guide", "The instrument behind the data or the discussion", "Attached to a data file or to transcripts, read automatically, and matched. See below."],
          ["Statistical output", "A zip or several files of model results, cluster profiles, diagnostics and logs", "Sorted into a set, classified, checked as a set, and turned into findings. See below."],
        ]}
      />
      <P>
        Cross tabulations are not imported as output. Any case-level data goes through the cross tab tool, which
        weights, tests and labels it consistently. Statistical output is for everything else a statistician produces
        around the data.
      </P>

      <H2 id="accept">Reading and accepting data files</H2>
      <P>
        A case-level data file is read as soon as it arrives. The read gets the variable list, labels, value labels and
        the structure choices (which variable is the weight, which identify respondents, which are multiple response
        sets). You do not have to press anything for this to happen. The file is also accepted automatically, so the
        cross tab tool opens without a trip back to Import.
      </P>
      <P>
        Transcripts follow the same rule. A transcript nobody has set up yet is accepted on import with the
        app&apos;s best reading of it (individual interviews when it cannot tell), and the dropdowns stay open to
        change it. Every file card now shows one of two badges: <em>Accepted</em> or <em>Needs review</em>. Raw
        case-level files are labelled <em>Raw data</em> on the card and in the upload list. The upload list puts each
        file picker on the same line as its type to save space, and a note under it says that you should upload
        only files that the owner has cleared for analysis, since the app does not scan for personal information.
      </P>
      <P>
        Acceptance is a record that the structure was looked at, not a verdict on the data. If you change a structure
        choice afterwards, the card changes to <em>Accept again</em>, because tables built on the old choice may no
        longer mean what they did. Wide files, with thousands of columns, keep only the usable variables, and the panel
        says how many were kept; the cross tab tool still reads every variable it needs.
      </P>
      <WhyBox>
        Accepting by default saves a step nearly everyone would take anyway. Asking again after a change keeps the one
        safeguard that matters: a table should never silently rest on a different structure than the one you
        approved.
      </WhyBox>

      <H2 id="quality">What the quality panels check</H2>
      <P>Each card has a rolled-up quality panel. It reports figures, not scores, so you can see why it says what it says.</P>
      <H3>Case-level data</H3>
      <UL>
        <li>
          <strong>Missing values.</strong> How much is empty, per variable. Survey routing creates legitimate gaps: a
          person never asked a question is not a non-response. Where one variable cleanly splits empty from answered
          (a gate question), the gaps it explains are set aside and the file reports what is left once routed
          questions are accounted for.
        </li>
        <li>
          <strong>Weights.</strong> Whether a weight variable is present, how many cases lack a weight, and how
          variable the weights are. Very unequal weights reduce the effective sample size.
        </li>
        <li>
          <strong>Structure.</strong> Duplicated respondents, constant columns, label look-alikes, and codes that look
          like missing values but are not flagged.
        </li>
      </UL>
      <H3>Summarised tables</H3>
      <UL>
        <li>Tables read, whether a base is stated for each, and whether any base is under 30 or under 10.</li>
        <li>Whether weighting is stated, whether percentage columns add to about 100, and whether counts agree with the total row.</li>
        <li>Duplicate tables, extraction damage (merged cells, split headers) and column layouts the reader had to guess.</li>
      </UL>
      <H3>Transcripts</H3>
      <UL>
        <li>Respondents, turns, and words per respondent, with thin respondents named.</li>
        <li>Moderator share of the talk, dominant voices, and quiet members of a group.</li>
        <li>Questions asked, split into open, closed and leading, and how long the answers were.</li>
        <li>Inaudible markers, duplicated turns, very long turns, speaker labels that look alike, and whether there are timestamps.</li>
      </UL>
      <Limit title="Checks find signs, not causes">
        A high share of missing values can mean a routing gap, a bad export, or a real pattern of refusal. The panel
        cannot tell which. The same is true of a moderator who talks a lot: that may be a weak interview or a
        deliberately directive one. Treat each line as a prompt to look.
      </Limit>

      <H2 id="instruments">Questionnaires and guides</H2>
      <P>
        A questionnaire sits inside the data file card, and a guide inside the transcript card, rolled up. They are
        read automatically when they arrive, and the wrong one can be removed with the delete button beside it.
      </P>
      <H3>Questionnaire</H3>
      <P>
        The read produces a list of items: code, wording, answer options and any printed skip instruction. Matching to
        the data then proceeds from the most to the least reliable signal: same code, same code stem (Q12 to Q12_1; Q1
        never matches Q10), a variable label that starts with the code, and last, overlapping wording. Every match
        starts as a suggestion with its method and confidence. You can confirm a whole batch of same-code matches at
        once, or accept and reject them one by one.
      </P>
      <P>Confirmed matches do three things.</P>
      <UL>
        <li>
          They supply the full question wording as a tooltip and as a variable label, and answer labels where the data
          file has none. The data file&apos;s own labels always win. Rejecting a match takes effect at once, because
          the stored dictionary is not changed.
        </li>
        <li>
          They supply skip logic. Printed instructions such as &quot;ASK IF Q5 = 1 or 2&quot; and jumps on answer
          options (&quot;GO TO Q10&quot;) are read into rules. A rule is used to separate people who were not asked
          from people who skipped only if at least 90% of the cases it says were not asked are in fact empty; otherwise
          the detected routing is the fallback.
        </li>
        <li>They can later give wording for the labels in a statistical output set (see below).</li>
      </UL>
      <H3>Guide</H3>
      <P>
        Moderator questions in each transcript are split out and compared with the guide items by wording overlap. A
        question counts as asked at an overlap of 0.7 or more, reworded from 0.4 to 0.7, and the rest as not asked.
        Per session you see items raised, items not raised, and moderator questions outside the guide (probes are
        expected). Coverage of 80% or more reads as a pass, 50% to 80% as a check. Up to 25 guide topics are also
        passed to the open-coding step as hints, worded so that a theme still needs support in the transcript.
      </P>
      <Limit title="Wording overlap is a rough measure">
        A moderator can ask a guide question in words that share little with the printed wording, and two different
        questions can share many words. Coverage figures are a first look at fidelity to the guide, not a score for the
        moderator.
      </Limit>

      <H2 id="output">Statistical output sets</H2>
      <P>
        Model coefficients, odds ratios, cluster profiles, diagnostics and the logs that explain them usually arrive as
        a folder of files from R, SPSS, Stata or Python. Upload them as one zip, or select several files, and give the
        study or wave a label. They become one <strong>output set</strong>. Images are left out, and very large or
        deeply nested uploads are limited (up to 400 files, 40 MB for a file, 300 MB for the set).
      </P>
      <P>
        Each file is sorted by what it contains, with the signals shown, so the sort can be checked. There are two
        questions. First, what role does it play?
      </P>
      <Table
        rows={[
          ["Role", "Meaning", "Examples"],
          ["Evidence", "Findings are built from it", "Coefficients, odds ratios, proportions with intervals, cluster profiles"],
          ["Assurance", "Says how far to trust the evidence", "Diagnostics, design effects, collinearity, separation, replication and robustness checks"],
          ["Context", "Explains how the output was produced", "Run manifests, survey design records, session information, author notes, the console log"],
          ["To check", "No clear pattern was found", "Anything the sorter could not place"],
        ]}
      />
      <P>
        Second, what kind of file is it? The kinds include model coefficients, odds ratios and intervals, proportions
        with intervals, cluster profiles, descriptive tables, diagnostics, validation checks, and the context kinds
        above. Files are grouped into families for the roll-down, by folder or by a shared first word of the name.
      </P>
      <ExampleBox>
        An R script writes <code>DV1_Model1_coefficients.csv</code> and <code>DV1_Model1_ORs.csv</code>, a GVIF
        summary, a design-effect table, a folder of robustness runs with an exact-replication check, and a Word copy of
        the console. The sorter treats the first two as evidence, the next three and the replication check as
        assurance, and the console copy as context. If a script did not write something to a file but it appears in
        the console (for example which category was left out as the reference), the console copy is how the app
        recovers it.
      </ExampleBox>

      <H2 id="checks">The checks on an output set</H2>
      <P>
        <em>Check this set</em> compares the files with each other and reads the assurance files. It writes no findings.
        The results stay on the set card, with a green, amber or grey marker for each.
      </P>
      <Table
        rows={[
          ["Check", "What it asks", "Why it matters"],
          ["Odds ratios equal exp(estimate)", "For each paired model, does every odds ratio equal the exponential of its coefficient?", "A mismatch means the two files come from different model runs, a common slip when files are regenerated one at a time."],
          ["Intervals fit the standard errors", "Does the width of each odds ratio interval imply a critical value near 1.96?", "A different value points to another confidence level or degrees of freedom than the standard errors suggest."],
          ["Test statistics fit estimate over standard error", "Is each t or z value within 1% of estimate divided by standard error?", "Catches columns pasted from a different model."],
          ["Published results reproduce", "Did every row of a replication or validation file pass?", "A failed row means the headline numbers may not be the ones in the report."],
          ["Separation", "Did any model flag quasi-complete separation?", "Under separation the estimates can run away to very large values and cannot be trusted (Albert & Anderson, 1984; Heinze & Schemper, 2002)."],
          ["Collinearity", "How large is the biggest adjusted generalised variance inflation factor?", "Adjusted GVIF is on the scale of a standard error inflation; values from about 2.24 deserve a look and from about 3.16 are a concern. These are rules of thumb, not tests (Fox & Monette, 1992)."],
          ["Design effect", "What design effect does the output report?", "It says how much less precise the complex sample makes an estimate than a simple random sample of the same size."],
          ["Small cells", "How many unweighted cases are in the smallest outcome cell?", "Under 30 is a caution and under 10 a concern."],
          ["Robustness across specifications", "Do headline terms keep their direction, and an interval excluding 1, in every alternative model?", "A term that flips in some specifications may owe its result to a modelling choice."],
          ["Reference categories", "Does the console log state which level was left out?", "An odds ratio means nothing without the group it is compared with."],
        ]}
      />
      <Limit title="Consistency is not correctness">
        The checks show that the files agree with each other and with the usual conventions. They cannot show that the
        model was the right one, that the weights were right, or that the script did what the author intended.
      </Limit>

      <H2 id="findings">From output to findings</H2>
      <P>
        <em>Make findings</em> reads each evidence file with a reader that fits its kind and writes one finding per
        model, table or segment variable. Running it again replaces the findings from that set.
      </P>
      <UL>
        <li>
          <strong>Models.</strong> One finding per model. It says how many terms reached p &lt; .05 and describes the
          four clearest, ranked by test statistic, with odds ratio, interval and p value. Where the reference category
          is known from the console log, the text says what the odds are compared with. Odds ratios that are extreme
          with very wide intervals, which usually mean very few cases in a group, are left out of the summary and
          counted. If no term reaches p &lt; .05, the finding says so.
        </li>
        <li>
          <strong>Interaction and odds ratio tables.</strong> One finding per block, with the same treatment of extreme
          ratios. A non-significant interaction is reported as little evidence of a difference, not as evidence of none.
        </li>
        <li>
          <strong>Segments.</strong> Proportions with intervals give a finding only where the highest and lowest
          groups have separate intervals. Estimates with standard errors are compared by the size of the gap against
          the combined standard error.
        </li>
        <li>
          <strong>Clusters.</strong> The finding names the variables on which the clusters differ most, with group
          sizes, and attaches the silhouette width when a file reports it (Rousseeuw, 1987).
        </li>
      </UL>
      <P>
        Every finding carries <strong>assurance notes</strong> from the set. Cautions and checks show on the finding;
        the rest are rolled up beneath it. Typical notes are the design effect, collinearity, separation, that p values
        are not adjusted for the number of terms, that a reference category is not stated, that a segment gap rests on
        separate intervals and not a formal test, and the robustness record for the same term.
      </P>
      <P>
        Robustness and sensitivity files, such as a folder of alternative specifications, are not turned into findings
        of their own. They feed the robustness check and the notes on the headline findings. Descriptive tables with no
        interval or test are listed as read but giving no finding.
      </P>
      <WhyBox>
        A model finding that does not carry its own warnings travels badly. A figure pasted into a deck loses the
        design effect, the unadjusted p value and the reference category that gave it meaning. Attaching the notes to
        the finding is meant to keep them with the number.
      </WhyBox>

      <H2 id="waves">Related sets and waves</H2>
      <P>
        When a run holds two or more sets, the app looks for pairs that match once wave, year and version labels are
        ignored in file names. A strong overlap suggests the same analysis on another wave, and the suggested action
        is to compare. Sets with a shared label and no files in common may be two parts of one output, and the
        suggested action is to merge them. You can also compare any two sets directly, choosing which is earlier.
      </P>
      <P>
        A comparison matches the same model term, or the same segment, in both sets and tests the change against
        sampling error. For a model term, the difference in log-odds is divided by the combined standard error. For a
        proportion, the difference in the two estimates is divided by the same kind of combined standard error. Changes
        beyond about two standard errors are reported as larger than sampling error would explain; the rest are
        reported as within chance.
      </P>
      <Limit title="Two significant results are not a significant change">
        A term significant in one wave and not in the other has not necessarily changed. The difference between
        &quot;significant&quot; and &quot;not significant&quot; is not itself statistically significant (Gelman &amp;
        Stern, 2006). That is why the comparison tests the change itself.
      </Limit>
      <Limit title="Independence and like-for-like">
        The test assumes the waves are independent samples. If the same people were followed, it will be wrong in
        either direction. It also assumes the same questions, weights and model specification in both waves. Where
        the specification changed, a difference in the numbers may be a difference in the model.
      </Limit>

      <H2 id="limits">Limitations</H2>
      <Limit title="Quality checks use fixed thresholds">
        Under 30 cases, 80% guide coverage, a design effect of 1.5 and adjusted GVIF cut-offs are conventions. They are
        sensible defaults, not boundaries in nature, and p values themselves say little about the size or importance of
        an effect (Wasserstein &amp; Lazar, 2016).
      </Limit>
      <Limit title="Output is classified by shape">
        Files are sorted from headers, a few rows and the name. An unusual export can land in the wrong kind, which is
        why the signals are shown and the role can be checked.
      </Limit>
      <Limit title="Reference categories depend on the console">
        The reference level is read from relevel calls in a pasted console log. Terms for variables whose reference was
        never set that way are marked as unknown, and the odds ratios still compare with the omitted level.
      </Limit>
      <Limit title="Cluster profiles describe, they do not test">
        A profile shows how the segments differ on variables that are usually the ones that built them. No test of
        between-cluster differences is in most output, and the findings say so.
      </Limit>
      <Limit title="Questionnaire wording for model terms is a suggestion">
        Term group labels such as &quot;Education&quot; are matched to questionnaire items by shared words. Derived
        measures (scores, segments, recoded variables) have no item and get no match, and every match is worded as
        something to check.
      </Limit>
      <DoesDoesNot
        does={[
          "Reads, checks and accepts data files without extra steps, and asks again when the structure changes.",
          "Attaches and reads a questionnaire or guide, and matches it by code, stem and wording, with every match confirmable.",
          "Sorts a zip of statistical output into evidence, assurance and context, and shows the signals.",
          "Checks a set against itself and writes findings that carry their assurance notes.",
          "Compares two waves of the same output and tests each change against sampling error.",
        ]}
        doesNot={[
          "Decide that data is good enough to use.",
          "Prove a model is correctly specified or a script correct.",
          "Re-run any model; it reads the output as given.",
          "Turn cluster profiles or descriptive tables into tested differences.",
          "Treat two waves as a panel; the comparison assumes independent samples.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Upload the data and, if you have it, the questionnaire or guide beside it. Open the quality panel and read the figures.</li>
        <li>Confirm same-code matches, then look at the wording matches one by one.</li>
        <li>For statistical output, upload the whole folder as a zip with a wave label, and look at the roles and kinds the sorter chose.</li>
        <li>Paste the console log into the set if the script did not export everything. It supplies the reference categories.</li>
        <li>Run <em>Check this set</em> and read every amber marker before you make findings.</li>
        <li>Make findings, then read the assurance notes on each before the finding goes anywhere else.</li>
        <li>For a later wave, upload it as its own set and compare.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
