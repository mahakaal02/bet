import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../lib/api';
import { getUser } from '../lib/auth';

const BET_BASE = (
  import.meta.env.VITE_BET_BASE_URL ?? 'http://localhost:3100'
).replace(/\/$/, '');

/**
 * Admin-app landing screen. Mirrors the user-facing Kalki Hub — three
 * product tiles — but every tile routes into the corresponding admin
 * surface rather than the player-facing app:
 *
 *   - Auctions    → /auctions (this app, sidebar route)
 *   - Aviator     → /aviator/analytics (this app, sidebar route)
 *   - Exchange    → ${BET_BASE}/api/auth/sso?token=…&next=/admin
 *
 * The Auctions and Aviator tiles are internal SPA links — no token
 * hand-off needed because the admin's session cookie is already
 * scoped to this origin. The Exchange tile leaves to the Bet app,
 * which lives on a different origin, so we fetch a short-lived JWT
 * via `/auth/admin/sso-token` (PR-ADMIN-COOKIE-AUTH) and hand it to
 * Bet's SSO endpoint. The long-lived session JWT lives in an
 * httpOnly cookie that JS can't read — minting a 60s token on
 * demand keeps the handoff working without exposing the durable
 * credential.
 *
 * We target `/api/auth/sso` DIRECTLY (not `/admin?token=…`): Bet's
 * middleware normally diverts any `?token=` request to that SSO
 * route, but its matcher deliberately excludes `/admin`, so a
 * `/admin?token=…` URL would skip the bridge entirely, hit the
 * unauthenticated admin layout, and bounce to the user login page.
 * Hitting the SSO route ourselves verifies the token, mints a Bet
 * session cookie, and 307s straight to `next=/admin` — landing the
 * operator in the Exchange admin console, not the player login.
 */
export default function Hub() {
  const user = getUser();
  const [opening, setOpening] = useState(false);

  async function openExchange(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (opening) return;
    setOpening(true);
    try {
      const res = await api.post<{ token: string; expiresIn: number }>(
        '/auth/admin/sso-token',
        {},
      );
      // Hand the token to Bet's SSO consumer with `next=/admin` so it
      // exchanges the token for a Bet session and lands on the admin
      // console. Open in a new tab — using `window.open` (vs href +
      // .click()) sidesteps the popup-blocker quirk where a non-user-
      // initiated `.click()` is treated as suspect.
      const ssoUrl = new URL(`${BET_BASE}/api/auth/sso`);
      ssoUrl.searchParams.set('token', res.token);
      ssoUrl.searchParams.set('next', '/admin');
      window.open(ssoUrl.toString(), '_blank', 'noopener,noreferrer');
    } catch {
      // Token mint failed (e.g. the admin's own session expired). Open
      // the SSO route without a token: it redirects to Bet's sign-in,
      // which itself bounces to the Kalki hub login — the operator can
      // re-authenticate there. There's no valid path into the Exchange
      // admin without a token, so this is the safest degradation.
      window.open(
        `${BET_BASE}/api/auth/sso?next=/admin`,
        '_blank',
        'noopener,noreferrer',
      );
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-indigo to-brand-indigo-dark text-white">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex items-center justify-between mb-10">
          <div>
            <div className="text-brand-gold text-sm font-semibold uppercase tracking-widest">
              Kalki · Admin
            </div>
            <h1 className="text-3xl font-bold mt-1">
              Hi <span className="text-brand-gold">@{user?.username ?? 'admin'}</span>
            </h1>
            <p className="text-white/70 text-sm mt-1">
              Pick a product to manage. Each tile opens that game&apos;s admin console.
            </p>
          </div>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Tile
            to="/auctions"
            title="Live Auctions"
            tagline="Manage live auctions, close rounds, inspect bids."
            tone="cyan"
            icon="🛒"
          />
          <Tile
            to="/aviator/analytics"
            title="Aviator"
            tagline="Analytics, round log, seeds, chat moderation."
            tone="orange"
            icon="✈️"
          />
          <ExternalTile
            // href is set to a fallback target; the click handler
            // intercepts to fetch a fresh SSO token first.
            href={`${BET_BASE}/admin`}
            onClick={openExchange}
            title="Kalki Exchange"
            tagline={opening ? 'Opening…' : 'Markets, users, withdrawals, comment moderation.'}
            tone="emerald"
            icon="📈"
          />
        </div>

        {/* Platform-wide consoles that aren't tied to a single product.
            These live behind the sidebar Layout, which the three-tile
            hub doesn't render — so we surface direct links here. The
            coin economy (incl. PPP regional pricing) is global: coins
            are universal, only the local fiat purchase price varies per
            country, and that grid is managed under "Regional pricing". */}
        <div className="mt-10">
          <div className="text-[11px] uppercase tracking-widest text-white/50 mb-3">
            Platform &amp; coin economy
          </div>
          <div className="flex flex-wrap gap-2">
            <QuickLink to="/pricing" label="🌍 Regional pricing (PPP)" />
            <QuickLink to="/coin-settings" label="Coin economy" />
            <QuickLink to="/coin-packs" label="Coin packs" />
            <QuickLink to="/withdrawals" label="Withdrawals" />
            <QuickLink to="/analytics" label="Analytics" />
            <QuickLink to="/settings" label="Runtime settings" />
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/80 transition hover:border-brand-gold/50 hover:bg-white/10 hover:text-brand-gold"
    >
      {label}
    </Link>
  );
}

type Tone = 'cyan' | 'orange' | 'emerald';

const TONE_RING: Record<Tone, string> = {
  cyan: 'hover:border-cyan-300/60 hover:bg-cyan-500/10',
  orange: 'hover:border-orange-300/60 hover:bg-orange-500/10',
  emerald: 'hover:border-emerald-300/60 hover:bg-emerald-500/10',
};

function Tile({
  to,
  title,
  tagline,
  tone,
  icon,
}: {
  to: string;
  title: string;
  tagline: string;
  tone: Tone;
  icon: string;
}) {
  return (
    <Link
      to={to}
      className={`group block h-full rounded-xl border border-white/10 bg-white/5 p-5 transition ${TONE_RING[tone]}`}
    >
      <TileBody title={title} tagline={tagline} icon={icon} />
    </Link>
  );
}

function ExternalTile({
  href,
  onClick,
  title,
  tagline,
  tone,
  icon,
}: {
  href: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  title: string;
  tagline: string;
  tone: Tone;
  icon: string;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      target="_blank"
      rel="noopener noreferrer"
      className={`group block h-full rounded-xl border border-white/10 bg-white/5 p-5 transition ${TONE_RING[tone]}`}
    >
      <TileBody title={title} tagline={tagline} icon={icon} />
    </a>
  );
}

function TileBody({
  title,
  tagline,
  icon,
}: {
  title: string;
  tagline: string;
  icon: string;
}) {
  return (
    <>
      <div className="flex items-center gap-3 mb-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-black/30 text-xl">
          {icon}
        </span>
        <div className="text-lg font-bold">{title}</div>
      </div>
      <p className="text-sm text-white/70">{tagline}</p>
      <div className="mt-4 text-xs font-semibold text-white/50 group-hover:text-brand-gold transition">
        Open →
      </div>
    </>
  );
}
