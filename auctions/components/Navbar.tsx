import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/session";
import { backend, BackendUnauthorized } from "@/lib/backend";
import {
  DEFAULT_LOCALE,
  LOCALE_HEADER,
  isLocale,
  localizedPath,
  t,
  type Locale,
} from "@/lib/i18n";
import { LanguageSwitcher } from "./LanguageSwitcher";
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

/** Inline star glyph for the watchlist link. Same hollow-stroke style
 *  as the other Navbar icons; fills to amber when the user is on the
 *  watchlist page (handled by the parent's active styling). */
function StarIcon() {
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
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
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
  // Locale comes from the request header set by middleware. The
  // navbar renders inside the [locale]/ tree, so the header is
  // always present in practice — but fall back defensively so a
  // misconfigured edge doesn't blow the page up.
  const hdrs = await headers();
  const raw = hdrs.get(LOCALE_HEADER);
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const tr = (k: string) => t(k, locale);
  const lp = (path: string) => localizedPath(path, locale);
  let me: {
    username: string;
    email: string | null;
    coinBalance: number;
  } | null = null;
  let unreadCount = 0;
  if (token) {
    try {
      const authed = backend.authed(token);
      // Race both calls — /auth/me is the gate; the unread badge is
      // best-effort and rendered as 0 if it fails. Both calls are
      // server-rendered so the badge is correct on first paint
      // without any client-side hydration round-trip.
      const [meResp, badgeResp] = await Promise.allSettled([
        authed.get<{
          username: string;
          email: string | null;
          coinBalance: number;
        }>("/auth/me"),
        authed.get<{ count: number }>("/notifications/unread-count"),
      ]);
      if (meResp.status === "fulfilled") {
        me = meResp.value;
      } else if (meResp.reason instanceof BackendUnauthorized) {
        redirect(lp("/login"));
      }
      if (badgeResp.status === "fulfilled") {
        unreadCount = badgeResp.value.count;
      }
    } catch (err) {
      // Transient errors land users on a stale balance for a beat — only
      // redirect when the upstream actively rejects the JWT.
      if (err instanceof BackendUnauthorized) redirect(lp("/login"));
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-divider)] bg-[var(--color-bg)]/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href={lp("/")} className="flex items-center gap-2">
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
            href={lp("/")}
            className="hidden text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200 sm:inline"
          >
            {tr("nav.games")}
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
                href={lp("/me/watchlist")}
                aria-label={tr("nav.watchlist")}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:border-amber-400/40 hover:text-amber-200 transition"
              >
                <StarIcon />
              </Link>
              <Link
                href={lp("/notifications")}
                aria-label={
                  unreadCount > 0
                    ? `${tr("nav.notifications")} (${unreadCount})`
                    : tr("nav.notifications")
                }
                className="relative grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:border-cyan-500/40 transition"
              >
                <BellIcon />
                {unreadCount > 0 && (
                  <span
                    aria-hidden
                    className="absolute -top-1 -right-1 grid min-w-[18px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white shadow-md"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              <Link
                href={lp("/profile")}
                aria-label={tr("nav.profile")}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/80 hover:border-cyan-500/40 transition"
                title={me.username ? `@${me.username}` : tr("nav.profile")}
              >
                <UserIcon />
              </Link>
              <LanguageSwitcher currentLocale={locale} />
            </>
          ) : (
            <>
              <Link
                href={lp("/login")}
                className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1 text-cyan-200 hover:bg-cyan-500/15"
              >
                {tr("nav.signIn")}
              </Link>
              <LanguageSwitcher currentLocale={locale} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}
