/**
 * Tiny number formatters shared by every panel. Centralised so a
 * future locale change (e.g. en-IN → another locale) is one edit.
 */

export function formatRupees(n: number | null | undefined): string {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function formatMultiplier(m: number): string {
  // Multipliers are conventionally displayed with two decimals up
  // to 99.99×, then one decimal beyond that (the readout starts to
  // jitter visually if we always force two decimals on big numbers).
  if (m >= 100) return `${m.toFixed(1)}×`;
  return `${m.toFixed(2)}×`;
}

export function formatProfit(amount: number, multiplier: number): string {
  const payout = Math.floor(amount * multiplier);
  return formatRupees(payout);
}
