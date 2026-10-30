// SEC1: tenant ownership on every write an entry point makes itself (source scan).
//
// The app may connect as a role that bypasses row-level security (docs/database-roles.md), so a
// write must not rely on RLS to stay inside the signed-in organisation. This reads the actual
// source with TypeScript's parser and fails, naming the function and the statement, when a write
// (insert, update or delete) in an entry point has no tenant scoping of its own:
//   - an UPDATE or DELETE must name tenant_id in its WHERE clause, or the same function must check
//     the run's ownership first (runOwnership.ts) and the statement must be scoped by run_id (or,
//     for the runs table itself, by id);
//   - an INSERT that sets run_id must follow a run ownership check in the same function, or guard
//     itself with `where exists (select 1 from runs where id = ... and tenant_id = ...)`;
//   - a write that sets program_id from a value must follow a program ownership check;
//   - an INSERT must set tenant_id.
// "The same function" includes callbacks nested in it (the withTenant transaction body), so the
// check and the write share one transaction there. A check made in a separate earlier
// transaction still counts: a run's or program's tenant never changes (no code path updates
// runs.tenant_id or programs.tenant_id), so ownership established once stays true.
//
// Entry points scanned: every top-level function of a "use server" module (exported actions and
// the private helpers they call, such as findingActions.ts editField), every inline "use server"
// function, and every route handler under src/app. Writes made by library modules those entry
// points delegate to are NOT scanned here; see claude/batchSEC1-handover-2026-10-29.md.
//
// A second test requires every route handler under src/app/api/runs/[id] to confirm the run
// belongs to the signed-in tenant before reading anything, so another organisation's project
// answers 404 exactly like a missing one.
//
// SEC2: a third test requires every server action that takes a run id to check that run at its
// entry, before any database or library call (the rule is written out above RUN_PARAM below), so
// the library code an action delegates to never runs for another organisation's project. That
// closes most of the gap the first test leaves (library writes are not scanned): the library may
// still scope by run id alone, but it is only reached with a run already proven to be the
// signed-in tenant's. Ids of other kinds (document, table, finding) are not covered by it.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../..");

/** Calls that establish run ownership for the signed-in tenant (owner: src/lib/runOwnership.ts). */
const RUN_CHECKS = ["assertRunOwned", "runOwned", "runBelongsToTenant", "lockRunForContextChange"];
const PROGRAM_CHECKS = ["assertProgramOwned"];

// Statements that are safe without the rule above, each with the reason. Key: file#function#statement start.
const EXEMPT = new Map<string, string>([]);

// SEC2 entry rule. A server action is an exported function of a "use server" module, or an inline
// "use server" function in a page. When one takes a parameter named like a run id (RUN_PARAM:
// runId, _runId, projectId or run_id, any case), its body must check that run against the
// signed-in tenant (ENTRY_CHECKS, called with that parameter) before anything else touches the
// database or a library. Concretely, walking the body's top-level statements in order (and into a
// top-level try block, which runs unconditionally until something throws):
//   - the statement that makes the check must be one of them, not inside a branch or a callback,
//     with one exception: the first statement of a withTenant/withTenantRead/withTenantRepeatableRead
//     callback, so a check that shares the write's transaction (SEC1's assertRunOwned) counts;
//   - a statement before it may await only the request context (requireTenantId,
//     requireRequestContext), may not call the database, and may not return a call's result.
// Synchronous validation (UUID.test, form parsing) may come first: it reads no stored data.
// A parameter named otherwise (documentId, programId) is not covered by this rule; see
// claude/batchSEC2-handover-2026-10-29.md.
const RUN_PARAM = /^_?(?:run|project)_?id$/i;
const ENTRY_CHECKS = ["runAccessible", "assertRunAccessible", ...RUN_CHECKS];
const CONTEXT_CALLS = ["requireTenantId", "requireRequestContext"];
const TX_CALLS = ["withTenant", "withTenantRead", "withTenantRepeatableRead"];
const DB_CALLS = [...TX_CALLS, "query", "connect"];

