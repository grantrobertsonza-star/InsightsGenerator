// Grant, 29 October 2026: "I select the variables for awareness, it saves it, but it doesn't update the tile". A
// stage with a chosen question whose figures cannot be counted read "No question for this stage was found", which
// contradicts the choice. brandOverviewFigures now says why (noFigures); this is decided before any read, so no
// database is needed: the file's variables give the recognition, and the brand list is varied.
import { describe, expect, it, vi } from "vitest";

vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
import { brandOverviewFigures } from "../trackerFigures";
import { recogniseTracker, type RoleVariable } from "../trackerRoles";
import { resolveDashboard } from "../trackerDashboard";

const YES_NO = { "0": "Not selected", "1": "Selected" };
const BRANDS = ["Toyota", "BMW", "Haval"];
const variables: RoleVariable[] = ["Aware", "Consider", "Purchased"].flatMap((q) => BRANDS.map((b) => ({ name: `${q}_${b}`, label: `${q}: ${b}`, numeric: true, valueLabels: YES_NO })));
const rec = recogniseTracker(variables);
const dashboard = resolveDashboard(rec, new Set(variables.map((v) => v.name)), null, {});

describe("a stage with a question but no figures says why", () => {
  it("the fixture has brands and an awareness stage", () => {
    expect(dashboard.brands.map((b) => b.label)).toEqual(BRANDS);
    expect(dashboard.stages.some((s) => s.stage === "awareness")).toBe(true);
  });
  it("no brand list: nothing to count, and the reason says to link the codebook", async () => {
    const f = await brandOverviewFigures("t", "r", "d", rec, { ...dashboard, brands: [] }, variables);
    expect(f.stages).toEqual([]);
    expect(f.noFigures).toMatch(/no brand list was found .*Link the codebook/);
  });
  it("a brand list the chosen questions do not ask about: the reason says so", async () => {
    const f = await brandOverviewFigures("t", "r", "d", rec, { ...dashboard, brands: [{ code: "Kia", label: "Kia" }] }, variables);
    expect(f.noFigures).toMatch(/not asked about any brand in this file's brand list/);
  });
  it("no stage with a question: no reason (the tiles say no question was found)", async () => {
    const f = await brandOverviewFigures("t", "r", "d", rec, { ...dashboard, brands: [], stages: [] }, variables);
    expect(f.noFigures).toBeNull();
  });
});
