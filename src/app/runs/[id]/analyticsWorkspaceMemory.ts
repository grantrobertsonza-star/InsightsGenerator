// What the Analytics workspace remembers between visits (Grant, 2026-10-21: "When I do a driver
// or NPS or other analysis and go out and come back in it is gone").
//
// The memory holds requests and saved-analysis ids only, never figures. On reopening, charts,
// scatter plots, NPS and unsaved driver results are worked out again from the current file, and a
// saved driver analysis is read again from the server by its id, so nothing shown after a return
// can be older than the file it describes. It is a per-viewer convenience in this browser
// (localStorage), keyed by run and data file: it is not shared, not durable, and can be absent.
// A value that is missing, from another version or malformed is read as "nothing remembered";
// a blocked storage is reported as unavailable so the screen can say results will not be kept.
import type { DriverRequest } from "@/lib/drivers";

/** Bumped when the stored shape changes; a value from another version is ignored, not migrated. */
export const ANALYTICS_MEMORY_VERSION = 1;

/** Bounds how much a corrupted or hand-edited value can make the workspace recompute on opening. */
const MAX_CARDS = 60;

export type ChartVariant = "bar" | "line" | "histogram";

/** A chart card's request, plus the researcher's presentation choices (none of them figures). */
export type RememberedChart = {
  variable: string;
  groupVar: string | null;
  weightVar: string | null;
  variant: ChartVariant;
  /** A title the researcher typed; null keeps the variable's current label. */
  title: string | null;
  /** Series colours; ignored on restore when the recomputed result has a different number of series. */
  colors: string[] | null;
  legendPos: "top" | "bottom";
};

export type RememberedScatter = { x: string; y: string; weightVar: string | null; spread: boolean };

export type RememberedNps = { variable: string; weightVar: string | null; groupVar: string | null };

/**
 * The driver result on screen: a saved analysis by its id (read again from the saved list), or an
 * unsaved one by the request that made it (run again; the engine call is statistics, not a model).
 */
export type RememberedDriver = { kind: "saved"; savedId: string } | { kind: "request"; request: DriverRequest };

/** A card in the shared chart grid; charts and scatter plots tile together, so they share one order. */
export type RememberedCard = ({ kind: "chart" } & RememberedChart) | ({ kind: "scatter" } & RememberedScatter);

export type WorkspaceMemory = {
  /** The chart grid, newest first, as it is shown. */
  cards: RememberedCard[];
  nps: RememberedNps | null;
  driver: RememberedDriver | null;
};

export const EMPTY_WORKSPACE_MEMORY: WorkspaceMemory = { cards: [], nps: null, driver: null };

export function workspaceMemoryKey(runId: string, documentId: string): string {
  return `insights:analytics-workspace:v${ANALYTICS_MEMORY_VERSION}:${runId}:${documentId}`;
}

/** This browser's localStorage, or null when the browser blocks it (reading the property can throw). */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 500;
const optStr = (v: unknown): string | null | undefined => (v === null || v === undefined ? null : isStr(v) ? v : undefined);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parseChart(v: unknown): RememberedChart | null {
  if (!isObj(v) || !isStr(v.variable)) return null;
  const groupVar = optStr(v.groupVar);
  const weightVar = optStr(v.weightVar);
  if (groupVar === undefined || weightVar === undefined) return null;
  if (v.variant !== "bar" && v.variant !== "line" && v.variant !== "histogram") return null;
  const title = typeof v.title === "string" && v.title.length <= 500 ? v.title : null;
  const colors = Array.isArray(v.colors) && v.colors.length <= 64 && v.colors.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c)) ? (v.colors as string[]) : null;
  const legendPos = v.legendPos === "bottom" ? "bottom" : "top";
  return { variable: v.variable, groupVar, weightVar, variant: v.variant, title, colors, legendPos };
}

function parseScatter(v: unknown): RememberedScatter | null {
  if (!isObj(v) || !isStr(v.x) || !isStr(v.y) || v.x === v.y) return null;
  const weightVar = optStr(v.weightVar);
  if (weightVar === undefined) return null;
  return { x: v.x, y: v.y, weightVar, spread: v.spread === true };
}

function parseNps(v: unknown): RememberedNps | null {
  if (!isObj(v) || !isStr(v.variable)) return null;
  const weightVar = optStr(v.weightVar);
  const groupVar = optStr(v.groupVar);
  if (weightVar === undefined || groupVar === undefined) return null;
  return { variable: v.variable, weightVar, groupVar };
}

