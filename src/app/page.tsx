import Link from "next/link";
import { redirect } from "next/navigation";
import { withTenant } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { deleteRun } from "@/lib/runActions";
import DeleteRunButton from "./DeleteRunButton";
import { BoltIcon, CheckIcon, DocumentIcon, ChartIcon, GridIcon, BookIcon, TranscriptIcon } from "@/components/icons";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { extractDocumentText } from "@/lib/extractFindings";
import { extractBriefFields } from "@/lib/briefIntake";
import { storeUploadedDocument } from "@/lib/documentUpload";
import SubmitButton from "@/components/SubmitButton";
import { parseNumberedItems } from "@/lib/text";

const BUCKET = "documents";

// There's no login system yet, so every run on this page belongs to one
// fixed tenant read from the environment. Once real auth exists, this will
// come from whoever is logged in instead.
const TENANT_ID = process.env.DEFAULT_TENANT_ID!;

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
  findings_reviewed: number;
};

async function getRuns(): Promise<Run[]> {
  return withTenant(TENANT_ID, async (client) => {
    const runsResult = await client.query<Omit<Run, "findings_total" | "findings_reviewed">>(
      "select id, project_name, business_problem, research_objective, decision_statement, audience, status, entry_point, created_at from runs order by created_at desc"
    );
    // A researcher juggling several projects wants to see review progress
    // without opening each one, so this tallies findings per run in one pass
    // rather than a query per card.
    const countsResult = await client.query<{ run_id: string; total: string; reviewed: string }>(
      `select run_id, count(*) as total, count(*) filter (where status <> 'pending') as reviewed
       from findings
       group by run_id`
    );
    const countsByRun = new Map(
      countsResult.rows.map((row) => [row.run_id, { total: Number(row.total), reviewed: Number(row.reviewed) }])
    );
    return runsResult.rows.map((run) => ({
      ...run,
      findings_total: countsByRun.get(run.id)?.total ?? 0,
      findings_reviewed: countsByRun.get(run.id)?.reviewed ?? 0,
    }));
  });
}

