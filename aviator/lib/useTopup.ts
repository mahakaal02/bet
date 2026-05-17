'use client';

import { useCallback, useState } from 'react';
import { api, ApiError } from './api';
import { openRazorpay } from './razorpay';
import { useGame } from './store';

interface CreateOrderResp {
  orderId: string;
  razorpayKeyId: string;
  amountInPaise: number;
  currency: string;
  amount: number;
}

interface VerifyResp {
  credited: number;
  newBalance: number;
}

export interface TopupResult {
  ok: boolean;
  credited?: number;
  newBalance?: number;
  /** User-facing error string when ok=false. */
  error?: string;
  /** True iff the user explicitly closed the Razorpay modal. */
  dismissed?: boolean;
}

/**
 * Shared top-up driver. Lives in a hook (not a component) so both the
 * standalone WalletPanel and the in-game "ADD ₹X" fallback in BetControls
 * can share one Razorpay-load + verify codepath.
 *
 * Resolves with `{ ok: true, credited, newBalance }` on a successful
 * payment + verify, or `{ ok: false, error }` for any failure (including
 * dismissal of the Razorpay sheet, which surfaces as `dismissed: true`).
 *
 * Callers should treat `dismissed: true` as a soft no-op (don't show an
 * error) and any other `ok:false` as a hard failure to surface.
 */
export function useTopup() {
  const setWalletBalance = useGame((s) => s.setWalletBalance);
  const [busy, setBusy] = useState(false);

  const topup = useCallback(
    (amount: number, opts?: { description?: string }) =>
      new Promise<TopupResult>((resolve) => {
        if (busy) {
          resolve({ ok: false, error: 'top-up already in progress' });
          return;
        }
        const rupees = Math.max(100, Math.ceil(amount));
        setBusy(true);
        (async () => {
          let order: CreateOrderResp;
          try {
            order = await api.post<CreateOrderResp>('/wallet/topup/order', {
              amount: rupees,
            });
          } catch (e) {
            setBusy(false);
            resolve({
              ok: false,
              error: e instanceof ApiError ? e.message : (e as Error).message,
            });
            return;
          }

          let settled = false;
          const settle = (r: TopupResult) => {
            if (settled) return;
            settled = true;
            setBusy(false);
            resolve(r);
          };

          try {
            await openRazorpay({
              key: order.razorpayKeyId,
              amount: order.amountInPaise,
              currency: order.currency,
              name: 'Kalki Bet · Aviator',
              description: opts?.description ?? `Wallet top-up ₹${order.amount}`,
              order_id: order.orderId,
              theme: { color: '#FF4D5A' },
              modal: {
                ondismiss: () => settle({ ok: false, dismissed: true }),
              },
              handler: async (resp) => {
                try {
                  const result = await api.post<VerifyResp>('/wallet/topup/verify', {
                    orderId: resp.razorpay_order_id,
                    paymentId: resp.razorpay_payment_id,
                    signature: resp.razorpay_signature,
                  });
                  setWalletBalance(result.newBalance);
                  settle({
                    ok: true,
                    credited: result.credited,
                    newBalance: result.newBalance,
                  });
                } catch (e) {
                  settle({
                    ok: false,
                    error: e instanceof ApiError ? e.message : 'verification failed',
                  });
                }
              },
            });
          } catch (e) {
            // openRazorpay() itself can reject if the checkout.js script fails
            // to load (offline, blocked extension, etc).
            settle({
              ok: false,
              error: e instanceof Error ? e.message : 'Razorpay failed to load',
            });
          }
        })();
      }),
    [busy, setWalletBalance],
  );

  return { topup, busy };
}
