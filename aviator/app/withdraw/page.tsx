'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { getToken } from '@/lib/auth';

interface BalanceResp { balance: number }
interface WithdrawResp { requestId: string; amount: number; newBalance: number }
interface PendingWithdrawal { id: string; amount: number; status: string; createdAt: string }

const THRESHOLD = 2_000;

export default function WithdrawPage() {
  const router = useRouter();
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState<number>(THRESHOLD);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<WithdrawResp | null>(null);
  const [history, setHistory] = useState<PendingWithdrawal[]>([]);

  useEffect(() => {
    if (!getToken()) {
      // Aviator no longer has a standalone login. Bounce out to the
      // canonical auctions login if the user isn't signed in.
      const base =
        process.env.NEXT_PUBLIC_AUCTIONS_URL ?? 'http://localhost:3200';
      window.location.replace(`${base.replace(/\/$/, '')}/login`);
      return;
    }
    void api.get<BalanceResp>('/wallet/balance').then((r) => setBalance(r.balance));
    void api.get<PendingWithdrawal[]>('/wallet/withdrawals').then(setHistory);
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (balance !== null && amount > balance) {
      setError('amount exceeds wallet balance');
      return;
    }
    setBusy(true);
    try {
      const res = await api.post<WithdrawResp>('/wallet/withdraw', { amount });
      setSuccess(res);
      setBalance(res.newBalance);
      const list = await api.get<PendingWithdrawal[]>('/wallet/withdrawals');
      setHistory(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  if (balance !== null && balance < THRESHOLD) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="glass rounded-3xl p-8 max-w-md w-full">
          <h1 className="text-2xl font-extrabold">Withdrawal locked</h1>
          <p className="mt-2 text-text-secondary">
            Amount above ₹{THRESHOLD} can be withdrawn. Your current wallet
            balance is ₹{balance}.
          </p>
          <button
            onClick={() => router.replace('/')}
            className="mt-6 w-full py-2.5 rounded-xl font-semibold bg-elevated border border-divider hover:bg-surface transition"
          >
            Back to game
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-10 max-w-xl mx-auto">
      <button
        onClick={() => router.back()}
        className="text-sm text-text-secondary hover:text-text-primary"
      >
        ← Back
      </button>

      <h1 className="text-2xl font-extrabold mt-4">Withdraw from wallet</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Wallet balance: <span className="font-mono text-text-primary">₹{balance ?? '—'}</span>
      </p>

      <form onSubmit={submit} className="glass rounded-3xl p-6 mt-6 space-y-4">
        <label className="block">
          <span className="text-xs uppercase tracking-widest text-text-secondary">
            Amount to withdraw (₹)
          </span>
          <input
            type="number"
            min={1}
            max={balance ?? undefined}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
            className="mt-1 w-full bg-elevated border border-divider rounded-lg px-3 py-2 font-mono text-lg outline-none focus:border-accent-orange"
          />
          <p className="mt-2 text-xs text-text-secondary">
            Must be less than or equal to your wallet balance.
          </p>
        </label>

        {error && <p className="text-sm text-accent-red">{error}</p>}
        {success && (
          <p className="text-sm text-neon-green">
            Request #{success.requestId.slice(0, 8)}… submitted. New balance:
            ₹{success.newBalance}.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || balance === null || amount <= 0 || amount > (balance ?? 0)}
          className="w-full py-3 rounded-xl font-bold text-white bg-gradient-to-br from-[var(--color-neon-green)] to-[var(--color-neon-green-deep)] hover:brightness-110 transition disabled:opacity-50"
        >
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </form>

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold mb-2">Recent requests</h2>
          <ul className="space-y-2">
            {history.slice(0, 8).map((w) => (
              <li
                key={w.id}
                className="glass rounded-xl px-4 py-3 flex items-center justify-between text-sm"
              >
                <span className="font-mono">₹{w.amount}</span>
                <span className="text-text-secondary">
                  {new Date(w.createdAt).toLocaleString()}
                </span>
                <span
                  className={
                    w.status === 'APPROVED'
                      ? 'text-neon-green'
                      : w.status === 'REJECTED'
                      ? 'text-accent-red'
                      : 'text-accent-orange'
                  }
                >
                  {w.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
