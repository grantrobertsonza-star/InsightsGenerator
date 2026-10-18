// IMP-001 (worker scope): how the app proves to the Python conversion function
// (api/parse-stats-file.py) that THIS app chose the file to read.
//
// The function downloads with the service-role key, so whoever can call it can read any stored
// object. It used to accept a shared-secret header plus a caller-chosen storagePath and bucket:
// a request that leaked once (a log, a proxy) could be replayed for any other tenant's path
// forever. Now the secret never leaves the app. Each request carries an HMAC-SHA256 signature
// over the exact action, bucket and storage path, valid for SIGNATURE_LIFETIME_SECONDS. The
// function recomputes it and refuses anything else, so a captured request reads only the one
// file it was issued for, only briefly, and cannot be retargeted.
//
// The app only signs paths read from documents rows under the request's tenant (callers in
// parseStatsFile.ts receive storage_path from owned rows), and the path itself must have the
// tenant/run/file shape documentUpload.ts creates. Both sides check that shape.
import { createHmac } from "node:crypto";

export const SIGNATURE_HEADER = "x-parse-stats-signature";
export const SIGNATURE_LIFETIME_SECONDS = 300;
const STORAGE_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^/\\]+$/i;

export function signedPayload(expiresAt: number, action: string, bucket: string, storagePath: string): string {
  return `v1\n${expiresAt}\n${action}\n${bucket}\n${storagePath}`;
}

/** The signature header value for one conversion request. Throws when it cannot be signed safely. */
export function signParseRequest(action: string, bucket: string, storagePath: string, now = Date.now()): string {
  const secret = process.env.PARSE_STATS_SHARED_SECRET;
  if (!secret) {
    throw new Error(
      "PARSE_STATS_SHARED_SECRET is not set, so the conversion service request cannot be signed. Set the same value in this app's environment and the parse-stats-file function's environment.",
    );
  }
  if (!STORAGE_PATH.test(storagePath) || storagePath.includes("..")) {
    throw new Error("Refusing to sign a conversion request for a storage path that is not a tenant/run/file path.");
  }
  const expiresAt = Math.floor(now / 1000) + SIGNATURE_LIFETIME_SECONDS;
  const mac = createHmac("sha256", secret).update(signedPayload(expiresAt, action, bucket, storagePath)).digest("hex");
  return `v1.${expiresAt}.${mac}`;
}
