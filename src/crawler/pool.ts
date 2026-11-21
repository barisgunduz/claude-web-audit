/** Runs `work` for every item with at most `limit` running at once. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (!shouldStop()) {
      const index = next++;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
