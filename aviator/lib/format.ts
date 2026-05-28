/**
 * Tiny number formatters shared by every panel. Centralised so a
 * future unit change is one edit.
 *
 * Balances and bets are expressed in coins. The local-currency VALUE
 * of a balance (what the user paid per coin) is derived separately from
 * the backend's PPP pricing — see `lib/useCoinValue.ts` — and shown
 * alongside the coin count on the wallet panel.
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
