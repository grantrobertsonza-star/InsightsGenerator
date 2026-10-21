import SubmitButton from "@/components/SubmitButton";
import { saveRunContext } from "@/lib/runContextActions";
import type { BriefFill } from "@/lib/briefFillRecord";
import { LAST_FILL_UNKNOWN, lastFillText } from "@/lib/briefFillText";

const field =
  "mt-1.5 block w-full rounded-lg border border-border px-3 py-2 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

export default function RunContextForm({
  runId,
  businessProblem,
  objective,
  audience,
  documents,
  lastFill,
}: {
  runId: string;
  businessProblem: string | null;
  objective: string | null;
  audience: string | null;
  /** The project's imported documents that can be read as a brief or proposal, with any role recorded at import. */
  documents: { id: string; filename: string; role: "brief" | "proposal" | null }[];
  /** The last successful fill (briefFillRecord.loadLastBriefFill): null when never filled, error when unknown. */
  lastFill?: BriefFill | null | { error: string };
}) {
  return (
    <form
      action={saveRunContext.bind(null, runId)}
      className="flex flex-col gap-4"
    >
      {documents.length > 0 && (
        <div className="rounded-lg border border-dashed border-border bg-slate-50 p-3">
          <span className="text-sm font-medium text-foreground">Fill in from a brief or proposal</span>
          <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
          <p className="mt-1 text-xs text-muted">
            Choose an imported brief and/or proposal and we will fill in whichever fields below you leave blank when you save. Text you type yourself always wins. Add files under Import data.
            The choice applies to one save, so it shows Not used again afterwards; choose a document again to fill again.
          </p>
          {lastFill && (
            <p className="mt-1.5 text-xs font-medium text-slate-700" data-testid="brief-last-fill">
              {"error" in lastFill ? LAST_FILL_UNKNOWN : lastFillText(lastFill)}
            </p>
          )}
          <div className="mt-2 grid grid-cols-1 gap-2">
            {(
              [
                ["briefDocumentId", "Brief (from the client)", "brief"],
                ["proposalDocumentId", "Proposal (your response)", "proposal"],
              ] as const
            ).map(([name, label, role]) => (
              <label key={name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-xs font-medium text-foreground">{label}</span>
                <select name={name} defaultValue="" className="min-w-0 max-w-full rounded-lg border border-border bg-white px-2 py-1 text-xs text-foreground">
                  <option value="">Not used</option>
                  {[...documents].sort((a, b) => Number(b.role === role) - Number(a.role === role)).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.role === role ? `${d.filename} (imported as ${role})` : d.filename}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="block">
        <span className="text-sm font-medium text-foreground">Business problem</span>
        <span className="ml-1.5 text-xs font-normal text-muted">(optional)</span>
        <textarea
          name="businessProblem"
          rows={10}
          defaultValue={businessProblem ?? ""}
          placeholder="e.g. Renewal among lapsed members has dropped 12% year on year and we don't know why."
          className={`${field} min-h-48 resize-y`}
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
