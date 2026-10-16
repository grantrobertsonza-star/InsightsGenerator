import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/codingAnalysisActions", () => ({ saveTranscriptSetupAction: vi.fn() }));
vi.mock("@/lib/dataSetupActions", () => ({ readDataFileAction: vi.fn(), saveDataSetupAction: vi.fn() }));
vi.mock("@/app/DeleteDocumentButton", () => ({ default: () => null }));
vi.mock("@/app/useHydrated", async () => await import("../../app/useHydrated"));
vi.mock("@/lib/dataSetupShared", async () => await import("../dataSetupShared"));

const { default: TranscriptSetupTable, ImportDetailProvider } = await import("../../app/runs/[id]/TranscriptSetup");

describe("setup choices before event handlers attach", () => {
  for (const kind of ["table", "transcript"]) {
    it(`server-rendered ${kind} choices refuse interaction and explain loading`, () => {
      const row = {
        documentId: "synthetic-document", filename: kind === "table" ? "cases.csv" : "interview.txt",
        kind, kindLabel: kind, kindBadge: "Synthetic", uploadedAt: "2026-10-16T12:00:00Z",
        detail: null, isRawData: kind === "table", dataSetup: null, preview: null,
        initial: null, suggestion: null, hasCoding: false,
        accent: { border: "border-sky-200", dot: "bg-sky-200" }, deleteAction: async () => {},
      };
      const html = renderToStaticMarkup(<ImportDetailProvider><TranscriptSetupTable runId="synthetic-run" rows={[row]} /></ImportDetailProvider>);
      const selects = html.match(/<select\b[^>]*>/g) ?? [];
      expect(selects.length).toBeGreaterThan(0);
      for (const select of selects) expect(select).toMatch(/\bdisabled=""/);
      expect(html).toContain('data-testid="setup-loading"');
      expect(html).toContain("set-up options can be changed in a moment");
    });
  }
});
