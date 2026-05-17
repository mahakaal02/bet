/**
 * Withdrawals moved to the Bet admin (Kalki Exchange, the canonical wallet
 * authority). This stub page exists only to redirect / deep-link admins
 * who land here from old bookmarks.
 *
 * The auctions backend's `WalletService.withdrawals` API was deleted; the
 * Bet admin under `/admin/withdrawals` is the single queue going forward,
 * with the per-user audit page (`/admin/users/[id]/audit`) for anti-
 * malpractice review.
 */
export default function Withdrawals() {
  const betAdminUrl =
    (import.meta.env.VITE_BET_BASE_URL as string | undefined)?.replace(
      /\/$/,
      '',
    ) ?? 'http://localhost:3100';

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Withdrawals</h1>
      <div className="max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="mb-2">
          <strong>Moved.</strong> Withdrawal review now lives in the Bet (Kalki
          Exchange) admin — Bet owns the unified wallet across all three games.
        </p>
        <p>
          <a
            href={`${betAdminUrl}/admin/withdrawals`}
            target="_blank"
            rel="noreferrer"
            className="font-semibold underline hover:text-amber-700"
          >
            Open the withdrawals queue →
          </a>
        </p>
        <p className="mt-2 text-xs text-amber-700">
          Same workflow (approve / reject / mark-paid) plus an extra
          per-user audit page showing coin flow by source and IP-overlap
          warnings.
        </p>
      </div>
    </div>
  );
}
