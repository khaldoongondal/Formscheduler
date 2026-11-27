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
