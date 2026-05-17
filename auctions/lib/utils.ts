export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Short relative-time label matching what the Bet page renders, so users
 * who land on /auctions feel like they're still on Kalki.
 */
export function relativeTime(ms: number, suffix: "in" | "ago"): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 2) return suffix === "in" ? `in ${days}d` : `${days}d ago`;
  if (hours >= 1) return suffix === "in" ? `in ${hours}h` : `${hours}h ago`;
  if (minutes >= 1) return suffix === "in" ? `in ${minutes}m` : `${minutes}m ago`;
  return suffix === "in" ? "any minute" : "just now";
}
