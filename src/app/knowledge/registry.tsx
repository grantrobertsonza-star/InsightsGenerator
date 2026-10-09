import type { ComponentType } from "react";
import QualitativeAnalysis from "./content/qualitative-analysis";
import Crosstabs from "./content/crosstabs";
import Findings from "./content/findings";
import Insights from "./content/insights";
import Import from "./content/import";
import Objectives from "./content/objectives";
import Decisions from "./content/decisions";
import Reports from "./content/reports";

/** Maps each slug in articles.ts to the component that renders it. */
export const articleComponents: Record<string, ComponentType> = {
  "qualitative-analysis": QualitativeAnalysis,
  crosstabs: Crosstabs,
  findings: Findings,
  insights: Insights,
  import: Import,
  objectives: Objectives,
  decisions: Decisions,
  reports: Reports,
};
