import { H1, Lede, H2, P, DoesDoesNot, WhyBox, ExampleBox } from "../blocks";
import { ManualPageFooter } from "../ManualPageFooter";

export default function UploadingPage() {
  return (
    <div>
      <H1>Uploading your material</H1>
      <Lede>What you can upload, the one question that matters most, and what happens to your files.</Lede>

      <H2>Three kinds of document</H2>
      <P>
        <strong>Reports</strong> are narrative documents: a Word file, a PDF, a slide deck, anything
        written in prose that makes claims you want checked.
      </P>
      <P>
        <strong>Tables</strong> are structured data: a spreadsheet, a CSV, or a Word/PDF document that
        contains one or more data tables worth analysing on their own terms. SPSS (.sav), Stata (.dta),
        and SAS (.sas7bdat) files are read the same way as a spreadsheet, including the variable and
        value labels they carry, so a question coded as <code>Q7a</code> with answers coded 1 and 2 shows
        up with its real label and category names rather than raw codes.
      </P>
      <P>
        <strong>Transcripts</strong> are interview or focus-group material, read for claims the same way
        a report is, but kept in their own category since they carry a different kind of evidence
        (what someone said) than a report&apos;s own stated conclusions.
      </P>

      <H2>Raw or aggregated: the question that changes everything downstream</H2>
      <P>
        When you upload a table, you are asked whether it is <strong>aggregated</strong> (already
        summarised, for example a cross-tab with totals and percentages) or <strong>raw</strong> (one row
        per respondent, the kind of file a survey platform exports before anyone has summarised it).
      </P>
      <P>
        This single choice decides how the table gets processed. An aggregated table is scanned
        automatically for patterns. A raw table is not scanned automatically at all; it waits for you to
        name which columns matter, through a banner plan. The <em>Raw data and banner plans</em> page
        explains exactly why, but the short version: scanning every possible pair of columns in a large
        raw file for anything interesting is a well-known way to generate false positives, so the app
        deliberately does not do that without your say in which comparisons are actually worth running.
      </P>

      <ExampleBox>
        A 40-question customer survey with 2,000 respondents has 40 columns. Scanning every pair of
        columns means testing roughly 780 comparisons. At the standard 5% significance threshold,
        chance alone would produce around 39 &quot;significant&quot; results even if nothing real were
        happening in the data at all. That is the exact risk the raw/aggregated distinction exists to
        manage.
      </ExampleBox>

      <WhyBox>
        Getting this one choice wrong in the safe direction (marking aggregated data as raw) costs you an
        extra step of naming your columns. Getting it wrong in the other direction (marking raw,
        respondent-level data as aggregated) risks a page full of statistically fragile, uncorrected
        findings presented as though they were solid. The app is built to make the safer mistake the
        default and the costlier one require a second, explicit choice.
      </WhyBox>

      <DoesDoesNot
        does={[
          "Reads CSV, Excel (.xlsx/.xls), SPSS (.sav), Stata (.dta), and SAS (.sas7bdat) files for tables",
          "Keeps every tenant's documents and data completely separate from every other tenant's",
          "Lets you re-upload or re-tag a document if you set the wrong kind or ingestion type the first time",
        ]}
        doesNot={[
          "Guess whether your table is raw or aggregated for you: you have to say",
          "Read scanned, image-only PDFs: a table extraction pass needs actual selectable text",
          "Share evidence between different clients' runs, even inside the same organisation's account",
        ]}
      />

      <ManualPageFooter currentSlug="uploading" />
    </div>
  );
}