// Actions allowed to skip the entry check, each with the reason. Key: file#function.
const ENTRY_EXEMPT = new Map<string, string>([]);

function calleeName(n: ts.CallExpression): string {
  const c = n.expression;
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : "";
}
/** True when `n` is (or wraps) a call to one of ENTRY_CHECKS passing `runParam` itself. */
function checksRun(n: ts.Node, runParam: string): boolean {
  let found = false;
  const visit = (m: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(m) && ENTRY_CHECKS.includes(calleeName(m)) && m.arguments.some((a) => ts.isIdentifier(a) && a.text === runParam)) found = true;
    // A nested function is not run by this statement, so a check inside one does not count.
    else if (!isFn(m)) ts.forEachChild(m, visit);
  };
  visit(n);
  return found;
}
/** A statement that runs `withTenant*(..., async (client) => { <check>; ... })`. */
function checksInTransaction(st: ts.Statement, runParam: string): boolean {
  let found = false;
  const visit = (m: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(m) && TX_CALLS.includes(calleeName(m))) {
      const cb = m.arguments[m.arguments.length - 1];
      if (cb && isFn(cb) && cb.body && ts.isBlock(cb.body) && cb.body.statements[0] && checksRun(cb.body.statements[0], runParam)) found = true;
    }
    if (!isFn(m)) ts.forEachChild(m, visit);
  };
  visit(st);
  return found;
}
/** Why a statement before the check is not allowed there, or null. */
function earlyProblem(st: ts.Statement): string | null {
  let why: string | null = null;
  const visit = (m: ts.Node) => {
    if (why) return;
    if (ts.isAwaitExpression(m)) {
      const e = m.expression;
      if (!(ts.isCallExpression(e) && CONTEXT_CALLS.includes(calleeName(e)))) why = `awaits ${flat(e.getText()).slice(0, 40)} before the run check`;
    } else if (ts.isCallExpression(m) && DB_CALLS.includes(calleeName(m))) why = `calls ${calleeName(m)} before the run check`;
    else if (ts.isReturnStatement(m) && m.expression && containsCall(m.expression)) why = `returns ${flat(m.expression.getText()).slice(0, 40)} before the run check`;
    if (!isFn(m)) ts.forEachChild(m, visit);
  };
  visit(st);
  return why;
}
function containsCall(n: ts.Node): boolean {
  let found = false;
  const visit = (m: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(m)) found = true;
    else if (!isFn(m)) ts.forEachChild(m, visit);
  };
  visit(n);
  return found;
}
/** Why action `fn` does not check `runParam` at its entry, or null when it does. */
function entryProblem(fn: Fn, runParam: string): string | null {
  if (!fn.body || !ts.isBlock(fn.body)) return "has no body to check";
  const sequence: ts.Statement[] = [];
  for (const st of fn.body.statements) {
    if (ts.isTryStatement(st)) sequence.push(...st.tryBlock.statements);
    else sequence.push(st);
  }
  for (const st of sequence) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) continue; // the "use server" directive
    const direct = (ts.isExpressionStatement(st) || ts.isIfStatement(st) || ts.isVariableStatement(st)) && checksRun(ts.isIfStatement(st) ? st.expression : st, runParam);
    if (direct || checksInTransaction(st, runParam)) return null;
    const why = earlyProblem(st);
    if (why) return why;
  }
  return `never checks ${runParam} at its entry`;
}
/** Exported functions of a "use server" module and inline "use server" functions. */
function serverActions(sf: ts.SourceFile): Fn[] {
  const out = new Set<Fn>();
  if (directive(sf.statements, "use server")) {
    for (const st of sf.statements) {
      const exported = ts.canHaveModifiers(st) && ts.getModifiers(st)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) continue;
      if (ts.isFunctionDeclaration(st)) out.add(st);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (d.initializer && isFn(d.initializer)) out.add(d.initializer);
    }
  }
  const visit = (n: ts.Node) => {
    if (isFn(n) && n.body && ts.isBlock(n.body) && directive(n.body.statements, "use server")) out.add(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return [...out];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const files = walk(SRC).map((f) => ({ full: f, rel: path.relative(path.resolve(SRC, ".."), f).split(path.sep).join("/") }));

type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (n: ts.Node): n is Fn => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
function parse(full: string) {
  return ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, full.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function directive(statements: readonly ts.Statement[] | undefined, text: string): boolean {
  const first = statements?.[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === text;
}
function fnName(fn: Fn): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  return ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText() : "<anonymous>";
}

/** The entry points of one file, as described at the top. */
function entryPoints(sf: ts.SourceFile, rel: string): Fn[] {
  const out = new Set<Fn>();
  if (directive(sf.statements, "use server")) {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st)) out.add(st);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (d.initializer && isFn(d.initializer)) out.add(d.initializer);
    }
  }
  const visit = (n: ts.Node) => {
    if (isFn(n) && n.body && ts.isBlock(n.body) && directive(n.body.statements, "use server")) out.add(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (/^src\/app\/.*\/route\.ts$/.test(rel)) {
    for (const st of sf.statements) if (ts.isFunctionDeclaration(st) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(st.name?.getText() ?? "")) out.add(st);
  }
  return [...out];
}

/** Module-level `const NAME = "..."` (or a template without placeholders): SQL fragments a statement may interpolate. */
function moduleStrings(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) out.set(d.name.text, d.initializer.text);
    }
  }
  return out;
}

