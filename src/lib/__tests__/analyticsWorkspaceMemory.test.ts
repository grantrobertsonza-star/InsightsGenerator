// What the Analytics workspace remembers between visits (analyticsWorkspaceMemory.ts). The actual
// helper with an in-memory Storage: round-trip, malformed and foreign values, blocked storage,
// per-file isolation and versioning. How the workspace rebuilds cards from it is covered by the
// browser check e2e/ui/analytics-kept.check.mjs.
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_MEMORY_VERSION,
  EMPTY_WORKSPACE_MEMORY,
  parseWorkspaceMemory,
  readWorkspaceMemory,
  workspaceMemoryKey,
  writeWorkspaceMemory,
  type WorkspaceMemory,
} from "../../app/runs/[id]/analyticsWorkspaceMemory";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

/** A browser that refuses storage: every call throws, as Safari private mode and blocked site data do. */
class BlockedStorage extends MemoryStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }
  setItem(): void {
    throw new Error("blocked");
  }
  removeItem(): void {
    throw new Error("blocked");
  }
}

const sample: WorkspaceMemory = {
  cards: [
    { kind: "scatter", x: "EASE", y: "TRUST", weightVar: "WT", spread: true },
    { kind: "chart", variable: "Q1", groupVar: "GENDER", weightVar: null, variant: "line", title: "My title", colors: ["#112233", "#445566"], legendPos: "bottom" },
    { kind: "chart", variable: "AGE", groupVar: null, weightVar: null, variant: "histogram", title: null, colors: null, legendPos: "top" },
  ],
  nps: { variable: "NPS", weightVar: null, groupVar: "REGION" },
  driver: { kind: "saved", savedId: "3f0d0a4e-0000-4000-8000-000000000001" },
};

describe("analytics workspace memory", () => {
  it("round-trips requests, ids and presentation choices in order", () => {
    const st = new MemoryStorage();
    expect(writeWorkspaceMemory("run-1", "doc-1", sample, st)).toBe(true);
    expect(readWorkspaceMemory("run-1", "doc-1", st)).toEqual({ available: true, memory: sample });
    const stored = JSON.parse(st.getItem(workspaceMemoryKey("run-1", "doc-1"))!);
    expect(stored.v).toBe(ANALYTICS_MEMORY_VERSION);
    // Requests only: nothing in the stored value is a figure.
    expect(Object.keys(stored).sort()).toEqual(["cards", "driver", "nps", "v"]);
    expect(JSON.stringify(stored)).not.toMatch(/"(result|series|correlation|report|score|share)"/);
  });

  it("round-trips an unsaved driver result by its request", () => {
    const st = new MemoryStorage();
    const memory: WorkspaceMemory = {
      ...EMPTY_WORKSPACE_MEMORY,
      driver: {
        kind: "request",
        request: { outcome: "Y", outcomeType: "binary", topBoxMin: 9, predictors: ["X1", "X2"], weightVar: null, statedImportance: { X1: "IMP1" }, groupVar: null },
      },
    };
    writeWorkspaceMemory("r", "d", memory, st);
    expect(readWorkspaceMemory("r", "d", st).memory).toEqual(memory);
  });

  it("keeps each run and file apart", () => {
    const st = new MemoryStorage();
    writeWorkspaceMemory("run-1", "doc-1", sample, st);
    expect(readWorkspaceMemory("run-1", "doc-2", st).memory).toEqual(EMPTY_WORKSPACE_MEMORY);
    expect(readWorkspaceMemory("run-2", "doc-1", st).memory).toEqual(EMPTY_WORKSPACE_MEMORY);
    writeWorkspaceMemory("run-1", "doc-2", EMPTY_WORKSPACE_MEMORY, st);
    expect(readWorkspaceMemory("run-1", "doc-1", st).memory).toEqual(sample);
  });

  it("removes the key when the memory is emptied (Clear all)", () => {
    const st = new MemoryStorage();
    writeWorkspaceMemory("r", "d", sample, st);
    writeWorkspaceMemory("r", "d", EMPTY_WORKSPACE_MEMORY, st);
    expect(st.length).toBe(0);
  });

  it("reads malformed values as nothing remembered, and drops only the malformed entries", () => {
    for (const raw of ["{not json", "null", "[]", '"text"', "42", JSON.stringify({ cards: sample.cards })]) {
      expect(parseWorkspaceMemory(raw)).toEqual(EMPTY_WORKSPACE_MEMORY);
    }
    const mixed = parseWorkspaceMemory(
      JSON.stringify({
        v: ANALYTICS_MEMORY_VERSION,
        cards: [
          { kind: "chart", variable: "", groupVar: null, weightVar: null, variant: "bar" }, // no variable
          { kind: "chart", variable: "Q1", groupVar: null, weightVar: null, variant: "pie" }, // unknown variant
          { kind: "scatter", x: "A", y: "A", weightVar: null }, // same variable twice
          { kind: "table", variable: "Q1" }, // unknown kind
          { kind: "chart", variable: "Q2", groupVar: 7, weightVar: null, variant: "bar" }, // wrong type
          { kind: "chart", variable: "Q3", groupVar: null, weightVar: null, variant: "bar", colors: ["red;}"], legendPos: "left" },
          "junk",
        ],
        nps: { variable: 5 },
        driver: { kind: "saved" },
      }),
    );
    // The one usable chart survives; unsafe colours and an unknown legend fall back to defaults.
    expect(mixed).toEqual({
      cards: [{ kind: "chart", variable: "Q3", groupVar: null, weightVar: null, variant: "bar", title: null, colors: null, legendPos: "top" }],
      nps: null,
      driver: null,
    });
  });

  it("ignores a value written by another version instead of guessing at its shape", () => {
    const st = new MemoryStorage();
    const key = workspaceMemoryKey("r", "d");
    st.setItem(key, JSON.stringify({ v: ANALYTICS_MEMORY_VERSION + 1, cards: sample.cards }));
    expect(readWorkspaceMemory("r", "d", st)).toEqual({ available: true, memory: EMPTY_WORKSPACE_MEMORY });
    expect(key).toContain(`:v${ANALYTICS_MEMORY_VERSION}:`);
  });

  it("reports blocked storage as unavailable, not as nothing remembered, and never throws", () => {
    const st = new BlockedStorage();
    expect(readWorkspaceMemory("r", "d", st)).toEqual({ available: false, memory: EMPTY_WORKSPACE_MEMORY });
    expect(writeWorkspaceMemory("r", "d", sample, st)).toBe(false);
    expect(readWorkspaceMemory("r", "d", null)).toEqual({ available: false, memory: EMPTY_WORKSPACE_MEMORY });
    expect(writeWorkspaceMemory("r", "d", sample, null)).toBe(false);
  });

  it("bounds how many cards a stored value can ask to rebuild", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ kind: "scatter", x: `X${i}`, y: `Y${i}`, weightVar: null }));
    expect(parseWorkspaceMemory(JSON.stringify({ v: ANALYTICS_MEMORY_VERSION, cards: many })).cards.length).toBe(60);
  });
});
