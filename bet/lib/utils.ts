import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format an integer coin balance with thousands separators. */
export function fmtCoins(n: number | bigint): string {
  return Number(n).toLocaleString("en-US");
}

/** Format a 0..1 probability as a percentage string. Kept for genuine
 *  percentages like progress bars — prefer `fmtPrice` for market prices. */
export function fmtPct(p: number, digits = 0): string {
  return `${(p * 100).toFixed(digits)}%`;
}

/**
 * Format a 0..1 market price as a decimal string ("0.55"). This is how
 * prediction markets like Polymarket and Kalshi quote — a YES share trading
 * at 0.55 means the market thinks YES has a 55% chance, AND you pay 0.55
 * coins per share, AND you receive 1 coin per share on a YES resolution.
 */
export function fmtPrice(p: number, digits = 2): string {
  if (!Number.isFinite(p)) return "—";
  return p.toFixed(digits);
}

/** Short relative time: "2m ago", "3h ago", "yesterday". */
export function timeAgo(iso: Date | string): string {
  const t = typeof iso === "string" ? new Date(iso) : iso;
  const sec = Math.floor((Date.now() - t.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  const d = Math.floor(sec / 86400);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  return t.toLocaleDateString();
}

/** XP needed to reach the given level. Curve: level n requires n*250 XP. */
export function xpForLevel(level: number): number {
  return level * 250;
}

export function levelFromXp(xp: number): { level: number; toNext: number; progress: number } {
  let level = 1;
  let acc = 0;
  while (acc + xpForLevel(level) <= xp) {
    acc += xpForLevel(level);
    level += 1;
  }
  const within = xp - acc;
  const need = xpForLevel(level);
  return { level, toNext: need - within, progress: within / need };
}
