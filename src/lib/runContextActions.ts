"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { readContextDocument } from "./extractFindings";
import { extractBriefFields } from "./briefIntake";
import { syncResearchObjective } from "./runSync";
import { parseObjectiveLines, normalizeObjectiveLine, objectiveIdentityKey } from "./objectiveLines";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { requireTenantId } from "./requestContext";


/**
 * Saves the project's context: business problem, research objective or
 * hypothesis, and audience. All optional. A brief and/or proposal chosen from
 * the project's imported documents only fills fields the researcher left
 * blank, it never overwrites text typed by hand. The objective is also kept as the researcher's own accepted
 * candidate, so a later accept or reject on the objective list (which
 * recomputes runs.research_objective from accepted candidates) cannot wipe it.
 *
 * The merge below reads and writes stated_objectives_text, the current,
 * ordinary mutable list of what the researcher has typed or imported so
 * far (OBJ-SET-M01). initial_research_objective is a separate, write-once
 * column: the update sets it with coalesce so only the very first save
 * for a run ever touches it, after which objectiveFramer.ts can keep
 * reading it as a true, untouched snapshot of the researcher's starting
 * point rather than something this function (or editStatedObjective) has
 * been quietly rewriting on every add, edit, or delete.
 */
/** The rationale of an objective added from a document; the prefix is what briefFillRecord matches. */
function addedFromRationale(brief: string | null, proposal: string | null): string | null {
  if (brief && proposal) return `Added from the brief "${brief}" and the proposal "${proposal}"`;
  if (brief) return `Added from the brief "${brief}"`;
  if (proposal) return `Added from the proposal "${proposal}"`;
  return null;
}

/**
 * What one Set objectives save did, so the form can say it (GT500-F02). `ok` is always true: a
 * save that fails outright still throws. A requested fill that did not happen comes back as
 * `fill.status = "failed"` beside the save that did, never as silence.
 */
export type RunContextSaveResult = {
  ok: true;
  /** Lines already in the project (by objectiveIdentityKey), so not added again. */
  alreadyInProject: number;
  /** Document lines imported by an earlier fill of this project (GT500-F01), so not added again. */
  importedBefore: number;
  fill:
    | null
    | { status: "filled"; objectivesAdded: number; filledBusinessProblem: boolean }
    | {
        status: "failed";
        /** "the proposal X.docx", or "the chosen document" when even its name could not be read. */
        documents: string;
        reason: string;
        /** False when the failure could not be recorded either, so a reload will not show it. */
        recorded: boolean;
        briefDocumentId: string | null;
        proposalDocumentId: string | null;
      };
};

/** "the brief A.docx and the proposal B.docx" for a message; ids whose name is unknown are "the chosen document". */
function documentsLabel(brief: { filename: string | null } | null, proposal: { filename: string | null } | null): string {
  const one = (kind: string, d: { filename: string | null } | null) => (d ? (d.filename ? `the ${kind} ${d.filename}` : "the chosen document") : null);
  return [one("brief", brief), one("proposal", proposal)].filter(Boolean).join(" and ") || "the chosen document";
}

