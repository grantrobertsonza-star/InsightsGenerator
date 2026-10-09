import SubmitButton from "@/components/SubmitButton";
import { saveRunContext } from "@/lib/runContextActions";

const field =
  "mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const fileField =
  "mt-1 block w-full text-xs text-foreground file:mr-2 file:rounded-lg file:border-0 file:bg-primary-light file:px-2.5 file:py-1.5 file:text-xs file:font-medium file:text-primary hover:file:bg-blue-100";

export default function RunContextForm({
  runId,
  businessProblem,
  objective,
  audience,
}: {
  runId: string;
  businessProblem: string | null;
  objective: string | null;
  audience: string | null;
}) {
  return (
    <form
      action={saveRunContext.bind(null, runId)}
      className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5"
    >
      <div className="rounded-lg border border-dashed border-border bg-slate-50 p-3">
        <span className="text-sm font-medium text-foreground">
          Import from a brief and/or proposal
        </span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
        <p className="mt-1 text-xs text-muted">
          The client&apos;s brief usually states the business problem and objectives; a
          supplier&apos;s proposal reflects both back. Upload either or both and we will fill in
          whichever fields below you leave blank. Text you type yourself always wins.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-foreground">Brief (from the client)</span>
            <input type="file" name="briefFile" accept=".pdf,.docx,.pptx,.txt" className={fileField} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-foreground">Proposal (your response)</span>
            <input type="file" name="proposalFile" accept=".pdf,.docx,.pptx,.txt" className={fileField} />
          </label>
        </div>
      </div>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Business problem</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional, why this project exists)</span>
        <textarea
          name="businessProblem"
          rows={2}
          defaultValue={businessProblem ?? ""}
          placeholder="e.g. Renewal among lapsed members has dropped 12% year on year and we don't know why."
          className={field}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Add research objectives or hypotheses</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional, one per line. Saved ones appear on the right)</span>
        <textarea
          name="researchObjective"
          rows={3}
          placeholder="e.g. Understand whether price or service is the bigger driver of lapsed renewals."
          className={field}
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-foreground">Audience</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
        <input name="audience" defaultValue={audience ?? ""} className={field} />
      </label>
      <SubmitButton
        pendingLabel="Saving..."
        className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-hover hover:shadow-md"
      >
        Save
      </SubmitButton>
    </form>
  );
}
