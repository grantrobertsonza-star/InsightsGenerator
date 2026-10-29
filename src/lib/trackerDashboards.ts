// D2 (Grant, 29 October 2026): reading and saving a tracker dashboard's choices, once per programme (or per
// project when it is in no programme), migration 0132. The suggestion is worked out from this wave's file on
// every read (trackerInput.ts, trackerRoles.ts); only the researcher's choices are stored, and they are
// applied to each wave by trackerDashboard.ts.
// Guarantees:
//   - a save or reset is a compare-and-swap on `revision`: a caller that last saw another revision is told so
//     and given the current choices, and nothing is written; "no row yet" is its own expected state, and two
//     first saves cannot both win (the scope's unique index);
//   - the project and the file are checked inside the same transaction as the write, with the project's row
//     locked, so a project moved to another programme meanwhile writes to the programme it is in now, and a
//     project or file that is gone is refused;
//   - choices are checked against this wave's suggestion and variables on the server, never trusted from the
//     screen;
//   - before migration 0132 the suggestion still shows, and saving is refused with that reason.
import type { PoolClient } from "pg";
import { withTenant, withTenantRead } from "./db";
import { loadRoleInput } from "./trackerInput";
import { recogniseTracker, type TrackerRecognition } from "./trackerRoles";
import { choiceProblems, normaliseChoices, prefilledFocalBrand, resolveDashboard, TRACKER_ROLE_RULES, type ResolvedDashboard, type TrackerChoices } from "./trackerDashboard";

export const TRACKER_DASHBOARDS_UNAVAILABLE = "Dashboard choices cannot be saved yet: the database needs migration 0132.";

type Row = {
  revision: number;
  choices: unknown;
  choices_run_id: string | null;
  choices_document_id: string | null;
  choices_by: string | null;
  choices_at: Date | null;
  reset_at: Date | null;
};

export type TrackerDashboardView = {
  recognition: TrackerRecognition;
  dashboard: ResolvedDashboard;
  /** The stored revision, or null when nothing has been saved for this programme or project. */
  revision: number | null;
  choices: TrackerChoices;
  /** Where the saved choices were last made: this wave, or another (by project and file). */
  choicesFrom: { runId: string | null; documentId: string | null; thisWave: boolean; at: string | null; by: string | null } | null;
  resetAt: string | null;
  scope: "programme" | "project";
  /** False before migration 0132: choices cannot be saved (TRACKER_DASHBOARDS_UNAVAILABLE). */
  storageAvailable: boolean;
  labelsCut: string[];
};

export type SaveResult =
  | { saved: true; revision: number }
  | { saved: false; reason: "conflict"; current: { revision: number | null; choices: TrackerChoices } }
  | { saved: false; reason: "invalid"; problems: string[] }
  | { saved: false; reason: "unavailable"; message: string };

async function storageAvailable(client: PoolClient): Promise<boolean> {
  const r = await client.query<{ ok: boolean }>("select to_regclass('tracker_dashboards') is not null as ok");
  return r.rows[0]?.ok === true;
}

/** The project's programme (or none), its name and the programme's, from the project row. Refuses a project
 * that is not this tenant's. `lock` takes the row for the write's transaction. */
async function scopeOf(client: PoolClient, tenantId: string, runId: string, lock: boolean) {
  const r = await client.query<{ program_id: string | null; project_name: string | null; program_name: string | null }>(
    `select r.program_id, r.project_name, p.name as program_name
       from runs r left join programs p on p.id = r.program_id and p.tenant_id = r.tenant_id
      where r.id = $1 and r.tenant_id = $2 ${lock ? "for update of r" : ""}`,
    [runId, tenantId],
  );
  if (r.rowCount !== 1) throw new Error("That project no longer exists. Nothing was changed.");
  const row = r.rows[0];
  return { programId: row.program_id, names: [row.program_name, row.project_name] };
}

const scopeWhere = (programId: string | null) => (programId ? "tenant_id = $1 and program_id = $2" : "tenant_id = $1 and run_id = $2");

async function storedRow(client: PoolClient, tenantId: string, programId: string | null, runId: string, lock = false): Promise<Row | null> {
  const r = await client.query<Row>(
    `select revision, choices, choices_run_id, choices_document_id, choices_by, choices_at, reset_at
       from tracker_dashboards where ${scopeWhere(programId)} ${lock ? "for update" : ""}`,
    [tenantId, programId ?? runId],
  );
  return r.rows[0] ?? null;
}

async function documentInRun(client: PoolClient, runId: string, documentId: string) {
  const r = await client.query("select 1 from documents where id = $1 and run_id = $2", [documentId, runId]);
  if (r.rowCount !== 1) throw new Error("That data file is no longer in this project. Nothing was changed.");
}

