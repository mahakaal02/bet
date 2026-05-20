import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearToken, getUser } from '../lib/auth';

export default function Layout() {
  const navigate = useNavigate();
  const user = getUser();

  function logout() {
    clearToken();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-brand-indigo-dark text-white flex flex-col">
        <div className="px-6 py-6 border-b border-white/10">
          <NavLink
            to="/"
            className="block text-brand-gold text-xl font-semibold tracking-tight hover:opacity-90"
          >
            Kalki Bet
          </NavLink>
          <div className="text-xs opacity-70 mt-1">Admin console</div>
          <NavLink
            to="/"
            className="mt-2 inline-block text-[11px] uppercase tracking-wider text-white/60 hover:text-brand-gold"
          >
            ← All games
          </NavLink>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          <SideLink to="/auctions" label="Auctions" />
          <SideLink to="/auctions/new" label="New auction" />
          <SideLink to="/coin-settings" label="Coin economy" />
          <SideLink to="/coin-packs" label="Coin packs" />
          <SideLink to="/withdrawals" label="Withdrawals" />
          <SideLink to="/kyc" label="KYC review" />
          <SideLink to="/audit-log" label="Audit log" />
          <SideLink to="/profile-moderation" label="Profile moderation" />
          <SideLink to="/roles" label="Roles &amp; access" />
          <SideLink to="/impersonate" label="Impersonate" />
          <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest opacity-50">
            Platform
          </div>
          <SideLink to="/settings" label="Runtime settings" />
          <SideLink to="/feature-flags" label="Feature flags" />
          <SideLink to="/analytics" label="Analytics" />
          <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-widest opacity-50">
            Aviator
          </div>
          <SideLink to="/aviator/analytics" label="Analytics" />
          <SideLink to="/aviator/current" label="Current round" />
          <SideLink to="/aviator/finance" label="Finance" />
          <SideLink to="/aviator/controls" label="Controls" />
          <SideLink to="/aviator/rounds" label="Round log" />
          <SideLink to="/aviator/seeds" label="Seeds" />
          <SideLink to="/aviator/chat" label="Chat moderation" />
        </nav>
        <div className="px-6 py-4 border-t border-white/10 text-sm">
          <div className="opacity-80">{user?.username}</div>
          <button
            onClick={logout}
            className="mt-2 text-xs text-brand-gold hover:underline"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 px-10 py-8 max-w-5xl">
        <Outlet />
      </main>
    </div>
  );
}

function SideLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `block px-3 py-2 rounded text-sm transition ${
          isActive ? 'bg-white/10 text-brand-gold' : 'text-white/80 hover:bg-white/5'
        }`
      }
    >
      {label}
    </NavLink>
  );
}
