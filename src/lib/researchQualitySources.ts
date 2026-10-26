// Research Quality Review v1: immutable text snapshots of the selected project documents
// (brief sections 4 and 5, fit assessment section 4).
//
// The ordinary documents.extracted_text is mutable and keeps no page map, so the module stores its
// own snapshot: canonical text, a segment map (real PDF pages, converted Word pages, or paragraphs
// when there are no pages) and SHA-256 of both the stored bytes and the canonical text. Every
// locator and quote in a review refers to one such snapshot.
//
// Supported in v1: text PDF, DOCX (through the existing LibreOffice conversion, which also saves the
// app's usual preview PDF, an accepted side effect; or direct Word text when conversion is not
// available) and UTF-8 TXT. Anything else, a scanned PDF with no text layer or binary data is an
// explicit "unavailable" with the reason, never interpreted as text. No model call happens here.
import mammoth from "mammoth";
import { buildSegments, sha256 } from "./researchQualityRules";
import { extractDocumentText } from "./extractFindings";
import { supabaseAdmin } from "./supabaseAdmin";
import { ResearchQualityError, type Segment } from "./researchQualityTypes";

const BUCKET = "documents";
export const EXTRACTOR_VERSION = "rq-reader@1";

export type SourceSnapshot = {
  filename: string;
  contentSha256: string;
  canonicalSha256: string;
  extractor: "pdf_pages" | "office_pdf_pages" | "docx_text" | "plain_text";
  canonicalText: string;
  segments: Segment[];
};
/** A document that cannot be reviewed; the message says why and is shown to the researcher. */
export class SourceUnavailableError extends ResearchQualityError {}

/** Reads one owned document (storage path from an owned documents row) into a snapshot. */
export async function readSourceSnapshot(doc: { id: string; storage_path: string; source_filename: string }): Promise<SourceSnapshot> {
  const name = doc.source_filename.toLowerCase();
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(doc.storage_path);
  if (error || !data) throw new SourceUnavailableError(`${doc.source_filename} could not be downloaded (${error?.message ?? "no data"}).`);
  const bytes = Buffer.from(await data.arrayBuffer());
  const contentSha256 = sha256(bytes.toString("base64"));

  let pages: { pageNumber: number; text: string }[] | null = null;
  let text = "";
  let extractor: SourceSnapshot["extractor"];
  if (name.endsWith(".txt")) {
    // Refuse binary data rather than treat it as text: a NUL byte or invalid UTF-8 means it is not text.
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (bytes.includes(0) || decoded.includes("�")) throw new SourceUnavailableError(`${doc.source_filename} is not UTF-8 text.`);
    text = decoded;
    extractor = "plain_text";
  } else if (name.endsWith(".pdf")) {
    const extracted = await extractDocumentText(doc.storage_path, doc.source_filename, doc.id);
    pages = extracted.pages;
    text = extracted.fullText;
    extractor = "pdf_pages";
  } else if (name.endsWith(".docx")) {
    try {
      const extracted = await extractDocumentText(doc.storage_path, doc.source_filename, doc.id);
      pages = extracted.pages;
      text = extracted.fullText;
      extractor = "office_pdf_pages";
    } catch {
      // The converter is optional. Without it the Word text is read directly, with paragraph
      // segments and no invented page numbers.
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
      extractor = "docx_text";
    }
    if (!text.trim()) {
      text = (await mammoth.extractRawText({ buffer: bytes })).value;
      pages = null;
      extractor = "docx_text";
    }
  } else {
    throw new SourceUnavailableError(`${doc.source_filename}: only PDF, Word (.docx) and plain-text (.txt) documents can be reviewed in this version.`);
  }
  const { text: canonical, segments } = buildSegments(pages && pages.length ? pages : null, text);
  if (!canonical.trim()) {
    throw new SourceUnavailableError(`${doc.source_filename} has no readable text (a scanned PDF needs text recognition, which this version does not do).`);
  }
  return { filename: doc.source_filename, contentSha256, canonicalSha256: sha256(canonical), extractor, canonicalText: canonical, segments };
}
