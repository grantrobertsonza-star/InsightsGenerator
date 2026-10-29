// SEC1: the project and program lists and the project header, read for one tenant.
//
// These used to be inline in the pages (src/app/page.tsx, src/app/programs/page.tsx,
// src/app/runs/[id]/page.tsx) and relied on row-level security alone to keep other organisations'
// rows out. Every statement here names tenant_id itself, so the lists and the header stay correct
// when the app connects as a role that bypasses row-level security (docs/database-roles.md). They
// live here so a disposable-database test can call the same reads the pages make
// (src/lib/__tests__/tenantScopingWithoutRls.db.test.ts). Another tenant's project reads exactly like a
// missing one: null, never a name.
import { withTenantRead } from "./db";

export type ProjectListRow = {
  id: string;
  project_name: string | null;
  business_problem: string | null;
  research_objective: string | null;
  decision_statement: string | null;
  audience: string | null;
  status: string;
  entry_point: "generate" | "validate" | null;
  created_at: string;
  findings_total: number;
  findings_rejected: number;
};

/** The home page's projects, newest first, with each one's finding counts. A project's bin is never listed. */
export async function loadProjectList(tenantId: string): Promise<ProjectListRow[]> {
  return withTenantRead(tenantId, async (client) => {
    // Both queries are independent, so they go to the database together on the same connection
    // (pg queues them) instead of one waiting on the other in code.
    const runsPromise = client.query<Omit<ProjectListRow, "findings_total" | "findings_rejected">>(
      // A project's bin is a run too (migration 0115); to_jsonb works before the column exists.
      `select id, project_name, business_problem, research_objective, decision_statement, audience, status, entry_point, created_at
         from runs where tenant_id = $1 and (to_jsonb(runs)->>'bin_of') is null order by created_at desc`,
      [tenantId],
    );
    const countsPromise = client.query<{ run_id: string; total: string; rejected: string }>(
      `select run_id, count(*) as total, count(*) filter (where status = 'rejected') as rejected
         from findings where tenant_id = $1
        group by run_id`,
      [tenantId],
    );
    const [runsResult, countsResult] = await Promise.all([runsPromise, countsPromise]);
    const countsByRun = new Map(countsResult.rows.map((row) => [row.run_id, { total: Number(row.total), rejected: Number(row.rejected) }]));
    return runsResult.rows.map((run) => ({
      ...run,
      findings_total: countsByRun.get(run.id)?.total ?? 0,
      findings_rejected: countsByRun.get(run.id)?.rejected ?? 0,
    }));
  });
}

export type ProgramWave = { id: string; project_name: string | null; wave_label: string | null; created_at: string };
export type ProgramWithWaves = { id: string; name: string; created_at: string; waves: ProgramWave[] };

/** The Programs page: this tenant's programs, newest first, each with its linked projects in creation order. */
export async function loadProgramsWithWaves(tenantId: string): Promise<ProgramWithWaves[]> {
  return withTenantRead(tenantId, async (client) => {
    const programsResult = await client.query<{ id: string; name: string; created_at: string }>(
      "select id, name, created_at from programs where tenant_id = $1 order by created_at desc",
      [tenantId],
    );
    // One query for all waves across every program, rather than a query per card.
    const wavesResult = await client.query<ProgramWave & { program_id: string }>(
      `select id, program_id, project_name, wave_label, created_at
         from runs
        where tenant_id = $1 and program_id is not null
        order by created_at asc`,
      [tenantId],
    );
    const wavesByProgram = new Map<string, ProgramWave[]>();
    for (const { program_id, ...wave } of wavesResult.rows) {
      const list = wavesByProgram.get(program_id) ?? [];
      list.push(wave);
      wavesByProgram.set(program_id, list);
    }
    return programsResult.rows.map((program) => ({ ...program, waves: wavesByProgram.get(program.id) ?? [] }));
  });
}

export type RunHeader = {
  id: string;
  project_name: string | null;
  business_problem: string | null;
  research_objective: string | null;
  decision_statement: string | null;
  evidence_synthesis: string | null;
  audience: string | null;
  status: string;
  entry_point: "generate" | "validate" | null;
  initial_research_objective: string | null;
  // OBJ-SET-M01: the current, editable list of stated objectives. On a pre-migration-0080
  // database the column does not exist and loadRunHeader falls back (see below).
  stated_objectives_text: string | null;
  program_id: string | null;
  wave_label: string | null;
};

/** The project page's header row; null when the project is missing, is a bin, or is another tenant's. */
export async function loadRunHeader(tenantId: string, runId: string): Promise<RunHeader | null> {
  return withTenantRead(tenantId, async (client) => {
    try {
      const result = await client.query<RunHeader>(
        `select id, project_name, business_problem, research_objective, decision_statement,
                evidence_synthesis, audience, status, entry_point, initial_research_objective,
                stated_objectives_text, program_id, wave_label
           from runs where id = $1 and tenant_id = $2 and (to_jsonb(runs)->>'bin_of') is null`,
        [runId, tenantId],
      );
      return result.rows[0] ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/stated_objectives_text/.test(message)) throw error;
      // Pre-migration-0080 database: same query without the new column.
      const result = await client.query<Omit<RunHeader, "stated_objectives_text">>(
        `select id, project_name, business_problem, research_objective, decision_statement,
                evidence_synthesis, audience, status, entry_point, initial_research_objective,
                program_id, wave_label
           from runs where id = $1 and tenant_id = $2 and (to_jsonb(runs)->>'bin_of') is null`,
        [runId, tenantId],
      );
      const row = result.rows[0];
      // Pre-migration-0080, a run's current objective list lived in initial_research_objective
      // (migration 0080's own backfill is `stated_objectives_text = initial_research_objective`
      // for exactly this reason). Falling back to that column keeps existing projects' objectives
      // visible until the migration runs (OBJ-SET-005), instead of showing none.
      return row ? { ...row, stated_objectives_text: row.initial_research_objective } : null;
    }
  });
}

/** This tenant's programs by name, for the project page's "link to a program" choice. */
export async function loadProgramOptions(tenantId: string): Promise<{ id: string; name: string }[]> {
  return withTenantRead(tenantId, async (client) => {
    const result = await client.query<{ id: string; name: string }>("select id, name from programs where tenant_id = $1 order by name asc", [tenantId]);
    return result.rows;
  });
}

/**
 * The other projects linked to `programId`, shown beside a linked project so the researcher sees
 * which projects it is grouped with. Only this tenant's projects are listed.
 */
export async function loadProgramWaves(tenantId: string, programId: string, excludeRunId: string): Promise<Omit<ProgramWave, "created_at">[]> {
  return withTenantRead(tenantId, async (client) => {
    const result = await client.query<Omit<ProgramWave, "created_at">>(
      `select id, project_name, wave_label from runs
        where tenant_id = $1 and program_id = $2 and id <> $3
        order by created_at asc`,
      [tenantId, programId, excludeRunId],
    );
    return result.rows;
  });
}
