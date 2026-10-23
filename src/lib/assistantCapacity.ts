import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { claimPool } from "./db";

// How many assistant answers run at once (Codex B7-F01, B8-F01, RR-F08): every answer, in a
// project or outside one, with or without a request id, first takes a slot from the claim pool
// (db.ts claimPool), and nothing runs before it has one.

/**
 * How long a send waits for another send of the same request to finish before saying it is still
 * running: 5 minutes, or ASSISTANT_REQUEST_WAIT_MS (milliseconds) when set, e.g. for a host whose
 * server actions time out sooner.
 */
export function requestClaimWaitMs(): number {
  const fromEnv = Number(process.env.ASSISTANT_REQUEST_WAIT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 5 * 60 * 1000;
}

/** A send of a request another send is still answering, after requestClaimWaitMs(). Nothing was run or stored by it. */
export class RequestInProgressError extends Error {
  constructor() {
    super("This question is still being answered from an earlier send. Its answer will appear in the conversation when it is ready; there is no need to send it again.");
    this.name = "RequestInProgressError";
  }
}

/** No answer could start before the wait ran out: as many as allowed were running (db.ts claimPool). Nothing was run or stored. */
export class AssistantBusyError extends Error {
  constructor() {
    super("The assistant is answering as many questions as it can at once. Nothing was sent to it; try again in a moment.");
    this.name = "AssistantBusyError";
  }
}

/**
 * Runs `answer` while holding a Postgres session advisory lock for the request (on one connection
 * of the claim pool, db.ts claimPool, kept for the duration, outside any transaction, so no
 * transaction stays open while the model works). A second send of the same request waits, trying again every 250 ms, up to
 * requestClaimWaitMs(). The lock is released when `answer` finishes or fails, and by Postgres if
 * the connection or server process dies. Guarantee: within one database, two sends of one request
 * never run the model or tools at the same time, and a later send sees the earlier one's stored
 * answer. A send that fails part way (or a server process that dies mid-answer) leaves no stored
 * answer, so a later send of the request runs again; it does not repeat that send's work: a report
 * revision is applied only in the transaction that stores the answer, and a table already built for
 * the request with the same table request is reused (researchAssistantTools.ts). What such a send
 * leaves behind is at most draft tables, which the retry reuses.
 */
export async function withRequestClaim<T>(runId: string, requestId: string, answer: () => Promise<T>): Promise<T> {
  return claimed(`assistant-request:${runId}:${requestId}`, answer);
}

/**
 * A slot for an answer with no request to replay (a project send without an id, the assistant
 * outside a project): the same wait and busy refusal as a keyed send, under a key no other send
 * shares, so it only ever waits for capacity.
 */
export async function withAnswerCapacity<T>(scope: string, answer: () => Promise<T>): Promise<T> {
  return claimed(`${scope}:unkeyed:${randomUUID()}`, answer);
}

async function claimed<T>(key: string, answer: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + requestClaimWaitMs();
  // Claims come from their own pool (db.ts claimPool), so a holder's work never waits on a
  // connection another holder is keeping. A waiting send borrows a claim connection only per try.
  let holder: PoolClient | null = null;
  let busy = false;
  for (;;) {
    let client: PoolClient | null = null;
    try {
      client = await claimPool.connect();
    } catch {
      // No claim connection free within connectionTimeoutMillis: as many answers as allowed are running.
      busy = true;
    }
    if (client) {
      busy = false;
      let ok = false;
      try {
        ok = Boolean((await client.query<{ ok: boolean }>("select pg_try_advisory_lock(hashtextextended($1, 0)) as ok", [key])).rows[0]?.ok);
      } catch (error) {
        client.release(true);
        throw error;
      }
      if (ok) {
        holder = client;
        break;
      }
      client.release();
    }
    if (Date.now() >= deadline) throw busy ? new AssistantBusyError() : new RequestInProgressError();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    return await answer();
  } finally {
    // If the unlock itself fails, the connection is destroyed rather than returned with the lock.
    const unlocked = await holder.query("select pg_advisory_unlock(hashtextextended($1, 0))", [key]).then(() => true, () => false);
    holder.release(!unlocked);
  }
}