/** This wave's dashboard: the suggestion from its file with the programme's saved choices applied. */
export async function loadTrackerDashboard(tenantId: string, runId: string, documentId: string): Promise<TrackerDashboardView> {
  const input = await loadRoleInput(tenantId, runId, documentId);
  const recognition = recogniseTracker(input.variables);
  const { programId, names, available, row } = await withTenantRead(tenantId, async (client) => {
    const scope = await scopeOf(client, tenantId, runId, false);
    const ok = await storageAvailable(client);
    return { ...scope, available: ok, row: ok ? await storedRow(client, tenantId, scope.programId, runId) : null };
  });
  const choices = normaliseChoices(row?.choices);
  const variableNames = new Set(input.variables.map((v) => v.name));
  const prefill = recognition.frame ? prefilledFocalBrand(recognition.frame.brands, names) : null;
  return {
    recognition,
    dashboard: resolveDashboard(recognition, variableNames, input.weightVar, choices, prefill),
    revision: row?.revision ?? null,
    choices,
    choicesFrom: row?.choices_at
      ? { runId: row.choices_run_id, documentId: row.choices_document_id, thisWave: row.choices_document_id === documentId, at: row.choices_at.toISOString(), by: row.choices_by }
      : null,
    resetAt: row?.reset_at ? row.reset_at.toISOString() : null,
    scope: programId ? "programme" : "project",
    storageAvailable: available,
    labelsCut: input.labelsCut,
  };
}

/** What was suggested when the choices were saved, kept with them for the record. */
function suggestionRecord(rec: TrackerRecognition, weightVar: string | null) {
  return {
    rules: TRACKER_ROLE_RULES,
    type: rec.type,
    brands: rec.frame?.brands ?? [],
    nonBrandCodes: rec.frame?.nonBrandCodes.map((c) => c.code) ?? [],
    stages: Object.fromEntries(rec.measures.map((m) => [m.group, m.stage])),
    csm: rec.csm,
    weightVar,
  };
}

/**
 * Saves the researcher's choices for the programme (replacing the stored set), made while viewing this wave's
 * file. `expectedRevision` is the revision the screen last read (null: nothing saved yet).
 */
export async function saveTrackerChoices(
  tenantId: string,
  runId: string,
  documentId: string,
  expectedRevision: number | null,
  rawChoices: unknown,
  by: string | null,
): Promise<SaveResult> {
  const choices = normaliseChoices(rawChoices);
  const input = await loadRoleInput(tenantId, runId, documentId);
  const rec = recogniseTracker(input.variables);
  return withTenant(tenantId, async (client) => {
    if (!(await storageAvailable(client))) return { saved: false, reason: "unavailable", message: TRACKER_DASHBOARDS_UNAVAILABLE } as const;
    const { programId } = await scopeOf(client, tenantId, runId, true);
    await documentInRun(client, runId, documentId);
    // A choice this file cannot support may still be saved unchanged: it was made against a wave that had it,
    // and resaving other choices from this wave must not drop it.
    const stored = normaliseChoices((await storedRow(client, tenantId, programId, runId))?.choices);
    const problems = choiceProblems(choices, rec, new Set(input.variables.map((v) => v.name)), input.weightVar, stored);
    if (problems.length) return { saved: false, reason: "invalid", problems } as const;
    const values = [JSON.stringify(choices), runId, documentId, by, JSON.stringify(suggestionRecord(rec, input.weightVar))];
    let written;
    if (expectedRevision === null) {
      written = await client.query<{ revision: number }>(
        `insert into tracker_dashboards (tenant_id, program_id, run_id, choices, choices_run_id, choices_document_id, choices_by, choices_at, suggested)
         values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
         on conflict do nothing returning revision`,
        [tenantId, programId, programId ? null : runId, ...values],
      );
    } else {
      written = await client.query<{ revision: number }>(
        `update tracker_dashboards
            set choices = $4, choices_run_id = $5, choices_document_id = $6, choices_by = $7, choices_at = now(), suggested = $8,
                revision = revision + 1, updated_at = now()
          where ${scopeWhere(programId)} and revision = $3 returning revision`,
        [tenantId, programId ?? runId, expectedRevision, ...values],
      );
    }
    if (written.rowCount === 1) return { saved: true, revision: written.rows[0].revision } as const;
    const current = await storedRow(client, tenantId, programId, runId);
    return { saved: false, reason: "conflict", current: { revision: current?.revision ?? null, choices: normaliseChoices(current?.choices) } } as const;
  });
}

/** Reset to suggested: clears the programme's choices and keeps them as previous_choices. */
export async function resetTrackerChoices(tenantId: string, runId: string, expectedRevision: number, by: string | null): Promise<SaveResult> {
  return withTenant(tenantId, async (client) => {
    if (!(await storageAvailable(client))) return { saved: false, reason: "unavailable", message: TRACKER_DASHBOARDS_UNAVAILABLE } as const;
    const { programId } = await scopeOf(client, tenantId, runId, true);
    const written = await client.query<{ revision: number }>(
      `update tracker_dashboards
          set previous_choices = choices, choices = '{}'::jsonb, reset_at = now(), choices_by = $4, choices_at = null,
              choices_run_id = null, choices_document_id = null, revision = revision + 1, updated_at = now()
        where ${scopeWhere(programId)} and revision = $3 returning revision`,
      [tenantId, programId ?? runId, expectedRevision, by],
    );
    if (written.rowCount === 1) return { saved: true, revision: written.rows[0].revision } as const;
    const current = await storedRow(client, tenantId, programId, runId);
    return { saved: false, reason: "conflict", current: { revision: current?.revision ?? null, choices: normaliseChoices(current?.choices) } } as const;
  });
}
