import Decimal from 'decimal.js';

/**
 * Pure bidding-engine algorithms. No DB, no I/O. The status classifier and
 * the winner selector are the entire business rule of UniqueBid; everything
 * else in this codebase is plumbing around these two functions.
 *
 * Amounts are always passed as Decimal to avoid floating-point error.
 * Internally we normalise on `toFixed(2)` for grouping, because bids are
 * constrained to at most 2 decimal places at the API boundary.
 *
 * # Status taxonomy (user-facing)
 *
 * The product spec names three states that a player ever sees for their
 * most-recent bid. Backend enum values match the spec one-to-one so the
 * BidPanel can switch on these strings directly:
 *
 *   - LOWEST_UNIQUE        "Lowest & Unique"      → winning right now
 *   - DUPLICATE_COLLIDING  "Duplicate / Colliding" → another user picked
 *                                                    the same amount
 *   - UNIQUE_LOSING        "Unique Losing Bid"    → unique amount but a
 *                                                    lower unique exists
 *   - NO_BID               (internal)             → user hasn't bid yet
 *
 * # Admin manipulation modes
 *
 * Three modes mounted on `Auction.manipulationMode`:
 *
 *   - NORMAL        — natural lowest-unique-bid rule. Default.
 *   - NO_WINNER     — kill-switch. The ringmaster sentinel user auto-
 *                     places a duplicate against any "Lowest & Unique"
 *                     bid so that classification can never stick. This
 *                     module doesn't need to know about NO_WINNER —
 *                     the duplicates make the natural rules produce the
 *                     right output. The auto-bid lives in BidsService.
 *   - FIXED_WINNER  — admin pre-picks the winning amount. The first
 *                     bidder at exactly `fixedWinningAmount` is treated
 *                     as the winner; later bidders at the same amount
 *                     see DUPLICATE_COLLIDING; everyone else sees their
 *                     normal classification but never LOWEST_UNIQUE
 *                     (because the admin has already declared the winner).
 */

export type BidStatusKind =
  | 'LOWEST_UNIQUE'
  | 'DUPLICATE_COLLIDING'
  | 'UNIQUE_LOSING'
  | 'NO_BID';

export interface PlacedBid {
  userId: string;
  amount: Decimal;
}

/** Bid row with the bits we need for fixed-winner first-bidder lookup. */
export interface BidRow {
  id: string;
  userId: string;
  amount: Decimal;
  createdAt: Date;
}

export interface ClassifyOpts {
  /** When set, the auction is in FIXED_WINNER mode and this is the
   *  admin-picked winning amount. */
  fixedWinningAmount?: Decimal | null;
}

/**
 * Classify a hypothetical [candidate] amount against the set of [others]
 * already placed in the auction. `others` is what the database returns —
 * the candidate is NOT in that list yet.
 *
 * Fairness contract: returns only the category. Callers MUST NOT leak
 * counts, other users' amounts, or the unique set.
 */
export function classifyCandidate(
  candidate: Decimal,
  others: Decimal[],
  opts: ClassifyOpts = {},
): BidStatusKind {
  if (candidate.lte(0)) return 'UNIQUE_LOSING';
  return classifyAmount(candidate, [...others, candidate], opts);
}

/**
 * Classify an amount that is already in the placed-bid set. Used after the
 * user has committed coins — they're told the status of their actual bid,
 * not a hypothetical. Pass the full bid list (including the user's own
 * bid) — order doesn't matter, only counts.
 *
 * For FIXED_WINNER mode without bid timestamps this can't resolve
 * "earliest among tied bidders" — every fixed-amount bidder will see
 * LOWEST_UNIQUE if alone, or DUPLICATE_COLLIDING if tied. Real call sites
 * should use `classifyBidFor` instead.
 */
export function classifyPlacedAmount(
  amount: Decimal,
  allAmounts: Decimal[],
  opts: ClassifyOpts = {},
): BidStatusKind {
  if (allAmounts.length === 0) return 'NO_BID';
  return classifyAmount(amount, allAmounts, opts);
}

/**
 * Per-bid classification (uses bid timestamps to resolve fixed-winner
 * priority). Prefer this over `classifyPlacedAmount` whenever you have
 * the full Bid rows handy — only this overload returns correct results
 * in FIXED_WINNER mode for users who tied on the fixed amount.
 */
export function classifyBidFor(
  myBidId: string,
  bids: BidRow[],
  opts: ClassifyOpts = {},
): BidStatusKind {
  const me = bids.find((b) => b.id === myBidId);
  if (!me) return 'NO_BID';
  return classifyAmountForBid(me, bids, opts);
}

// ─── internals ──────────────────────────────────────────────────────────

