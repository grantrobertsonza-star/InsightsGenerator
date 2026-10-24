import { Article, H2, H3, P, UL, Limit } from "../kbBlocks";

const toc = [
  { id: "what", title: "What this page is" },
  { id: "sas", title: "SAS files" },
  { id: "flipped", title: "Variables-in-rows workbooks with a separate Codebook" },
  { id: "design", title: "Weights and survey design from a separate file" },
  { id: "technical", title: "More uses of technical documents" },
];

export default function RoadmapGuide() {
  return (
    <Article
      slug="roadmap"
      title="Planned, and not yet supported"
      lede="What the app deliberately does not do yet, what to do instead today, and what building it would take. Nothing here is a defect; each is a decision to leave it for later. It describes current scope and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What this page is</H2>
      <P>
        A short list of capabilities left out on purpose, so a request that falls outside them gets a plain answer and a
        workaround rather than a guess. The engineering record is in the repository&apos;s docs/later-additions.md.
      </P>

      <H2 id="sas">SAS files</H2>
      <P>
        SAS data files are recognised by name and refused with a message. Export them to SPSS (.sav), Stata (.dta), CSV or
        Excel instead. Supporting them needs a reader with the same identity, label, missing-value and weight rules as
        SPSS and Stata, checked on valid and damaged reference files.
      </P>

      <H2 id="flipped">Variables-in-rows workbooks with a separate Codebook</H2>
      <P>
        A workbook laid out with variables in rows and cases in columns is supported, but not together with weight or
        multiple-response declarations on a separate Codebook sheet. That combination is refused before any result,
        with a message to re-export as one row per respondent or to put the declarations on the data sheet.
      </P>

      <H2 id="design">Weights and survey design from a separate file</H2>
      <H3>What works now</H3>
      <UL>
        <li>Weight variables in the data file itself, found by name, used by Cross tabs and Analytics, never offered as rows or columns.</li>
        <li>
          A survey design in Cross tabs with one cluster (PSU) variable and one stratum variable, used for design-based
          standard errors and tests, and by the analyses built on cross tabs (NPS, objective evidence, brand health,
          CSM, wave tracking). Analytics uses the weight only.
        </li>
      </UL>
      <H3>Not yet</H3>
      <UL>
        <li>Bringing a weight or design fields from a second file, joined to the data by respondent ID.</li>
        <li>A stratum made of several variables (for FinScope 2024: foreign-area flag, metro, NLI group, province and race), with single-cluster strata merged into a neighbour.</li>
        <li>The survey design in Analytics.</li>
      </UL>
      <H3>Today&apos;s workaround</H3>
      <P>
        Merge the weighting file into the data file in R or SPSS and export it with the final weight and one final
        stratum column; then choose that weight, the cluster variable (for FinScope, EACode) and that stratum column in
        Cross tabs. On FinScope 2024 prepared this way, the app&apos;s standard errors matched R&apos;s survey package to within
        0.3% in every cell compared.
      </P>
      <Limit title="What building it would take">
        A weights-and-design file type that refuses a join unless every respondent ID matches once in both files, a
        shared cluster code agrees, weights are present and positive and cluster-level fields are constant within a
        cluster, and that records which file each attached column came from; then composite strata with a stated
        singleton rule, checked against the R preparation script&apos;s own counts.
      </Limit>

      <H2 id="technical">More uses of technical documents</H2>
      <P>
        Technical documents (methodology, fieldwork, sampling, weighting and analysis documentation) are read today by
        the Research assistant only. Later they could feed the report&apos;s methodology summary and suggest weight and
        design variables named in the document, always for you to confirm, since what a document describes is not
        evidence that the data file matches it.
      </P>
    </Article>
  );
}
