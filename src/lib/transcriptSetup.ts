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
  /** Which round of a repeated study this transcript is ("Wave 1"); null when not given. */
  wave: string | null;
  /** The researcher undid the acceptance (migration 0107): not accepted again automatically. */
  withdrawn: boolean;
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

/**
 * Whether migration 0107 is applied, so a transcript's wave and Undo accept can be saved. Asked once
 * per page rather than per transcript, because a transcript nobody has set up has no stored setup
 * to carry the answer. Unknown (the check itself failed) is reported as unavailable, so the screen
 * says the update is needed rather than offering a save that would fail.
 */
export async function transcriptWaveAvailable(tenantId: string): Promise<boolean> {
  try {
    return await withTenantRead(tenantId, (client) => hasColumn(client, "setup_withdrawn_at"));
  } catch {
    return false;
  }
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
        wave?: string | null;
        setup_withdrawn_at?: string | null;
      };
      const styleAvailable = await hasColumn(client, "interview_style");
      const confirmAvailable = await hasColumn(client, "setup_confirmed_at");
      const waveAvailable = await hasColumn(client, "setup_withdrawn_at");
      const rows = (
        await client.query<Row>(
          `select document_id, session_type, segmentation_mode${
            styleAvailable ? ", interview_style" : ""
          }${
            confirmAvailable ? ", setup_confirmed_at" : ""
          }${waveAvailable ? ", wave, setup_withdrawn_at" : ""} from coding_document_settings where run_id = $1`,
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
          wave: r.wave ?? null,
          withdrawn: r.setup_withdrawn_at != null,
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
    /** Left out: the stored wave is kept. null or blank clears it. */
    wave?: string | null;
  },
): Promise<void> {
  const wave = setup.wave === undefined ? undefined : setup.wave?.trim() ? setup.wave.trim().slice(0, 80) : null;
  // What could not be saved for want of a migration, reported only after the rest has committed:
  // thrown inside the transaction it would roll the other choices back too, while saying they saved.
  const missing: string[] = [];
  await withTenant(tenantId, async (client) => {
    const cols = await client.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'coding_document_settings'
         and column_name in ('interview_style', 'setup_confirmed_at', 'setup_withdrawn_at')`,
    );
    const have = new Set(cols.rows.map((c) => c.column_name));
    const styleColumn = have.has("interview_style");
    const waveColumns = have.has("setup_withdrawn_at");
    // Saving a setup is accepting it, so it also clears an earlier Undo accept (0107).
    const extraCols = [
      styleColumn ? "interview_style" : null,
      have.has("setup_confirmed_at") ? "setup_confirmed_at" : null,
      waveColumns ? "setup_withdrawn_at" : null,
      waveColumns && wave !== undefined ? "wave" : null,
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
      if (c === "wave") {
        values.push(wave);
        return `$${values.length}`;
      }
      if (c === "setup_withdrawn_at") return "null";
      return "now()";
    });
    const updates = [
      "session_type = excluded.session_type",
      "segmentation_mode = excluded.segmentation_mode",
      ...extraCols.map((c) =>
        c === "setup_confirmed_at"
          ? "setup_confirmed_at = coalesce(coding_document_settings.setup_confirmed_at, now())"
          : c === "setup_withdrawn_at"
            ? "setup_withdrawn_at = null"
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
    if (!styleColumn && setup.style !== null) missing.push("Interview style needs database migration 0048.");
    if (!waveColumns && wave) missing.push("The wave needs database migration 0107.");
  });
  if (missing.length > 0) throw new Error(`${missing.join(" ")} The other choices were saved.`);
}

/**
 * Undo accept for a transcript (Grant, 2026-10-19). Its choices are kept, but it goes back to
 * "Needs review": coding skips it until it is accepted again (findUnconfirmedTranscripts), and the
 * Import card does not accept it again by itself (withdrawn). Scoped to this run and organisation;
 * a transcript that was never accepted has nothing to undo and is refused, not silently ignored.
 */
export async function withdrawTranscriptSetup(tenantId: string, runId: string, documentId: string): Promise<void> {
  await withTenant(tenantId, async (client) => {
    if (!(await hasColumn(client, "setup_withdrawn_at"))) {
      throw new Error("Undo accept needs database migration 0107. Nothing was changed.");
    }
    const r = await client.query(
      `update coding_document_settings
          set setup_confirmed_at = null, setup_withdrawn_at = now(), updated_at = now()
        where tenant_id = $1 and run_id = $2 and document_id = $3 and setup_confirmed_at is not null
      returning document_id`,
      [tenantId, runId, documentId],
    );
    if (r.rowCount === 0) throw new Error("This transcript is not accepted in this project, so there is nothing to undo.");
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
