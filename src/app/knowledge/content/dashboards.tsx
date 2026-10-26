import { Article, H2, H3, P, UL, Table, Limit, WhyBox, DoesDoesNot } from "../kbBlocks";

const toc = [
  { id: "what", title: "What the dashboards are for" },
  { id: "states", title: "The five states" },
  { id: "home", title: "The main dashboard" },
  { id: "sections", title: "Section overviews and module status lines" },
  { id: "rules", title: "How a state is decided" },
  { id: "storage", title: "Files still in storage" },
  { id: "limits", title: "Limitations" },
  { id: "practice", title: "A sensible way to work with it" },
];

export default function DashboardsGuide() {
  return (
    <Article
      slug="dashboards"
      title="How the dashboards and stage status work"
      lede="The main dashboard's project rows, the overview of each project stage, and the status line at the top of every module: what each state means, how it is worked out from what the project holds, and where it stops. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What the dashboards are for</H2>
      <P>
        A project moves through four stages, the same groups as its sidebar: Prepare (Import data, Research quality,
        Objectives, Business decisions), Analyse (Cross tabs, Analytics, Coding, Secondary analysis), Develop findings
        (Findings, Insights) and Deliver (Recommendations, Insights report). The dashboards answer one question at each
        level: what is done, what is waiting for you, and what could not be checked. They show the state of the work;
        they do not judge its research quality.
      </P>

      <H2 id="states">The five states</H2>
      <Table
        rows={[
          ["State", "What it means"],
          ["Ready", "Nothing in the module needs you or could not be checked. Caveats (a weak objective score, flagged data quality checks) can still be listed."],
          ["Needs you", "Something only you can do: accept a setup, review a suggestion, commit a draft table, add a first file."],
          ["Working", "The app is doing something by itself, such as reading a file."],
          ["Couldn't check", "Something the module depends on could not be read or verified. It is never shown as Ready."],
          ["Not used", "An optional module this project does not use, such as Coding without transcripts or Analytics never opened. It is shown, but left out of its stage's state."],
        ]}
      />

      <H2 id="home">The main dashboard</H2>
      <P>
        Start a project sits above the list as a band, as on the section pages, with the two starting points side by
        side; it folds to its heading and remembers that. Each project row shows its four stages as coloured pills and
        its next step. A pill opens that stage&apos;s overview; the next step opens the module it is about. The right pane
        counts projects that need you (a stage needs you or could not be checked), that are working, and that are
        delivered (the Deliver stage is ready).
      </P>
      <P>
        Statuses are read for the 25 newest projects; older rows say to open the project for its status, and the
        Projects count says when the summary covers only those. The rows use what is stored for each project. Inside a
        project its overviews also check previews, data quality, survey design and support, which the dashboard does
        not.
      </P>

      <H2 id="sections">Section overviews and module status lines</H2>
      <P>
        Each sidebar group starts with its overview (Prepare overview, Analyse overview, and so on). The overview has a
        card per module with its state, a headline and the items behind it. An item links to where the work is: the
        exact file and tab in Import, the data file in Cross tabs, the objective in Objectives, or the module itself. A
        transcript whose coding is incomplete links to Coding, where Code themes is run again.
      </P>
      <P>
        Every module&apos;s own page has a one-line status at the top with the same state, its most important item, and a
        link back to the overview when there is more to see.
      </P>
      <H3>An example</H3>
      <P>
        A project with one raw data file whose setup is not yet accepted shows Prepare as Needs you, with &quot;Accept the
        setup of survey.sav&quot; linking to that file&apos;s Setup tab. Once accepted, and with objectives scored, Prepare
        turns Ready; Analyse then asks for a first committed table.
      </P>

      <H2 id="rules">How a state is decided</H2>
      <UL>
        <li>Each module has its own rule, written in code from what the project holds; no model is asked.</li>
        <li>A stage takes the worst state among the modules it uses, in the order Couldn&apos;t check, Needs you, Working, Ready.</li>
        <li>The next step is the first item, in workflow order, that needs you or could not be checked.</li>
        <li>
          Absent information is never read as fine: a record that could not be read makes the module Couldn&apos;t check,
          and a file with nothing read from it is not counted as ready.
        </li>
        <li>
          A file&apos;s processing state is its own: Read, Reading, Read failed, Not read yet, and Partly read when part of
          it could not be read. For a transcript the partial state is about its coding, not its text, and is called
          Coding incomplete.
        </li>
      </UL>
      <WhyBox>
        A dashboard that says Ready when it simply could not look is worse than none. Keeping Couldn&apos;t check apart
        from Needs you tells you whether to act or to reload.
      </WhyBox>

      <H2 id="storage">Files still in storage</H2>
      <P>
        Deleting a project removes its records at once; its files are removed from storage straight after. When
        storage does not confirm a removal, the dashboard lists it with the last error and a Remove them now button.
        A converted copy of a data file (written when the server&apos;s statistics service reads an SPSS or Stata file) is
        recorded before it is made, so a copy is never left behind unrecorded, even if the project is deleted while
        it is being read. The notice counts storage locations, each once, not files known to exist: a deleted
        project&apos;s record lists every place its files could be.
      </P>

      <H2 id="limits">Limitations</H2>
      <Limit title="A state is as current as the page">
        Status lines and overviews read the page as it was loaded. A change shows after the page refreshes: opening an
        overview refreshes it, as do actions that save and a reload.
      </Limit>
      <Limit title="The main dashboard is lighter than a project's own overviews">
        It reads stored records only, for the 25 newest projects. Preview identity, data quality flags and support
        freshness are checked inside the project.
      </Limit>
      <Limit title="Ready is not a quality verdict">
        Ready means nothing is waiting or unreadable. It says nothing about whether the data, the objectives or the
        findings are good; the quality panels, scores and verdicts do that.
      </Limit>
      <DoesDoesNot
        does={[
          "Shows each stage's state and next step, worked out in code from what the project holds.",
          "Links each item to the file, tab, table or objective it is about.",
          "Says Couldn't check rather than Ready when something could not be read.",
          "Lists storage locations whose removal is not confirmed, with a retry.",
        ]}
        doesNot={[
          "Judge research quality.",
          "Update without a refresh.",
          "Read statuses for more than the 25 newest projects on the main dashboard.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <UL>
        <li>Start from the main dashboard&apos;s next step for the project you are working on.</li>
        <li>Inside a project, open the stage overview, clear its Needs you items in order, and reopen it to refresh.</li>
        <li>Treat Couldn&apos;t check as a reason to reload or fix a setup, never as a pass.</li>
      </UL>
    </Article>
  );
}
