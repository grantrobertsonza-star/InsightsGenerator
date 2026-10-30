// Codex R1-F01 (29 October 2026): a table read from a workbook before the label reader repair (R1) may carry
// merged answers, so it must be reported as built with an earlier method until rebuilt, and anything built on it
// marked. Through the actual buildCrosstab, listCrosstabs and loadInsightSupport, the local engine and a real
// disposable PostgreSQL; storage and the model are the mocked boundaries. Workbook: a Data sheet and a Labels sheet
// headed variable / label / value / value_label (the packs' layout), with a Codebook sheet.
//   - A table built now records the current label reader and is current.
//   - The same table as saved before R1 (no label reader recorded, its answers all named "First choice brand") is
//     earlier with the workbook reason; its finding's insight reads stale (method_changed) with that reason; wording,
//     review and the saved table are kept; rebuilding gives Toyota/BMW/Haval and a current table.
//   - Unaffected-format control: a CSV table without a recorded label reader stays current.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDisposableDb, TEST_DATABASE_URL, type DisposableDb } from "./helpers/disposableDb";
import { PYTHON } from "./helpers/pythonEngine";
import { CURRENT_LABEL_READER, WORKBOOK_LABELS_TEXT } from "../tableMethod";
import type { CrosstabRequest, CrosstabResult } from "../parseStatsFile";

vi.mock("../requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/requestContext", async () => (await import("./helpers/testRequestContext")).testRequestContextModule());
vi.mock("@/lib/db", async () => await import("../db"));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
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

vi.setConfig({ testTimeout: 120_000, hookTimeout: 180_000 });
const PYTHON_OK = spawnSync(PYTHON, ["-c", "import pandas, pyreadstat, openpyxl"], { encoding: "utf8" }).status === 0;

