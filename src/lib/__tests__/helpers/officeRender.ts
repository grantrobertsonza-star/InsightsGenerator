import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// V-B36-02 (Codex): the full library run fails a rendered-slides check when two test workers convert
// at the same time with LibreOffice's default user profile, which one headless instance locks. Every
// test conversion runs on a profile of its own (a fresh folder), so parallel workers never share one.
// A failure keeps LibreOffice's exit code and output in the message, so a first failure can be read.
export const SOFFICE = ["soffice", "libreoffice"].find((b) => spawnSync("which", [b]).status === 0) ?? process.env.LIBREOFFICE_PATH;

/** LibreOffice's arguments for one conversion on a fresh profile of its own. */
export function officeArgs(input: string, format: "pdf" | "xlsx", outdir = path.dirname(input)): string[] {
  const profile = pathToFileURL(mkdtempSync(path.join(tmpdir(), "lo-profile-"))).href;
  return [`-env:UserInstallation=${profile}`, "--headless", "--convert-to", format, "--outdir", outdir, input];
}

export function officeConvert(input: string, format: "pdf" | "xlsx", outdir = path.dirname(input), timeout = 180_000): { status: number | null; detail: string } {
  if (!SOFFICE) return { status: null, detail: "LibreOffice is not installed" };
  const r = spawnSync(SOFFICE, officeArgs(input, format, outdir), { encoding: "utf8", timeout });
  return { status: r.status, detail: `exit ${r.status}${r.signal ? ` (${r.signal})` : ""}; stdout: ${r.stdout?.trim() ?? ""}; stderr: ${r.stderr?.trim() ?? ""}${r.error ? `; ${r.error.message}` : ""}` };
}
