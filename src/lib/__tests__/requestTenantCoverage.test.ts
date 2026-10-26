// G6: every entry point a browser can reach must take its tenant from the signed-in user.
//
// Reads the actual source (TypeScript's parser, no regex guessing) and fails, naming the
// function, when:
//   - any non-test source still reads DEFAULT_TENANT_ID;
//   - an exported function of a "use server" module, or an inline "use server" function, does not
//     call requireTenantId / requireRequestContext (directly, in its own body);
//   - a route handler (GET/POST/...) does not call routeRequestContext;
//   - a page under src/app that loads data does not resolve the request context.
// The only exemptions are named below with the reason, so adding an entry point without a check
// fails here rather than in production.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../..");

const EXEMPT_ACTIONS = new Map<string, string>([
  ["src/lib/authActions.ts#signIn", "creates the session; there is no context before it"],
  ["src/lib/authActions.ts#signOut", "clears the session; works with an expired one"],
  ["src/lib/authActions.ts#safeNextPath", "pure path check, no data access"],
]);
// Pages that hold no tenant data and must work signed out (or without an organisation).
const PUBLIC_PAGES = [/^src\/app\/login\//, /^src\/app\/no-organisation\//, /^src\/app\/manual\//, /^src\/app\/knowledge\//];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === "__tests__" ? [] : walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}
const files = walk(SRC).map((f) => ({ full: f, rel: path.relative(path.resolve(SRC, ".."), f).split(path.sep).join("/") }));

function parse(full: string) {
  return ts.createSourceFile(full, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, full.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
type Fn = ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;
const isFn = (n: ts.Node): n is Fn => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);
function hasDirective(body: ts.Node | undefined, text: string): boolean {
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === text;
}
function moduleDirective(sf: ts.SourceFile, text: string): boolean {
  const first = sf.statements[0];
  return !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === text;
}
// Calls one of `names` in its own body (not only inside a nested function that may never run).
function callsOwn(fn: Fn, names: string[]): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n !== fn && isFn(n)) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && names.includes(n.expression.text)) found = true;
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return found;
}
function fnName(fn: Fn): string {
  if ((ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) && fn.name) return fn.name.getText();
  return ts.isVariableDeclaration(fn.parent) ? fn.parent.name.getText() : "<anonymous>";
}
const exported = (n: ts.Node) => (ts.getCombinedModifierFlags(n as ts.Declaration) & ts.ModifierFlags.Export) !== 0;

const ACTION_CHECKS = ["requireTenantId", "requireRequestContext"];

describe("G6 request-tenant coverage (source scan)", () => {
  it("no source reads DEFAULT_TENANT_ID any more", () => {
    const offenders = files.filter((f) => /process\.env\.DEFAULT_TENANT_ID/.test(readFileSync(f.full, "utf8"))).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("every exported server action resolves the signed-in tenant itself", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of files) {
      const sf = parse(f.full);
      if (!moduleDirective(sf, "use server")) continue;
      for (const st of sf.statements) {
        const fns: Fn[] = [];
        if (ts.isFunctionDeclaration(st) && exported(st)) fns.push(st);
        if (ts.isVariableStatement(st) && exported(st)) {
          for (const d of st.declarationList.declarations) if (d.initializer && isFn(d.initializer)) fns.push(d.initializer);
        }
        for (const fn of fns) {
          checked++;
          const key = `${f.rel}#${fnName(fn)}`;
          if (EXEMPT_ACTIONS.has(key)) continue;
          if (!callsOwn(fn, ACTION_CHECKS)) missing.push(key);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it("every inline \"use server\" function resolves the signed-in tenant itself", () => {
    const missing: string[] = [];
    for (const f of files) {
      const sf = parse(f.full);
      const visit = (n: ts.Node) => {
        if (isFn(n) && hasDirective(n.body, "use server") && !callsOwn(n, ACTION_CHECKS)) missing.push(`${f.rel}#${fnName(n)}`);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(missing).toEqual([]);
  });

  it("every route handler resolves the signed-in tenant and answers 401/403 itself", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const f of files.filter((x) => /^src\/app\/.*\/route\.ts$/.test(x.rel))) {
      const sf = parse(f.full);
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && exported(st) && /^(GET|POST|PUT|PATCH|DELETE)$/.test(st.name?.getText() ?? "")) {
          checked++;
          if (!callsOwn(st, ["routeRequestContext"])) missing.push(`${f.rel}#${st.name!.getText()}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it("every non-public page resolves the request context in its default export", () => {
    const missing: string[] = [];
    for (const f of files.filter((x) => /^src\/app\/(.*\/)?page\.tsx$/.test(x.rel) && !PUBLIC_PAGES.some((p) => p.test(x.rel)))) {
      const sf = parse(f.full);
      const page = sf.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && (ts.getCombinedModifierFlags(s) & ts.ModifierFlags.Default) !== 0);
      if (!page || !callsOwn(page, ACTION_CHECKS)) missing.push(f.rel);
    }
    expect(missing).toEqual([]);
  });

  it("public pages read no tenant data", () => {
    const offenders = files
      .filter((x) => /^src\/app\/(.*\/)?page\.tsx$/.test(x.rel) && PUBLIC_PAGES.some((p) => p.test(x.rel)))
      .filter((x) => /withTenant|@\/lib\/db"/.test(readFileSync(x.full, "utf8")))
      .map((x) => x.rel);
    expect(offenders).toEqual([]);
  });
});
