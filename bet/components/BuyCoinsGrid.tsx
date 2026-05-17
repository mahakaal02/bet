"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { motion } from "framer-motion";
import { Coins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { toast } from "@/components/ui/Toaster";
import { cn, fmtCoins } from "@/lib/utils";
import type { CoinPack } from "@/lib/coin-packs";

interface Props {
  packs: CoinPack[];
  /** Current user — only the username and email pre-fill Razorpay Checkout. */
  user: { username: string; email: string };
}

interface TopupConfig {
  razorpayConfigured: boolean;
  razorpayKeyId: string | null;
  instantTopupEnabled: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare global {
  interface Window { Razorpay?: any }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * Coin-pack grid. The Buy button picks the right top-up path at runtime:
 *
 *   - Razorpay configured  → open Checkout, verify server-side on success
 *   - Dev instant mode      → POST /api/wallet/topup, credit immediately
 *   - Neither              → show a "payments not configured" message
 *
 * Razorpay's checkout.js is loaded lazily so cold page loads aren't taxed
 * by a script users may not need.
 */
export function BuyCoinsGrid({ packs, user }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const { data: config } = useSWR<TopupConfig>(
    "/api/wallet/topup/config",
    fetcher,
    { revalidateOnFocus: false },
  );

  // Preload Razorpay's checkout.js once we know it'll be needed. Idempotent
  // — re-renders don't re-inject the script.
  useEffect(() => {
    if (!config?.razorpayConfigured) return;
    if (typeof document === "undefined") return;
    if (document.querySelector(`script[src="${RAZORPAY_SCRIPT}"]`)) return;
    const s = document.createElement("script");
    s.src = RAZORPAY_SCRIPT;
    s.async = true;
    document.body.appendChild(s);
  }, [config?.razorpayConfigured]);

  // Baseline ratio for the "X% bonus" chip. With strict 1:1, every pack
  // has the same ratio and the chip simply never renders — left in so a
  // future promo tier (if we ever do one) lights up automatically.
  const baseline = packs.length
    ? Math.min(...packs.map((p) => p.coins / p.priceInr))
    : 1;

  async function buyViaRazorpay(pack: CoinPack) {
    const orderRes = await fetch("/api/wallet/topup/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: pack.id }),
    });
    const order = await orderRes.json().catch(() => ({}));
    if (!orderRes.ok) {
      toast(prettyError(order.error), "err");
      return;
    }
    if (!window.Razorpay) {
      toast("Payment widget didn't load. Refresh and try again.", "err");
      return;
    }

    await new Promise<void>((resolve) => {
      const rzp = new window.Razorpay({
        key: order.razorpayKeyId,
        order_id: order.orderId,
        amount: order.amountInPaise,
        currency: order.currency,
        name: "Kalki Bet",
        description: `${order.coins.toLocaleString()} coins`,
        prefill: { name: user.username, email: user.email },
        theme: { color: "#22d3ee" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handler: async (resp: any) => {
          try {
            const verify = await fetch("/api/wallet/topup/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: resp.razorpay_order_id,
                razorpay_payment_id: resp.razorpay_payment_id,
                razorpay_signature: resp.razorpay_signature,
              }),
            });
            const body = await verify.json().catch(() => ({}));
            if (!verify.ok) {
              toast(prettyError(body.error), "err");
              return;
            }
            toast(
              body.duplicate
                ? "Already credited."
                : `+${fmtCoins(body.credited)} coins · balance ${fmtCoins(body.balance)}`,
              "ok",
            );
            startTransition(() => router.refresh());
          } finally {
            resolve();
          }
        },
        modal: { ondismiss: () => resolve() },
      });
      rzp.open();
    });
  }

  async function buyViaInstant(pack: CoinPack) {
    const res = await fetch("/api/wallet/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packId: pack.id }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(prettyError(body.error), "err");
      return;
    }
    toast(
      body.duplicate
        ? "Already credited — try a different pack."
        : `+${fmtCoins(body.credited)} coins · balance ${fmtCoins(body.balance)}`,
      "ok",
    );
    startTransition(() => router.refresh());
  }

  async function buy(pack: CoinPack) {
    setBusy(pack.id);
    try {
      if (config?.razorpayConfigured) {
        await buyViaRazorpay(pack);
      } else if (config?.instantTopupEnabled) {
        await buyViaInstant(pack);
      } else {
        toast(
          "Payments aren't configured on this environment. Ask an admin.",
          "err",
        );
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {packs.map((p) => {
          const ratio = p.coins / p.priceInr;
          const bonusPct = Math.round(((ratio - baseline) / baseline) * 100);
          const showBonus = bonusPct >= 5;
          const isBusy = busy === p.id;
          return (
            <motion.div
              key={p.id}
              whileHover={{ y: -2 }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
              className={cn(
                "relative rounded-xl border p-4 transition",
                p.highlight
                  ? "border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 to-indigo-500/5"
                  : "border-slate-800 bg-slate-900/40",
              )}
            >
              {p.highlight && (
                <Badge tone="info" className="absolute -top-2 left-3">
                  {p.highlight}
                </Badge>
              )}
              <div className="flex items-center gap-1.5 text-cyan-300">
                <Coins className="h-4 w-4" />
                <span className="text-2xl font-black">
                  {fmtCoins(p.coins)}
                </span>
              </div>
              <div className="mt-1 text-xs uppercase tracking-wider text-slate-500">
                coins
              </div>
              <div className="mt-3 text-lg font-semibold text-slate-100">
                ₹{fmtCoins(p.priceInr)}
              </div>
              {showBonus && (
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  +{bonusPct}% bonus
                </div>
              )}
              <Button
                onClick={() => buy(p)}
                disabled={isBusy || !config}
                className="mt-3 w-full"
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>Buy ₹{fmtCoins(p.priceInr)}</>
                )}
              </Button>
            </motion.div>
          );
        })}
      </div>
      {config && !config.razorpayConfigured && (
        <p className="mt-3 text-[11px] text-amber-300">
          Razorpay is not configured.
          {config.instantTopupEnabled
            ? " Running in dev instant-credit mode — coins credit immediately without payment."
            : " Set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in the env to enable real top-ups."}
        </p>
      )}
    </>
  );
}

function prettyError(code?: string): string {
  switch (code) {
    case "unknown_pack":
      return "That pack isn't available.";
    case "rate_limited":
      return "Slow down — wait a minute before buying again.";
    case "razorpay_not_configured":
      return "Payments aren't configured. Ask an admin.";
    case "order_create_failed":
      return "Couldn't create a payment order. Try again.";
    case "bad_signature":
      return "Payment verification failed. Contact support if money was charged.";
    case "instant_topup_disabled":
      return "Instant top-up is disabled. Use the payment flow.";
    case "unauthorized":
      return "Please sign in.";
    default:
      return "Top-up failed. Try again.";
  }
}
