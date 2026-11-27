/**
 * PostgREST returns at most 1000 rows per request. This helper reads every
 * page of a query. It imports nothing from Supabase, so it is unit tested.
 */

export const TOO_MUCH_DATA_MESSAGE = "Too much data for this date range. Choose a shorter range.";

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Calls build(from, to) with .range() pages of `pageSize` until a short page.
 * Throws past maxRows so a page never hangs. Every query passed in must have a
 * stable `.order(...)` (use `id`), or rows can repeat or go missing between pages.
 */
export async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  opts?: { pageSize?: number; maxRows?: number }
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxRows = opts?.maxRows ?? 250000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const row of page) rows.push(row);
    if (rows.length > maxRows) throw new Error(TOO_MUCH_DATA_MESSAGE);
    if (page.length < pageSize) return rows;
  }
}

/** Default cap for keyset reads: the error fires long before a request times out. */
export const KEYSET_MAX_ROWS = 50000;

/**
 * Reads every row of a query in id order with keyset paging: each call gets
 * the last id seen (null first) and must add `.gt("id", afterId)` when set,
 * `.order("id")` and `.limit(limit)`. Unlike OFFSET pages, no page re-reads
 * the rows before it, so the cost grows with the row count, not its square.
 * Throws TOO_MUCH_DATA_MESSAGE past maxRows.
 */
export async function selectAllByKeyset<T extends { id: string }>(
  build: (afterId: string | null, limit: number) => PromiseLike<PageResult<T>>,
  opts?: { pageSize?: number; maxRows?: number }
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxRows = opts?.maxRows ?? KEYSET_MAX_ROWS;
  const rows: T[] = [];
  let afterId: string | null = null;

  for (;;) {
    const { data, error } = await build(afterId, pageSize);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    for (const row of page) rows.push(row);
    if (rows.length > maxRows) throw new Error(TOO_MUCH_DATA_MESSAGE);
    if (page.length < pageSize) return rows;
    const lastId: string = page[page.length - 1].id;
    if (afterId !== null && lastId <= afterId) throw new Error("Keyset paging did not advance; order the query by id.");
    afterId = lastId;
  }
}

/** Splits a list into chunks (for `.in()` filters that must stay short). */
export function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Runs work over items with at most `concurrency` calls in flight; results keep the input order. */
export async function mapInBatches<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let index = 0; index < items.length; index += concurrency) {
    const batch = await Promise.all(items.slice(index, index + concurrency).map(work));
    for (const result of batch) results.push(result);
  }
  return results;
}
