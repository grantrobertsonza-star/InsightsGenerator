import { withTenantRead } from "./db";
import { computeGuideCoverage, guideHints, type GuideCoverage } from "./guideCoverage";
import { getInstrumentItems } from "./instruments";
import { readRunTranscripts } from "./transcriptImportQuality";

// Interview and focus group guides against the transcripts of a run.
// Coverage is computed on request from the stored text, nothing is saved.

export type TranscriptCoverage = {
  documentId: string;
  name: string;
  sessionType: "individual" | "focus_group";
  coverage: GuideCoverage;
};

export type GuideReport = {
  items: { id: string; order: number; section: string | null; text: string }[];
  transcripts: TranscriptCoverage[];
  /** Per item: sessions where it was raised (asked or reworded), and sessions that could be scored. */
  perItem: { itemId: string; raised: number; sessions: number; neverAsked: boolean }[];
};

export async function getGuideCoverage(
  tenantId: string,
  runId: string,
  guideId: string,
  onlyDocumentId?: string,
): Promise<GuideReport> {
  const items = await getInstrumentItems(tenantId, guideId);
  const transcripts = (await readRunTranscripts(tenantId, runId)).filter((t) => !onlyDocumentId || t.id === onlyDocumentId);
  const out: TranscriptCoverage[] = transcripts.map((t) => ({
    documentId: t.id,
    name: t.name,
    sessionType: t.sessionType,
    coverage: computeGuideCoverage(
      items.map((i) => ({ id: i.id, order: i.order, section: i.section, code: i.code, text: i.text })),
      t.reading.segments.map((s) => ({ index: s.index, speaker: s.speaker, role: s.role, text: s.text })),
    ),
  }));
  const perItem = items.map((i) => {
    let raised = 0;
    let sessions = 0;
    for (const t of out) {
      const c = t.coverage.items.find((x) => x.itemId === i.id);
      if (!c || c.status === "unmatchable") continue;
      sessions++;
      if (c.status !== "not_asked") raised++;
    }
    return { itemId: i.id, raised, sessions, neverAsked: sessions > 0 && raised === 0 };
  });
  return { items: items.map((i) => ({ id: i.id, order: i.order, section: i.section, text: i.text })), transcripts: out, perItem };
}

/**
 * Topics from the run's guides, offered to the open-coding pass as things the
 * discussion was meant to cover. Empty when there is no guide or the tables
 * are not migrated yet.
 */
export async function getGuideHintsForRun(tenantId: string, runId: string): Promise<string[]> {
  try {
    const guides = await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{ id: string }>(
        `select id from documents where run_id = $1 and kind = 'instrument'
           and instrument_type in ('interview_guide', 'focus_group_guide') order by uploaded_at`,
        [runId],
      );
      return r.rows;
    });
    const items = [];
    for (const g of guides) items.push(...(await getInstrumentItems(tenantId, g.id)));
    return guideHints(items.map((i) => ({ id: i.id, order: i.order, section: i.section, code: i.code, text: i.text })));
  } catch {
    return [];
  }
}
