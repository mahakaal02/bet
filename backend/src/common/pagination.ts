/**
 * Cursor-pagination helpers shared by the admin list endpoints.
 *
 * The standard pattern is: fetch `take + 1` rows, return the first
 * `take` as the page, and expose the id of the LAST returned row as the
 * `nextCursor`. The next request passes that cursor with `skip: 1`
 * (Prisma skips the cursor row), so page N+1 begins exactly at the first
 * row page N didn't return — no gap, no overlap.
 *
 * NOTE: several call sites previously computed `nextCursor` from the
 * *peeked* (`rows[take]`, i.e. take+1-th) row id which — combined with
 * `skip: 1` on the next request — silently dropped one row at every page
 * boundary. Routing them through `cursorPage` fixes that off-by-one.
 */

/** Clamp a client-supplied page size into `[1, max]`, defaulting to `def`. */
export function clampPageLimit(
  limit: number | undefined | null,
  def = 25,
  max = 50,
): number {
  return Math.min(max, Math.max(1, limit ?? def));
}

/**
 * Slice a `take + 1` over-fetch into a page plus a forward cursor.
 *
 * @param rows rows fetched with `take: take + 1`
 * @param take the page size requested by the caller
 * @returns `page` (≤ `take` rows) and `nextCursor` — the id of the last
 *          row in `page`, or `null` when there is no further page. Pair
 *          the cursor with `{ skip: 1, cursor: { id: nextCursor } }` on
 *          the follow-up query.
 */
export function cursorPage<T extends { id: string }>(
  rows: T[],
  take: number,
): { page: T[]; nextCursor: string | null } {
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    page,
    nextCursor: hasMore && page.length > 0 ? page[page.length - 1].id : null,
  };
}
