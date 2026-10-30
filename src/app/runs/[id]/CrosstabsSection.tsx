"use client";

import CrosstabWorkspace from "./CrosstabWorkspace";
import DataFileSection, { type DataFileOption } from "./DataFileSection";

export type CrosstabDataset = DataFileOption;

/**
 * Cross tabs opens straight into the crosstab workspace (Grant's review, 2026-10-20), replacing the
 * page that only listed data files and opened the workspace in a full-window overlay. The file is
 * chosen in the workspace's header (DataFileSection); each file's workspace stays mounted once
 * opened, so switching files and back keeps an unfinished table, its filters and its settings.
 *
 * Where the gateway's parts went: file selection, to the workspace header; dataset setup, to a
 * message with Accept and a link to Sources for a file whose setup needs it; the findings count, to a
 * link beside the title; the instructions and statistical notes, to "How Cross tabs works" (now
 * matching what the workspace applies) and the workspace's settings summary; deleting a data file,
 * to Sources, where every source is removed.
 */
export default function CrosstabsSection({ runId, datasets, findings }: { runId: string; datasets: CrosstabDataset[]; findings: number }) {
  return (
    <DataFileSection
      runId={runId}
      title="Cross tabs"
      howTitle="How Cross tabs works"
      how={
        <>
          <p>Choose rows and columns from the variable list and add the table to the set. Nothing is built or compared until you add a table, and opening this page calls no model. Commit the tables worth keeping and their comparisons become findings.</p>
          <p>Differences between columns are tested with the correction chosen under Table settings: false discovery rate (Benjamini-Hochberg) by default, or Bonferroni, or none. It is applied across the columns of each banner variable, row by row.</p>
          <p>With a PSU or strata variable set under Table settings, standard errors use Taylor series linearisation for the survey design; without one, they assume a simple random sample, with weights if a weight is chosen.</p>
          <p>Driver analysis, NPS, charts and the other analyses are under Analytics.</p>
        </>
      }
      emptyText="No data files yet. Add a survey data file (SPSS, Stata, CSV or Excel; SAS files are not supported yet) in Sources, then build tables here."
      aggregatedText="This file holds tables that are already aggregated, so there is no variable list to cross-tabulate. Generate findings from its tables below."
      datasets={datasets}
      findings={findings}
      renderReady={(d, selector) => <CrosstabWorkspace layout="page" runId={runId} documentId={d.id} filename={d.filename} fileSelector={selector} />}
      testIds={{ section: "crosstabs-section", select: "crosstab-file-select", state: "crosstab-file-state", findings: "crosstab-findings-link" }}
    />
  );
}
