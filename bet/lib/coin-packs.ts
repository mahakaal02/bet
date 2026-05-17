import { COIN_RATE_INR } from "@/lib/coins";

/**
 * Coin packs. Strict 1₹ → 1 coin per platform rule, so each pack's `coins`
 * equals its `priceInr`. No bonus tiers — promo value should come through
 * achievements / daily rewards, not by selling discounted INR exposure.
 *
 * Hard-coded so an admin-edited catalog can't drift from the 1:1 rule.
 *
 * The Razorpay verify step uses the pack id (never the client-supplied
 * price), so a tampered client can't request a 5000-coin pack for ₹100.
 */
export interface CoinPack {
  id: string;
  coins: number;
  priceInr: number;
  /** Optional UI highlight ("Popular", "Most bought", etc.). */
  highlight?: string;
}

function pack(amount: number, highlight?: string): CoinPack {
  return {
    id: `coins-${amount}`,
    coins: amount,
    priceInr: amount * COIN_RATE_INR,
    highlight,
  };
}

export const COIN_PACKS: CoinPack[] = [
  pack(100),
  pack(500, "Popular"),
  pack(1_000, "Most bought"),
  pack(5_000),
];

export function findPack(id: string): CoinPack | null {
  return COIN_PACKS.find((p) => p.id === id) ?? null;
}
