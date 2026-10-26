import { Article, H2, H3, P, OL, Table, Limit, WhyBox, DoesDoesNot } from "../kbBlocks";

const toc = [
  { id: "what", title: "What the review is for" },
  { id: "start", title: "Starting a review" },
  { id: "scores", title: "How the scores are built" },
  { id: "overview", title: "The Overview and its Show filter" },
  { id: "improvements", title: "Improvements" },
  { id: "details", title: "Details, checklists and the export" },
  { id: "limits", title: "Where it stops" },
  { id: "practice", title: "A sensible way to work with it" },
];

export default function ResearchQualityGuide() {
  return (
    <Article
      slug="research-quality"
      title="How the research quality review works"
      lede="How a brief or a proposal is reviewed against good research practice, how its scores are worked out, and how to read the Overview, Improvements and Details. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What the review is for</H2>
      <P>
        The review rates how well a brief or a proposal is written against a fixed set of research-practice criteria,
        with a score for each part and what to improve. A proposal can also be compared with its brief. It looks at what
        the documents say, not at whether the study was then carried out well.
      </P>

      <H2 id="start">Starting a review</H2>
      <P>
        Documents imported as a brief or a proposal are listed in the section with their role. Opening the section
        makes no model call. Choosing <em>Review brief</em>, <em>Review proposal</em> or <em>Compare</em> shows an
        estimate first, and nothing runs until you confirm. A comparison is a review of its own and appears in the
        history of both documents.
      </P>
      <P>
        The review runs in steps: the documents are read into fixed snapshots, facts are extracted with exact quotes
        that the app finds in the stored text, and the criteria are then judged over those facts. If steps fail, the
        review says which, and <em>Retry failed steps</em> runs only those; an interrupted review offers
        <em> Continue review</em>.
      </P>

      <H2 id="scores">How the scores are built</H2>
      <P>
        A model rates each criterion on the release&apos;s scale, citing the document. Everything numeric after that is
        worked out by code from the stored ratings.
      </P>
      <Table
        rows={[
          ["Figure", "How it is worked out"],
          ["Criterion", "Strong 5, Workable 3, Weak 1, Absent 0. Where a criterion has several observations (one per decision), the lowest counts"],
          ["Category (proposal)", "The average of its rated criteria. A brief's ten dimensions are one criterion each"],
          ["Overall percentage", "Sum of weight times score, over sum of weight times 5, across rated dimensions"],
          ["Band", "Strong at 80% or more, Workable at 60% or more, Weak below"],
        ]}
      />
      <P>
        A criterion that is not rated yet, failed, or was dismissed is left out of every average; it is never counted
        as zero. Absent is a real rating and is counted. With less than half of the total weight rated, no overall
        figure is given.
      </P>

      <H2 id="overview">The Overview and its Show filter</H2>
      <P>
        The Overview shows the overall percentage as a ring and one bar per dimension or category. Clicking a bar or a
        criterion opens its detail on the right: the criterion&apos;s question, the reasons for its rating, the
        document&apos;s own words and what to improve.
      </P>
      <P>
        The <em>Show</em> filter lists All and each status the review actually has: Strong, Workable, Weak, Absent, then
        Not rated, Pending and Failed. Choosing one lists only the criteria with that status. A category keeps its
        heading, bar and score beside its matching criteria, so you can see where each sits, and a category with none
        is left out.
      </P>
      <WhyBox>
        The filter narrows the list; it does not rescore. The ring and the category scores stay the figures for the
        whole review, so a filtered view never reads as a new, better or worse score. Pending, Failed and Not rated are
        states, not ratings, so they are separate choices and never shown as a band.
      </WhyBox>

      <H2 id="improvements">Improvements</H2>
      <P>
        Improvements are grouped by when they can be made: before commissioning or fieldwork, before this decision, and
        for the next study. Each row shows its criterion with the same bar, score and band as the Overview. Choosing a
        row opens the improvement on the right first, followed by the criterion&apos;s question, the reasons for its
        rating and the document&apos;s own words.
      </P>

      <H2 id="details">Details, checklists and the export</H2>
      <P>
        Details records the reviewer, the source versions, the criteria release, and the model and prompt used. The
        element checklists say, for each required element of the document type, whether it is present, partial or
        absent, citing the extracted facts. Points (present 2, partial 1, absent 0) give section and overall
        percentages over the elements assessed. An element whose status cannot be relied on is marked not assessed and
        left out; unknown is never scored as absent. The review can be exported as a Word document built from the same
        view as the screen, with no further model call.
      </P>
      <H3>Selection</H3>
      <P>
        Opening another review clears the selection and resets the filter to All. A review is shown only while its own
        document is chosen. Switching between Overview, Improvements and Details keeps the selection. The filter and the
        selection are not remembered after a reload.
      </P>

      <H2 id="limits">Where it stops</H2>
      <Limit title="Ratings are a model's judgement">
        The ratings come from a language model working to written criteria. A borderline criterion can land in a
        neighbouring band on another run. The reasons and quotes are there so you can check and disagree. Scores are a
        guide to where to look, not a certification.
      </Limit>
      <Limit title="It reviews what is written">
        A document can describe a sound design that is then carried out badly, or a good study can be written up
        thinly. The review sees only the text, and only the parts it read: where a document was not read in full, an
        absence cannot be claimed.
      </Limit>

      <DoesDoesNot
        does={[
          "Rates a brief, a proposal, or a proposal against its brief, with cited reasons.",
          "Works out every percentage and band in code from the stored ratings.",
          "Keeps unrated, pending and failed criteria out of averages instead of counting them as zero.",
          "Filters the criteria by status without changing any score.",
        ]}
        doesNot={[
          "Run a model when you open the section, or start a review without your confirmation.",
          "Judge whether the study was done well, only how it is documented.",
          "Remember the Show filter or selection after a reload.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Import the brief and the proposal with their roles, then open Research quality.</li>
        <li>Review the brief first, then the proposal, then compare the two.</li>
        <li>Use <em>Show</em> to go through the Weak and Absent criteria, reading the quotes behind each.</li>
        <li>Work through Improvements in their order: before fieldwork first.</li>
        <li>Retry failed steps before relying on the overall figure.</li>
      </OL>
    </Article>
  );
}
