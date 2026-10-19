"use server";

import { revalidatePath } from "next/cache";
import { withTenant } from "./db";
import { readContextDocument } from "./extractFindings";
import { extractBriefFields } from "./briefIntake";
import { syncResearchObjective } from "./runSync";
import { parseObjectiveLines, normalizeObjectiveLine } from "./objectiveLines";
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
export async function saveRunContext(runId: string, formData: FormData) {
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
  // ordinary save never calls the model.
  const briefId = clean("briefDocumentId");
  const proposalId = clean("proposalDocumentId");

  if (briefId || proposalId) {
    try {
      const textOf = async (documentId: string): Promise<string> => {
        const read = async () =>
          withTenant(TENANT_ID, async (client) => {
            const r = await client.query<{ extracted_text: string | null }>(
              "select extracted_text from documents where id = $1 and run_id = $2 and tenant_id = $3",
              [documentId, runId, TENANT_ID],
            );
            if (r.rowCount !== 1) throw new Error("That document is not in this project.");
            return r.rows[0].extracted_text;
          });
        // A document whose text was never read (an old upload) is read now, the same way Import does.
        const text = (await read()) ?? (await readContextDocument(TENANT_ID, runId, documentId), await read());
        return text ?? "";
      };
      const [briefText, proposalText] = await Promise.all([briefId ? textOf(briefId) : Promise.resolve(null), proposalId ? textOf(proposalId) : Promise.resolve(null)]);
      const extracted = await extractBriefFields(TENANT_ID, runId, { briefText, proposalText });
      businessProblem = businessProblem ?? extracted.businessProblem;
      objective = objective ?? extracted.researchObjective;
    } catch (error) {
      // An unreadable brief must not block saving what was typed.
      await withTenant(TENANT_ID, async (client) => {
        await client.query(
          `insert into trace (tenant_id, run_id, event, detail) values ($1, $2, 'brief_intake_error', $3)`,
          [TENANT_ID, runId, JSON.stringify({ message: error instanceof Error ? error.message : String(error) })],
        );
      }).catch(() => {});
    }
  }

  await withTenant(TENANT_ID, async (client) => {
    const prev = await client.query<{ stated_objectives_text: string | null }>(
      "select stated_objectives_text from runs where id = $1",
      [runId],
    );
    const prevObjective = prev.rows[0]?.stated_objectives_text?.trim() ?? null;

    // The objective box only adds. Saved objectives live in the list beside
    // the form, where they are edited or deleted one by one.
    const prevLines = parseObjectiveLines(prevObjective);
    const newLines = parseObjectiveLines(objective).filter((l) => !prevLines.includes(l));
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

    for (const line of newLines) {
      const exists = await client.query(
        "select 1 from objective_candidates where run_id = $1 and trim(candidate_text) = $2",
        [runId, line],
      );
      if (exists.rows.length === 0) {
        await client.query(
          `insert into objective_candidates (tenant_id, run_id, candidate_text, rationale, source, status)
           values ($1, $2, $3, 'Written or imported at project set-up.', 'researcher_authored', 'accepted')`,
          [TENANT_ID, runId, line],
        );
      }
    }
    await syncResearchObjective(client, runId);
  });

  // Setup only records objectives. Scoring and checking against the insights
  // happen later, in Objective review, once there is data to judge them by.
  revalidatePath(`/runs/${runId}`);
}

/**
 * The Setup list's entry point for editing or removing a stated objective. Same work as
 * editStatedObjective, but a failure comes back as a result instead of a thrown error: a server
 * action's thrown message is withheld in production builds, and an unhandled throw from the
 * list's transition replaced the page and discarded the researcher's open draft. Returning it
 * lets the list keep the draft open and show the actual reason (a database failure, or the
 * repeated-conflict message below).
 */
