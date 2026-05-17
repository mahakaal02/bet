import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import { TopupChip } from "./TopupChip";

/** Inline bell glyph — avoids pulling lucide-react into the auctions
 *  bundle for a single icon. Shape matches Bet's NotificationsBell. */
function BellIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/** User-silhouette glyph (same shape as lucide-react's `User`) — the
 *  Kalki Exchange navbar uses this icon for its profile button, and
 *  this matches it pixel-for-pixel so all three games look identical. */
function UserIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Top bar. Shared across the auctions app:
 *
 *   - Left: horse logo + "Kalki" wordmark. Always links to the hub at /.
 *   - Centre (md+): one navigation pill linking to /auctions so users
 *     can find the catalog from any sub-page.
 *   - Right: tappable coin chip → opens the Exchange wallet via SSO.
 *     Profile avatar → /profile, which is now the single place users
 *     sign out from.
 *
 * The previous design had "@username" text + a "Sign out" button right
 * here in the navbar. That's been replaced by the profile avatar — one
 * canonical place to manage the account.
 */
export async function Navbar() {
  const token = await getSessionToken();
  let me: {
    username: string;
    email: string | null;
    coinBalance: number;
  } | null = null;
  if (token) {
    try {
      me = await backend.authed(token).get<{
        username: string;
        email: string | null;
        coinBalance: number;
      }>("/auth/me");
    } catch (err) {
      // Transient errors land users on a stale balance for a beat — only
      // redirect when the upstream actively rejects the JWT.
      if (err instanceof BackendUnauthorized) redirect("/login");
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-divider)] bg-[var(--color-bg)]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2">
            <Image
              src="/kalki-logo.png"
              alt="Kalki"
              width={32}
              height={32}
              className="rounded-lg"
              priority
            />
            <span className="text-base font-black tracking-tight text-cyan-300">
              Kalki
            </span>
          </Link>
          {/* "Games" pill links back to the hub (which lists all three
              products). Previously labelled "Auctions" pointing at
              /auctions — but the hub is the canonical landing surface,
              and the pill doubles as a "back to game picker" affordance
              from any auctions sub-page. */}
          <Link
            href="/"
            className="hidden text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 sm:inline"
          >
            Games
          </Link>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {me ? (
            // Standard Kalki account row — same three icons in the same
            // order on every game's navbar (wallet · notifications ·
            // profile). Lets users build muscle memory across surfaces.
            <>
              <TopupChip balance={me.coinBalance} />
              <Link
                href="/notifications"
                aria-label="Notifications"
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:border-cyan-500/40 transition"
              >
                <BellIcon />
              </Link>
              <Link
                href="/profile"
                aria-label="Profile"
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:border-cyan-500/40 transition"
                title={me.username ? `@${me.username}` : "Profile"}
              >
                <UserIcon />
              </Link>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/15"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
