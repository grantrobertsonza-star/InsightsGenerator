// The files a suggestion was drawn from (candidateSourceDocuments.sourceDocumentsOf): unknown when any
// evidence row has no recorded file, so a suggestion is never treated as drawn only from one file.
import { describe, expect, it } from "vitest";
import { sourceDocumentsOf } from "../candidateSourceDocuments";

describe("sourceDocumentsOf", () => {
  it("returns the distinct files, sorted", () => {
    expect(sourceDocumentsOf([{ source_document: "b" }, { source_document: "a" }, { source_document: "b" }])).toEqual(["a", "b"]);
  });
  it("is unknown (null) when any row has no file, or there is no evidence", () => {
    expect(sourceDocumentsOf([{ source_document: "a" }, { source_document: null }])).toBeNull();
    expect(sourceDocumentsOf([])).toBeNull();
  });
});
