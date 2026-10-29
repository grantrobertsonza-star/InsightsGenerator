import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/codingAnalysisActions", () => ({ saveTranscriptSetupAction: vi.fn() }));
vi.mock("@/lib/dataSetupActions", () => ({ readDataFileAction: vi.fn(), saveDataSetupAction: vi.fn() }));
vi.mock("@/lib/documentOpenActions", () => ({ openDocumentAction: vi.fn() }));
vi.mock("@/app/DeleteDocumentButton", () => ({ default: () => null }));
vi.mock("@/app/useHydrated", async () => await import("../../app/useHydrated"));
vi.mock("@/lib/dataSetupShared", async () => await import("../dataSetupShared"));
vi.mock("@/lib/dataSetupRebase", async () => await import("../dataSetupRebase"));
vi.mock("@/lib/displayDate", async () => await import("../displayDate"));
vi.mock("@/lib/importSources", async () => await import("../importSources"));
vi.mock("@/lib/rowCells", async () => await import("../rowCells"));

const { ImportDetailProvider, SelectedFileDetail } = await import("../../app/runs/[id]/TranscriptSetup");

describe("setup choices before event handlers attach", () => {
  for (const kind of ["table", "transcript"]) {
    it(`server-rendered ${kind} choices refuse interaction and explain loading`, () => {
      const row = {
        documentId: "synthetic-document", filename: kind === "table" ? "cases.csv" : "interview.txt",
        kind, kindLabel: kind, uploadedAt: "2026-10-16T12:00:00Z",
        isRawData: kind === "table", dataSetup: null, preview: null, processingStatus: null, panels: [],
        initial: null, suggestion: null, hasCoding: false, deleteAction: async () => {}, runId: "synthetic-run",
      };
      // The setup forms render in the selected source's pane, from the server render on (the provider
      // is given the sources directly), so the guard has to hold there.
      const html = renderToStaticMarkup(<ImportDetailProvider rows={[row]}><SelectedFileDetail /></ImportDetailProvider>);
      const selects = html.match(/<select\b[^>]*>/g) ?? [];
      expect(selects.length).toBeGreaterThan(0);
      for (const select of selects) expect(select).toMatch(/\bdisabled=""/);
      expect(html).toContain('data-testid="setup-loading"');
      expect(html).toContain("set-up options can be changed in a moment");
    });
  }
});
