import { Article, H2, H3, P, UL, OL, Table, Limit, WhyBox, ExampleBox, DoesDoesNot, References, type Source } from "../kbBlocks";

const toc = [
  { id: "what", title: "What the report outputs are" },
  { id: "types", title: "The three report types" },
  { id: "boundary", title: "Only reviewed evidence goes in" },
  { id: "story", title: "How the story narrative is built" },
  { id: "word", title: "The Word report, section by section" },
  { id: "deck", title: "The slide deck, slide by slide" },
  { id: "discovery", title: "What the analysis added beyond the report" },
  { id: "caveats", title: "How caveats are carried through" },
  { id: "formats", title: "Export formats" },
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
      "Gelman, A., & Stern, H. (2006). The difference between \"significant\" and \"not significant\" is not itself statistically significant. The American Statistician, 60(4), 328-331.",
    url: "https://doi.org/10.1198/000313006X152649",
  },
  {
    citation:
      "Ji, Z., Lee, N., Frieske, R., Yu, T., Su, D., Xu, Y., Ishii, E., Bang, Y. J., Madotto, A., & Fung, P. (2023). Survey of hallucination in natural language generation. ACM Computing Surveys, 55(12), Article 248.",
    url: "https://doi.org/10.1145/3571730",
  },
  {
    citation:
      "Wasserstein, R. L., & Lazar, N. A. (2016). The ASA statement on p-values: Context, process, and purpose. The American Statistician, 70(2), 129-133.",
    url: "https://doi.org/10.1080/00031305.2016.1154108",
  },
];

