// Batch 65: a failed storage write names its underlying network cause (Codex's 120 MB check failed in one
// environment with only "fetch failed"). The trace recording through uploadDocumentsAction is in
// outputSelectionIdentity.db.test.ts; this covers the reading of the cause and the unchanged message without one.
import { describe, expect, it, vi } from "vitest";
vi.mock("../supabaseAdmin", () => ({ supabaseAdmin: {} }));
import { storageFailureCause, StorageWriteError } from "../documentUpload";

const fetchFailed = (cause: unknown) => ({ message: "fetch failed", originalError: Object.assign(new TypeError("fetch failed"), { cause }) });

describe("storage write failure cause", () => {
  it("reads the socket cause under supabase-js's error and fetch's TypeError, hiding addresses and tokens", () => {
    const socket = Object.assign(new Error("read ECONNRESET at https://x.example/storage/v1/object/a?token=abc Bearer eyJ.secret"), { code: "ECONNRESET" });
    const cause = storageFailureCause(fetchFailed(socket));
    expect(cause).toEqual({ code: "ECONNRESET", message: "read ECONNRESET at [address] Bearer [hidden]" });
    const e = new StorageWriteError("wave-a.csv", fetchFailed(socket));
    expect(e.message).toBe("Upload of wave-a.csv failed: fetch failed. The connection reported: ECONNRESET, read ECONNRESET at [address] Bearer [hidden].");
    expect(e.failureCause).toEqual(cause);
  });

  it("a headers timeout with no message keeps its code; an error with no cause keeps the message it always had", () => {
    expect(storageFailureCause(fetchFailed({ code: "UND_ERR_HEADERS_TIMEOUT" }))).toEqual({ code: "UND_ERR_HEADERS_TIMEOUT", message: "" });
    const plain = new StorageWriteError("wave-a.csv", { message: "The object exceeded the maximum allowed size" });
    expect(plain.message).toBe("Upload of wave-a.csv failed: The object exceeded the maximum allowed size");
    expect(plain.failureCause).toBeNull();
  });
});
