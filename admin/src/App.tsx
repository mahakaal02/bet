import { Navigate, Route, Routes } from 'react-router-dom';
import { isAuthed } from './lib/auth';
import Layout from './pages/Layout';
import Hub from './pages/Hub';
import Login from './pages/Login';
import Auctions from './pages/Auctions';
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

export default function App() {
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
