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
 *   - Exchange    → ${BET_BASE}/admin with a 60s SSO token for handoff
 *
 * The Auctions and Aviator tiles are internal SPA links — no token
 * hand-off needed because the admin's session cookie is already
 * scoped to this origin. The Exchange tile leaves to the Bet app,
 * which lives on a different origin, so we fetch a short-lived JWT
 * via `/auth/admin/sso-token` (PR-ADMIN-COOKIE-AUTH) and attach it
 * to the URL. The long-lived session JWT lives in an httpOnly
 * cookie that JS can't read — minting a 60s token on demand keeps
 * the handoff working without ever exposing the durable credential.
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
      // Open in a new tab — same as the previous `<a target="_blank">`
      // behaviour. Using `window.open` (vs setting href + .click())
      // sidesteps the browser quirk where some popup blockers count
      // a non-user-initiated `.click()` as suspect.
      window.open(
        `${BET_BASE}/admin?token=${encodeURIComponent(res.token)}`,
        '_blank',
        'noopener,noreferrer',
      );
    } catch {
      // Fall back to opening without the token; the user will see
      // Bet's own sign-in screen if their session there has expired.
      window.open(`${BET_BASE}/admin`, '_blank', 'noopener,noreferrer');
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
      </div>
    </div>
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
