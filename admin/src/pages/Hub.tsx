import { Link } from 'react-router-dom';
import { getToken, getUser } from '../lib/auth';

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
 *   - Exchange    → ${BET_BASE}/admin with `?token=…` for SSO
 *
 * The Auctions and Aviator tiles are internal SPA links — no token
 * hand-off needed because the admin's JWT is already in localStorage
 * for this origin. The Exchange tile leaves to the Bet app, so we
 * attach the token and Bet's middleware (`/api/auth/sso`) mints the
 * matching Bet session before landing on /admin.
 */
export default function Hub() {
  const token = getToken();
  const user = getUser();
  const exchangeHref = token
    ? `${BET_BASE}/admin?token=${encodeURIComponent(token)}`
    : `${BET_BASE}/admin`;

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
            href={exchangeHref}
            title="Kalki Exchange"
            tagline="Markets, users, withdrawals, comment moderation."
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
  title,
  tagline,
  tone,
  icon,
}: {
  href: string;
  title: string;
  tagline: string;
  tone: Tone;
  icon: string;
}) {
  return (
    <a
      href={href}
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
