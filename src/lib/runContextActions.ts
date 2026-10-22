"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { readContextDocument } from "./extractFindings";
import { extractBriefFields } from "./briefIntake";
import { syncResearchObjective } from "./runSync";
import { parseObjectiveLines, normalizeObjectiveLine, objectiveIdentityKey } from "./objectiveLines";
import { refreshObjectiveQuality } from "./objectiveQualityScorer";
import { requireTenantId } from "./requestContext";
import { loadFailedBriefFill, type FailedBriefFill } from "./briefFillRecord";
import { rereadRationale } from "./briefFillText";
import type { PoolClient } from "pg";


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
    | {
        status: "filled";
        objectivesAdded: number;
        filledBusinessProblem: boolean;
        /** A deliberate re-read (Read it again): its new lines were added as pending suggestions. */
        reread: boolean;
        suggestionsAdded: number;
      }

    | {
        status: "failed";
        /** "the proposal X.docx", or "the chosen document" when even its name could not be read. */
        documents: string;
        reason: string;
        /** False when the failure could not be recorded either, so a reload will not show it. */
        recorded: boolean;
        briefDocumentId: string | null;
        proposalDocumentId: string | null;
        /** The failed attempt was Read it again, so its retry reads again too. */
        reread: boolean;
      };
  /**
   * The project's unresolved failed fill as stored after this save (loadFailedBriefFill), read
   * whatever the save did (R500-01): a save with no document leaves an earlier failure unresolved,
   * so the form keeps showing it and its retry, as a reload does; only a successful fill resolves
   * it. `{ error }` when it could not be read, never null.
   */
  unresolvedFailure: FailedBriefFill | null | { error: string };
  /**
   * Chosen document(s) that already filled this project (Grant, 2026-10-22): not read again and
   * nothing added from them, because a fresh read re-words the same objectives and the exact
   * identity check cannot tell. Read it again re-reads them on request and only suggests. Beside
   * `fill` when another chosen document was new and read.
   */
  already: AlreadyFilled | null;
};

export type AlreadyFilled = {
  documents: string;
  /** When it first filled this project. */
  at: string;
  /** Objectives the earlier fill(s) from it added. */
  objectivesFromIt: number;
  briefDocumentId: string | null;
  proposalDocumentId: string | null;
};

/** "the brief A.docx and the proposal B.docx" for a message; ids whose name is unknown are "the chosen document". */
function documentsLabel(brief: { filename: string | null } | null, proposal: { filename: string | null } | null): string {
  const one = (kind: string, d: { filename: string | null } | null) => (d ? (d.filename ? `the ${kind} ${d.filename}` : "the chosen document") : null);
  return [one("brief", brief), one("proposal", proposal)].filter(Boolean).join(" and ") || "the chosen document";
}

type PriorFill = { at: string; objectivesAdded: number };

/**
 * Successful earlier fills of this project that used each of `documentIds` (Grant, 2026-10-22). A
 * document counts as used when a 'brief_intake_used' row names it, or names another document of
 * this project with the same content (documents.content_sha256, where that column exists and was
 * recorded). A row for a document deleted since cannot be matched by content, so re-importing a
 * deleted proposal fills normally (the identity and lineage checks still apply).
 */
