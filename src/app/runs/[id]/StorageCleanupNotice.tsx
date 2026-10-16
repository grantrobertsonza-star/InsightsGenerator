import { pendingDocumentStorageCleanupCount } from "@/lib/documentStorageCleanup";
import StorageCleanupRetry from "./StorageCleanupRetry";

export default async function StorageCleanupNotice({ runId }: { runId: string }) {
  const count = await pendingDocumentStorageCleanupCount(process.env.DEFAULT_TENANT_ID!, runId);
  return count ? <StorageCleanupRetry runId={runId} count={count} /> : null;
}