/** SQL text of every string or template literal in `fn` (nested callbacks included), with module fragments inlined. */
function sqlTexts(fn: Fn, fragments: Map<string, string>): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      const span = (e: ts.Expression) => (ts.isIdentifier(e) && fragments.has(e.text) ? fragments.get(e.text)! : "${" + e.getText() + "}");
      out.push(n.head.text + n.templateSpans.map((s) => span(s.expression) + s.literal.text).join(""));
      return; // spans hold expressions, not separate statements
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return out;
}
function calls(fn: Fn, names: string[]): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (names.includes(name)) found = true;
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const OWNED_RUN_SQL = /\bfrom runs (?:\w+ )?where (?:\w+\.)?id ?= ?\$\d+ and (?:\w+\.)?tenant_id ?= ?\$\d+/i;
const OWNED_PROGRAM_SQL = /\bfrom programs (?:\w+ )?where (?:\w+\.)?id ?= ?\$\d+ and (?:\w+\.)?tenant_id ?= ?\$\d+/i;
const GUARDED_INSERT = /\bwhere exists \(select 1 from runs where id = \$\d+ and tenant_id = \$\d+/i;

type Write = { kind: "insert" | "update" | "delete"; table: string; sql: string };
function writeOf(raw: string): Write | null {
  const sql = flat(raw);
  const m = /^(?:with [\s\S]*?\)\s*)?(insert into|update|delete from)\s+([a-z_]+)\b/i.exec(sql);
  if (!m) return null;
  const kind = m[1].toLowerCase().startsWith("insert") ? "insert" : m[1].toLowerCase() === "update" ? "update" : "delete";
  if (kind === "update" && !/\bset\b/i.test(sql)) return null;
  return { kind, table: m[2].toLowerCase(), sql };
}

