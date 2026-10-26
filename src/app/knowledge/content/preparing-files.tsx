import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox } from "../kbBlocks";

const toc = [
  { id: "principles", title: "Four habits that help every file" },
  { id: "reports", title: "Reports, decks and briefs" },
  { id: "aggregated", title: "Tables that are already summarised" },
  { id: "raw", title: "Raw case-level data" },
  { id: "qual", title: "Transcripts" },
  { id: "coded", title: "A coding file of your own" },
  { id: "instruments", title: "Questionnaires and guides" },
  { id: "output", title: "Statistical output" },
  { id: "checklist", title: "A short checklist before you upload" },
];

export default function PreparingFilesGuide() {
  return (
    <Article
      slug="preparing-files"
      title="Preparing your files for import"
      lede="How each kind of file is best laid out, and what to change in your documents so the app can read them accurately. Nothing here is compulsory. Files that break these tips are still read, but the more closely a file follows them, the less the reader has to guess, and guesses are where extraction errors come from."
      toc={toc}
    >
      <H2 id="principles">Four habits that help every file</H2>
      <OL>
        <li>
          <strong>Use the original, not a copy of a copy.</strong> A file exported from the source tool (SPSS, Excel,
          Word, PowerPoint) reads better than a scan or a print-to-PDF of it. Text that a person can select and copy is
          text the app can read.
        </li>
        <li>
          <strong>Put each kind of file where it belongs.</strong> A Word report uploaded as a table, or a table
          uploaded as a report, is read by the wrong reader and fails in confusing ways. If something looks wrong
          straight after upload, check the type first.
        </li>
        <li>
          <strong>Name files so they can be told apart.</strong> A name such as <em>Brand_tracker_W2_2026.sav</em>{" "}
          tells you, and the app, more than <em>final_v3.sav</em>. Wave and year tokens in names are also what lets
          related sets be matched later.
        </li>
        <li>
          <strong>Say what is in it, once, near the top.</strong> Fieldwork dates, sample size, who was asked, whether
          figures are weighted. The checks look for these, and a missing base is the most common reason a figure cannot
          be verified.
        </li>
      </OL>
      <WhyBox>
        The reader is careful but not clairvoyant. Where a layout is ambiguous it will pick the likeliest reading and
        flag it. Fixing the ambiguity at source is faster than correcting the flag afterwards.
      </WhyBox>

      <H2 id="reports">Reports, decks and briefs</H2>
      <P>
        Accepted as PDF, Word or PowerPoint. The app reads the text, pulls out claims, and finds the tables inside the
        document. The brief and proposal on the objectives page accept PDF, Word, PowerPoint or plain text.
      </P>
      <UL>
        <li>
          <strong>Send a digital PDF, not a scan.</strong> A PDF made from images has no text to read, and table
          extraction from scans is not supported yet. If all you have is a scan, run it through OCR first, or send the
          Word or PowerPoint original.
        </li>
        <li>
          <strong>Prefer the Word or PowerPoint original to a PDF of it.</strong> Real tables survive as tables. In a
          PDF the same table can lose its merged headers.
        </li>
        <li>
          <strong>Keep tables as tables.</strong> A pasted picture of a table is invisible to the reader. Use a real
          table, with one header row, and avoid merged cells where you can.
        </li>
        <li>
          <strong>Put the base beside the figure.</strong> &quot;42% (n = 512)&quot; can be checked. &quot;42%&quot;
          cannot. Say whether figures are weighted, and who was asked.
        </li>
        <li>
          <strong>Make claims findable.</strong> One claim per sentence, with the number in the same sentence as the
          statement it supports, extracts cleanly. A claim that spreads over three sentences, with the figure in a
          footnote, tends to be extracted without its evidence.
        </li>
        <li>
          <strong>Use headings that say something.</strong> &quot;Satisfaction fell among younger customers&quot; helps
          more than &quot;Results&quot;. Charts need their numbers in labels or a table beside them, because a bar with
          no values cannot be checked.
        </li>
        <li>
          <strong>Keep the methodology in the document.</strong> Sample, mode, dates, weighting and margin of error in
          one place give the checks something to test the claims against.
        </li>
      </UL>
      <ExampleBox title="Hard to verify, then easy">
        <P>
          Before: &quot;Most customers are now happier with call times (see chart).&quot; After: &quot;Satisfaction with
          call time rose from 41% to 55% between Wave 1 and Wave 2 (weighted, n = 1 000 each wave; Table 4).&quot; The
          second version carries its own base, direction, size and source.
        </P>
      </ExampleBox>

      <H2 id="aggregated">Tables that are already summarised</H2>
      <P>Use the <em>Tables</em> picker for CSV or Excel files that hold counts, percentages or averages, not individual respondents.</P>
      <UL>
        <li>One table per sheet, with the title in the first cell or the sheet name, and the column headers in a single row.</li>
        <li>Answer options down the side, groups across the top. Put the total column first.</li>
        <li>Include a base row (the n for each column). Tables without a stated base cannot be checked for small samples.</li>
        <li>Keep percentages as numbers, with the same decimals throughout. Do not mix counts and percentages in one block without a label.</li>
        <li>Avoid merged cells, notes inside the grid, and blank spacer columns. Move footnotes under the table.</li>
        <li>Say in the title or a note whether the figures are weighted.</li>
      </UL>
      <Limit title="Percent columns should add to about 100">
        The checks compare each column with 100 and each count with the total row. A table where they disagree is
        flagged, and sometimes the cause is rounding, sometimes multiple response, and sometimes an extraction error.
        A note saying which one saves you a query.
      </Limit>

      <H2 id="raw">Raw case-level data</H2>
      <P>
        Use <em>Raw data</em> for files with one row per respondent: .sav, .dta, .csv or Excel (SAS is excluded pending verification). This is what
        the cross tab tool works from.
      </P>
      <UL>
        <li>
          <strong>Prefer SPSS or Stata to CSV.</strong> They carry variable labels and value labels, so the tool
          shows &quot;Very satisfied&quot; and the full question wording instead of codes such as 5 and Q12. A CSV has
          only what is in its cells, so add a questionnaire if you can.
        </li>
        <li>One row per respondent, one column per variable. Do not mix tables, titles or totals into the data sheet.</li>
        <li>Give every respondent a unique ID. Duplicated IDs are reported as a quality issue.</li>
        <li>Keep a single header row, with short, unique variable names. Two columns with the same name cause silent confusion.</li>
        <li>
          Flag missing values properly (system missing, or declared missing codes), and avoid unmarked stand-ins such as
          99 or 999. They look like real answers and are the most common cause of strange means.
        </li>
        <li>Include the weight variable if there is one, and keep it in the same file.</li>
        <li>Multiple response questions work best as one 0/1 column per option, with a shared stem (Q7_1, Q7_2, Q7_3), so they can be grouped.</li>
        <li>Remove variables nobody needs. Very wide files keep only the usable variables, and fewer, cleaner columns make that cut easier to trust.</li>
      </UL>

      <H2 id="qual">Transcripts</H2>
      <P>
        Use <em>Qual data</em>. The reader splits a transcript into speaker turns, so clear speaker labels matter most.
      </P>
      <UL>
        <li>
          <strong>Label every turn.</strong> Start each turn on a new line with the speaker and a colon:
          <em> Moderator: </em>, <em>Interviewer: </em>, <em>Thandi: </em>, <em>P3: </em>. Labels like these are
          picked up as speakers, and Moderator, Interviewer, Facilitator, Researcher, Host and Q are treated as the
          moderator.
        </li>
        <li>
          <strong>Be consistent.</strong> A label counts only when the same label opens at least two lines, so one
          spelling per speaker (not Mod, Moderator and Mod. in the same file).
        </li>
        <li>
          <strong>One interview per file, or clear headings.</strong> If one file holds several sessions, separate
          them with headings such as <em>Interview 1</em>, <em>Respondent 2</em> or <em>Participant 3</em> on their
          own lines.
        </li>
        <li>
          <strong>Timestamps are welcome.</strong> A leading [00:12:40] before the label is accepted and does not stop the
          speaker being recognised. They also help you find the audio again.
        </li>
        <li>
          <strong>Unlabelled notes are read as plain paragraphs.</strong> That works, but speaker-level counts, moderator
          share and quiet-member checks then have nothing to measure.
        </li>
        <li>
          <strong>Mark what you could not hear.</strong> Use one consistent marker, such as [inaudible], rather than
          guessing words. Guessed words get coded as if they were said.
        </li>
        <li>
          <strong>Keep it as spoken.</strong> Do not tidy, summarise or merge turns. Long monologues are split into
          segments of about 1 200 characters for coding, and quotes are checked back against the original text.
        </li>
        <li>Remove names and identifying detail before upload, and use codes (P1, P2) if you can.</li>
      </UL>
      <ExampleBox title="A transcript layout that reads well">
        <P>
          Interview 3
          <br />
          [00:00:12] Moderator: Tell me about the last time you called the centre.
          <br />
          [00:00:20] P3: It was about my account balance. I waited a long time and then got cut off.
          <br />
          [00:00:41] Moderator: What did you do next?
        </P>
      </ExampleBox>

      <H2 id="coded">A coding file of your own</H2>
      <P>
        If you have already coded the transcripts elsewhere (ATLAS.ti, NVivo, a spreadsheet), the coding can be brought
        in as Qual data. The app reads three shapes and recounts everything itself, so counts in your file are ignored.
      </P>
      <UL>
        <li><strong>Theme table.</strong> One row per quote, with a column headed Theme or Code and a column headed Quote or Quotation. A Definition column is picked up if present.</li>
        <li><strong>Coded sentences.</strong> One row per quote with the codes in another column. Separate several codes in one cell with new lines, semicolons or a vertical bar, not commas, because code names often contain commas.</li>
        <li><strong>Matrix.</strong> One row per sentence, one column per code, with 1, x or yes where the code applies.</li>
        <li>Use plain headers on the first row, and give a theme once above its quotes if you merge cells. Merged values are copied down.</li>
        <li>Copy quotes exactly as they appear in the transcript. Quotes that differ from the transcript text may not be placed against it.</li>
      </UL>

      <H2 id="instruments">Questionnaires and guides</H2>
      <P>
        Accepted as PDF or Word, attached to the data file or the transcripts. They are read automatically and matched.
      </P>
      <UL>
        <li>
          <strong>Print the question code with every question</strong> and make it the same as the variable name in the
          data (Q12, B3a). Same-code matches are the most reliable and can be confirmed in one go.
        </li>
        <li>Put the question wording, then the answer options, in a consistent order, one option per line.</li>
        <li>
          <strong>Write routing as plain words, next to the question:</strong> &quot;ASK IF Q5 = 1 or 2&quot;, or
          &quot;No: GO TO Q10&quot;. These are read into rules that separate people who were not asked from people who
          skipped.
        </li>
        <li>Send the final fielded version, not a draft. Wording and numbering that changed after programming will not match the data.</li>
        <li>For guides, number the topics and write each as a question or a short prompt. Probes belong under their topic, not as separate topics.</li>
        <li>Choose the right type in the dropdown (survey questionnaire, interview guide or focus group guide), since each is matched differently.</li>
      </UL>

      <H2 id="output">Statistical output</H2>
      <P>
        Use <em>Statistical output</em> for model results, cluster profiles, diagnostics and logs. A zip of the whole
        results folder works best, with a wave label if there is more than one study.
      </P>
      <UL>
        <li>Send the folder as it came out of the script, so the evidence, the assurance files (diagnostics, validation) and the context (manifest, session info) arrive together.</li>
        <li>Export tables as CSV or Excel, with a header row and named columns (term, estimate, std.error, p.value, conf.low, conf.high). Standard column names are what let the sorter recognise the kind of table.</li>
        <li>Give files descriptive names that say what they are: <em>logit_coefficients.csv</em>, <em>cluster_profile.csv</em>, <em>vif_diagnostics.csv</em>.</li>
        <li>Include the console log or the relevel calls, since the reference category for each factor is read from them.</li>
        <li>Keep Word tables simple. They are read, but plain CSV is the safer choice.</li>
        <li>Name waves consistently (Wave 1, Wave 2, W1, W2). The matching ignores wave and year tokens, so the rest of the name should stay the same between waves.</li>
      </UL>
      <Limit title="Cross tabs do not belong here">
        Cross tabulations are built from case-level data inside the app, so that weighting, tests and labels stay
        consistent. Send the data, not a finished cross tab, when you have the choice.
      </Limit>

      <H2 id="checklist">A short checklist before you upload</H2>
      <UL>
        <li>Is each file in the right picker (Reports, Tables, Raw data, Qual data, Statistical output, Questionnaire or guide)?</li>
        <li>Can you select and copy the text in the PDF? If not, find the original.</li>
        <li>Does every table have a header row and a base?</li>
        <li>Does raw data have unique IDs, a weight variable, labelled values and properly marked missing values?</li>
        <li>Does every transcript turn start with a speaker label and a colon?</li>
        <li>Does the questionnaire show the question codes that appear in the data?</li>
        <li>Has the owner cleared the files, with personal information removed or covered?</li>
      </UL>
    </Article>
  );
}
