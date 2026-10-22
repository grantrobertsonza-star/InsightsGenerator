// The one runtime contract for a driver analysis request (GT1000-F02, Codex 2026-10-21). TypeScript
// types are erased at the server-action boundary, so a crafted or corrupted request (an outcome
// type the engine does not support, a bootstrap of "disabled") used to reach the calculation and
// come back as a successful report whose method, wording or uncertainty did not match what was
// asked. Every server entry point that runs, saves or reports a driver request parses it here
// first and refuses anything else before any calculation or write. Client memory parsing
// (analyticsWorkspaceMemory) can reuse the same parser so the two cannot disagree.
//
// Variable identity: variables are canonical data-file column names. This contract checks their
// shape (non-empty, distinct, the outcome not also a predictor, no role used twice); whether each
// exists in the file is decided by the engine's read of exactly these columns, which refuses an
// unknown column with an error rather than skipping it.

import type { DriverRequest } from "./drivers";

/**
 * Bootstrap policy. Omitted: DEFAULT_BOOTSTRAP resamples. Otherwise an integer: 0 means "no
 * bootstrap ranges" (deliberate, and the report says so), or MIN_BOOTSTRAP..MAX_BOOTSTRAP. The
 * engine draws no intervals below 20 resamples, so 1 to 19 would silently give none: refused, as
 * are negatives, fractions, non-numbers and anything above the cap. A binary outcome analysed by
 * exact Shapley shares is further capped by the engine at BINARY_SHAPLEY_BOOTSTRAP_CAP for speed;
 * the report notes when that happened.
 */
export const DEFAULT_BOOTSTRAP = 200;
export const MIN_BOOTSTRAP = 20;
export const MAX_BOOTSTRAP = 300;
export const BINARY_SHAPLEY_BOOTSTRAP_CAP = 60;
/** More predictors than this cannot be read or modelled sensibly in one request. */
export const MAX_PREDICTORS = 500;

export type DriverRequestCheck = { ok: true; request: DriverRequest } | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const name = (v: unknown): v is string => typeof v === "string" && v.trim() !== "" && v.length <= 512;

function optionalName(v: unknown, what: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  if (!name(v)) return { ok: false, error: `The ${what} must be a variable name.` };
  return { ok: true, value: v };
}

/** Parses a driver request from untrusted input. Never coerces: an invalid value is refused with the reason. */
export function parseDriverRequest(raw: unknown): DriverRequestCheck {
  const fail = (error: string): DriverRequestCheck => ({ ok: false, error: `This driver analysis request cannot be run: ${error}` });
  if (!isObj(raw)) return fail("it is not a request.");
  if (!name(raw.outcome)) return fail("choose an outcome variable.");
  if (raw.outcomeType !== "continuous" && raw.outcomeType !== "binary") {
    return fail(`the outcome type must be "continuous" or "binary" (got ${JSON.stringify(raw.outcomeType ?? null)}).`);
  }
  if (!Array.isArray(raw.predictors) || !raw.predictors.every(name)) return fail("the predictors must be a list of variable names.");
  const predictors = raw.predictors as string[];
  if (predictors.length < 2) return fail("choose at least two predictors.");
  if (predictors.length > MAX_PREDICTORS) return fail(`choose at most ${MAX_PREDICTORS} predictors.`);
  if (new Set(predictors).size !== predictors.length) return fail("a predictor is listed twice.");
  if (predictors.includes(raw.outcome)) return fail("the outcome cannot also be a predictor.");

  let topBoxMin: number | null = null;
  if (raw.topBoxMin !== undefined && raw.topBoxMin !== null) {
    if (raw.outcomeType !== "binary") return fail("a top box only applies to a binary outcome.");
    if (typeof raw.topBoxMin !== "number" || !Number.isFinite(raw.topBoxMin)) return fail("the top box must be a number.");
    topBoxMin = raw.topBoxMin;
  }

  const weight = optionalName(raw.weightVar, "weight");
  if (!weight.ok) return fail(weight.error.replace(/^The /, "the "));
  const group = optionalName(raw.groupVar, "group variable");
  if (!group.ok) return fail(group.error.replace(/^The /, "the "));
  const roles = [raw.outcome, ...predictors];
  if (weight.value && roles.includes(weight.value)) return fail("the weight cannot also be the outcome or a predictor.");
  if (group.value && (roles.includes(group.value) || group.value === weight.value)) {
    return fail("the group variable cannot also be the outcome, a predictor or the weight.");
  }

  let statedImportance: Record<string, string> = {};
  if (raw.statedImportance !== undefined && raw.statedImportance !== null) {
    if (!isObj(raw.statedImportance)) return fail("stated importance must pair predictors with questions.");
    for (const [predictor, question] of Object.entries(raw.statedImportance)) {
      if (!predictors.includes(predictor)) return fail(`stated importance names ${JSON.stringify(predictor)}, which is not a predictor.`);
      if (!name(question)) return fail(`the stated importance question for ${predictor} must be a variable name.`);
    }
    statedImportance = raw.statedImportance as Record<string, string>;
  }

  const request: DriverRequest = {
    outcome: raw.outcome,
    outcomeType: raw.outcomeType,
    topBoxMin,
    predictors: [...predictors],
    weightVar: weight.value,
    statedImportance,
    groupVar: group.value,
  };
  if (raw.bootstrap !== undefined) {
    const b = raw.bootstrap;
    if (typeof b !== "number" || !Number.isInteger(b)) return fail(`the number of bootstrap resamples must be a whole number (got ${JSON.stringify(b)}).`);
    if (b !== 0 && (b < MIN_BOOTSTRAP || b > MAX_BOOTSTRAP)) {
      return fail(`the number of bootstrap resamples must be 0 (no ranges) or from ${MIN_BOOTSTRAP} to ${MAX_BOOTSTRAP} (got ${b}).`);
    }
    request.bootstrap = b;
  }
  return { ok: true, request };
}

/** The data-file variables a driver request reads: what a correction to the file can change. */
export function driverRequestVariables(request: DriverRequest): string[] {
  return Array.from(
    new Set([
      request.outcome,
      ...request.predictors,
      ...(request.weightVar ? [request.weightVar] : []),
      ...(request.groupVar ? [request.groupVar] : []),
      ...Object.values(request.statedImportance ?? {}),
    ]),
  );
}
