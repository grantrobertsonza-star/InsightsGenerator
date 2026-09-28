import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import path from "path";

const execFileAsync = promisify(execFile);

// Default install location on Windows. Override with LIBREOFFICE_PATH in
// .env.local if LibreOffice was installed somewhere else.
const SOFFICE_PATH = process.env.LIBREOFFICE_PATH || "C:\\Program Files\\LibreOffice\\program\\soffice.exe";

/**
 * Converts a Word (.docx) or PowerPoint (.pptx) file to PDF using a local
 * LibreOffice install, so it can be run through the same page-by-page PDF
 * extraction and quote-grounding pipeline used for a native PDF upload.
 * Each PowerPoint slide becomes one PDF page.
 */
export async function convertOfficeDocToPdf(buffer: Buffer, originalFilename: string): Promise<Buffer> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "insights-elevator-"));
  const extension = path.extname(originalFilename) || ".docx";
  const inputPath = path.join(tempDir, `input${extension}`);

  try {
    await writeFile(inputPath, buffer);

    await execFileAsync(SOFFICE_PATH, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      inputPath,
    ]);

    const outputPath = path.join(tempDir, "input.pdf");
    return await readFile(outputPath);
  } catch (error) {
    throw new Error(
      `Could not convert "${originalFilename}" to PDF using LibreOffice. Make sure LibreOffice is ` +
        `installed and that soffice.exe is at ${SOFFICE_PATH} (or set LIBREOFFICE_PATH in .env.local ` +
        `to wherever it was actually installed). Underlying error: ` +
        `${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