/** Why `w` is not tenant-scoped in a function with the given evidence, or null when it is. */
function problem(w: Write, runChecked: boolean, programChecked: boolean): string | null {
  const where = /\bwhere\b([\s\S]*)$/i.exec(w.sql)?.[1] ?? "";
  if (w.kind === "insert") {
    const cols = /^insert into [a-z_]+ \(([^)]*)\)/i.exec(w.sql)?.[1]?.split(",").map((c) => c.trim().toLowerCase()) ?? [];
    if (!cols.includes("tenant_id")) return "insert does not set tenant_id";
    if (cols.includes("run_id") && !runChecked && !GUARDED_INSERT.test(w.sql)) return "insert sets run_id without a run ownership check";
    if (cols.includes("program_id") && !programChecked) return "insert sets program_id without a program ownership check";
    return null;
  }
  if (/\bset\b[\s\S]*\bprogram_id = \$\d+/i.test(w.sql) && !programChecked) return "sets program_id without a program ownership check";
  if (/\btenant_id\b/i.test(where)) return null;
  if (!where) return `${w.kind} has no WHERE clause`;
  if (!runChecked) return `${w.kind} has no tenant_id predicate and no run ownership check`;
  const scoped = w.table === "runs" ? /\bid = \$\d+/i.test(where) : /\brun_id\b/i.test(where);
  return scoped ? null : `${w.kind} relies on a run check but is not scoped by run_id`;
}

