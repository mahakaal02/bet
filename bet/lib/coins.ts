/**
 * Env-driven coin constants. One source of truth so the signup bonus
 * and coin-pack defaults don't drift across the codebase. The daily
 * faucet was removed — no free-coin path exists outside the signup
 * grant and payment-backed top-ups.
 */
export function signupCoins(): number {
  const n = Number(process.env.SIGNUP_COIN_BONUS ?? "10000");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10000;
}

/**
 * 1 coin = ₹1, by platform decree. Kept as a constant (rather than env-
 * driven) so any future promotional rate would have to be a deliberate
 * code change with audit. Razorpay quotes in paise (1 INR = 100 paise),
 * so payment handlers multiply this by 100 themselves.
 */
export const COIN_RATE_INR = 1 as const;

/** Min top-up in coins (= ₹ same). Razorpay's test mode rejects orders
 *  below ₹1 anyway; we set a higher floor so the payments UX is sane. */
export const MIN_TOPUP_COINS = 100;

/** Min withdrawal in coins (= ₹ same). Set high enough that the admin
 *  payout queue doesn't drown in micro-requests, while still being
 *  accessible to regular players. The Zod validator in
 *  `app/api/wallet/withdraw/route.ts` enforces this server-side; the
 *  form on `app/wallet/withdraw/page.tsx` surfaces it as the input's
 *  `min` and the helper text. The Aviator `WalletPanel`'s encash
 *  threshold mirrors this so the "Encash unlocks at …" hint stays
 *  in sync with the server contract. */
export const MIN_WITHDRAW_COINS = 2000;
