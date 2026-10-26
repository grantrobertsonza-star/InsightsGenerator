// scripts/change-tier.cjs: the tier of a change follows the most consequential file it touches, and an
// unplaced path is treated as tier A until someone places it deliberately.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { tierOf, classify } = require("../../../scripts/change-tier.cjs") as {
  tierOf: (f: string) => "A" | "B" | "C";
  classify: (files: string[]) => { tier: "A" | "B" | "C"; requires: string[] };
};

describe("change tiers", () => {
  it("places research-meaning and stored-data files in A", () => {
    for (const f of ["api/parse-stats-file.py", "supabase/migrations/0118_x.sql", "src/lib/crosstabs.ts", "src/lib/documentBin.ts", "src/app/api/runs/[id]/story/export/route.ts", "scripts/parse_stats_worker.py"]) {
      expect(tierOf(f), f).toBe("A");
    }
  });
  it("places screens and display-only helpers in B", () => {
    for (const f of ["src/app/runs/[id]/SectionDashboard.tsx", "src/components/StageLook.tsx", "src/lib/rowCells.ts", "src/lib/sectionStatus.ts"]) {
      expect(tierOf(f), f).toBe("B");
    }
  });
  it("places docs, tests, styles and tooling in C", () => {
    for (const f of ["docs/x.md", "claude/answer-domain.md", "src/lib/__tests__/a.test.ts", "e2e/ui/a.check.mjs", "src/app/globals.css", ".github/workflows/validate.yml", "scripts/change-tier.cjs", "package.json"]) {
      expect(tierOf(f), f).toBe("C");
    }
  });
  it("treats an unplaced path as A, and a change takes its highest tier", () => {
    expect(tierOf("somewhere/new.rs")).toBe("A");
    expect(classify(["docs/a.md", "src/app/runs/[id]/X.tsx"]).tier).toBe("B");
    expect(classify(["docs/a.md", "src/app/runs/[id]/X.tsx", "api/parse-stats-file.py"]).tier).toBe("A");
    expect(classify(["docs/a.md"]).tier).toBe("C");
    expect(classify(["api/parse-stats-file.py"]).requires.join(" ")).toMatch(/Independent review/);
  });
});
