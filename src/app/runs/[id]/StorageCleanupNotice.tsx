import { pendingDocumentStorageCleanupCount } from "@/lib/documentStorageCleanup";
import StorageCleanupRetry from "./StorageCleanupRetry";
import { requireTenantId } from "@/lib/requestContext";

export default async function StorageCleanupNotice({ runId }: { runId: string }) {
  const count = await pendingDocumentStorageCleanupCount(await requireTenantId(), runId);
  return count ? <StorageCleanupRetry runId={runId} count={count} /> : null;
}
