/**
 * Tiny number formatters shared by every panel. Centralised so a
 * future unit change (we're on coins; 1 coin = ₹1 by platform decree,
 * see `bet/lib/coins.ts`) is one edit.
 *
 * History: surfaces used to display ₹ amounts. The product moved to
 * a unified-wallet model where balances and bets are expressed in
 * coins, so the UI was updated to match — same numeric values, just
 * a "coins" suffix instead of a "₹" prefix.
 */

/**
 * Format a coin amount as `"1,234 coins"` (or `"1 coin"`) — falls back
 * to `"—"` while the value is loading. Use `compact: true` for tight
 * spaces (e.g. mid-button) where the shorter `1,234c` reads better.
 */
export function formatCoins(
  n: number | null | undefined,
  opts: { compact?: boolean } = {},
): string {
  if (n == null) return '—';
  const formatted = n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  if (opts.compact) return `${formatted}c`;
  return `${formatted} ${n === 1 ? 'coin' : 'coins'}`;
}

export function formatMultiplier(m: number): string {
  // Multipliers are conventionally displayed with two decimals up to
  // 99.99×, then one decimal beyond that (the readout starts to
  // jitter visually if we always force two decimals on big numbers).
  if (m >= 100) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

export function formatProfit(amount: number, multiplier: number): string {
  const payout = Math.floor(amount * multiplier);
  return formatCoins(payout);
}
