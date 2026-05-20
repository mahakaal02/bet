import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { isAuthed } from './lib/auth';
import { consumeSsoToken } from './lib/sso';
import Layout from './pages/Layout';
import Hub from './pages/Hub';
import Login from './pages/Login';
import Auctions from './pages/Auctions';
import AuctionBids from './pages/AuctionBids';
import CreateAuction from './pages/CreateAuction';
import EditAuction from './pages/EditAuction';
import CoinSettings from './pages/CoinSettings';
import CoinPacks from './pages/CoinPacks';
import Withdrawals from './pages/Withdrawals';
import AviatorAnalytics from './pages/AviatorAnalytics';
import AviatorControls from './pages/AviatorControls';
import AviatorCurrent from './pages/AviatorCurrent';
import AviatorFinance from './pages/AviatorFinance';
import AviatorSeeds from './pages/AviatorSeeds';
import AviatorChat from './pages/AviatorChat';
import AviatorRounds from './pages/AviatorRounds';
import AuditLog from './pages/AuditLog';
import Roles from './pages/Roles';
import Settings from './pages/Settings';
import FeatureFlags from './pages/FeatureFlags';

function Protected({ children }: { children: JSX.Element }) {
  return isAuthed() ? children : <Navigate to="/login" replace />;
}

// SSO from the Kalki hub: when an admin lands here with `?token=…`,
// we exchange it for a session before rendering any route. Without
// this gate `<Protected>` would bounce to /login before the async
// exchange completes.
const hasSsoToken = new URLSearchParams(window.location.search).has('token');

export default function App() {
  const [bootstrapping, setBootstrapping] = useState(hasSsoToken);

  useEffect(() => {
    if (!hasSsoToken) return;
    consumeSsoToken().finally(() => setBootstrapping(false));
  }, []);

  if (bootstrapping) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-indigo to-brand-indigo-dark text-white">
        <div className="text-sm opacity-80">Signing you in…</div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Hub lives OUTSIDE the Layout wrapper. The user-facing Kalki hub
          uses a clean three-tile landing with no sidebar; the admin hub
          mirrors that visual language so an admin who jumps in via
          /admin (no SSO token) gets the same product picker an admin
          who lands via the SSO tile would expect. */}
      <Route
        path="/"
        element={
          <Protected>
            <Hub />
          </Protected>
        }
      />
      {/* Inner admin routes keep the sidebar Layout so the per-product
          surfaces stay navigable without bouncing back to the hub. */}
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route path="auctions" element={<Auctions />} />
        <Route path="auctions/new" element={<CreateAuction />} />
        <Route path="auctions/:id/edit" element={<EditAuction />} />
        <Route path="auctions/:id/bids" element={<AuctionBids />} />
        <Route path="coin-settings" element={<CoinSettings />} />
        <Route path="coin-packs" element={<CoinPacks />} />
        <Route path="withdrawals" element={<Withdrawals />} />
        <Route path="aviator/analytics" element={<AviatorAnalytics />} />
        <Route path="aviator/controls" element={<AviatorControls />} />
        <Route path="aviator/current" element={<AviatorCurrent />} />
        <Route path="aviator/finance" element={<AviatorFinance />} />
        <Route path="aviator/rounds" element={<AviatorRounds />} />
        <Route path="aviator/seeds" element={<AviatorSeeds />} />
        <Route path="aviator/chat" element={<AviatorChat />} />
        <Route path="audit-log" element={<AuditLog />} />
        <Route path="roles" element={<Roles />} />
        <Route path="settings" element={<Settings />} />
        <Route path="feature-flags" element={<FeatureFlags />} />
      </Route>
    </Routes>
  );
}
