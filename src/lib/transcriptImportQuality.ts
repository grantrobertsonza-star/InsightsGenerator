import { withTenantRead } from "./db";
import { segmentTranscriptDetailed, type SegmentMode } from "./qualCoding";
import { computeTranscriptImportQuality, type TranscriptImportQuality } from "./qualImportQuality";

export type RunTranscript = {
  id: string;
  name: string;
  text: string;
  sessionType: "individual" | "focus_group";
  reading: ReturnType<typeof segmentTranscriptDetailed>;
};

/**
 * Every transcript in a run, segmented with the session type, layout and
 * moderator labels the researcher chose. Best effort: a run with no readable
 * transcripts returns an empty list.
 */
export async function readRunTranscripts(tenantId: string, runId: string): Promise<RunTranscript[]> {
  const out: RunTranscript[] = [];
  try {
    await withTenantRead(tenantId, async (client) => {
      const docs = await client.query<{ id: string; name: string | null; text: string | null }>(
        `select id, source_filename as name, extracted_text as text from documents where run_id = $1 and kind = 'transcript' order by uploaded_at`,
        [runId],
      );
      const settings = new Map<
        string,
        { sessionType: "individual" | "focus_group"; mode: SegmentMode; moderators: string[] }
      >();
      try {
        const s = await client.query<{
          document_id: string;
          session_type: "individual" | "focus_group";
          segmentation_mode: SegmentMode | null;
          moderator_labels: string[] | null;
        }>(
          `select document_id, session_type, segmentation_mode, moderator_labels
           from coding_document_settings where run_id = $1`,
          [runId],
        );
        for (const r of s.rows) {
          settings.set(r.document_id, {
            sessionType: r.session_type,
            mode: r.segmentation_mode ?? "auto",
            moderators: r.moderator_labels ?? [],
          });
        }
      } catch {
        // Settings columns not migrated yet: read with defaults.
      }
      for (const d of docs.rows) {
        const text = d.text ?? "";
        if (text.trim().length < 20) continue;
        const cfg = settings.get(d.id) ?? { sessionType: "individual" as const, mode: "auto" as SegmentMode, moderators: [] };
        out.push({
          id: d.id,
          name: d.name ?? "Transcript",
          text,
          sessionType: cfg.sessionType,
          reading: segmentTranscriptDetailed(text, { mode: cfg.mode, moderators: cfg.moderators }),
        });
      }
    });
  } catch {
    // No transcripts is fine.
  }
  return out;
}

/**
 * Import-stage quality for every transcript in a run, read from the stored
 * text. Works before any coding. Best effort: a transcript that cannot be
 * read just has no panel.
 */
export async function getTranscriptImportQuality(
  tenantId: string,
  runId: string,
): Promise<Map<string, TranscriptImportQuality>> {
  const out = new Map<string, TranscriptImportQuality>();
  for (const t of await readRunTranscripts(tenantId, runId)) {
    out.set(
      t.id,
      computeTranscriptImportQuality({
        segments: t.reading.segments.map((s) => ({
          id: String(s.index),
          index: s.index,
          speaker: s.speaker,
          role: s.role,
          text: s.text,
        })),
        sessionType: t.sessionType,
        profiles: t.reading.profiles,
        rawText: t.text,
      }),
    );
  }
  return out;
}
