// The Audience page's recognition of age, gender, income and the other profile questions (R5, Grant 30 October 2026)
// checked against Codex's independent coverage file, read at test time and never copied into the app:
// fixtures/tracker-packs/bmw_car/independent/codex-coverage-and-scope-2026-10-30.json ("datasets[].coverage[]": per
// file, items age, gender and income with status and the variables Codex mapped from the questionnaire and codebook).
// Each file goes through the actual reader (stored document, local engine, real disposable PostgreSQL, the actual
// readInstrumentItems / suggestInstrumentLinks / confirmInstrumentLinks for a CSV with a codebook) and loadRoleInput,
// then recogniseTracker. Storage is an in-memory stand-in; the model is stubbed and must never be called.
//
// Where the app and Codex agree the test asserts agreement: Codex "present" -> found, and the app's variable is one of
// Codex's variables; Codex "not_found" or "questionnaire_or_codebook_only" (the file has no such column) -> not found.
// Where they differ, the app's behaviour is asserted and the difference is listed in DISAGREEMENTS with its evidence,
// so the report reads it from here; the app is not adjusted to match:
//   - Car_Brand_Tracker_Wave_1.csv read alone, or with the pack's Master_Codebook.csv (wording but no answer lists):
//     Codex marks age, gender and income present because it read the questionnaire and the pack's labels; the app
//     recognises a profile question by its wording AND its answer list (claude/tracker-roles.md rule 5b1, never by a
//     variable name alone), so without answer labels it reports not found with the reason and offers "Choose a
//     question". With metadata.json (answer labels) it agrees.
//   - Age: Codex lists `age` (years, continuous) and `age_band`; the card uses the banded single-choice `age_band`
//     only (a continuous age is not a single-choice question). Agreement on the question; scope difference only.
// Codex's file has no items for the other profile questions (province, settlement, life stage); those are checked
// against the pack's own Master_Codebook.csv rows D2, D3 and D5 (single choice, all eligible).
// Skipped, with the reason, without a test database or python3 + pandas/pyreadstat/openpyxl.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../apiUsage", () => ({ logApiUsage: vi.fn(async () => {}) }));
vi.mock("../anthropic", () => ({ CLAUDE_MODEL: "controlled", anthropic: { messages: { create: vi.fn(async () => { throw new Error("test: no model call expected"); }) } } }));

const storage = vi.hoisted(() => ({ objects: new Map<string, Buffer>() }));
vi.mock("../supabaseAdmin", () => ({
  supabaseAdmin: {
    storage: {
      from: () => ({
        download: async (key: string) => (storage.objects.has(key) ? { data: new Blob([new Uint8Array(storage.objects.get(key)!)]), error: null } : { data: null, error: { message: "not found" } }),
        remove: async () => ({ data: [], error: null }),
        upload: async () => ({ data: {}, error: null }),
      }),
    },
  },
}));

