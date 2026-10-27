// The waves of a tracking study inside one project (Grant, 27 October 2026): which are in, and their order.
import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_SETUP, normaliseDataSetup, normaliseWaveDate, type DataSetup } from "../dataSetupShared";
import { projectWaves, waveOrderText, type WaveSource } from "../waves";

const src = (id: string, uploadedAt: string, setup: Partial<DataSetup>): WaveSource => ({
  documentId: id, filename: `${id}.sav`, uploadedAt, setup: { ...DEFAULT_DATA_SETUP, accepted: true, ...setup },
});

describe("projectWaves", () => {
  it("orders by fieldwork date when every included wave has one, whatever the upload order or the labels say", () => {
    const w = projectWaves([
      src("w10", "2026-10-01T09:00:00Z", { wave: "Wave 10", waveDate: "2026-09" }),
      src("w2", "2026-10-02T09:00:00Z", { wave: "Wave 2", waveDate: "2026-03-15" }),
      src("w9", "2026-10-03T09:00:00Z", { wave: "Wave 9", waveDate: "2026-03" }),
    ]);
    expect(w.included.map((x) => x.wave)).toEqual(["Wave 9", "Wave 2", "Wave 10"]);
    expect(w.basis).toEqual({ kind: "fieldwork_date" });
    expect(waveOrderText(w.basis)).toBe("Waves in order of fieldwork date.");
  });

  it("falls back to upload order, naming the waves without a date, and never parses a label", () => {
    const w = projectWaves([
      src("b", "2026-10-02T09:00:00Z", { wave: "Wave 2", waveDate: "2026-02" }),
      src("a", "2026-10-01T09:00:00Z", { wave: "Wave 10" }),
    ]);
    expect(w.included.map((x) => x.wave)).toEqual(["Wave 10", "Wave 2"]);
    expect(w.basis).toEqual({ kind: "upload", undated: ["Wave 10"] });
    expect(waveOrderText(w.basis)).toMatch(/^Waves in upload order, oldest first: "Wave 10" has no fieldwork date/);
  });

  it("leaves out a wave taken out of the analysis, and an unlabelled file is no wave", () => {
    const w = projectWaves([
      src("w1", "2026-10-01T09:00:00Z", { wave: "Wave 1", waveDate: "2026-01" }),
      src("w2", "2026-10-02T09:00:00Z", { wave: "Wave 2", waveDate: "2026-02", waveIncluded: false }),
      src("adhoc", "2026-10-03T09:00:00Z", { wave: null }),
      src("w3", "2026-10-04T09:00:00Z", { wave: "Wave 3", waveDate: "2026-03" }),
    ]);
    expect(w.included.map((x) => x.documentId)).toEqual(["w1", "w3"]);
    expect(w.excluded.map((x) => x.documentId)).toEqual(["w2"]);
    // The excluded wave's missing date does not change the order basis; nor would its presence.
    expect(w.basis.kind).toBe("fieldwork_date");
  });

  it("keeps upload order between waves of the same fieldwork date", () => {
    const w = projectWaves([
      src("second", "2026-10-02T09:00:00Z", { wave: "B", waveDate: "2026-05" }),
      src("first", "2026-10-01T09:00:00Z", { wave: "A", waveDate: "2026-05-01" }),
    ]);
    expect(w.included.map((x) => x.documentId)).toEqual(["first", "second"]);
  });

  it("is empty for a project with no waves", () => {
    expect(projectWaves([src("x", "2026-10-01T09:00:00Z", {})])).toEqual({ included: [], excluded: [], basis: { kind: "upload", undated: [] } });
  });
});

describe("the wave fields of a data set-up", () => {
  it("keeps a real month or day and drops anything else as not given", () => {
    expect(["2026-05", "2026-05-31", "2024-02-29"].map(normaliseWaveDate)).toEqual(["2026-05", "2026-05-31", "2024-02-29"]);
    expect(["2026-13", "2026-02-30", "May 2026", "2026/05", "", 202605, null].map(normaliseWaveDate)).toEqual([null, null, null, null, null, null, null]);
  });
  it("a set-up saved before these fields reads as no date and included", () => {
    expect(normaliseDataSetup({ unit: "respondents", layout: "rows_are_cases", method: "survey", accepted: true, wave: "Wave 1" })).toMatchObject({ wave: "Wave 1", waveDate: null, waveIncluded: true });
    expect(normaliseDataSetup({ wave: "Wave 1", waveIncluded: false }).waveIncluded).toBe(false);
    expect(normaliseDataSetup({ wave: "Wave 1", waveIncluded: "no" }).waveIncluded).toBe(true);
  });
});

describe("a finding's source names its wave", () => {
  it("adds the wave label to the file name, and nothing when the file is no wave", async () => {
    const { formatFindingSource } = await import("../sourceAttribution");
    expect(formatFindingSource({ source_filename: "w2.sav", source_page: null, source_table_label: "Fees by status", source_wave: "Wave 2" })).toBe("w2.sav (Wave 2), Fees by status");
    expect(formatFindingSource({ source_filename: "adhoc.sav", source_page: null, source_table_label: null, source_wave: null })).toBe("adhoc.sav");
    expect(formatFindingSource({ source_filename: "report.pdf", source_page: 4 })).toBe("report.pdf, p. 4");
  });
});