export async function saveRunContext(runId: string, formData: FormData): Promise<RunContextSaveResult> {
  const TENANT_ID = await requireTenantId();
  const clean = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v.length > 0 ? v : null;
  };
  let businessProblem = clean("businessProblem");
  let objective = clean("researchObjective");
  const audience = String(formData.get("audience") ?? "").trim();
  // Grant 2026-10-19: briefs and proposals are added under Import data; here the researcher only
  // chooses which imported one(s) to fill the blank fields from. Nothing is chosen by default, so an
  // ordinary save makes no extraction call. (Automatic objective scoring, below, can still call the
  // model when the save adds or changes objectives.)
  const briefId = clean("briefDocumentId");
  const proposalId = clean("proposalDocumentId");
  // Which document filled what (Grant, 2026-10-21: the screen did not say which brief or proposal
  // was used). Set only after a successful read; recorded with the save below.
  let fill: {
    brief: { id: string; filename: string } | null;
    proposal: { id: string; filename: string } | null;
    filledBusinessProblem: boolean;
    objectivesFromDocument: boolean;
  } | null = null;
  let failedFill: Extract<RunContextSaveResult["fill"], { status: "failed" }> | null = null;

  if (briefId || proposalId) {
    // Names learned so far, so a failure message can name the document even when a later step failed.
    const names: Record<string, string> = {};
    try {
      const textOf = async (documentId: string): Promise<{ text: string; filename: string }> => {
        const read = async () =>
          withTenant(TENANT_ID, async (client) => {
            const r = await client.query<{ extracted_text: string | null; source_filename: string }>(
              "select extracted_text, source_filename from documents where id = $1 and run_id = $2 and tenant_id = $3",
              [documentId, runId, TENANT_ID],
            );
            if (r.rowCount !== 1) throw new Error("That document is not in this project.");
            names[documentId] = r.rows[0].source_filename;
            return r.rows[0];
          });
        // A document whose text was never read (an old upload) is read now, the same way Import does.
        const first = await read();
        const row = first.extracted_text !== null ? first : (await readContextDocument(TENANT_ID, runId, documentId), await read());
        return { text: row.extracted_text ?? "", filename: row.source_filename };
      };
      const [brief, proposal] = await Promise.all([briefId ? textOf(briefId) : Promise.resolve(null), proposalId ? textOf(proposalId) : Promise.resolve(null)]);
      const extracted = await extractBriefFields(TENANT_ID, runId, { briefText: brief?.text ?? null, proposalText: proposal?.text ?? null });
      fill = {
        brief: brief && briefId ? { id: briefId, filename: brief.filename } : null,
        proposal: proposal && proposalId ? { id: proposalId, filename: proposal.filename } : null,
        filledBusinessProblem: businessProblem === null && !!extracted.businessProblem,
        objectivesFromDocument: objective === null && !!extracted.researchObjective,
      };
      businessProblem = businessProblem ?? extracted.businessProblem;
      objective = objective ?? extracted.researchObjective;
    } catch (error) {
      // An unreadable brief must not block saving what was typed, and must not pass for a fill
      // either (GT500-F02): it is recorded for Set objectives to show after a reload, and returned
      // so this response shows it even when recording it fails too.
      const reason = error instanceof Error ? error.message : String(error);
      const detail = {
        message: reason,
        briefDocumentId: briefId,
        briefFilename: briefId ? names[briefId] ?? null : null,
        proposalDocumentId: proposalId,
        proposalFilename: proposalId ? names[proposalId] ?? null : null,
      };
      const recorded = await withTenant(TENANT_ID, async (client) => {
        await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'brief_intake_error', $3)`, [
          TENANT_ID,
          runId,
          JSON.stringify(detail),
        ]);
        return true;
      }).catch(() => false);
      failedFill = {
        status: "failed",
        documents: documentsLabel(briefId ? { filename: detail.briefFilename } : null, proposalId ? { filename: detail.proposalFilename } : null),
        reason,
        recorded,
        briefDocumentId: briefId,
        proposalDocumentId: proposalId,
      };
    }
  }

  const counts = await withTenant(TENANT_ID, async (client) => {
    // Locked, so two saves at once cannot both add the same objective, and the import lineage read
    // below is current; the row must exist.
    const prev = await client.query<{ stated_objectives_text: string | null }>(
      "select stated_objectives_text from runs where id = $1 for update",
      [runId],
    );
    if (prev.rowCount !== 1) throw new Error("This project was not found.");
    const prevObjective = prev.rows[0]?.stated_objectives_text?.trim() ?? null;

    // The objective box only adds. Saved objectives live in the list beside
    // the form, where they are edited or deleted one by one.
    //
    // A line already in the project is not added again (Grant, 2026-10-21): it is compared, through
    // objectiveIdentityKey, with the saved list and with every objective candidate of this project
    // whatever its source or status, so filling from the same proposal twice, or from a brief whose
    // objectives Review already holds or the researcher rejected, adds nothing.
    //
    // Import lineage (GT500-F01): comparing with current wording alone let a reread bring back an
    // imported objective the researcher had since reworded or deleted. Every successful fill records
    // the identity keys of all the objectives it read from its documents ('brief_intake_used',
    // extractedKeys), and a line read from a document whose key any earlier fill of this project
    // already read is not added again, whatever has happened to the objective since: edited,
    // rejected or deleted, those are the researcher's decisions. Lines the researcher types are not
    // checked against this lineage; typing a line in again is a deliberate add. Fills recorded
    // before extractedKeys existed have no lineage, so only the current-wording check covers them.
    const prevLines = parseObjectiveLines(prevObjective);
    const candidateRows = await client.query<{ candidate_text: string }>(
      "select candidate_text from objective_candidates where run_id = $1",
      [runId],
    );
    const known = new Set([...prevLines, ...candidateRows.rows.map((r) => r.candidate_text)].map(objectiveIdentityKey));
    const fromDocument = fill?.objectivesFromDocument === true;
    const importedKeys = new Set<string>();
    if (fromDocument) {
      const lineage = await client.query<{ key: string }>(
        `select jsonb_array_elements_text(detail->'extractedKeys') as key from trace
          where run_id = $1 and event = 'brief_intake_used' and jsonb_typeof(detail->'extractedKeys') = 'array'`,
        [runId],
      );
      for (const r of lineage.rows) importedKeys.add(r.key);
    }
    const extractedKeys: string[] = [];
    const newLines: string[] = [];
    let alreadyInProject = 0;
    let importedBefore = 0;
    for (const line of parseObjectiveLines(objective)) {
      const key = objectiveIdentityKey(line);
      if (key.length === 0) continue;
      if (fromDocument && !extractedKeys.includes(key)) extractedKeys.push(key);
      if (known.has(key)) {
        alreadyInProject++;
        continue;
      }
      if (importedKeys.has(key)) {
        importedBefore++;
        continue;
      }
      known.add(key);
      newLines.push(line);
    }
    const merged = [...prevLines, ...newLines].join("\n") || null;

    // OBJ-SET-003: this is "Setup's own first save" the objectiveFramer.ts carry-over comment
    // already assumed sets objective_candidates_seeded - it never actually did. Without it, a
    // run that is only ever edited through Setup (never regenerated) stays permanently
    // unseeded, so the first time generateObjectiveCandidates ever runs for it - possibly long
    // after several Setup edits have replaced the original upfront text - its carry-over logic
    // treats the ORIGINAL initial_research_objective as "not yet represented" and inserts it
    // fresh alongside whatever the researcher's edits actually left current, resurrecting
    // superseded text. Setting the marker here, transactionally with the save that creates
    // the initial candidate rows below, is what the comment in objectiveFramer.ts already
    // describes as the intended source of truth for it.
    await client.query("savepoint obj_candidates_seeded_setup_save");
    try {
      await client.query(
        `update runs set business_problem = $1, stated_objectives_text = $2,
                initial_research_objective = coalesce(initial_research_objective, $2),
                audience = $3, objective_candidates_seeded = true, updated_at = now() where id = $4`,
        [businessProblem, merged, audience, runId],
      );
      await client.query("release savepoint obj_candidates_seeded_setup_save");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/objective_candidates_seeded/.test(message)) throw error;
      // Migration 0084 not applied yet: no such column. Roll back to the savepoint (so this
      // failed statement does not poison the rest of the transaction) and save everything
      // else the same way this always did before that migration existed.
      await client.query("rollback to savepoint obj_candidates_seeded_setup_save");
      await client.query(
        `update runs set business_problem = $1, stated_objectives_text = $2,
                initial_research_objective = coalesce(initial_research_objective, $2),
                audience = $3, updated_at = now() where id = $4`,
        [businessProblem, merged, audience, runId],
      );
    }

    // Lines read from a brief or proposal say which one (briefFillRecord.loadObjectiveSources shows it).
    const rationale = fromDocument ? addedFromRationale(fill?.brief?.filename ?? null, fill?.proposal?.filename ?? null) : null;
    const addedIds: string[] = [];
    for (const line of newLines) {
      // Every line here is new to the project by objectiveIdentityKey (above).
      const inserted = await client.query<{ id: string }>(
        `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
         values ($1, $2, $3, $4, 'researcher_authored', 'accepted') returning id`,
        [TENANT_ID, runId, line, rationale ?? "Written or imported at project set-up."],
      );
      addedIds.push(inserted.rows[0].id);
    }
    if (fill) {
      // The record Set objectives shows as "Last filled from ..." (briefFillRecord.loadLastBriefFill),
      // and the import lineage above, written with the save they describe.
      await client.query(`insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'brief_intake_used', $3)`, [
        TENANT_ID,
        runId,
        JSON.stringify({
          briefDocumentId: fill.brief?.id ?? null,
          briefFilename: fill.brief?.filename ?? null,
          proposalDocumentId: fill.proposal?.id ?? null,
          proposalFilename: fill.proposal?.filename ?? null,
          filledBusinessProblem: fill.filledBusinessProblem,
          objectivesAdded: fromDocument ? newLines.length : 0,
          importedBefore,
          extractedKeys,
          addedCandidateIds: fromDocument ? addedIds : [],
        }),
      ]);
    }
    await syncResearchObjective(client, runId);
    return { alreadyInProject, importedBefore, added: newLines.length };
  });

  // Objectives are scored straight away (Grant, 2026-10-21: automate where possible), so this save
  // can call the model. An unchanged list makes no model call; a scoring failure is recorded and
  // shown on Review, never blocks the save.
  await refreshObjectiveQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  return {
    ok: true,
    alreadyInProject: counts.alreadyInProject,
    importedBefore: counts.importedBefore,
    fill: failedFill ?? (fill ? { status: "filled", objectivesAdded: fill.objectivesFromDocument ? counts.added : 0, filledBusinessProblem: fill.filledBusinessProblem } : null),
  };
}

/** The Set objectives form's action (useActionState passes the previous result first). */
export async function saveRunContextFromForm(runId: string, _previous: RunContextSaveResult | null, formData: FormData): Promise<RunContextSaveResult> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  return saveRunContext(runId, formData);
}

/**
 * The Setup list's entry point for editing or removing a stated objective. Same work as
 * editStatedObjective, but a failure comes back as a result instead of a thrown error: a server
 * action's thrown message is withheld in production builds, and an unhandled throw from the
 * list's transition replaced the page and discarded the researcher's open draft. Returning it
 * lets the list keep the draft open and show the actual reason (a database failure, or a
 * conflict with a change made since the editor opened, GT500-F03).
 */
export async function saveStatedObjectiveEdit(
  runId: string,
  oldText: string,
  newText: string | null,
): Promise<{ ok: true } | { ok: false; error: string; conflict: boolean }> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    await editStatedObjective(runId, oldText, newText);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), conflict: error instanceof ObjectiveEditConflict };
  }
}

/** The objective an editor opened is no longer there as it was (GT500-F03). */
class ObjectiveEditConflict extends Error {}

const EDIT_CONFLICT_MESSAGE =
  "This objective was changed or removed after you opened it, so your edit was not saved and nothing was added. Your wording is still in the box: copy it, then Cancel to see the current objective, and edit that.";

/**
 * Edits or removes one stated objective (pass newText = null to remove it).
 * Edits runs.stated_objectives_text, the current mutable list (OBJ-SET-M01) -
 * never runs.initial_research_objective, which is write-once and reserved
 * for objectiveFramer.ts's "researcher's true starting point" read.
 *
 * `oldText` is the wording the editor opened with, and is the edit's expected current state
 * (GT500-F03): the target is the list line with that wording, or a researcher-authored
 * candidate with it (an objective added on Review has a candidate but may have no Setup line).
 * When neither is there any more (another editor changed or removed it) the edit is refused as
 * a conflict. It used to append the new wording instead, so a stale editor silently added a
 * second accepted objective. Adding stays a separate, deliberate action.
 */
export async function editStatedObjective(runId: string, oldText: string, newText: string | null) {
  const TENANT_ID = await requireTenantId();
  // OBJ-SET-M02: only trimming here, instead of running the replacement through the same
  // normalizeObjectiveLine stripping parseObjectiveLines applies on every read, let a
  // bulleted/numbered edit ("- B", "1. B") get stored as typed while display (which always
  // re-parses through parseObjectiveLines) showed it already stripped ("B") - so a next edit
  // of what the researcher actually SEES never matched the raw, unstripped text actually on
  // file, in either stated_objectives_text or the synced objective_candidates row, and
  // silently inserted a second candidate instead of updating the one already there.
  const next = newText ? normalizeObjectiveLine(newText) || null : null;
  await withTenant(TENANT_ID, async (client) => {
    // stated_objectives_text is a single text column holding every line, recomputed in
    // application code and written back whole. Two concurrent edits (two different lines, or
    // two editors of the same line) each recomputing the whole column from the same starting
    // text used to race (OBJ-SET-002), and the check that the edited objective is still there
    // (below) must see the same state the write replaces. Locking the run row for the whole
    // read-check-write serializes them: the second edit reads the first's result, so an edit
    // of a different line keeps both changes and a second edit of the same line finds its
    // starting wording gone and is refused. The row must exist.
    const r = await client.query<{ stated_objectives_text: string | null }>(
      "select stated_objectives_text from runs where id = $1 for update",
      [runId],
    );
    if (r.rowCount !== 1) throw new Error("This project was not found.");
    const lines = parseObjectiveLines(r.rows[0].stated_objectives_text ?? null);
    // OBJ-SET-M02: parseObjectiveLines already stripped every line's leading marker, so
    // matching against a bare .trim() of oldText missed it whenever oldText still carried
    // one (any caller other than this module's own already-stripped UI list). Matching on
    // the same normalizeObjectiveLine() every line in `lines` was built from keeps this
    // lookup correct regardless of what form oldText arrives in.
    const normalizedOldText = normalizeObjectiveLine(oldText);
    const idx = lines.indexOf(normalizedOldText);

    // OBJ-SET-001/M02: `trim(candidate_text) = $N` only ever found a row saved with the
    // exact same whitespace-trimmed text. A candidate accepted on Review with its bullet or
    // number still attached ("- B", not the stripped "B" this module always works with) was
    // therefore invisible to this match, so an edit made here added a second, divergent
    // candidate instead of updating the one Review had already created. Comparing both sides
    // through normalizeObjectiveLine finds that row regardless of which marker it carries.
    const existingCandidates = await client.query<{ id: string; candidate_text: string }>(
      `select id, candidate_text from objective_candidates where run_id = $1 and source = 'researcher_authored' for update`,
      [runId],
    );
    const matchingIds = existingCandidates.rows
      .filter((row) => normalizeObjectiveLine(row.candidate_text) === normalizedOldText)
      .map((row) => row.id);
    if (idx < 0 && matchingIds.length === 0) throw new ObjectiveEditConflict(EDIT_CONFLICT_MESSAGE);

    if (idx >= 0) {
      if (next) lines[idx] = next;
      else lines.splice(idx, 1);
    } else if (next) {
      // A Review-added objective being edited from Setup for the first time: its wording joins
      // the Setup list here, the same as it always did.
      lines.push(next);
    }
    await client.query("update runs set stated_objectives_text = $1, updated_at = now() where id = $2", [
      lines.length > 0 ? lines.join("\n") : null,
      runId,
    ]);

    if (next) {
      if (matchingIds.length > 0) {
        await client.query(`update objective_candidates set candidate_text = $1, edited = true where id = any($2)`, [
          next,
          matchingIds,
        ]);
      } else {
        // A Setup line with no candidate row yet (a list saved before candidates were kept for
        // Setup lines): the line itself was edited in place above, and this gives it its row.
        await client.query(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, 'Written or imported at project set-up.', 'researcher_authored', 'accepted')`,
          [TENANT_ID, runId, next],
        );
      }
    } else if (matchingIds.length > 0) {
      await client.query(`delete from objective_candidates where id = any($1)`, [matchingIds]);
    }
    await syncResearchObjective(client, runId);
  });
  // Scored straight away (Grant, 2026-10-21: automate where possible). An unchanged list makes
  // no model call; a failure is recorded and shown on Review, never blocks the save.
  await refreshObjectiveQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}