function workbook(): Buffer {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "r1-wb-")), "w.xlsx");
  const script = String.raw`
import sys, pandas as pd
data = pd.DataFrame({"brand": [1, 8, 10, 1, 8, 1], "g": [1, 1, 1, 2, 2, 2]})
codebook = pd.DataFrame({"variable": ["brand", "g"], "label": ["First choice brand", "Group"]})
labels = pd.DataFrame({"variable": ["brand"] * 3, "label": ["First choice brand"] * 3, "value": [1, 8, 10], "value_label": ["Toyota", "BMW", "Haval"]})
with pd.ExcelWriter(sys.argv[1]) as w:
    data.to_excel(w, sheet_name="Respondents", index=False)
    codebook.to_excel(w, sheet_name="Codebook", index=False)
    labels.to_excel(w, sheet_name="Labels", index=False)
`;
  const r = spawnSync(PYTHON, ["-I", "-c", script, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(out);
}

describe.skipIf(!TEST_DATABASE_URL || !PYTHON_OK)("R1-F01: workbook tables read before the label reader repair (real database, actual engine)", () => {
  let db: DisposableDb;
  const tenant = process.env.DEFAULT_TENANT_ID ?? randomUUID();
  let run = "";
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows;
  const docs: Record<string, string> = {};
  const setup = JSON.stringify({ layout: "rows_are_cases", unit: "respondents", method: "survey", accepted: true });

  beforeAll(async () => {
    db = await createDisposableDb();
    process.env.DATABASE_URL = db.url;
    process.env.DEFAULT_TENANT_ID = tenant;
    (globalThis as { pgPool?: unknown }).pgPool = undefined;
    await q("insert into tenants (id, name) values ($1, 'T') on conflict do nothing", [tenant]);
    run = (await q("insert into runs (tenant_id, project_name) values ($1, 'P') returning id", [tenant]))[0].id;
    const files: [string, Buffer][] = [
      ["w.xlsx", workbook()],
      ["w.csv", Buffer.from("brand,g\n1,1\n8,1\n10,1\n1,2\n8,2\n1,2\n")],
    ];
    for (const [name, bytes] of files) {
      const key = `${tenant}/${run}/${randomUUID()}-${name}`;
      storage.objects.set(key, bytes);
      docs[name] = (await q(
        `insert into documents (tenant_id, run_id, kind, ingestion_type, source_filename, storage_path, data_setup) values ($1, $2, 'table', 'raw', $3, $4, $5) returning id`,
        [tenant, run, name, key, setup],
      ))[0].id;
    }
  });
  afterAll(async () => {
    const { pool } = await import("../db");
    await pool.end().catch(() => {});
    await db?.drop();
  });

  const request: CrosstabRequest = { columnVars: ["g"], weightVar: null, correction: "none", rowItems: [{ key: "brand", label: "brand", vars: ["brand"] }] };
  const stored = async (id: string) => (await q("select crosstab from document_tables where id = $1", [id]))[0].crosstab as CrosstabResult & { notes: { labelReader?: string } };
  const answers = (t: CrosstabResult) => t.questions[0].rows.filter((r) => !r.isBase && !r.isEffBase).map((r) => r.label);

  it("a workbook table built now records the current label reader and is current", async () => {
    const { buildCrosstab, listCrosstabs } = await import("../crosstabs");
    const id = (await buildCrosstab(tenant, run, docs["w.xlsx"], request)).tableId;
    expect((await stored(id)).notes.labelReader).toBe(CURRENT_LABEL_READER);
    expect(answers(await stored(id))).toEqual(["Toyota", "BMW", "Haval"]);
    expect((await listCrosstabs(tenant, run, docs["w.xlsx"])).find((x) => x.id === id)?.methodFreshness).toBe("current");
  });

  it("the same table as saved before R1 is earlier with the workbook reason, its insight stale; wording, review and table kept; rebuilt, current", async () => {
    const { buildCrosstab, listCrosstabs } = await import("../crosstabs");
    const { loadInsightSupport } = await import("../supportStatus");
    const old = (await buildCrosstab(tenant, run, docs["w.xlsx"], request)).tableId;
    // As the engine before R1 saved it: no label reader recorded, every answer named by the question's label.
    await q(
      `update document_tables set crosstab = jsonb_set(
         jsonb_set(jsonb_set(jsonb_set(crosstab #- '{notes,labelReader}', '{questions,0,rows,0,label}', '"First choice brand"'),
           '{questions,0,rows,1,label}', '"First choice brand"'), '{questions,0,rows,2,label}', '"First choice brand"'),
         '{questions,0,rows,3,label}', '"First choice brand"') where id = $1`,
      [old],
    );
    const one = async (sql: string, p: unknown[]) => (await q(sql, p))[0].id as string;
    const finding = await one(`insert into findings (tenant_id, run_id, origin, finding_text, status, source_table_id) values ($1, $2, 'generated', 'Researcher wording kept', 'accepted', $3) returning id`, [tenant, run, old]);
    const pre = await one(`insert into insights (tenant_id, run_id, finding_id, headline, observation, tension, implication) values ($1, $2, $3, 'h', 'o', 't', 'i') returning id`, [tenant, run, finding]);
    const insight = await one(`insert into synthesized_insights (tenant_id, run_id, headline, observation, tension, implication, review_status) values ($1, $2, 'Insight kept', 'o', 't', 'i', 'accepted') returning id`, [tenant, run]);
    await q(`insert into synthesized_insight_sources (tenant_id, synthesized_insight_id, pre_insight_id, support_snapshot) values ($1, $2, $3, finding_support_parts($4))`, [tenant, insight, pre, finding]);
    const savedBefore = await stored(old);

    const listed = (await listCrosstabs(tenant, run, docs["w.xlsx"])).find((x) => x.id === old)!;
    expect([listed.methodFreshness, listed.methodReason]).toEqual(["earlier", WORKBOOK_LABELS_TEXT]);
    const support = (await loadInsightSupport(tenant, run, [insight])).statusOf(insight);
    expect(support.status).toBe("stale");
    expect(JSON.stringify(support)).toContain("method_changed");
    expect(JSON.stringify(support)).toContain("labels sheet was read correctly");
    expect((await q("select finding_text from findings where id = $1", [finding]))[0].finding_text).toBe("Researcher wording kept");
    expect((await q("select headline, review_status from synthesized_insights where id = $1", [insight]))[0]).toEqual({ headline: "Insight kept", review_status: "accepted" });
    expect(await stored(old)).toEqual(savedBefore);

    const rebuilt = (await buildCrosstab(tenant, run, docs["w.xlsx"], request)).tableId;
    const after = await listCrosstabs(tenant, run, docs["w.xlsx"]);
    expect(after.find((x) => x.id === rebuilt)?.methodFreshness).toBe("current");
    expect(answers(await stored(rebuilt))).toEqual(["Toyota", "BMW", "Haval"]);
    expect(after.find((x) => x.id === old)?.methodFreshness).toBe("earlier");
  });

  it("unaffected format: a CSV table with no label reader recorded stays current", async () => {
    const { buildCrosstab, listCrosstabs } = await import("../crosstabs");
    const id = (await buildCrosstab(tenant, run, docs["w.csv"], request)).tableId;
    await q("update document_tables set crosstab = crosstab #- '{notes,labelReader}' where id = $1", [id]);
    expect((await listCrosstabs(tenant, run, docs["w.csv"])).find((x) => x.id === id)?.methodFreshness).toBe("current");
  });
});
