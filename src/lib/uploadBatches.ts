import { IMPORT_LIMITS } from "./importLimits";

/**
 * How the Add files dialog sends the files chosen together (Grant, 28 October 2026: a new project's upload
 * failed with "Unexpected end of form"). Every request passes the sign-in proxy, which keeps only the first
 * 100 MiB of a body (next.config.ts `proxyClientMaxBodySize`, matching `bodySizeLimit`). All the chosen files
 * used to go in one request, so files that were each within the limit but together over 100 MiB were cut off
 * before the server could check any of them, and the page failed instead of saying why.
 *
 * Files go in order, in batches whose combined size is at most the per-file limit (`maxFileBytes`,
 * 100,000,000 bytes): the largest supported file fits alone, with room for the form's own few hundred bytes
 * per file under the proxy's 104,857,600. A file over the per-file limit is never sent; it is returned in
 * `tooLarge` to be named to the researcher (the server refuses such a file too, but only when it arrives
 * whole, which a file that size cannot).
 */
export function planUploadBatches<T extends { size: number }>(
  files: T[],
  limit: number = IMPORT_LIMITS.maxFileBytes,
): { batches: T[][]; tooLarge: T[] } {
  const batches: T[][] = [];
  const tooLarge: T[] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const f of files) {
    if (f.size > limit) {
      tooLarge.push(f);
      continue;
    }
    if (current.length > 0 && bytes + f.size > limit) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(f);
    bytes += f.size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, tooLarge };
}
