import { eraseExpiredBinItems, listBin, type BinItem } from "@/lib/documentBin";
import { requireTenantId } from "@/lib/requestContext";
import BinPanel from "./BinPanel";

/**
 * The project's bin, under Import data (claude/document-deletion-contract.md). Items older than the
 * bin period are erased here, when the project is opened, because the app has no background
 * scheduler. A failure to read or expire the bin is said, never shown as an empty bin.
 */
export default async function BinNotice({ runId }: { runId: string }) {
  const tenantId = await requireTenantId();
  let items: BinItem[] = [];
  let expired = 0;
  let error: string | null = null;
  try {
    expired = await eraseExpiredBinItems(tenantId, runId);
    items = await listBin(tenantId, runId);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  if (!error && items.length === 0 && expired === 0) return null;
  return <BinPanel runId={runId} items={items} expired={expired} error={error} />;
}