function classifyAmount(
  amount: Decimal,
  allAmounts: Decimal[],
  opts: ClassifyOpts,
): BidStatusKind {
  const counts = countByKey(allAmounts);
  const myKey = key(amount);
  const myCount = counts.get(myKey) ?? 0;
  if (myCount === 0) return 'NO_BID';
  const myIsUnique = myCount === 1;

  // Fixed-winner shortcut: when an admin has rigged the outcome, the
  // only way any bid is LOWEST_UNIQUE is by matching the fixed amount.
  // Without bid timestamps we can't distinguish "first to bid" from
  // "later collision", so the amount-only path lets the fixed-amount
  // unique through. `classifyBidFor` handles the timestamp version.
  const fixed = opts.fixedWinningAmount;
  if (fixed) {
    if (!myIsUnique) return 'DUPLICATE_COLLIDING';
    return myKey === key(fixed) ? 'LOWEST_UNIQUE' : 'UNIQUE_LOSING';
  }

  if (!myIsUnique) return 'DUPLICATE_COLLIDING';
  const uniqueKeys = [...counts.entries()]
    .filter(([, c]) => c === 1)
    .map(([k]) => k);
  const lowestUnique = uniqueKeys.length ? uniqueKeys.reduce(minByDecimal) : null;
  return lowestUnique !== null && myKey === lowestUnique
    ? 'LOWEST_UNIQUE'
    : 'UNIQUE_LOSING';
}

function classifyAmountForBid(
  me: BidRow,
  bids: BidRow[],
  opts: ClassifyOpts,
): BidStatusKind {
  const fixed = opts.fixedWinningAmount;
  if (!fixed) {
    return classifyAmount(
      me.amount,
      bids.map((b) => b.amount),
      opts,
    );
  }
  const fixedKey = key(fixed);
  const myKey = key(me.amount);
  if (myKey !== fixedKey) {
    // Off-target bid. Normal counting determines duplicate vs unique,
    // but the admin has declared the winner elsewhere — so any natural
    // LOWEST_UNIQUE we'd compute here must be demoted to UNIQUE_LOSING.
    const natural = classifyAmount(
      me.amount,
      bids.map((b) => b.amount),
      { fixedWinningAmount: null },
    );
    return natural === 'LOWEST_UNIQUE' ? 'UNIQUE_LOSING' : natural;
  }
  // I bid the fixed amount. Earliest bidder wins; the rest collide.
  const matchers = bids
    .filter((b) => key(b.amount) === fixedKey)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  if (matchers.length === 0) return 'NO_BID';
  return matchers[0].id === me.id ? 'LOWEST_UNIQUE' : 'DUPLICATE_COLLIDING';
}

/**
 * Select the auction winner under the natural lowest-unique-bid rule.
 * Returns null when no amount appears exactly once. Used directly by
 * the unit tests; production callers should use `selectWinnerFromBids`
 * which also handles FIXED_WINNER mode.
 */
export function selectWinner(bids: PlacedBid[]): PlacedBid | null {
  if (bids.length === 0) return null;
  const countsByAmount = new Map<string, number>();
  for (const b of bids) {
    const k = key(b.amount);
    countsByAmount.set(k, (countsByAmount.get(k) ?? 0) + 1);
  }
  const uniqueAmounts = [...countsByAmount.entries()]
    .filter(([, c]) => c === 1)
    .map(([k]) => k);
  if (uniqueAmounts.length === 0) return null;
  const winningKey = uniqueAmounts.reduce(minByDecimal);
  return bids.find((b) => key(b.amount) === winningKey) ?? null;
}

/**
 * Winner selection with full bid rows. Use from `AuctionsService.close`.
 *
 *   - FIXED_WINNER (opts.fixedWinningAmount): earliest bid at exactly
 *     that amount wins. Null if nobody hit the amount.
 *   - Otherwise: lowest-unique-bid rule via `selectWinner`.
 */
export function selectWinnerFromBids(
  bids: BidRow[],
  opts: ClassifyOpts = {},
): BidRow | null {
  if (bids.length === 0) return null;
  const fixed = opts.fixedWinningAmount;
  if (fixed) {
    const fixedKey = key(fixed);
    const matchers = bids
      .filter((b) => key(b.amount) === fixedKey)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return matchers[0] ?? null;
  }
  const winner = selectWinner(bids);
  if (!winner) return null;
  return (
    bids.find(
      (b) => b.userId === winner.userId && key(b.amount) === key(winner.amount),
    ) ?? null
  );
}

function key(amount: Decimal): string {
  return amount.toFixed(2);
}

function countByKey(amounts: Decimal[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of amounts) {
    const k = key(a);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function minByDecimal(a: string, b: string): string {
  return new Decimal(a).lt(new Decimal(b)) ? a : b;
}
