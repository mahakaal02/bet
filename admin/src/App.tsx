import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { isAuthed } from './lib/auth';
import { consumeSsoToken } from './lib/sso';
import Layout from './pages/Layout';
import Login from './pages/Login';
import Auctions from './pages/Auctions';
import AuctionBids from './pages/AuctionBids';
import CreateAuction from './pages/CreateAuction';
import EditAuction from './pages/EditAuction';
import CoinSettings from './pages/CoinSettings';
import CoinPacks from './pages/CoinPacks';
import Withdrawals from './pages/Withdrawals';
import AviatorAnalytics from './pages/AviatorAnalytics';
import AviatorSeeds from './pages/AviatorSeeds';
import AviatorChat from './pages/AviatorChat';
import AviatorRounds from './pages/AviatorRounds';

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
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Navigate to="/auctions" replace />} />
        <Route path="auctions" element={<Auctions />} />
        <Route path="auctions/new" element={<CreateAuction />} />
        <Route path="auctions/:id/edit" element={<EditAuction />} />
        <Route path="auctions/:id/bids" element={<AuctionBids />} />
        <Route path="coin-settings" element={<CoinSettings />} />
        <Route path="coin-packs" element={<CoinPacks />} />
        <Route path="withdrawals" element={<Withdrawals />} />
        <Route path="aviator/analytics" element={<AviatorAnalytics />} />
        <Route path="aviator/rounds" element={<AviatorRounds />} />
        <Route path="aviator/seeds" element={<AviatorSeeds />} />
        <Route path="aviator/chat" element={<AviatorChat />} />
      </Route>
    </Routes>
  );
}
