import Link from "next/link";
import { withTenant, withTenantRead } from "@/lib/db";
import { revalidatePath } from "next/cache";
import SubmitButton from "@/components/SubmitButton";
import { ChartIcon, ArrowLeftIcon } from "@/components/icons";
import { requireTenantId } from "@/lib/requestContext";
import ProgramControls from "./ProgramControls";

// Same no-login-yet placeholder as every other page (see src/app/page.tsx).


type ProgramWave = {
  id: string;
  project_name: string | null;
  wave_label: string | null;
  created_at: string;
};

type Program = {
  id: string;
  name: string;
  created_at: string;
  waves: ProgramWave[];
};

async function getPrograms(): Promise<Program[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    const programsResult = await client.query<{
      id: string;
      name: string;
      created_at: string;
    }>("select id, name, created_at from programs order by created_at desc");
    // One query for all waves across every program, same "tally in one
    // pass rather than a query per card" reasoning the project list uses
    // for its findings counts.
    const wavesResult = await client.query<
      ProgramWave & { program_id: string }
    >(
      `select id, program_id, project_name, wave_label, created_at
       from runs
       where program_id is not null
       order by created_at asc`,
    );
    const wavesByProgram = new Map<string, ProgramWave[]>();
    for (const wave of wavesResult.rows) {
      const list = wavesByProgram.get(wave.program_id) ?? [];
      list.push(wave);
      wavesByProgram.set(wave.program_id, list);
    }
    return programsResult.rows.map((program) => ({
      ...program,
      waves: wavesByProgram.get(program.id) ?? [],
    }));
  });
}

async function createProgram(formData: FormData) {
  "use server";
  const TENANT_ID = await requireTenantId();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return;
  }
  await withTenant(TENANT_ID, async (client) => {
    await client.query(
      "insert into programs (tenant_id, name) values ($1, $2)",
      [TENANT_ID, name],
    );
  });
  revalidatePath("/programs");
}

export default async function ProgramsPage() {
  // G6: resolve the session first, so a signed-out visit redirects before any loader runs.
  await requireTenantId();
  const programs = await getPrograms();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-8 py-10">
      <Link
        href="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to projects
      </Link>
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
        Programs
      </h1>
      <p className="mb-10 text-sm text-muted">
        A program groups related projects, for example one client&apos;s brand and satisfaction
        trackers, so they are easy to find together. For the waves of one tracking study, keep them in
        one project: add each wave&apos;s data file under Import data and give it a wave label and
        fieldwork month; Analytics then compares the waves. A project stays a normal project unless you
        add it to a program. Deleting a program only removes the grouping; its projects and their data
        are kept.
      </p>

      <div className="card-surface mb-12 rounded-xl border border-border bg-white p-6">
        <h2 className="mb-1 text-base font-semibold text-foreground">
          Start a new program
        </h2>
        <p className="mb-4 text-sm text-muted">
          Give it a name the client would recognize, e.g. &quot;Acme Member
          Satisfaction Tracker&quot;. You can attach projects to it as waves
          from each project&apos;s own page, including projects that already
          exist.
        </p>
        <form
          action={createProgram}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <label className="block flex-1">
            <span className="text-sm font-medium text-foreground">
              Program name
            </span>
            <input
              name="name"
              required
              placeholder="e.g. Acme Member Satisfaction Tracker"
              className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </label>
          <SubmitButton
            pendingLabel="Creating..."
            className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
          >
            Create program
          </SubmitButton>
        </form>
      </div>

      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Existing programs
      </h2>
      {programs.length === 0 && (
        <p className="text-sm text-muted">No programs yet.</p>
      )}
      <ul className="flex flex-col gap-3">
        {programs.map((program) => (
          <li
            key={program.id}
            className="card-surface rounded-xl border border-border bg-white p-4"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary">
                <ChartIcon className="h-4 w-4" />
              </div>
              <div className="font-semibold text-foreground">
                {program.name}
              </div>
              <span className="text-border">&middot;</span>
              <span className="text-sm text-muted">
                {program.waves.length}{" "}
                {program.waves.length === 1 ? "project" : "projects"}
              </span>
              <ProgramControls programId={program.id} name={program.name} projects={program.waves.length} />
            </div>
            {program.waves.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5 border-l-2 border-border pl-4">
                {program.waves.map((wave) => (
                  <li key={wave.id} className="text-sm">
                    <Link
                      href={`/runs/${wave.id}`}
                      className="font-medium text-foreground hover:text-primary"
                    >
                      {wave.project_name ?? "Untitled project"}
                    </Link>
                    <span className="ml-2 text-muted">
                      {wave.wave_label ? `${wave.wave_label} · ` : ""}
                      {new Date(wave.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No projects in it yet. Open a project and add it to this
                program under Import data.
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
