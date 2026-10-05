/**
 * Runs `fn` over `items` with at most `concurrency` calls in flight at
 * once, rather than either fully sequential (await in a for-loop, the slow
 * default everywhere in this codebase until now) or fully parallel
 * (Promise.all over the whole list, which can fire dozens of Claude calls
 * at the same instant and trip rate limits). A worker-pool shape: each of
 * `concurrency` workers pulls the next unclaimed index and processes it
 * until the list is exhausted, so slow and fast items don't leave workers
 * idle waiting on a batch boundary the way chunking into fixed-size
 * batches would.
 *
 * `fn` is expected to handle its own errors (store them, push to an
 * `errors` array, whatever the caller needs) rather than throwing, since a
 * throw here rejects the whole call and anything mid-flight is abandoned;
 * this mirrors how processRunAction already collected per-document errors
 * before this helper existed.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
