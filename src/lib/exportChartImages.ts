// Shared by both Insights Report export routes (story/export/route.ts for
// the pptx deck, story/export-docx/route.ts for the docx): given a run's
// findings (already scoped by whatever accepted/verified filter the caller
// applies), group them by theme and render a PNG chart image for every
// theme that qualifies as chart-eligible -- i.e. every finding in that
// theme group is a code-computed banner_comparison finding with the
// structured stats to chart (see findingsChartData.ts). A theme mixing in
// even one report-sourced ("stated"/"coded") finding, or missing the
// pre-pctA/pctB-migration stats, stays text-only, exactly like the
// Chart findings tab on the Findings page.
//
// This is the one place export routes turn "a theme's worth of findings"
// into "a rendered chart image" -- so the docx and the deck can never
// silently chart a theme differently, or disagree about which themes are
// chartable at all.

import {
  buildChartForThemeGroup,
  type ChartableFinding,
} from "./findingsChartData";
import { renderChartImage, type RenderedChartImage } from "./renderChartImage";

export type ThemeChartImage = {
  theme: string;
  caption: string;
  image: RenderedChartImage;
};

const NO_THEME_LABEL = "Uncategorized";

export async function buildChartImagesByTheme(
  findings: ChartableFinding[],
  widthPx = 640,
): Promise<ThemeChartImage[]> {
  const byTheme = new Map<string, ChartableFinding[]>();
  for (const finding of findings) {
    const key = finding.theme ?? NO_THEME_LABEL;
    if (!byTheme.has(key)) byTheme.set(key, []);
    byTheme.get(key)!.push(finding);
  }

  const results: ThemeChartImage[] = [];
  for (const [theme, themeFindings] of byTheme) {
    const spec = buildChartForThemeGroup(themeFindings);
    if (!spec) continue;
    const image = await renderChartImage(spec, widthPx);
    results.push({ theme, caption: spec.caption, image });
  }
  return results;
}