function parseDriverRequest(v: unknown): DriverRequest | null {
  if (!isObj(v) || !isStr(v.outcome)) return null;
  if (v.outcomeType !== "continuous" && v.outcomeType !== "binary") return null;
  if (!Array.isArray(v.predictors) || v.predictors.length > 500 || !v.predictors.every(isStr)) return null;
  const topBoxMin = v.topBoxMin === null || v.topBoxMin === undefined ? null : typeof v.topBoxMin === "number" && Number.isFinite(v.topBoxMin) ? v.topBoxMin : undefined;
  const weightVar = optStr(v.weightVar);
  const groupVar = optStr(v.groupVar);
  if (topBoxMin === undefined || weightVar === undefined || groupVar === undefined) return null;
  let statedImportance: Record<string, string> = {};
  if (v.statedImportance !== undefined && v.statedImportance !== null) {
    if (!isObj(v.statedImportance) || !Object.values(v.statedImportance).every(isStr)) return null;
    statedImportance = v.statedImportance as Record<string, string>;
  }
  const req: DriverRequest = { outcome: v.outcome, outcomeType: v.outcomeType, topBoxMin, predictors: v.predictors as string[], weightVar, statedImportance, groupVar };
  if (typeof v.bootstrap === "number" && Number.isInteger(v.bootstrap) && v.bootstrap > 0) req.bootstrap = v.bootstrap;
  return req;
}

function parseDriver(v: unknown): RememberedDriver | null {
  if (!isObj(v)) return null;
  if (v.kind === "saved") return isStr(v.savedId) ? { kind: "saved", savedId: v.savedId } : null;
  if (v.kind === "request") {
    const request = parseDriverRequest(v.request);
    return request ? { kind: "request", request } : null;
  }
  return null;
}

function parseCard(v: unknown): RememberedCard | null {
  if (!isObj(v)) return null;
  if (v.kind === "chart") {
    const c = parseChart(v);
    return c ? { kind: "chart", ...c } : null;
  }
  if (v.kind === "scatter") {
    const c = parseScatter(v);
    return c ? { kind: "scatter", ...c } : null;
  }
  return null;
}

/**
 * Reads a stored value. Anything not of this version, or not JSON, is nothing remembered; a single
 * malformed entry is dropped while the well-formed ones are kept.
 */
export function parseWorkspaceMemory(raw: string | null): WorkspaceMemory {
  if (!raw) return EMPTY_WORKSPACE_MEMORY;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return EMPTY_WORKSPACE_MEMORY;
  }
  if (!isObj(v) || v.v !== ANALYTICS_MEMORY_VERSION) return EMPTY_WORKSPACE_MEMORY;
  return {
    cards: Array.isArray(v.cards) ? v.cards.slice(0, MAX_CARDS).map(parseCard).filter((c): c is RememberedCard => c !== null) : [],
    nps: v.nps == null ? null : parseNps(v.nps),
    driver: v.driver == null ? null : parseDriver(v.driver),
  };
}

export function isEmptyWorkspaceMemory(m: WorkspaceMemory): boolean {
  return m.cards.length === 0 && m.nps === null && m.driver === null;
}

/**
 * What is remembered for this run and file. `available` is false when the browser blocks storage,
 * which is not the same as nothing having been remembered.
 */
export function readWorkspaceMemory(
  runId: string,
  documentId: string,
  storage: Storage | null = browserStorage(),
): { available: boolean; memory: WorkspaceMemory } {
  if (!storage) return { available: false, memory: EMPTY_WORKSPACE_MEMORY };
  try {
    return { available: true, memory: parseWorkspaceMemory(storage.getItem(workspaceMemoryKey(runId, documentId))) };
  } catch {
    return { available: false, memory: EMPTY_WORKSPACE_MEMORY };
  }
}

/** Stores the memory (an empty one removes the key). Returns false when the browser refused. */
export function writeWorkspaceMemory(
  runId: string,
  documentId: string,
  memory: WorkspaceMemory,
  storage: Storage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const key = workspaceMemoryKey(runId, documentId);
  try {
    if (isEmptyWorkspaceMemory(memory)) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ v: ANALYTICS_MEMORY_VERSION, ...memory }));
    return true;
  } catch {
    return false;
  }
}
