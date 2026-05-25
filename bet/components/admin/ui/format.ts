/**
 * Server-safe formatters (PR-BET-HOTFIX-LOCAL).
 *
 * These were originally re-exported from `primitives.tsx`, but that
 * file is marked `"use client"` — Next.js's React Server Components
 * runtime then refuses to invoke any export from a "use client" module
 * from a server component, with the error:
 *
 *   Attempted to call fmtRelative() from the server but fmtRelative
 *   is on the client.
 *
 * The fix: pure functions live here in a NON-client module so both
 * server pages and client components can import them. `primitives.tsx`
 * still re-exports them for back-compat with any client-only callers
 * that imported from there.
 */

export function fmtCoins(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-IN");
}

export function fmtPct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}