async function priorFillsOf(client: PoolClient, runId: string, documentIds: string[]): Promise<Map<string, PriorFill[]>> {
  const out = new Map<string, PriorFill[]>();
  if (documentIds.length === 0) return out;
  const byId = `t.detail->>'briefDocumentId' = c.id::text or t.detail->>'proposalDocumentId' = c.id::text`;
  const sql = (withContent: boolean) => `
    with c as (select id${withContent ? ", content_sha256" : ""} from documents where run_id = $1 and id = any($2::uuid[]))
    select c.id::text as chosen, t.occurred_at, t.detail
      from c join trace t on t.run_id = $1 and t.event = 'brief_intake_used'
       and (${byId}${withContent ? `
            or (c.content_sha256 is not null and exists (
                  select 1 from documents d where d.run_id = $1 and d.content_sha256 = c.content_sha256
                     and (d.id::text = t.detail->>'briefDocumentId' or d.id::text = t.detail->>'proposalDocumentId')))` : ""})
     order by t.occurred_at, t.id`;
  await client.query("savepoint prior_fills");
  let rows: { chosen: string; occurred_at: Date | string; detail: { objectivesAdded?: unknown; reread?: unknown } }[];
  try {
    rows = (await client.query(sql(true), [runId, documentIds])).rows;
    await client.query("release savepoint prior_fills");
  } catch (error) {
    // Before the migration that added content_sha256: match by document id only.
    if ((error as { code?: string }).code !== "42703") throw error;
    await client.query("rollback to savepoint prior_fills");
    rows = (await client.query(sql(false), [runId, documentIds])).rows;
  }
  for (const r of rows) {
    const list = out.get(r.chosen) ?? [];
    list.push({
      at: new Date(r.occurred_at).toISOString(),
      // A re-read adds suggestions, not objectives, so it does not count towards "came from it".
      objectivesAdded: r.detail?.reread === true ? 0 : typeof r.detail?.objectivesAdded === "number" ? r.detail.objectivesAdded : 0,
    });
    out.set(r.chosen, list);
  }
  return out;
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
  const chosenBriefId = clean("briefDocumentId");
  const chosenProposalId = clean("proposalDocumentId");
  // Read it again (Grant, 2026-10-22): re-read documents that already filled this project, adding
  // only new lines, as pending suggestions. Without it a used document is not read again.
  const reread = formData.get("rereadDocuments") === "1";
  const typedBusinessProblem = businessProblem;
  const typedObjective = objective;
  let alreadyFill: AlreadyFilled | null = null;
  let briefId = chosenBriefId;
  let proposalId = chosenProposalId;
  if (!reread && (chosenBriefId || chosenProposalId)) {
    const chosen = [chosenBriefId, chosenProposalId].filter((v): v is string => !!v);
    const prior = await withTenant(TENANT_ID, async (client) => {
      const names = await client.query<{ id: string; source_filename: string }>(
        "select id::text, source_filename from documents where run_id = $1 and tenant_id = $2 and id = any($3::uuid[])",
        [runId, TENANT_ID, chosen],
      );
      return { fills: await priorFillsOf(client, runId, chosen), names: new Map(names.rows.map((n) => [n.id, n.source_filename])) };
    });
    const usedBrief = chosenBriefId ? prior.fills.get(chosenBriefId) ?? null : null;
    const usedProposal = chosenProposalId ? prior.fills.get(chosenProposalId) ?? null : null;
    // A used document is dropped from this fill; one not used yet is still read.
    if (usedBrief) briefId = null;
    if (usedProposal) proposalId = null;
    if (usedBrief || usedProposal) {
      const used = [...(usedBrief ?? []), ...(usedProposal ?? [])];
      alreadyFill = {
        documents: documentsLabel(
          usedBrief && chosenBriefId ? { filename: prior.names.get(chosenBriefId) ?? null } : null,
          usedProposal && chosenProposalId ? { filename: prior.names.get(chosenProposalId) ?? null } : null,
        ),
        at: used.map((u) => u.at).sort()[0],
        objectivesFromIt: used.reduce((n, u) => n + u.objectivesAdded, 0),
        briefDocumentId: usedBrief ? chosenBriefId : null,
        proposalDocumentId: usedProposal ? chosenProposalId : null,
      };
    }
  }
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
        reread,
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
        reread,
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
    // whatever its source or status, so a brief whose objectives Review already holds or the
    // researcher rejected adds nothing. The key is exact after normalisation, so it cannot catch a
    // re-worded repeat; that is why a document that already filled the project is not read again
    // (priorFillsOf, above) and Read it again only suggests (below).
    //
    // Import lineage (GT500-F01): comparing with current wording alone let a reread bring back an
    // imported objective the researcher had since reworded or deleted. Every successful fill records
    // the identity keys of all the objectives it read from its documents ('brief_intake_used',
    // extractedKeys), and a line read from a document whose key any earlier fill of this project
    // already read is not added again, whatever has happened to the objective since: edited,
    // rejected or deleted, those are the researcher's decisions. Lines the researcher types are not
    // checked against this lineage; typing a line in again is a deliberate add. Fills recorded
    // before extractedKeys existed have no lineage, so only the current-wording check covers them
    // (and the already-used document rule, which reads the same fill records).
    const prevLines = parseObjectiveLines(prevObjective);
    const candidateRows = await client.query<{ candidate_text: string }>(
      "select candidate_text from objective_candidates where run_id = $1",
      [runId],
    );
    const known = new Set([...prevLines, ...candidateRows.rows.map((r) => r.candidate_text)].map(objectiveIdentityKey));
    // A fill of the same document that finished while this one was reading it (two saves at once)
    // has filled the project already: this one adds nothing from it, as if it had been chosen after.
    let concurrentAlready: AlreadyFilled | null = null;
    if (fill && !reread) {
      const readIds = [fill.brief?.id, fill.proposal?.id].filter((v): v is string => !!v);
      const prior = await priorFillsOf(client, runId, readIds);
      if (readIds.some((id) => prior.has(id))) {
        const used = readIds.flatMap((id) => prior.get(id) ?? []);
        concurrentAlready = {
          documents: documentsLabel(fill.brief && prior.has(fill.brief.id) ? fill.brief : null, fill.proposal && prior.has(fill.proposal.id) ? fill.proposal : null),
          at: used.map((u) => u.at).sort()[0],
          objectivesFromIt: used.reduce((n, u) => n + u.objectivesAdded, 0),
          briefDocumentId: fill.brief && prior.has(fill.brief.id) ? fill.brief.id : null,
          proposalDocumentId: fill.proposal && prior.has(fill.proposal.id) ? fill.proposal.id : null,
        };
        fill = null;
        businessProblem = typedBusinessProblem;
        objective = typedObjective;
      }
    }
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
    // A deliberate re-read (Read it again) puts its new document lines on Review as pending
    // suggestions, not in the stated list: the researcher accepts, edits or rejects each one.
    const suggestionLines = fromDocument && reread ? newLines.splice(0) : [];
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
    const suggestionRationale = rereadRationale(fill?.brief?.filename ?? null, fill?.proposal?.filename ?? null);
    for (const line of suggestionLines) {
      // New to the project by objectiveIdentityKey and lineage (above); likely restatements of an
      // existing objective are shown beside it on Review (objectiveSimilarity.ts), never merged.
      const inserted = await client.query<{ id: string }>(
        `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
         values ($1, $2, $3, $4, 'researcher_authored', 'pending') returning id`,
        [TENANT_ID, runId, line, suggestionRationale],
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
          reread,
          suggestionsAdded: suggestionLines.length,
          importedBefore,
          extractedKeys,
          addedCandidateIds: fromDocument ? addedIds : [],
        }),
      ]);
    }
    await syncResearchObjective(client, runId);
    return { alreadyInProject, importedBefore, added: newLines.length, suggested: suggestionLines.length, concurrentAlready };
  });

  // Objectives are scored straight away (Grant, 2026-10-21: automate where possible), so this save
  // can call the model. An unchanged list makes no model call; a scoring failure is recorded and
  // shown on Review, never blocks the save.
  await refreshObjectiveQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
  const unresolvedFailure = await loadFailedBriefFill(TENANT_ID, runId);
  return {
    ok: true,
    unresolvedFailure,
    alreadyInProject: counts.alreadyInProject,
    importedBefore: counts.importedBefore,
    already: alreadyFill ?? counts.concurrentAlready,
    fill:
      failedFill ??
      (fill
        ? {
            status: "filled",
            objectivesAdded: fill.objectivesFromDocument ? counts.added : 0,
            filledBusinessProblem: fill.filledBusinessProblem,
            reread,
            suggestionsAdded: counts.suggested,
          }
        : null),
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
  target: StatedObjectiveTarget,
): Promise<{ ok: true } | { ok: false; error: string; conflict: boolean }> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    await editStatedObjective(runId, oldText, newText, target);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), conflict: error instanceof ObjectiveEditConflict };
  }
}