vi.setConfig({ testTimeout: 300_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;
const fixture = (...p: string[]) => readFileSync(path.join(process.cwd(), "fixtures", ...p));

type CodexItem = { item: string; status: string; data: { variables: string[] } };
type CodexDataset = { file: string; coverage: CodexItem[] };
const CODEX: CodexDataset[] = JSON.parse(fixture("tracker-packs", "bmw_car", "independent", "codex-coverage-and-scope-2026-10-30.json").toString("utf8")).datasets;
/** Codex's reading of one profile item for a file, by the file's base name (Codex wrote Windows paths). */
function codex(file: string, item: "age" | "gender" | "income"): CodexItem {
  const ds = CODEX.find((d) => d.file.split(/[\\/]/).pop() === file);
  const c = ds?.coverage.find((x) => x.item === item);
  if (!c) throw new Error(`Codex has no ${item} for ${file}`);
  return c;
}
const ROLE_FIELD = { age: "ageGroups", gender: "gender", income: "income" } as const;

/** Differences between the app and Codex, asserted below and reported in the handover. */
const DISAGREEMENTS = [
  "Car_Brand_Tracker_Wave_1.csv alone: Codex age, gender, income present; the app finds none (no wording or answer labels in a plain CSV).",
  "Car_Brand_Tracker_Wave_1.csv with Master_Codebook.csv: Codex present; the app finds none (the codebook has wording but no answer lists).",
];

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("Audience recognition against Codex's independent coverage (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  async function stored(run: string, kind: "instrument" | "table", name: string, bytes: Buffer, type: string | null = null) {
    const key = `${tenant}/${run}/${randomUUID()}-${name}`;
    storage.objects.set(key, bytes);
    return (await q(
      `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, instrument_type, data_setup)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [tenant, run, kind, kind === "table" ? "raw" : null, name, key, type, kind === "table" ? JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true }) : null],
    ))[0].id as string;
  }
  /** The recogniser's reading of one data file, optionally with a codebook linked through the actual instrument flow. */
  async function recognise(name: string, bytes: Buffer, codebook?: { name: string; bytes: Buffer }) {
    const run = (await q("insert into runs (tenant_id, project_name) values ($1, 'BMW car tracker') returning id", [tenant]))[0].id as string;
    const data = await stored(run, "table", name, bytes);
    if (codebook) {
      const { readInstrumentItems, suggestInstrumentLinks, confirmInstrumentLinks } = await import("../instruments");
      const cb = await stored(run, "instrument", codebook.name, codebook.bytes, "codebook");
      await readInstrumentItems(tenant, run, cb);
      await suggestInstrumentLinks(tenant, run, cb, data);
      await confirmInstrumentLinks(tenant, run, cb, 0.9);
    }
    const { loadRoleInput } = await import("../trackerInput");
    const { recogniseTracker } = await import("../trackerRoles");
    return recogniseTracker((await loadRoleInput(tenant, run, data)).variables);
  }
  type Recognition = Awaited<ReturnType<typeof recognise>>;
  /** Agreement with Codex for age, gender and income; returns the number of items compared. */
  function expectAgreement(file: string, r: Recognition) {
    let compared = 0;
    for (const item of ["age", "gender", "income"] as const) {
      const c = codex(file, item);
      const found = r[ROLE_FIELD[item]];
      if (c.status === "present") {
        expect(found.status, `${file} ${item}`).toBe("found");
        if (found.status === "found") expect(c.data.variables, `${file} ${item}`).toContain(found.variable);
      } else {
        expect(["not_found", "questionnaire_or_codebook_only"], `${file} ${item} (Codex)`).toContain(c.status);
        expect(found.status, `${file} ${item}`).toBe("not_found");
      }
      compared += 1;
    }
    return compared;
  }
  /** The other single-choice demographics of the pack's codebook (D2 province, D3 settlement, D5 life stage). */
  const PACK_DEMOGRAPHICS = fixture("tracker-packs", "bmw_car", "Master_Codebook.csv")
    .toString("utf8")
    .split(/\r?\n/)
    .map((l) => l.split(","))
    .filter((c) => /^D[2-5]$/.test(c[2] ?? "") && c[4] === "categorical" && c[0] !== "income")
    .map((c) => c[0]);

  it("BMW waves 1 and 2 (SPSS) and the car tracker CSV with metadata.json: age, gender and income as Codex maps them; province, settlement and life stage offered", async () => {
    expect(PACK_DEMOGRAPHICS).toEqual(["province", "settlement", "life_stage"]);
    const cases: [string, Recognition][] = [
      ["wave1_labels_only_compressed.sav", await recognise("wave1_labels_only_compressed.sav", fixture("tracker-packs", "bmw_car", "wave1_labels_only_compressed.sav"))],
      ["wave2_labels_only_compressed.sav", await recognise("wave2_labels_only_compressed.sav", fixture("tracker-packs", "bmw_car", "wave2_labels_only_compressed.sav"))],
      ["Car_Brand_Tracker_Wave_1.csv", await recognise("Car_Brand_Tracker_Wave_1.csv", fixture("tracker-packs", "bmw_car", "wave1_first60.csv"), { name: "metadata.json", bytes: fixture("tracker-packs", "bmw_car", "metadata.json") })],
    ];
    let compared = 0;
    for (const [file, r] of cases) {
      compared += expectAgreement(file, r);
      expect([r.ageGroups, r.gender, r.income].map((x) => (x.status === "found" ? x.variable : x.status)), file).toEqual(["age_band", "gender", "income"]);
      expect(r.profileQuestions.map((x) => x.variable), file).toEqual(expect.arrayContaining(PACK_DEMOGRAPHICS));
    }
    expect(compared).toBe(9);
    const { anthropic } = await import("../anthropic");
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });

  it("files Codex finds without these questions (banking relationship SPSS waves 1 and 2, the DK score file): not found, nothing invented", async () => {
    let compared = 0;
    for (const file of ["banking_relationship_w1_labels.sav", "banking_relationship_w2_labels.sav", "dk-score-source.sav"]) {
      const r = await recognise(file, fixture("csm", file));
      compared += expectAgreement(file, r);
      for (const x of [r.ageGroups, r.gender, r.income]) if (x.status === "not_found") expect(x.reason).toMatch(/^No question asked once whose wording names/);
    }
    expect(compared).toBe(9);
  });

  it("recorded disagreements: the car tracker CSV alone, or with Master_Codebook.csv (no answer lists), is not recognised; Codex marks it present", async () => {
    const alone = await recognise("Car_Brand_Tracker_Wave_1.csv", fixture("tracker-packs", "bmw_car", "wave1_first60.csv"));
    const withWording = await recognise("Car_Brand_Tracker_Wave_1.csv", fixture("tracker-packs", "bmw_car", "wave1_first60.csv"), { name: "Master_Codebook.csv", bytes: fixture("tracker-packs", "bmw_car", "Master_Codebook.csv") });
    for (const item of ["age", "gender", "income"] as const) {
      expect(codex("Car_Brand_Tracker_Wave_1.csv", item).status).toBe("present");
      expect(alone[ROLE_FIELD[item]].status, `alone ${item}`).toBe("not_found");
      expect(withWording[ROLE_FIELD[item]].status, `Master_Codebook.csv ${item}`).toBe("not_found");
    }
    expect(DISAGREEMENTS).toHaveLength(2);
  });
});
