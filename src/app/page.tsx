import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant, withTenantRead } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { deleteRun, renameRun } from "@/lib/runActions";
import DeleteRunButton from "./DeleteRunButton";
import ProjectCleanupNotice from "./ProjectCleanupNotice";
import { loadPendingProjectCleanups } from "@/lib/projectStorageCleanup";
import RenameRunButton from "./RenameRunButton";
import {
  BoltIcon,
  CheckIcon,
} from "@/components/icons";
import SubmitButton from "@/components/SubmitButton";
import { parseNumberedItems } from "@/lib/text";
import { Pane, ThreePane } from "./runs/[id]/ThreePane";
import { requireTenantId } from "@/lib/requestContext";
import { loadTenantUsageOutsideProjects } from "@/lib/apiUsage";
import { loadProjectOverviews, type ProjectOverview } from "@/lib/projectStageFacts";
import { SECTIONS } from "@/lib/sectionStatus";
import { StatePill, StateDisc, STATE_LOOK } from "@/components/StageLook";

type Run = {
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

async function getRuns(): Promise<Run[]> {
  const TENANT_ID = await requireTenantId();
  return withTenantRead(TENANT_ID, async (client) => {
    // Both queries are independent, so they go to the database together on
    // the same connection (pg queues them) instead of one waiting on the other
    // in code. The counts query only needs the findings table.
    const runsPromise = client.query<
      Omit<Run, "findings_total" | "findings_rejected">
    >(
      // A project's bin is a run too (migration 0115); it is never listed. to_jsonb works before the column exists.
      "select id, project_name, business_problem, research_objective, decision_statement, audience, status, entry_point, created_at from runs where (to_jsonb(runs)->>'bin_of') is null order by created_at desc",
    );
    const countsPromise = client.query<{
      run_id: string;
      total: string;
      rejected: string;
    }>(
      `select run_id, count(*) as total, count(*) filter (where status = 'rejected') as rejected
       from findings
       group by run_id`,
    );
    const [runsResult, countsResult] = await Promise.all([runsPromise, countsPromise]);
    const countsByRun = new Map(
      countsResult.rows.map((row) => [
        row.run_id,
        { total: Number(row.total), rejected: Number(row.rejected) },
      ]),
    );
    return runsResult.rows.map((run) => ({
      ...run,
      findings_total: countsByRun.get(run.id)?.total ?? 0,
      findings_rejected: countsByRun.get(run.id)?.rejected ?? 0,
    }));
  });
}

async function createRun(formData: FormData) {
  "use server";
  const TENANT_ID = await requireTenantId();
  const projectName = String(formData.get("projectName") ?? "");
  const entryPoint = String(formData.get("entryPoint") ?? "");

  // A project starts as just a name and a starting point. Context
  // (business problem, objective, audience, brief or proposal) and the data
  // files are added on the project page, once each, in that order.
  const runId = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into runs (tenant_id, project_name, entry_point)
       values ($1, $2, $3)
       returning id`,
      [TENANT_ID, projectName, entryPoint],
    );
    return result.rows[0].id;
  });

  revalidatePath("/");
  redirect(`/runs/${runId}`);
}

/** How many projects, newest first, the dashboard reads the status of. */
const STATUS_ROWS = 25;

const entryPointLabel: Record<string, string> = {
  generate: "Generate from data",
  validate: "Validate existing insights",
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  // G6: resolve the session first, so a signed-out visit redirects before any loader runs.
  const tenantId = await requireTenantId();
  const { entry } = await searchParams;
  const [runs, assistantUsage, projectCleanups] = await Promise.all([getRuns(), loadTenantUsageOutsideProjects(tenantId, 30), loadPendingProjectCleanups(tenantId)]);
  // Each project's four sections and next step (Grant, 2026-10-23), from the stored records.
  // Read for the most recent projects only: each takes about 25 ms (measured 2026-10-23: 26 projects,
  // home page 0.7 to 0.9 s on the disposable stack), so a long list stays bounded; older rows say
  // to open the project for its status, and the summary counts say how many they cover.
  const overviews = await loadProjectOverviews(tenantId, runs.slice(0, STATUS_ROWS).map((r) => r.id));

  const states = runs.map((r) => overviews.get(r.id));
  const needYou = states.filter((o) => o && (!o.ok || o.sections.some((x) => x.state === "needs_you" || x.state === "couldnt_check"))).length;
  const working = states.filter((o) => o?.ok && o.sections.some((x) => x.state === "working") && !o.sections.some((x) => x.state === "needs_you" || x.state === "couldnt_check")).length;
  const delivered = states.filter((o) => o?.ok && o.sections.find((x) => x.id === "deliver")?.state === "ready").length;
  let totalFindings = 0;
  let totalExcluded = 0;
  for (const run of runs) {
    totalFindings += run.findings_total;
    totalExcluded += run.findings_rejected;
  }
  const starting = entry === "generate" || entry === "validate";

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-8">
      <h1 className="text-3xl font-bold tracking-tight text-foreground">
        Insights, <span className="text-primary">elevated</span>.
      </h1>
      <p className="mb-6 mt-1 text-sm text-muted">A project is one engagement: a decision to inform, using a client&apos;s report and data.</p>

      <ProjectCleanupNotice state={projectCleanups.ok ? { ok: true, items: projectCleanups.items, locations: projectCleanups.locations } : projectCleanups} />
      {/* Start a project sits above the list as a foldable band, as on the section pages (Grant, 2026-10-23). */}
      <ThreePane
        leftOnTop
        storageKey="home"
        left={
          <Pane side="left" title="Start a project">
            {!starting ? (
              <div className="col-span-full grid gap-3 md:grid-cols-2">
                <StartCard href="/?entry=generate" icon={<BoltIcon />} title="Generate from data" text="Start from raw tables or a dataset. The app mines it for segment differences, trends, outliers and relationships." />
                <StartCard href="/?entry=validate" icon={<CheckIcon />} title="Validate existing insights" text="Start from a report that already makes findings. The app checks each one and elevates what survives into a clear narrative." />
              </div>
            ) : (
              <div className="card-surface col-span-full max-w-xl rounded-xl border border-border bg-white p-4">
                <Link href="/" className="text-sm font-medium text-primary hover:underline">
                  &larr; Choose a different starting point
                </Link>
                <div className="mb-4 mt-3">
                  <span className="inline-flex items-center rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-blue-200">{entryPointLabel[entry]}</span>
                </div>
                <form action={createRun} className="flex flex-col gap-4">
                  <input type="hidden" name="entryPoint" value={entry} />
                  <label className="block">
                    <span className="text-sm font-medium text-foreground">Project name</span>
                    <input
                      name="projectName"
                      required
                      placeholder="e.g. Acme Q3 member survey"
                      className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <SubmitButton pendingLabel="Creating project..." className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md">
                    Create project
                  </SubmitButton>
                </form>
              </div>
            )}
          </Pane>
        }
        middle={
          <Pane
            side="middle"
            title="Projects"
            badge={runs.length > 0 ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">{runs.length}</span> : undefined}
          >
            {runs.length === 0 ? (
              <p className="text-sm text-muted">No projects yet. Start one above.</p>
            ) : (
              <>
                <ul className="flex flex-col gap-3" data-testid="project-list">
                  {runs.map((run) => (
                    <ProjectRow key={run.id} run={run} overview={overviews.get(run.id)} />
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  Status from each project&apos;s stored records. Inside a project, its overviews also check previews, data quality, survey design and support.
                </p>
              </>
            )}
          </Pane>
        }
        right={
          <Pane side="right" title="Overview">
            <div className="flex flex-col gap-3" data-testid="dashboard-summary">
              <SummaryTile label="Projects" value={runs.length} note={runs.length > STATUS_ROWS ? `Statuses below cover the ${STATUS_ROWS} newest` : undefined} />
              <SummaryTile label="Need you" value={needYou} tone="needs_you" note="A stage needs you or could not be checked" />
              <SummaryTile label="Working" value={working} tone="working" note="The app is still doing something" />
              <SummaryTile label="Delivered" value={delivered} tone="ready" note="Deliver stage ready" />
              {totalFindings > 0 && <p className="text-xs text-muted">{`${totalExcluded} of ${totalFindings} findings excluded across all projects.`}</p>}
              <div data-testid="assistant-usage-outside-projects">
                {/* The Research assistant outside a project (dashboard, Knowledge base, Manual): a
                    project's own API usage page counts only that project's calls. */}
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Research assistant outside projects, last 30 days
                </div>
                {assistantUsage.ok ? (
                  <div className="mt-1 text-foreground">
                    {assistantUsage.summary.calls === 0
                      ? "Not used"
                      : `${assistantUsage.summary.calls} model calls, ${(
                          assistantUsage.summary.inputTokens +
                          assistantUsage.summary.cacheWriteTokens +
                          assistantUsage.summary.cacheReadTokens
                        ).toLocaleString("en-US")} input tokens (${assistantUsage.summary.cacheReadTokens.toLocaleString("en-US")} from cache), about $${assistantUsage.summary.costUsd.toFixed(2)}`}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-red-700">Could not be read: {assistantUsage.error}</div>
                )}
              </div>
            </div>
          </Pane>
        }
      />
    </main>
  );
}

function SummaryTile({ label, value, tone, note }: { label: string; value: number; tone?: "needs_you" | "working" | "ready"; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted">
        {tone && <StateDisc state={tone} size="sm" />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{value}</div>
      {note && <div className="text-[11px] text-muted">{note}</div>}
    </div>
  );
}

function StartCard({ href, icon, title, text }: { href: string; icon: React.ReactNode; title: string; text: string }) {
  return (
    <Link href={href} className="card-surface group rounded-xl border border-border bg-white p-4 hover:border-primary/50">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary">{icon}</span>
        <span className="text-sm font-semibold text-foreground group-hover:text-primary">{title}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted">{text}</p>
    </Link>
  );
}

function projectTitle(run: Run) {
  return run.project_name ?? run.research_objective ?? run.business_problem ?? "Untitled project";
}

function objectivePreview(run: Run): string | null {
  // decision_statement and research_objective are synced to a "1. ...\n2. ..." numbered block once
  // more than one candidate is accepted (runSync.ts); a row has room for the first item and a count.
  const decisionItems = parseNumberedItems(run.decision_statement);
  const objectiveItems = parseNumberedItems(run.research_objective);
  const items = decisionItems.length > 0 ? decisionItems : objectiveItems;
  const first = items.length > 0 ? items[0] : run.business_problem;
  if (!first) return null;
  return items.length > 1 ? `${first} (+${items.length - 1} more)` : first;
}

function ProjectRow({ run, overview }: { run: Run; overview: ProjectOverview | undefined }) {
  const deleteThisRun = deleteRun.bind(null, run.id);
  const renameThisRun = renameRun.bind(null, run.id);
  const preview = run.project_name ? objectivePreview(run) : null;
  const worst = overview?.ok ? (["couldnt_check", "needs_you", "working", "ready"] as const).find((s) => overview.sections.some((x) => x.state === s)) ?? "not_used" : "couldnt_check";
  return (
    <li className={`card-surface rounded-xl border border-border border-l-4 bg-white p-4 hover:border-primary/30 ${STATE_LOOK[worst].rail}`} data-testid="project-row" data-state={worst}>
      <div className="flex items-start justify-between gap-4">
        <Link href={`/runs/${run.id}`} className="min-w-0 flex-1 no-underline">
          <div className="font-semibold text-foreground">{projectTitle(run)}</div>
          {preview && <div className="mt-0.5 line-clamp-1 text-sm text-muted">{preview}</div>}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
            <span>{run.entry_point ? entryPointLabel[run.entry_point] : "No starting point recorded"}</span>
            <span className="text-border">&middot;</span>
            <span>{new Date(run.created_at).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}</span>
            {run.findings_total > 0 && (
              <>
                <span className="text-border">&middot;</span>
                <span>{`${run.findings_total} findings, ${run.findings_rejected} excluded`}</span>
              </>
            )}
          </div>
        </Link>
        <div className="flex shrink-0 items-start gap-2">
          <RenameRunButton name={run.project_name ?? run.research_objective ?? run.business_problem ?? ""} storedName={run.project_name} onRename={renameThisRun} />
          <DeleteRunButton action={deleteThisRun} />
        </div>
      </div>
      {overview === undefined ? (
        <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-muted">Open the project to see its status (shown here for the {STATUS_ROWS} newest projects).</p>
      ) : overview.ok ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-1.5" data-testid="project-sections">
            {overview.sections.map((x) => (
              <Link key={x.id} href={`/runs/${run.id}?section=${x.navId}`} className="no-underline" aria-label={`${x.label}: ${STATE_LOOK[x.state].label}, ${x.headline}`}>
                <StatePill state={x.state} label={SECTIONS.find((s) => s.id === x.id)?.label ?? x.label} title={x.headline} />
              </Link>
            ))}
          </div>
          {overview.next ? (
            <Link href={`/runs/${run.id}?section=${overview.next.moduleId}`} className="min-w-0 flex-1 text-sm text-primary hover:underline" data-testid="project-next">
              <span className="font-medium">{`Next: ${overview.next.label}`}</span>
              <span className="text-muted">{` · ${overview.next.text}`}</span>
            </Link>
          ) : (
            <span className="text-sm text-muted">Nothing waiting for you.</span>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-red-700" data-testid="project-status-error">
          {`Status could not be read: ${overview.error.replace(/\.$/, "")}.`}
        </p>
      )}
    </li>
  );
}