/** The objective an editor opened is no longer there as it was (GT500-F03, R500-02). */
class ObjectiveEditConflict extends Error {}

/**
 * The record a Setup editor was opened on (R500-02): the candidate id the page gave its line
 * (setupLineCandidateIds), or null for a Setup-only line that had no candidate.
 */
export type StatedObjectiveTarget = { candidateId: string | null };

const EDIT_CONFLICT_MESSAGE =
  "This objective was changed or removed after you opened it, so your edit was not saved and nothing was added. Your wording is still in the box: copy it, then Cancel to see the current objective, and edit that.";

/**
 * Edits or removes one stated objective (pass newText = null to remove it).
 * Edits runs.stated_objectives_text, the current mutable list (OBJ-SET-M01) -
 * never runs.initial_research_objective, which is write-once and reserved
 * for objectiveFramer.ts's "researcher's true starting point" read.
 *
 * The edit is bound to the record the editor was opened on (R500-02), with `oldText`, the wording
 * it opened with, as that record's expected state (GT500-F03):
 * - `target.candidateId` set: that researcher-authored candidate must still exist with that
 *   wording (compared marker-stripped). Only it is edited or removed. Deleted, or changed since,
 *   is a conflict, even when another candidate now has the same wording: a candidate deleted and
 *   then deliberately added again is a different record, and an editor opened on the first never
 *   touches the second.
 * - `target.candidateId` null (compatibility, a Setup-only line saved before candidates were
 *   kept for Setup lines): the Setup line with that wording must still be there and no
 *   researcher-authored candidate may have that wording (one created since means the line is no
 *   longer the candidate-less line the editor opened on). The line is edited in place and gets
 *   its candidate.
 * A conflict writes nothing. A stale editor used to append its wording, or edit whichever record
 * currently had the old wording. Adding stays a separate, deliberate action.
 */