export async function saveStatedObjectiveEdit(
  runId: string,
  oldText: string,
  newText: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  // G6: checked here as well as in the delegated action, so this entry point never relies on a callee.
  await requireTenantId();
  try {
    await editStatedObjective(runId, oldText, newText);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Edits or removes one stated objective (pass newText = null to remove it).
 * Edits runs.stated_objectives_text, the current mutable list (OBJ-SET-M01) -
 * never runs.initial_research_objective, which is write-once and reserved
 * for objectiveFramer.ts's "researcher's true starting point" read.
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
    // application code from a fresh read and written back whole - there is no per-line
    // row to update in place. Two concurrent edits (two different lines, say) that each
    // read the same starting text and each write back their own recomputed version of
    // the WHOLE column race: whichever UPDATE commits last overwrites the other's change
    // with no trace it ever happened (OBJ-SET-002: "concurrent independent edits lose one
    // change"). Making the write conditional on the column still holding exactly what was
    // just read - an optimistic-concurrency compare-and-swap, since there is no separate
    // version column to check instead - and retrying the whole read-recompute-write cycle
    // on a lost race (bounded, so a genuinely stuck case fails loudly rather than looping
    // forever) is what stops the second writer from silently discarding the first's edit.
    let newLines: string[] | null = null;
    const MAX_ATTEMPTS = 5;
    let attempt = 0;
    for (; attempt < MAX_ATTEMPTS; attempt++) {
      const r = await client.query<{ stated_objectives_text: string | null }>(
        "select stated_objectives_text from runs where id = $1",
        [runId],
      );
      const before = r.rows[0]?.stated_objectives_text ?? null;
      const lines = parseObjectiveLines(before);
      // OBJ-SET-M02: parseObjectiveLines already stripped every line's leading marker, so
      // matching against a bare .trim() of oldText missed it whenever oldText still carried
      // one (any caller other than this module's own already-stripped UI list). Matching on
      // the same normalizeObjectiveLine() every line in `lines` was built from keeps this
      // lookup correct regardless of what form oldText arrives in.
      const idx = lines.indexOf(normalizeObjectiveLine(oldText));
      if (idx >= 0) {
        if (next) lines[idx] = next;
        else lines.splice(idx, 1);
      } else if (next) {
        lines.push(next);
      }
      const after = lines.length > 0 ? lines.join("\n") : null;
      const result = await client.query(
        "update runs set stated_objectives_text = $1, updated_at = now() where id = $2 and stated_objectives_text is not distinct from $3",
        [after, runId, before],
      );
      if ((result.rowCount ?? 0) > 0) {
        newLines = lines;
        break;
      }
      // Someone else's edit landed between the select and this update; loop back and
      // redo the read-recompute-write against the now-current text rather than
      // overwriting it.
    }
    if (newLines === null) {
      throw new Error("Could not save this edit: it kept conflicting with another change in progress. Try again.");
    }

    // OBJ-SET-001/M02: `trim(candidate_text) = $N` only ever found a row saved with the
    // exact same whitespace-trimmed text. A candidate accepted on Review with its bullet or
    // number still attached ("- B", not the stripped "B" this module always works with) was
    // therefore invisible to this match, so an edit made here added a second, divergent
    // candidate instead of updating the one Review had already created - the two modules'
    // views of "the same objective" could permanently diverge. Comparing both sides through
    // normalizeObjectiveLine (the same stripping every line in `lines` above already went
    // through) finds that row regardless of which marker, if any, it still carries, and
    // doing the comparison in application code sidesteps needing a second, SQL-side copy of
    // the same stripping rule to keep in sync with objectiveLines.ts by hand.
    const normalizedOldText = normalizeObjectiveLine(oldText);
    const existingCandidates = await client.query<{ id: string; candidate_text: string }>(
      `select id, candidate_text from objective_candidates where run_id = $1 and source = 'researcher_authored'`,
      [runId],
    );
    const matchingIds = existingCandidates.rows
      .filter((row) => normalizeObjectiveLine(row.candidate_text) === normalizedOldText)
      .map((row) => row.id);
    if (next) {
      if (matchingIds.length > 0) {
        await client.query(`update objective_candidates set candidate_text = $1, edited = true where id = any($2)`, [
          next,
          matchingIds,
        ]);
      } else {
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
  revalidatePath(`/runs/${runId}`);
}
