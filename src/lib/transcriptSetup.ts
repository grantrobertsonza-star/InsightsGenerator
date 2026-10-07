import { withTenant, withTenantRead } from "./db";
import { segmentTranscriptDetailed, type SegmentMode } from "./qualCoding";

export type InterviewStyle = "unstructured" | "semi_structured" | "structured";

export type TranscriptSetup = {
  sessionType: "individual" | "focus_group";
  mode: SegmentMode;
  style: InterviewStyle | null;
  styleAvailable: boolean;
  // The researcher has made the choice. False for a transcript nobody has
  // set up yet, whatever the stored defaults say.
  confirmed: boolean;
};

export type SetupSuggestion = {
  sessionType: "individual" | "focus_group";
  mode: SegmentMode;
  reason: string;
};

async function hasColumn(
  client: { query: (q: string) => Promise<{ rows: unknown[] }> },
  column: string,
): Promise<boolean> {
  const r = await client.query(
    `select 1 from information_schema.columns
     where table_name = 'coding_document_settings' and column_name = '${column}'`,
  );
  return r.rows.length > 0;
}

export async function getTranscriptSetups(
  tenantId: string,
  runId: string,
): Promise<Map<string, TranscriptSetup>> {
  const out = new Map<string, TranscriptSetup>();
  try {
    await withTenantRead(tenantId, async (client) => {
      type Row = {
        document_id: string;
        session_type: "individual" | "focus_group";
        segmentation_mode: SegmentMode | null;
        interview_style?: InterviewStyle | null;
        setup_confirmed_at?: string | null;
      };
      const styleAvailable = await hasColumn(client, "interview_style");
      const confirmAvailable = await hasColumn(client, "setup_confirmed_at");
      const rows = (
        await client.query<Row>(
          `select document_id, session_type, segmentation_mode${
            styleAvailable ? ", interview_style" : ""
          }${
            confirmAvailable ? ", setup_confirmed_at" : ""
          } from coding_document_settings where run_id = $1`,
          [runId],
        )
      ).rows;
      for (const r of rows) {
        out.set(r.document_id, {
          sessionType: r.session_type,
          mode: r.segmentation_mode ?? "auto",
          style: r.interview_style ?? null,
          styleAvailable,
          // Before migration 0051 nothing can be confirmed, so nothing blocks.
          confirmed: confirmAvailable ? r.setup_confirmed_at != null : true,
        });
      }
    });
  } catch {
    // 0044/0046 missing: setup falls back to defaults.
  }
  return out;
}

export async function saveTranscriptSetup(
  tenantId: string,
  runId: string,
  documentId: string,
  setup: {
    sessionType: "individual" | "focus_group";
    mode: SegmentMode;
    style: InterviewStyle | null;
  },
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    const cols = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'coding_document_settings'
         and column_name in ('interview_style', 'setup_confirmed_at')`,
    );
    const have = new Set(cols.rows.map((c) => c.column_name));
    const styleColumn = have.has("interview_style");
    const extraCols = [
      styleColumn ? "interview_style" : null,
      have.has("setup_confirmed_at") ? "setup_confirmed_at" : null,
    ].filter((c): c is string => c !== null);
    const values: unknown[] = [
      tenantId,
      runId,
      documentId,
      setup.sessionType,
      setup.mode,
    ];
    const extraExprs = extraCols.map((c) => {
      if (c === "interview_style") {
        values.push(setup.style);
        return `$${values.length}`;
      }
      return "now()";
    });
    const updates = [
      "session_type = excluded.session_type",
      "segmentation_mode = excluded.segmentation_mode",
      ...extraCols.map((c) =>
        c === "setup_confirmed_at"
          ? "setup_confirmed_at = coalesce(coding_document_settings.setup_confirmed_at, now())"
          : `${c} = excluded.${c}`,
      ),
      "updated_at = now()",
    ];
    await client.query(
      `insert into coding_document_settings
         (tenant_id, run_id, document_id, session_type, segmentation_mode${extraCols.map((c) => `, ${c}`).join("")})
       values ($1, $2, $3, $4, $5${extraExprs.map((e) => `, ${e}`).join("")})
       on conflict (document_id) do update set ${updates.join(", ")}`,
      values,
    );
    if (!styleColumn && setup.style !== null) {
      throw new Error(
        "Interview style needs database migration 0048. The other choices were saved.",
      );
    }
  });
}

/**
 * Transcripts in this run that nobody has set up yet. Coding is held back for
 * these, because the group counts and echo flags depend on the answers.
 * Empty before migration 0051, so nothing is blocked until it is applied.
 */
export async function findUnconfirmedTranscripts(
  tenantId: string,
  runId: string,
): Promise<{ id: string; filename: string }[]> {
  try {
    return await withTenantRead(tenantId, async (client) => {
      if (!(await hasColumn(client, "setup_confirmed_at"))) return [];
      const r = await client.query<{ id: string; filename: string | null }>(
        `select d.id, d.source_filename as filename
         from documents d
         left join coding_document_settings s on s.document_id = d.id
         where d.run_id = $1 and d.kind = 'transcript'
           and s.setup_confirmed_at is null
         order by d.uploaded_at`,
        [runId],
      );
      return r.rows.map((x) => ({ id: x.id, filename: x.filename ?? x.id }));
    });
  } catch {
    return [];
  }
}

export const SETUP_NEEDED_MESSAGE =
  "Not coded yet: tell us who is in each session and how the file is laid out (Before coding), then run it again.";

/**
 * A starting point for the setup, from the file name and, when the text has
 * already been read, from the file itself. A suggestion only: the researcher
 * still confirms it.
 */
export function suggestSetup(
  filename: string,
  text: string | null,
): SetupSuggestion | null {
  const name = filename.toLowerCase();
  const fromName = /focus[\s_-]*group/.test(name)
    ? "focus_group"
    : /interview/.test(name)
      ? "individual"
      : null;
  if (text && text.trim().length >= 50) {
    const reading = segmentTranscriptDetailed(text, { mode: "auto" });
    const speakers = new Set(
      reading.segments
        .filter((s) => s.role !== "moderator")
        .map((s) => s.speaker),
    );
    const groups = (text.match(/^\s*focus group\s*#?\d+/gim) ?? []).length;
    const type =
      groups > 0 || fromName === "focus_group"
        ? "focus_group"
        : (fromName ?? "individual");
    return {
      sessionType: type,
      mode: reading.mode,
      reason:
        `${speakers.size} speaker${speakers.size === 1 ? "" : "s"} found` +
        (groups > 0
          ? `, ${groups} focus group heading${groups === 1 ? "" : "s"}`
          : "") +
        `, layout read as "${reading.mode}"`,
    };
  }
  if (fromName) {
    return {
      sessionType: fromName,
      mode: "auto",
      reason: `the file name mentions ${fromName === "focus_group" ? "a focus group" : "interviews"}`,
    };
  }
  return null;
}

export async function getSetupSuggestions(
  tenantId: string,
  runId: string,
): Promise<Map<string, SetupSuggestion>> {
  const out = new Map<string, SetupSuggestion>();
  try {
    await withTenantRead(tenantId, async (client) => {
      const r = await client.query<{
        id: string;
        filename: string | null;
        text: string | null;
      }>(
        `select id, source_filename as filename, substr(extracted_text, 1, 400000) as text
         from documents where run_id = $1 and kind = 'transcript'`,
        [runId],
      );
      for (const d of r.rows) {
        const sug = suggestSetup(d.filename ?? "", d.text);
        if (sug) out.set(d.id, sug);
      }
    });
  } catch {
    // No suggestion is fine.
  }
  return out;
}
