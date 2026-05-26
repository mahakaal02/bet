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
import { t, type Locale } from "@/lib/i18n";

interface Props {
  packs: CoinPack[];
  /** Current user — only the username and email pre-fill Razorpay Checkout. */
  user: { username: string; email: string };
  /** Active locale, passed from the server-rendered wallet page so
   *  all error toasts / inline copy match the rest of the page. */
  locale: Locale;
}

interface TopupConfig {
  razorpayConfigured: boolean;
  razorpayKeyId: string | null;
  instantTopupEnabled: boolean;
  /** PR-BET-ADMIN-FOLLOWUPS — super-admin-controlled link to the
   *  Secured Chat App APK. Empty string when unset. */
  chatAppDownloadUrl?: string;
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
export function BuyCoinsGrid({ packs, user, locale }: Props) {
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
      toast(prettyError(order.error, locale), "err");
      return;
    }
    if (!window.Razorpay) {
      toast(t("wallet.paymentWidgetError", locale), "err");
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
              toast(prettyError(body.error, locale), "err");
              return;
            }
            toast(
              body.duplicate
                ? t("wallet.alreadyCredited", locale)
                : t("wallet.creditsBalance", locale, {
                    coins: fmtCoins(body.credited),
                    balance: fmtCoins(body.balance),
                  }),
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
      toast(prettyError(body.error, locale), "err");
      return;
    }
    toast(
      body.duplicate
        ? t("wallet.alreadyCreditedPack", locale)
        : t("wallet.creditsBalance", locale, {
            coins: fmtCoins(body.credited),
            balance: fmtCoins(body.balance),
          }),
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
        // PR-BET-ADMIN-FOLLOWUPS — user-facing copy. The platform now
        // routes payment-arrangement through the Secured Kalki Chat
        // App (where admins handle UPI/bank transfers personally).
        // The old "payments aren't configured" copy leaked the
        // developer reality.
        toast(
          t("wallet.askAdmin", locale),
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
                {t("toast.coins", locale)}
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
      {/* PR-BET-ADMIN-FOLLOWUPS — payments now route through the
          Secured Kalki Chat App. Old banners exposed Razorpay env-var
          names + "instant credit" dev terminology to end users, both
          of which are private platform details. New copy points the
          user at the chat-app download (URL controlled by super admin
          via /admin/settings → wallet.chat_app_download_url). */}
      {config && !config.razorpayConfigured && !config.instantTopupEnabled && (
        <div className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-xs">
          {config.chatAppDownloadUrl ? (
            <p className="text-cyan-200">
              {t("wallet.chatAppMessage", locale)}{" "}
              <a
                href={config.chatAppDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-cyan-300 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-200 hover:decoration-cyan-300"
              >
                {t("wallet.downloadChatApp", locale)}
              </a>
            </p>
          ) : (
            <p className="text-cyan-200">
              {t("wallet.chatAppNoUrl", locale)}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function prettyError(code: string | undefined, locale: Locale): string {
  switch (code) {
    case "unknown_pack":
      return t("wallet.unknownPack", locale);
    case "rate_limited":
      return t("wallet.slowDown", locale);
    case "razorpay_not_configured":
      return t("wallet.noPaymentConfig", locale);
    case "order_create_failed":
      return t("wallet.orderCreateFailed", locale);
    case "bad_signature":
      return t("wallet.badSignature", locale);
    case "instant_topup_disabled":
      return t("wallet.instantDisabled", locale);
    case "unauthorized":
      return t("wallet.unauthorized", locale);
    default:
      return t("wallet.topUpFailed", locale);
  }
}
