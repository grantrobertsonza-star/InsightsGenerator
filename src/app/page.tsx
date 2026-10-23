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
      "select id, project_name, business_problem, research_objective, decision_statement, audience, status, entry_point, created_at from runs order by created_at desc",
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

const entryPointLabel: Record<string, string> = {
  generate: "Generate from data",
  validate: "Validate existing insights",
};

const statusStyles: Record<string, string> = {
  draft: "bg-slate-50 text-slate-600 ring-slate-200",
  ready: "bg-primary-light text-primary ring-blue-200",
  running: "bg-amber-50 text-amber-700 ring-amber-200",
  awaiting_human_review: "bg-amber-50 text-amber-700 ring-amber-200",
  complete: "bg-success-light text-success ring-green-200",
  error: "bg-danger-light text-danger ring-red-200",
};

// Same statuses as above, as a left border color for the project card in the list, so the status reads
// at a glance without having to find the badge text.
const statusBorder: Record<string, string> = {
  draft: "border-l-slate-300",
  ready: "border-l-primary",
  running: "border-l-amber-400",
  awaiting_human_review: "border-l-amber-400",
  complete: "border-l-success",
  error: "border-l-danger",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        statusStyles[status] ?? "bg-slate-50 text-slate-600 ring-slate-200"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ entry?: string }>;
}) {
  // G6: resolve the session first, so a signed-out visit redirects before any loader runs.
  const tenantId = await requireTenantId();
  const { entry } = await searchParams;
  const [runs, assistantUsage, projectCleanups] = await Promise.all([getRuns(), loadTenantUsageOutsideProjects(tenantId, 30), loadPendingProjectCleanups(tenantId)]);

  const statusCounts = new Map<string, number>();
  let totalFindings = 0;
  let totalExcluded = 0;
  for (const run of runs) {
    statusCounts.set(run.status, (statusCounts.get(run.status) ?? 0) + 1);
    totalFindings += run.findings_total;
    totalExcluded += run.findings_rejected;
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-8 py-10">
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
        Insights, <span className="text-primary">elevated</span>.
      </h1>
      <p className="mb-6 text-sm text-muted">
        A project is one engagement: a decision to inform, using a client&apos;s
        report and data.
      </p>

      <ProjectCleanupNotice state={projectCleanups.ok ? { ok: true, items: projectCleanups.items } : projectCleanups} />
      <ThreePane
        left={
          <Pane side="left" title="Start a project">
            {entry !== "generate" && entry !== "validate" ? (
              <div className="flex flex-col gap-3">
                <Link
                  href="/?entry=generate"
                  className="card-surface group rounded-xl border border-border bg-white p-4 hover:border-primary/50"
                >
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary">
                    <BoltIcon />
                  </div>
                  <div className="mb-1 text-sm font-semibold text-foreground group-hover:text-primary">
                    Generate from data
                  </div>
                  <div className="text-sm text-muted">
                    Start from raw tables or a dataset. The app mines it directly
                    for undeclared patterns: segment differences, trends,
                    outliers, relationships.
                  </div>
                </Link>
                <Link
                  href="/?entry=validate"
                  className="card-surface group rounded-xl border border-border bg-white p-4 hover:border-primary/50"
                >
                  <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-primary-light text-primary">
                    <CheckIcon />
                  </div>
                  <div className="mb-1 text-sm font-semibold text-foreground group-hover:text-primary">
                    Validate existing insights
                  </div>
                  <div className="text-sm text-muted">
                    Start from a report that already makes findings. The app
                    checks each one and elevates what survives into a clear
                    narrative.
                  </div>
                </Link>
              </div>
            ) : (
              <div className="card-surface rounded-xl border border-border bg-white p-4">
                <Link
                  href="/"
                  className="text-sm font-medium text-primary hover:underline"
                >
                  &larr; Choose a different starting point
                </Link>
                <div className="mt-3 mb-4">
                  <span className="inline-flex items-center rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-blue-200">
                    {entryPointLabel[entry]}
                  </span>
                </div>
                <form action={createRun} className="flex flex-col gap-4">
                  <input type="hidden" name="entryPoint" value={entry} />
                  <label className="block">
                    <span className="text-sm font-medium text-foreground">
                      Project name
                    </span>
                    <input
                      name="projectName"
                      required
                      placeholder="e.g. Acme Q3 member survey"
                      className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </label>
                  <SubmitButton
                    pendingLabel="Creating project..."
                    className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
                  >
                    Create project
                  </SubmitButton>
                </form>
              </div>
            )}
          </Pane>
        }
        middle={
          <Pane side="middle" title="Projects" badge={runs.length > 0 ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
              {runs.length}
            </span>
          ) : undefined}>
      {runs.length === 0 && (
        <p className="text-sm text-muted">No projects yet.</p>
      )}
      <ul className="flex flex-col gap-3">
        {runs.map((run) => {
          const deleteThisRun = deleteRun.bind(null, run.id);
          const renameThisRun = renameRun.bind(null, run.id);
          return (
            <li
              key={run.id}
              className={`card-surface flex items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 hover:border-primary/30 border-l-4 ${
                statusBorder[run.status] ?? "border-l-slate-300"
              }`}
            >
              <Link href={`/runs/${run.id}`} className="flex-1 no-underline">
                <div className="font-semibold text-foreground">
                  {run.project_name ??
                    run.research_objective ??
                    run.business_problem ??
                    "Untitled project"}
                </div>
                {run.project_name &&
                  (() => {
                    // decision_statement and research_objective are synced
                    // to a "1. ...\n2. ..." numbered block once more than
                    // one candidate is accepted (see runSync.ts); a list
                    // card has room for one representative line, not the
                    // whole block, so this shows the first item plus a
                    // count of anything else accepted rather than dumping
                    // the raw numbered text.
                    const decisionItems = parseNumberedItems(
                      run.decision_statement,
                    );
                    const objectiveItems = parseNumberedItems(
                      run.research_objective,
                    );
                    const items =
                      decisionItems.length > 0 ? decisionItems : objectiveItems;
                    const preview =
                      items.length > 0 ? items[0] : run.business_problem;
                    if (!preview) return null;
                    return (
                      <div className="mt-0.5 line-clamp-2 text-sm text-muted">
                        {preview}
                        {items.length > 1 && (
                          <span className="text-muted/70">
                            {" "}
                            (+{items.length - 1} more)
                          </span>
                        )}
                      </div>
                    );
                  })()}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                  <span>
                    {run.entry_point
                      ? entryPointLabel[run.entry_point]
                      : "No starting point recorded"}
                  </span>
                  <span className="text-border">&middot;</span>
                  {run.audience && (
                    <>
                      <span>Audience: {run.audience}</span>
                      <span className="text-border">&middot;</span>
                    </>
                  )}
                  <StatusBadge status={run.status} />
                  <span className="text-border">&middot;</span>
                  <span>{new Date(run.created_at).toLocaleString()}</span>
                </div>
                {run.findings_total > 0 && run.findings_rejected > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.round((run.findings_rejected / run.findings_total) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-muted">
                      {run.findings_rejected} of {run.findings_total} findings
                      excluded
                    </span>
                  </div>
                )}
              </Link>
              <div className="flex shrink-0 items-start gap-2">
                <RenameRunButton
                  name={
                    run.project_name ??
                    run.research_objective ??
                    run.business_problem ??
                    ""
                  }
                  onRename={renameThisRun}
                />
                <DeleteRunButton action={deleteThisRun} />
              </div>
            </li>
          );
        })}
      </ul>
          </Pane>
        }
        right={
          <Pane side="right" title="Overview">
            <div className="flex flex-col gap-4 text-sm">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted">
                  Projects
                </div>
                <div className="mt-1 text-2xl font-semibold text-foreground">
                  {runs.length}
                </div>
              </div>
              {statusCounts.size > 0 && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">
                    By status
                  </div>
                  <ul className="mt-1.5 flex flex-col gap-1.5">
                    {[...statusCounts.entries()].map(([status, count]) => (
                      <li key={status} className="flex items-center justify-between gap-2">
                        <StatusBadge status={status} />
                        <span className="text-muted">{count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {totalFindings > 0 && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted">
                    Findings across all projects
                  </div>
                  <div className="mt-1 text-foreground">
                    {totalExcluded} of {totalFindings} excluded
                  </div>
                </div>
              )}
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
              <p className="text-xs text-muted">
                Open a project from the middle pane for its own run dashboard, imports and analysis.
              </p>
            </div>
          </Pane>
        }
      />
    </main>
  );
}