export async function editStatedObjective(runId: string, oldText: string, newText: string | null, target: StatedObjectiveTarget) {
  // Validated at the action boundary: the id comes from the client. A caller that sends no target
  // takes the strict candidate-less path below, so it can never edit a record by wording alone.
  const targetId = target?.candidateId ?? null;
  if (targetId !== null && (typeof targetId !== "string" || !/^[0-9a-f-]{36}$/i.test(targetId))) {
    throw new ObjectiveEditConflict(EDIT_CONFLICT_MESSAGE);
  }
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

    // The expected wording is compared marker-stripped on both sides (OBJ-SET-001/M02): a
    // candidate accepted on Review with its bullet or number still attached ("- B") is the same
    // wording as the stripped Setup line "B". The record itself is chosen by id, never by wording
    // (R500-02).
    const existingCandidates = await client.query<{ id: string; candidate_text: string }>(
      `select id, candidate_text from objective_candidates where run_id = $1 and source = 'researcher_authored' for update`,
      [runId],
    );
    const sameWording = (row: { candidate_text: string }) => normalizeObjectiveLine(row.candidate_text) === normalizedOldText;
    if (targetId) {
      const opened = existingCandidates.rows.find((row) => row.id === targetId);
      if (!opened || !sameWording(opened)) throw new ObjectiveEditConflict(EDIT_CONFLICT_MESSAGE);
    } else if (idx < 0 || existingCandidates.rows.some(sameWording)) {
      throw new ObjectiveEditConflict(EDIT_CONFLICT_MESSAGE);
    }

    if (idx >= 0) {
      if (next) lines[idx] = next;
      else lines.splice(idx, 1);
    } else if (next) {
      // The candidate the editor was opened on has no Setup line (added on Review): its wording
      // joins the Setup list here, the same as it always did.
      lines.push(next);
    }
    await client.query("update runs set stated_objectives_text = $1, updated_at = now() where id = $2", [
      lines.length > 0 ? lines.join("\n") : null,
      runId,
    ]);

    if (next) {
      if (targetId) {
        await client.query(`update objective_candidates set candidate_text = $1, edited = true where id = $2 and run_id = $3`, [
          next,
          targetId,
          runId,
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
    } else if (targetId) {
      await client.query(`delete from objective_candidates where id = $1 and run_id = $2`, [targetId, runId]);
    }
    await syncResearchObjective(client, runId);
  });
  // Scored straight away (Grant, 2026-10-21: automate where possible). An unchanged list makes
  // no model call; a failure is recorded and shown on Review, never blocks the save.
  await refreshObjectiveQuality(TENANT_ID, runId);
  revalidatePath(`/runs/${runId}`);
}