describe("SEC1 and SEC2 tenant ownership coverage (source scan)", () => {
  it("every write an entry point makes is scoped to the signed-in tenant", () => {
    const missing: string[] = [];
    const usedExemptions = new Set<string>();
    let writes = 0;
    for (const f of files) {
      const sf = parse(f.full);
      const fragments = moduleStrings(sf);
      for (const fn of entryPoints(sf, f.rel)) {
        const texts = sqlTexts(fn, fragments);
        const runChecked = calls(fn, RUN_CHECKS) || texts.some((t) => OWNED_RUN_SQL.test(flat(t)));
        const programChecked = calls(fn, PROGRAM_CHECKS) || texts.some((t) => OWNED_PROGRAM_SQL.test(flat(t)));
        for (const t of texts) {
          const w = writeOf(t);
          if (!w) continue;
          writes++;
          const why = problem(w, runChecked, programChecked);
          if (!why) continue;
          const key = `${f.rel}#${fnName(fn)}#${w.sql.slice(0, 60)}`;
          if (EXEMPT.has(key)) {
            usedExemptions.add(key);
            continue;
          }
          missing.push(`${key} (${why})`);
        }
      }
    }
    if (missing.length) console.log("SCAN\n" + missing.join("\n"));
    expect(writes).toBeGreaterThan(80);
    expect(missing).toEqual([]);
    // An exemption that no longer matches anything must be removed, so the list stays honest.
    expect([...EXEMPT.keys()].filter((k) => !usedExemptions.has(k))).toEqual([]);
  });

  it("every route under /api/runs/[id] confirms the run is this tenant's before reading", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of files.filter((x) => /^src\/app\/api\/runs\/\[id\]\/.*route\.ts$/.test(x.rel))) {
      const sf = parse(f.full);
      for (const st of sf.statements) {
        if (!ts.isFunctionDeclaration(st) || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(st.name?.getText() ?? "")) continue;
        checked++;
        if (!calls(st, RUN_CHECKS)) missing.push(`${f.rel}#${st.name!.getText()}`);
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("every server action that takes a run id checks it before any database or library call", () => {
    const missing: string[] = [];
    const usedExemptions = new Set<string>();
    let checked = 0;
    for (const f of files) {
      const sf = parse(f.full);
      for (const fn of serverActions(sf)) {
        const runParam = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : "")).find((n) => RUN_PARAM.test(n));
        if (!runParam) continue;
        checked++;
        const why = entryProblem(fn, runParam);
        if (!why) continue;
        const key = `${f.rel}#${fnName(fn)}`;
        if (ENTRY_EXEMPT.has(key)) {
          usedExemptions.add(key);
          continue;
        }
        missing.push(`${key} (${why})`);
      }
    }
    if (missing.length) console.log("ENTRY SCAN\n" + missing.join("\n"));
    expect(checked).toBeGreaterThan(200);
    expect(missing).toEqual([]);
    expect([...ENTRY_EXEMPT.keys()].filter((k) => !usedExemptions.has(k))).toEqual([]);
  });

  it("the entry rule recognises a late or missing check (self-check)", () => {
    const fnOf = (code: string) => {
      const sf = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      return sf.statements[0] as ts.FunctionDeclaration;
    };
    const ok = fnOf(`async function a(runId: string) { const T = await requireTenantId(); if (!UUID.test(runId)) return { ok: false }; if (!(await runAccessible(T, runId))) return { ok: false }; return load(T, runId); }`);
    expect(entryProblem(ok, "runId")).toBeNull();
    const inTry = fnOf(`async function a(runId: string) { try { const c = await requireRequestContext(); await assertRunAccessible(c.tenantId, runId); await work(); } catch {} }`);
    expect(entryProblem(inTry, "runId")).toBeNull();
    const inTx = fnOf(`async function a(runId: string) { const T = await requireTenantId(); await withTenant(T, async (client) => { await assertRunOwned(client, T, runId); await client.query("x"); }); }`);
    expect(entryProblem(inTx, "runId")).toBeNull();
    const late = fnOf(`async function a(runId: string) { const T = await requireTenantId(); const x = await loadThing(T, runId); await assertRunAccessible(T, runId); }`);
    expect(entryProblem(late, "runId")).toMatch(/loadThing/);
    const none = fnOf(`async function a(runId: string) { const T = await requireTenantId(); return guard(runId, () => work(T, runId)); }`);
    expect(entryProblem(none, "runId")).toMatch(/guard/);
    const otherId = fnOf(`async function a(runId: string, otherRunId: string) { const T = await requireTenantId(); await assertRunAccessible(T, otherRunId); }`);
    expect(entryProblem(otherId, "runId")).toMatch(/awaits assertRunAccessible/);
    const branch = fnOf(`async function a(runId: string, x: boolean) { const T = await requireTenantId(); if (x) { await assertRunAccessible(T, runId); } }`);
    expect(entryProblem(branch, "runId")).toMatch(/awaits assertRunAccessible/);
    const callback = fnOf(`async function a(runId: string) { const T = await requireTenantId(); const run = () => assertRunAccessible(T, runId); }`);
    expect(entryProblem(callback, "runId")).toMatch(/never checks/);
    expect(RUN_PARAM.test("runId") && RUN_PARAM.test("_runId") && RUN_PARAM.test("projectId") && RUN_PARAM.test("run_id")).toBe(true);
    expect(RUN_PARAM.test("documentId") || RUN_PARAM.test("reruns")).toBe(false);
  });

  it("the scan recognises an unscoped write (self-check)", () => {
    expect(problem(writeOf("update findings set status = $1 where id = $2 and run_id = $3")!, false, false)).toMatch(/no tenant_id predicate/);
    expect(problem(writeOf("update findings set status = $1 where id = $2 and run_id = $3")!, true, false)).toBeNull();
    expect(problem(writeOf("update findings set status = $1 where id = $2 and tenant_id = $3")!, false, false)).toBeNull();
    expect(problem(writeOf("update decision_candidates set status = 'x' where id = $1")!, true, false)).toMatch(/not scoped by run_id/);
    expect(problem(writeOf("insert into trace (tenant_id, run_id, event) values ($1, $2, 'e')")!, false, false)).toMatch(/run ownership/);
    expect(
      problem(writeOf("insert into trace (tenant_id, run_id, event) select $1, $2, 'e' where exists (select 1 from runs where id = $2 and tenant_id = $1)")!, false, false),
    ).toBeNull();
    expect(problem(writeOf("update runs set program_id = $1 where id = $2 and tenant_id = $3")!, false, false)).toMatch(/program ownership/);
    expect(problem(writeOf("insert into programs (name) values ($1)")!, false, false)).toMatch(/tenant_id/);
  });
});
