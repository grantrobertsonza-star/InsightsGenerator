import type { ComponentType } from "react";
import QualitativeAnalysis from "./content/qualitative-analysis";
import Crosstabs from "./content/crosstabs";
import Findings from "./content/findings";
import Insights from "./content/insights";
import Import from "./content/import";
import PreparingFiles from "./content/preparing-files";
import Objectives from "./content/objectives";
import Decisions from "./content/decisions";
import Reports from "./content/reports";
import ResearchQuality from "./content/research-quality";
import ResearchAssistant from "./content/research-assistant";
import Dashboards from "./content/dashboards";
import Roadmap from "./content/roadmap";

/** Maps each slug in articles.ts to the component that renders it. */
export const articleComponents: Record<string, ComponentType> = {
  "qualitative-analysis": QualitativeAnalysis,
  crosstabs: Crosstabs,
  findings: Findings,
  insights: Insights,
  import: Import,
  "preparing-files": PreparingFiles,
  objectives: Objectives,
  decisions: Decisions,
  reports: Reports,
  "research-quality": ResearchQuality,
  "research-assistant": ResearchAssistant,
  dashboards: Dashboards,
  roadmap: Roadmap,
};
