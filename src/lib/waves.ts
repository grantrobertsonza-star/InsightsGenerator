// The waves of a tracking study inside one project (Grant, 27 October 2026: "keep adding waves to an
// existing study, and then be able to toggle which data sets should be included"). A wave is a raw data
// file with a wave label (data_setup.wave, set under Import data). This is the one place that decides
// which waves are in and in what order; Wave tracking and the Cross tabs file picker use it.
//
// Order: by fieldwork date when every included wave has one; otherwise by upload, oldest first, and the
// basis says so with the waves that have no date. A label is never parsed for order ("Wave 10" vs
// "Wave 2", "Spring" vs "Autumn"). Two waves with the same date keep their upload order.
import type { DataSetup } from "./dataSetupShared";

export type WaveSource = { documentId: string; filename: string; uploadedAt: string; setup: DataSetup };
export type OrderedWave = { documentId: string; filename: string; wave: string; waveDate: string | null; uploadedAt: string };
export type WaveOrderBasis = { kind: "fieldwork_date" } | { kind: "upload"; undated: string[] };

export type ProjectWaves = {
  /** Included waves, in order (first is the earliest). */
  included: OrderedWave[];
  /** Waves the researcher took out of the analysis, in upload order. */
  excluded: OrderedWave[];
  basis: WaveOrderBasis;
};

/** Pads a YYYY-MM date to the first of its month, so months and days compare. */
const sortKey = (d: string) => (d.length === 7 ? `${d}-01` : d);

export function projectWaves(sources: WaveSource[]): ProjectWaves {
  const byUpload = [...sources].sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : a.uploadedAt > b.uploadedAt ? 1 : a.documentId.localeCompare(b.documentId)));
  const labelled = byUpload
    .filter((s) => s.setup.wave)
    .map((s) => ({ wave: { documentId: s.documentId, filename: s.filename, wave: s.setup.wave as string, waveDate: s.setup.waveDate, uploadedAt: s.uploadedAt }, included: s.setup.waveIncluded }));
  const included = labelled.filter((w) => w.included).map((w) => w.wave);
  const excluded = labelled.filter((w) => !w.included).map((w) => w.wave);
  const undated = included.filter((w) => !w.waveDate).map((w) => w.wave);
  if (included.length > 0 && undated.length === 0) {
    // A stable sort keeps upload order between waves of the same date.
    return { included: [...included].sort((a, b) => sortKey(a.waveDate!).localeCompare(sortKey(b.waveDate!))), excluded, basis: { kind: "fieldwork_date" } };
  }
  return { included, excluded, basis: { kind: "upload", undated } };
}

/** The order basis as the screens say it. */
export function waveOrderText(basis: WaveOrderBasis): string {
  if (basis.kind === "fieldwork_date") return "Waves in order of fieldwork date.";
  return basis.undated.length > 0
    ? `Waves in upload order, oldest first: ${basis.undated.length === 1 ? `"${basis.undated[0]}" has` : `${basis.undated.map((w) => `"${w}"`).join(", ")} have`} no fieldwork date. Add one to each wave (Import data, the file's set-up) to order them by fieldwork.`
    : "Waves in upload order, oldest first.";
}