export default function ReportsGuide() {
  return (
    <Article
      slug="reports"
      title="How reports are built"
      lede="How the Insights Report is assembled from reviewed evidence, what the Word report and the slide deck each contain, how the story narrative is structured, how caveats travel with the content, and what the exports cannot do. It describes current behaviour and will change as the app does."
      toc={toc}
    >
      <H2 id="what">What the report outputs are</H2>
      <P>
        A report in this app is not written from scratch at the end. It is a layout of material that has already been
        extracted, verified, synthesised and reviewed, plus a thin layer of narrative framing that ties it together.
        Almost everything a reader sees on a page was a finding, an insight or a recommendation first, and was accepted
        by a person before it got there.
      </P>
      <P>
        That design has a practical consequence. If a report reads wrongly, the fix is rarely in the report. It is
        usually upstream: a finding that should have been rejected, an insight that was accepted too early, or an
        objective that was never recorded. The report shows what the earlier stages hold, no more and no less.
      </P>
      <WhyBox>
        Reports are where evidence meets an audience, and that is where a stray number or a dropped caveat does the
        most harm. Keeping the report a view onto reviewed material, instead of a fresh piece of authorship, is what
        stops the final document from drifting away from the checked evidence beneath it.
      </WhyBox>

      <H2 id="types">The three report types</H2>
      <P>
        The Insights Report section of a project produces two client-facing documents from one underlying narrative.
        A third element, the discovery report, is a section that appears inside both.
      </P>
      <Table
        rows={[
          ["Type", "What it is", "Built for"],
          ["Slide deck (.pptx)", "A persuasive argument in the Situation, Complication, Question, Answer shape, led by a governing thought, then supported by pillars of insights", "Presenting to a room, where the answer should come first"],
          ["Word report (.docx)", "A conventional research report: executive summary, introduction, methodology, findings, insights, recommendations, next steps", "Reading at your own pace, and being quoted from or circulated"],
          ["Discovery report (a section)", "A separate section that lists what the analysis added beyond the original report, and where it contradicts it", "Telling a reader which content was checked and which was originated here"],
        ]}
      />
      <P>
        Both documents read from the same stored narrative, so there is one thing to regenerate. Regenerating updates
        what both exports will produce next. Neither export keeps its own copy of the story.
      </P>
      <P>
        Separate from the Insights Report, the app also offers narrower exports: decks of findings, insights or
        recommendations, an Excel workbook of findings, and a CSV of removed findings. They are listed under export
        formats below.
      </P>

      <H2 id="boundary">Only reviewed evidence goes in</H2>
      <P>
        The Insights Report will not generate until at least one synthesised insight has been accepted. It is built on
        the synthesised layer, not the individual pre-insights, so a run with dozens of pre-insights behind a few
        accepted synthesised ones tells a story with a handful of proof points, not dozens.
      </P>
      <Table
        rows={[
          ["Content", "What qualifies it", "Where it appears"],
          ["Insights", "Synthesised insights marked accepted", "Narrative pillars, insight cards, insight sections"],
          ["Recommendations", "Accepted, and anchored to a synthesised insight", "Recommendation cards and the Recommendations section"],
          ["Findings", "Accepted, with a verdict of robust or use with caution", "The Findings section of the Word report, and chart pages"],
          ["Objectives and decisions", "Those the objective and decision check has run against", "Objectives and decisions pages, and the Word report section that mirrors them"],
        ]}
      />
      <P>
        Findings rated not supported or insufficient information are left out of the report. Rejected material and
        anything still awaiting review is left out too. This is deliberately stricter than the working views in the
        app, where you can see everything. A document that goes to a client uses the conservative bar.
      </P>
      <P>
        The model does not retype the evidence. In the narrative step it points at insights by number, and the code
        turns those numbers into stored ids. When a slide or section shows an insight, its headline, observation and
        implication are pulled straight from the saved record. What a researcher reviewed is therefore what appears,
        word for word.
      </P>

      <H2 id="story">How the story narrative is built</H2>
      <P>
        One model call reads the accepted insights, the accepted recommendations and the project context (business
        problem, research objective, decision statement, audience) and proposes how they add up. The structure it is
        asked to follow is the Pyramid Principle in its Situation, Complication, Question, Answer form: lead with the
        answer, then show the supporting arguments beneath it.
      </P>
      <Table
        rows={[
          ["Part", "What it does", "Length held in code"],
          ["Executive summary", "Two to four sentences a senior reader could stop after: the answer and the top action", "115 words"],
          ["Situation", "The context the decision sits in", "75 words"],
          ["Complication", "The tension that makes it matter now", "75 words"],
          ["Question", "The decision the project exists to inform. Falls back to the recorded decision statement", "No cap"],
          ["Governing thought", "The one-sentence answer the rest of the story supports", "34 words"],
          ["Pillars", "Two to five supporting arguments, each with a full-sentence headline and a one-sentence so what", "22 words and 30 words"],
          ["Caveats", "Two to four limits grounded in the specific evidence, not generic disclaimers", "38 words each"],
          ["Recommendations intro", "One sentence leading from evidence into action", "32 words"],
        ]}
      />
      <H3>What the code, not the model, controls</H3>
      <UL>
        <li>
          <strong>Which insights sit under which pillar.</strong> The model proposes groupings. Code discards invalid
          numbers, de-duplicates, and keeps at most three insights per pillar, ranked by confidence tier (strong first)
          and then by quality score. The number left out is stored, so the deck can say there are more.
        </li>
        <li>
          <strong>Length.</strong> Every field is cut to its word limit after the model has answered, in case the
          model overruns.
        </li>
        <li>
          <strong>Retries and fallback.</strong> If no usable pillar comes back, the call is repeated up to three
          times. If it still fails, the report falls back to one pillar per accepted insight, using that insight&apos;s
          own headline and implication. That is a worse story but a true one.
        </li>
      </UL>
      <P>
        The model is also told to write the framing in plain business English and to keep p-values, odds ratios and
        similar notation out of the narrative fields. That is an instruction, not a check. The statistical detail
        stays with the evidence underneath.
      </P>
      <ExampleBox title="Reading a pillar">
        <p>
          A pillar headline might read &quot;Informal traders save in short bursts, not on a schedule&quot;. The model
          wrote that sentence. The two or three insight cards beneath it were written earlier, reviewed by you, and are
          shown exactly as stored. If the headline claims more than the cards support, the cards are the better guide.
        </p>
      </ExampleBox>

      <H2 id="word">The Word report, section by section</H2>
      <P>
        The Word report follows the order a research report trains readers to expect. It is deliberately not the
        deck&apos;s answer-first shape, because a reader working through pages does not need to be persuaded in the
        same way as a room.
      </P>
      <OL>
        <li>Title block with the key question, the audience if recorded, and the date generated.</li>
        <li>Executive summary.</li>
        <li>Introduction: business problem, research objective, background (situation and complication) and the key question.</li>
        <li>Methodology: the original study&apos;s method as stated in the uploaded material, then a list of source documents grouped by kind.</li>
        <li>Findings, grouped by theme, each with its verdict label, and a chart for themes that qualify.</li>
        <li>Insights: the governing thought, then each theme with its insights, then how the objectives and decisions were answered.</li>
        <li>New insights beyond the report (when there is anything to say).</li>
        <li>Recommendations, each with priority, owner role, timeline and success metric.</li>
        <li>Next steps: gaps worth following up, scope and limitations, and a plain note on how the report was produced.</li>
      </OL>
      <P>
        The methodology section needs a word of care. It describes how the underlying research was done, and only what
        the uploaded brief, proposal or report actually says. If none of it states a method, the section says so
        instead of inferring one. How this app processed the material is kept in a separate note near the end, so the
        two are not mistaken for each other.
      </P>
      <P>
        Charts in the Findings section are drawn on the server from the same findings that appear as text. A theme gets
        a chart only when all of its findings are computed table comparisons. A theme that mixes in claims taken from a
        report stays text only.
      </P>

      <H2 id="deck">The slide deck, slide by slide</H2>
      <P>
        The deck is built to persuade, so it states the answer early and then spends its remaining slides proving it.
        The sequence below is the general order. Some parts appear only when there is content for them.
      </P>
      <Table
        rows={[
          ["Slides", "Content", "Appears when"],
          ["Title and roadmap", "Project title, the key question, audience, and a map of the deck's own sections", "Always"],
          ["Executive summary", "The opening paragraph", "A summary was generated"],
          ["SCQA overview, Situation, Complication", "The argument at a glance, then each build-up step on its own slide", "Always"],
          ["Governing thought", "The answer as a pull-quote, with the question beneath", "Always"],
          ["Objectives and decisions", "Each objective or decision with a status badge: resolved, partial, gap or inferred. A slide names any accepted insights that none of them asked about", "The objective and decision check has run"],
          ["Evidence charts", "One chart per qualifying theme", "A theme has chart-eligible findings"],
          ["New beyond the report", "Net-new insights and findings, and contradictions", "There is something to show"],
          ["Argument map and pillars", "A map of the pillars, then each pillar with its headline, so what and insight cards", "Pillars exist"],
          ["Recommendations", "Action cards with a priority badge, owner, timeline and metric, preceded by a divider", "Always, paged"],
          ["Caveats and scope", "The narrative caveats and a footnote on what the content is based on", "Caveats exist"],
        ]}
      />
      <P>
        Text on slides is shrunk in steps to fit its box and, as a last resort, cut with an ellipsis. Long headlines
        and long insight text are therefore the most likely to be shortened on a slide. The full wording is always in
        the app and in the Word report.
      </P>

      <H2 id="discovery">What the analysis added beyond the report</H2>
      <P>
        When a project starts from an existing report, two kinds of content end up side by side: claims the report made
        and the app checked, and things the analysis surfaced that the report never said. A reader is entitled to know
        which is which. The discovery section separates them.
      </P>
      <UL>
        <li>
          <strong>New insights.</strong> Accepted synthesised insights, each with a provenance line. The line says, for
          example, that the insight combines several claims the report made into something none of them said alone,
          or that it is built entirely from new findings the report did not contain.
        </li>
        <li>
          <strong>New findings from the data.</strong> Accepted findings computed from the supplied tables, rated
          robust or use with caution, that no report claim points at. A list of up to twelve is shown, strongest first,
          with a count of how many more passed verification and sit in the Findings section.
        </li>
        <li>
          <strong>Where the evidence contradicts the report.</strong> Each claim the report made that was rated not
          supported because of a new finding, a new insight, or another claim in the same report, quoted next to what
          contradicts it and the reason.
        </li>
        <li>
          <strong>How far this could be checked.</strong> If the project had only a report and no underlying data, a
          note says statistical verification could not run, and that every verdict should be read with that in mind.
        </li>
      </UL>
      <P>
        If there is nothing to say and nothing to warn about, the section does not appear. The aim is to avoid a hollow
        heading that suggests a check that did not happen.
      </P>

      <H2 id="caveats">How caveats are carried through</H2>
      <P>
        A caveat that lives only in the app is easy to lose when the content moves into a document. The report tries to
        keep the important ones attached in several places.
      </P>
      <Table
        rows={[
          ["Caveat", "Where it shows up"],
          ["Verdict tier on a finding", "Written beside each finding in the Word report and the new findings list: robust or usable with caution"],
          ["Confidence tier on an insight", "A badge on each insight card in the deck. It pairs a symbol with a text label, so it still reads on a black and white printout"],
          ["Quality tier on a new insight", "Labelled qualified, partial or finding level in the discovery section"],
          ["Thin or exploratory evidence", "The narrative caveats, which are asked to name which tier is thinnest and where a pillar rests on exploratory support"],
          ["Inferred objectives", "A note explaining that objectives generated from the project's own evidence cannot show the research answered what was asked, so no verdict is given"],
          ["Gaps", "Listed under next steps as places where the accepted evidence did not resolve an objective or decision. A gap is named, not hidden"],
          ["Report-only input", "The verification note in the discovery section"],
          ["Scope footnote", "States that the content rests only on what was accepted as of the generation date, and that confidence reflects how well triangulated an insight is, not how important it is"],
        ]}
      />
      <P>
        One distinction is easy to miss. Confidence and importance are separate. A well triangulated insight can be
        minor, and an exploratory one can matter a great deal. The report labels the first and leaves the second to
        you.
      </P>

      <H2 id="formats">Export formats</H2>
      <Table
        rows={[
          ["Export", "Format", "Contents"],
          ["Insights Report deck", ".pptx, 16:9 widescreen", "The full story deck described above"],
          ["Insights Report", ".docx", "The full Word report described above"],
          ["Findings deck", ".pptx", "One slide per theme. Accepted findings only by default, or all findings with each one tagged by its review status"],
          ["Findings workbook", ".xlsx", "Every finding as a row, for filtering and pivoting in Excel. Accepted only or all"],
          ["Removed findings history", ".csv", "The audit trail of findings removed or replaced, for answering why a number changed between drafts"],
        ]}
      />
      <P>
        Insights and recommendations also have their own decks, with an accepted-only or all choice. Exports are
        built fresh each time you click, from whatever was generated or accepted most recently. The two Insights Report
        files are named from the project name with a report suffix.
      </P>

      <H2 id="limits">Limitations</H2>
      <Limit title="The framing is model-written">
        The executive summary, situation, complication, governing thought, pillar headlines and caveats are authored by
        a model. Models can overstate, soften or slightly reword what they summarise (Ji et al., 2023). The insight
        cards beneath are verbatim, so check the framing against them before you present it.
      </Limit>
      <Limit title="A snapshot, not a live view">
        The narrative is stored when you generate it. If you accept, reject or edit insights afterwards, the framing
        does not change until you regenerate. Recommendations are read at export time, so the two can drift apart.
        Regenerate after any meaningful change in review decisions.
      </Limit>
      <Limit title="Highlight reel, not an audit trail">
        The deck shows at most three insights per pillar and drops findings that were not rated robust or usable with
        caution. Everything remains reviewable in the app, but a reader of the document alone will not see all of it.
      </Limit>
      <Limit title="Verdicts do not travel as proof">
        A finding labelled robust in the report means the evidence in the material supported it as worded. It does
        not mean the claim is true of the world, and significance is a narrow statement that is easily over-read
        (Wasserstein &amp; Lazar, 2016). Table findings are corrected for many comparisons within
        their own table (by default the false discovery rate; Benjamini &amp; Hochberg, 1995), not across the tables of a project, and a contrast
        between two results is not itself tested (Gelman &amp; Stern, 2006).
      </Limit>
      <Limit title="Gaps depend on what was recorded">
        The objectives and decisions pages exist only if the check has run, which needs objectives or decisions to
        have been recorded. A project with neither skips straight to the pillars, and the report will not point out
        what it was never told to look for.
      </Limit>
      <Limit title="Fixed layout, no custom branding">
        The deck uses a brand-neutral palette and fixed layouts. Text that does not fit is shrunk or truncated. The
        Word report is plain by design. There is no template, logo or style option, and there is no PDF export. If
        you need one, print or convert the Word file yourself.
      </Limit>
      <Limit title="Charts are limited to computed comparisons">
        Only themes made entirely of table-computed findings get a chart. Evidence quoted from a report is shown as
        text, even when it contains numbers.
      </Limit>
      <DoesDoesNot
        does={[
          "Builds a deck and a Word report from one stored narrative, using only accepted material.",
          "Shows insight text exactly as reviewed, with confidence and verdict labels attached.",
          "Separates what the original report said from what the analysis added, and flags contradictions.",
          "Names gaps against recorded objectives and decisions, and carries narrative caveats and a scope note.",
          "Exports to .pptx and .docx, with findings available as .pptx, .xlsx and removed-findings history as .csv.",
        ]}
        doesNot={[
          "Check the model-written framing against the evidence for you.",
          "Refresh the narrative automatically when review decisions change.",
          "Show every accepted insight or every finding in the deck.",
          "Judge which insights matter most. It ranks by confidence and quality, not by importance.",
          "Offer PDF export, custom templates or client branding.",
        ]}
      />

      <H2 id="practice">A sensible way to work with it</H2>
      <OL>
        <li>Finish reviewing findings, insights and recommendations first. Reject what is wrong before you generate.</li>
        <li>Record the business problem, objective and decision statement, since the framing and the objectives pages depend on them.</li>
        <li>Generate the Insights Report and read the executive summary, governing thought and caveats against the insight cards.</li>
        <li>Read the discovery section, particularly any contradictions and the verification note.</li>
        <li>Export the Word report and the deck, and read the Word version for the full picture before presenting the deck.</li>
        <li>If you change any review decision afterwards, regenerate and export again.</li>
      </OL>

      <References sources={sources} />
    </Article>
  );
}