async function createRun(formData: FormData) {
  "use server";
  const projectName = String(formData.get("projectName") ?? "");
  // Both optional, and stored as null rather than "" when blank so "has the
  // researcher given us anything to start from" stays a simple truthiness
  // check everywhere else in the app reads these. Neither is a decision:
  // the business problem is why this project exists, the objective is what
  // it sets out to learn, and the decision framer (run once documents are
  // processed) proposes actual candidate decisions from these plus the
  // evidence, rather than asking the researcher to guess one upfront.
  //
  // Either can also come from an uploaded brief or proposal instead of
  // being typed by hand: a brief is normally just these two things, a
  // proposal restates both and adds a methodology or literature review on
  // top of them. Manual text always wins if the researcher filled a field
  // in themselves; the upload only fills in whichever of the two it left
  // blank, it never overwrites something typed by hand.
  const businessProblemRaw = String(formData.get("businessProblem") ?? "").trim();
  const manualBusinessProblem = businessProblemRaw.length > 0 ? businessProblemRaw : null;
  const researchObjectiveRaw = String(formData.get("researchObjective") ?? "").trim();
  const manualResearchObjective = researchObjectiveRaw.length > 0 ? researchObjectiveRaw : null;
  const audience = String(formData.get("audience") ?? "");
  const entryPoint = String(formData.get("entryPoint") ?? "");

  const briefFileEntry = formData.get("briefFile");
  const briefFile = briefFileEntry instanceof File && briefFileEntry.size > 0 ? briefFileEntry : null;
  const proposalFileEntry = formData.get("proposalFile");
  const proposalFile = proposalFileEntry instanceof File && proposalFileEntry.size > 0 ? proposalFileEntry : null;

  // The actual material to analyze, same three kinds and the same storage
  // helper as the run page's own upload form, just gathered here too so
  // setting a project up is one page instead of "create it, then go find
  // the upload section and bring your data in separately." Nothing here is
  // processed yet, same as a document added later: the researcher still
  // reviews what landed on the project page and clicks "Process this
  // project" when ready, so a mis-tagged file is easy to catch and delete
  // before it costs an API call.
  const reportFiles = (formData.getAll("reportFiles") as File[]).filter((file) => file.size > 0);
  // Aggregated and raw tables are now separate file inputs (see the import
  // section's markup below) rather than one "Tables" input plus a radio
  // button choosing which ingestion type applies to all of them, so each
  // file's ingestion type is implicit in which box it was dropped into,
  // never a shared setting that could silently apply to the wrong file.
  const tableFiles = (formData.getAll("tableFiles") as File[]).filter((file) => file.size > 0);
  const rawTableFiles = (formData.getAll("rawTableFiles") as File[]).filter((file) => file.size > 0);
  const transcriptFiles = (formData.getAll("transcriptFiles") as File[]).filter((file) => file.size > 0);

  const runId = await withTenant(TENANT_ID, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into runs
         (tenant_id, project_name, business_problem, research_objective, initial_research_objective,
          audience, entry_point)
       values ($1, $2, $3, $4, $4, $5, $6)
       returning id`,
      [TENANT_ID, projectName, manualBusinessProblem, manualResearchObjective, audience, entryPoint]
    );
    return result.rows[0].id;
  });

  if (briefFile || proposalFile) {
    try {
      // Each is stored as an "evidence" document, the one kind that isn't
      // run through the findings extractors, since a brief or proposal is
      // context for the project, not a source findings should be mined
      // from. Both stay attached to the run either way, for provenance.
      async function storeAndExtractText(file: File): Promise<string> {
        const safeFileName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
        const storagePath = `${TENANT_ID}/${runId}/${Date.now()}-${safeFileName}`;
        const buffer = Buffer.from(await file.arrayBuffer());

        const { error: uploadError } = await supabaseAdmin.storage
          .from(BUCKET)
          .upload(storagePath, buffer, { contentType: file.type || undefined });

        if (uploadError) {
          throw new Error(`Upload of ${file.name} failed: ${uploadError.message}`);
        }

        const documentId = await withTenant(TENANT_ID, async (client) => {
          const result = await client.query<{ id: string }>(
            `insert into documents (tenant_id, run_id, kind, source_filename, storage_path)
             values ($1, $2, 'evidence', $3, $4)
             returning id`,
            [TENANT_ID, runId, file.name, storagePath]
          );
          return result.rows[0].id;
        });

        const { fullText } = await extractDocumentText(storagePath, file.name, documentId);
        return fullText;
      }

      const [briefText, proposalText] = await Promise.all([
        briefFile ? storeAndExtractText(briefFile) : Promise.resolve(null),
        proposalFile ? storeAndExtractText(proposalFile) : Promise.resolve(null),
      ]);

      const extracted = await extractBriefFields(TENANT_ID, runId, { briefText, proposalText });

      const finalBusinessProblem = manualBusinessProblem ?? extracted.businessProblem;
      const finalResearchObjective = manualResearchObjective ?? extracted.researchObjective;

      if (finalBusinessProblem !== manualBusinessProblem || finalResearchObjective !== manualResearchObjective) {
        await withTenant(TENANT_ID, async (client) => {
          // initial_research_objective is updated here too, not just
          // research_objective: this is still the project's starting point
          // (nothing has been accepted yet), it just arrived from the
          // brief/proposal instead of being typed in directly. Past this
          // point, research_objective starts moving as candidates are
          // accepted or rejected, but initial_research_objective stays
          // fixed at whatever this project actually started from, which is
          // what the objective framer needs for "the researcher's own
          // starting objective" on every later run, not a snapshot that
          // would otherwise be the pre-brief, often-empty, manual value.
          await client.query(
            `update runs
             set business_problem = $1, research_objective = $2, initial_research_objective = $2,
                 updated_at = now()
             where id = $3`,
            [finalBusinessProblem, finalResearchObjective, runId]
          );
        });
      }
    } catch (error) {
      // A brief or proposal that fails to parse (a scanned image PDF, a
      // corrupt file) shouldn't block the project from being created; the
      // researcher can still fill the two fields in by hand from the
      // project page.
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'brief_intake_error', $3)`,
          [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
        );
      }).catch(() => {});
    }
  }

  if (reportFiles.length + tableFiles.length + rawTableFiles.length + transcriptFiles.length > 0) {
    try {
      await Promise.all([
        ...reportFiles.map((file) => storeUploadedDocument(TENANT_ID, runId, "report", file)),
        ...tableFiles.map((file) => storeUploadedDocument(TENANT_ID, runId, "table", file, "aggregated")),
        ...rawTableFiles.map((file) => storeUploadedDocument(TENANT_ID, runId, "table", file, "raw")),
        ...transcriptFiles.map((file) => storeUploadedDocument(TENANT_ID, runId, "transcript", file)),
      ]);
    } catch (error) {
      // Same reasoning as the brief/proposal catch above: a single bad
      // upload (one oversized file, a storage hiccup) shouldn't block the
      // project from existing. Whatever did succeed is already listed on
      // the project page, and a failed one is easy to re-add from there.
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'setup_upload_error', $3)`,
          [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })]
        );
      }).catch(() => {});
    }
  }

  revalidatePath("/");
  // Importing a brief/proposal and the actual documents was the whole point
  // of unifying this into one setup screen, so the natural next step is the
  // project page itself, not back to the project list to go find the one
  // just created. Processing still waits for an explicit "Process this
  // project" click there, nothing here jumps ahead of that.
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
  const { entry } = await searchParams;
  const runs = await getRuns();

  return (
    <>
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-white shadow-sm">
              IE
            </div>
            <div>
              <div className="text-base font-semibold text-foreground">Insights Elevator</div>
              <div className="text-xs text-muted">Verified, decision-ready insights</div>
            </div>
          </div>
          <Link
            href="/programs"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary"
          >
            <ChartIcon className="h-3.5 w-3.5 text-muted" />
            Programs
          </Link>
          <Link
            href="/manual"
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:border-slate-400 hover:bg-primary-light hover:text-primary"
          >
            <BookIcon className="h-3.5 w-3.5 text-muted" />
            Manual
          </Link>
        </div>
      </header>
      <div className="brand-accent-bar" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-foreground">
          Insights, <span className="text-primary">elevated</span>.
        </h1>
        <p className="mb-10 text-sm text-muted">
          A project is one engagement: a decision to inform, using a client&apos;s report and data.
        </p>

        {entry !== "generate" && entry !== "validate" ? (
          <div className="mb-12 grid gap-4 sm:grid-cols-2">
            <Link
              href="/?entry=generate"
              className="card-surface group rounded-xl border border-border bg-white p-6 hover:border-primary/50"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
                <BoltIcon />
              </div>
              <div className="mb-2 text-base font-semibold text-foreground group-hover:text-primary">
                Generate from data
              </div>
              <div className="text-sm text-muted">
                Start from raw tables or a dataset. The app mines it directly for undeclared patterns:
                segment differences, trends, outliers, relationships.
              </div>
            </Link>
            <Link
              href="/?entry=validate"
              className="card-surface group rounded-xl border border-border bg-white p-6 hover:border-primary/50"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-primary-light text-primary">
                <CheckIcon />
              </div>
              <div className="mb-2 text-base font-semibold text-foreground group-hover:text-primary">
                Validate existing insights
              </div>
              <div className="text-sm text-muted">
                Start from a report that already makes findings. The app checks each one and elevates
                what survives into a clear narrative.
              </div>
            </Link>
          </div>
        ) : (
          <div className="card-surface mb-12 rounded-xl border border-border bg-white p-6">
            <Link href="/" className="text-sm font-medium text-primary hover:underline">
              &larr; Choose a different starting point
            </Link>
            <div className="mt-3 mb-5">
              <span className="inline-flex items-center rounded-full bg-primary-light px-3 py-1 text-xs font-medium text-primary ring-1 ring-inset ring-blue-200">
                {entryPointLabel[entry]}
              </span>
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
              <div className="rounded-lg border border-dashed border-border bg-slate-50 p-3">
                <span className="text-sm font-medium text-foreground">Import from a brief and/or proposal</span>
                <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
                <p className="mt-1 text-xs text-muted">
                  The client&apos;s brief usually states the business problem and objectives; a supplier&apos;s
                  proposal reflects both back and adds a methodology on top. Upload either or both and
                  we&apos;ll pull the business problem and objective(s) out of them below, reconciling the
                  two if you give us both. Fields you fill in yourself always win over what the documents say.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-foreground">Brief (from the client)</span>
                    <input
                      type="file"
                      name="briefFile"
                      accept=".pdf,.docx,.pptx,.txt"
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-foreground">Proposal (your response)</span>
                    <input
                      type="file"
                      name="proposalFile"
                      accept=".pdf,.docx,.pptx,.txt"
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                  </label>
                </div>
              </div>
              <div className="rounded-lg border border-dashed border-border bg-slate-50 p-3">
                <span className="text-sm font-medium text-foreground">Import the documents to analyze</span>
                <span className="ml-1.5 text-xs font-normal text-muted">(optional, add more anytime)</span>
                <p className="mt-1 text-xs text-muted">
                  Bring your reports, raw data tables, and transcripts in now instead of hunting for the
                  upload section after the project is created. Nothing is processed yet, you&apos;ll still
                  review what landed here and click &quot;Process this project&quot; once you&apos;re happy
                  with it.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <DocumentIcon className="h-3.5 w-3.5 text-primary" />
                      Reports
                    </span>
                    <input
                      type="file"
                      name="reportFiles"
                      multiple
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                  </label>
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <ChartIcon className="h-3.5 w-3.5 text-primary" />
                      Tables
                    </span>
                    <input
                      type="file"
                      name="tableFiles"
                      multiple
                      accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                    <span className="mt-1 block text-[11px] text-muted">Already aggregated</span>
                  </label>
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <GridIcon className="h-3.5 w-3.5 text-primary" />
                      Raw data
                    </span>
                    <input
                      type="file"
                      name="rawTableFiles"
                      multiple
                      accept=".csv,.xlsx,.xls,.sav,.dta,.sas7bdat"
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                    <span className="mt-1 block text-[11px] text-muted">One row per respondent</span>
                  </label>
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <TranscriptIcon className="h-3.5 w-3.5 text-primary" />
                      Transcripts
                    </span>
                    <input
                      type="file"
                      name="transcriptFiles"
                      multiple
                      className="mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100"
                    />
                  </label>
                </div>
              </div>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Business problem</span>
                <span className="ml-1.5 text-xs font-normal text-muted">(optional, why this project exists)</span>
                <textarea
                  name="businessProblem"
                  rows={2}
                  placeholder="e.g. Renewal among lapsed members has dropped 12% year on year and we don't know why."
                  className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Research objective or hypothesis</span>
                <span className="ml-1.5 text-xs font-normal text-muted">(optional, what this project sets out to learn)</span>
                <textarea
                  name="researchObjective"
                  rows={2}
                  placeholder="e.g. Understand whether price or service is the bigger driver of lapsed renewals."
                  className="mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <p className="-mt-1 text-xs text-muted">
                No decision field here on purpose. Once documents are processed, we propose candidate research
                objectives and, once one is confirmed, candidate decisions this evidence could inform. You accept,
                edit, reject, or add your own for each on the project page.
              </p>
              <label className="block">
                <span className="text-sm font-medium text-foreground">Audience</span>
                <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
                <input
                  name="audience"
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

        <h2 className="mb-4 text-lg font-semibold text-foreground">Projects</h2>
        {runs.length === 0 && <p className="text-sm text-muted">No projects yet.</p>}
        <ul className="flex flex-col gap-3">
          {runs.map((run) => {
            const deleteThisRun = deleteRun.bind(null, run.id);
            return (
              <li
                key={run.id}
                className="card-surface flex items-start justify-between gap-4 rounded-xl border border-border bg-white p-4 hover:border-primary/30"
              >
                <Link href={`/runs/${run.id}`} className="flex-1 no-underline">
                  <div className="font-semibold text-foreground">
                    {run.project_name ?? run.research_objective ?? run.business_problem ?? "Untitled project"}
                  </div>
                  {run.project_name && (() => {
                    // decision_statement and research_objective are synced
                    // to a "1. ...\n2. ..." numbered block once more than
                    // one candidate is accepted (see runSync.ts); a list
                    // card has room for one representative line, not the
                    // whole block, so this shows the first item plus a
                    // count of anything else accepted rather than dumping
                    // the raw numbered text.
                    const decisionItems = parseNumberedItems(run.decision_statement);
                    const objectiveItems = parseNumberedItems(run.research_objective);
                    const items = decisionItems.length > 0 ? decisionItems : objectiveItems;
                    const preview = items.length > 0 ? items[0] : run.business_problem;
                    if (!preview) return null;
                    return (
                      <div className="mt-0.5 line-clamp-2 text-sm text-muted">
                        {preview}
                        {items.length > 1 && (
                          <span className="text-muted/70"> (+{items.length - 1} more)</span>
                        )}
                      </div>
                    );
                  })()}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                    <span>{run.entry_point ? entryPointLabel[run.entry_point] : "No starting point recorded"}</span>
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
                  {run.findings_total > 0 && (
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 w-32 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${Math.round((run.findings_reviewed / run.findings_total) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted">
                        {run.findings_reviewed} of {run.findings_total} findings reviewed
                      </span>
                    </div>
                  )}
                </Link>
                <form action={deleteThisRun}>
                  <DeleteRunButton />
                </form>
              </li>
            );
          })}
        </ul>
      </main>
    </>
  );
}
