// scripts/change-tier.cjs: the tier of a change follows the most consequential file it touches, and an
// unplaced path is treated as tier A until someone places it deliberately. Screen files are read: a server
// page, an inline server action or a data import makes one A (B32-M01).
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { tierOf, classify } = require("../../../scripts/change-tier.cjs") as {
  tierOf: (f: string, content?: string | null) => "A" | "B" | "C";
  classify: (files: string[], contentOf?: (f: string) => string | null | (string | null)[]) => { tier: "A" | "B" | "C"; requires: string[] };
};
const CLIENT = '"use client";\n\nexport default function X() { return null; }\n';

describe("change tiers", () => {
  it("places research-meaning and stored-data files in A", () => {
    for (const f of ["api/parse-stats-file.py", "supabase/migrations/0118_x.sql", "src/lib/crosstabs.ts", "src/lib/documentBin.ts", "src/app/api/runs/[id]/story/export/route.ts", "scripts/parse_stats_worker.py"]) {
      expect(tierOf(f), f).toBe("A");
    }
  });
  it("places screens and display-only helpers in B", () => {
    for (const f of ["src/app/runs/[id]/SectionDashboard.tsx", "src/components/StageLook.tsx"]) expect(tierOf(f, CLIENT), f).toBe("B");
    for (const f of ["src/lib/rowCells.ts", "src/lib/sectionStatus.ts"]) expect(tierOf(f), f).toBe("B");
    // A presentational server component outside src/app (no data access) stays B.
    expect(tierOf("src/components/icons.tsx", "export function HomeIcon() { return null; }\n")).toBe("B");
  });
  it("places docs, tests, styles and tooling in C", () => {
    for (const f of ["docs/x.md", "claude/answer-domain.md", "src/lib/__tests__/a.test.ts", "e2e/ui/a.check.mjs", "src/app/globals.css", ".github/workflows/validate.yml", "scripts/change-tier.cjs", "package.json"]) {
      expect(tierOf(f), f).toBe("C");
    }
  });
  it("treats an unplaced path as A, and a change takes its highest tier", () => {
    expect(tierOf("somewhere/new.rs")).toBe("A");
    expect(classify(["docs/a.md", "src/app/runs/[id]/X.tsx"], () => CLIENT).tier).toBe("B");
    expect(classify(["docs/a.md", "src/app/runs/[id]/X.tsx", "api/parse-stats-file.py"], () => CLIENT).tier).toBe("A");
    expect(classify(["docs/a.md"]).tier).toBe("C");
    expect(classify(["api/parse-stats-file.py"]).requires.join(" ")).toMatch(/Independent review/);
  });

  it("reads screen files: a server page, an inline server action or a data import is A (Codex B32-M01)", () => {
    // The real project page: a server component whose inline server actions extract findings.
    const page = readFileSync(path.resolve("src/app/runs/[id]/page.tsx"), "utf8");
    expect(page).toMatch(/extractFindingsFromDocument/);
    expect(tierOf("src/app/runs/[id]/page.tsx", page)).toBe("A");
    expect(tierOf("src/app/runs/[id]/Panel.tsx", '"use client";\nimport { x } from "@/lib/db";\n')).toBe("A");
    expect(tierOf("src/components/Thing.tsx", 'async function save() {\n  "use server";\n}\n')).toBe("A");
    // A client component after a leading comment is still a client component.
    expect(tierOf("src/app/runs/[id]/Card.tsx", '// A card.\n/* more */\n"use client";\nexport default function C() {}\n')).toBe("B");
    // Mixed: one display-only client component and the server page make the change A.
    const files: Record<string, string> = { "src/app/runs/[id]/Card.tsx": CLIENT, "src/app/runs/[id]/page.tsx": page };
    expect(classify(Object.keys(files), (f) => files[f] ?? null).tier).toBe("A");
    // Unreadable content (a deleted or renamed-away file not found) and an unknown path are A.
    expect(tierOf("src/app/runs/[id]/Gone.tsx", null)).toBe("A");
    expect(tierOf("src/app/runs/[id]/Gone.tsx")).toBe("A");
    expect(tierOf("lib/elsewhere.ts")).toBe("A");
  });
});

// M-B35-01 (Codex, batch 35 review): both sides of a change count. Real git repositories in a temporary
// folder and the actual CLI, as the review's repros: a server page turned client-only, and a data
// import and write removed from a component, are A; a display-only client edit stays B; a deleted
// server page is A and a deleted display-only component B.
describe("change-tier reads both sides of a changed file", () => {
  const cli = path.resolve("scripts/change-tier.cjs");
  const SERVER_PAGE = 'export default async function Page() {\n  async function save() {\n    "use server";\n  }\n  return null;\n}\n';
  const DATA_CLIENT = '"use client";\nimport { pool } from "@/lib/db";\nexport default function P() { void pool; return null; }\n';
  const CLIENT_ONLY = '"use client";\nexport default function P() { return null; }\n';
  const CLIENT_EDITED = '"use client";\nexport default function P() { return "changed"; }\n';
  function repoTier(file: string, before: string | null, after: string | null): string {
    const dir = mkdtempSync(path.join(tmpdir(), "tier-repo-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    writeFileSync(path.join(dir, "README.md"), "x\n");
    if (before !== null) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), before);
    }
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "change");
    if (after === null) rmSync(path.join(dir, file));
    else {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), after);
    }
    git("add", "-A");
    git("commit", "-qm", "change");
    const out = execFileSync(process.execPath, [cli, "--base", "main"], { cwd: dir, encoding: "utf8" });
    return /Change tier: ([ABC])/.exec(out)![1];
  }
  it("is A when server or data behaviour is removed, and B for a display-only edit", () => {
    expect(repoTier("src/app/runs/[id]/page.tsx", SERVER_PAGE, CLIENT_ONLY)).toBe("A");
    expect(repoTier("src/app/runs/[id]/Panel.tsx", DATA_CLIENT, CLIENT_ONLY)).toBe("A");
    expect(repoTier("src/app/runs/[id]/Panel.tsx", CLIENT_ONLY, CLIENT_EDITED)).toBe("B");
    expect(repoTier("src/app/runs/[id]/page.tsx", SERVER_PAGE, null)).toBe("A");
    expect(repoTier("src/app/runs/[id]/Panel.tsx", CLIENT_ONLY, null)).toBe("B");
    expect(repoTier("src/app/runs/[id]/Panel.tsx", null, CLIENT_ONLY)).toBe("B");
  });
  it("classifies a file by its highest version when given several", () => {
    expect(classify(["src/app/runs/[id]/Panel.tsx"], () => [CLIENT_ONLY, DATA_CLIENT]).tier).toBe("A");
    expect(classify(["src/app/runs/[id]/Panel.tsx"], () => []).tier).toBe("A");
  });
});
