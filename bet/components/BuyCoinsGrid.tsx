"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toaster";
import { fmtCoins } from "@/lib/utils";
import type { CoinPack } from "@/lib/coin-packs";
import { useTranslation, type Locale } from "@/lib/i18n/client";

interface LocalizedPack {
  coins: number;
  currency: string;
  price: string;
  symbol: string;
}

interface Props {
  packs: CoinPack[];
  localizedPacks?: LocalizedPack[];
  locale: Locale;
}

interface TopupConfig {
  instantTopupEnabled: boolean;
  cryptoConfigured?: boolean;
  chatAppDownloadUrl?: string;
}

/** Buy target — a predefined pack or a custom coin amount. */
type BuyArg = { packId?: string; coins?: number };

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const ZERO_DECIMAL = new Set(["JPY", "IDR", "INR", "TRY", "NGN", "PHP", "CNY", "RUB", "ZAR"]);
const MIN_TOPUP_COINS = 100;

/**
 * Coin-pack grid — Wallet v2 design. Owns the section card-head (incl.
 * the "Custom amount" toggle) so the toggle can drive client state.
 * The Buy action (pack or custom) picks the live top-up path:
 *   crypto invoice → dev instant → Secured Chat fallback. Prices are
 *   PPP-localized; the custom amount is priced SERVER-SIDE from the
 *   coins (the client only sends coins, never a trusted fiat figure).
 */
export function BuyCoinsGrid({ packs, localizedPacks = [], locale: _locale }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [coins, setCoins] = useState(1000);
  const [, startTransition] = useTransition();
  const { t } = useTranslation();

  const localizedByCoins = new Map(localizedPacks.map((l) => [l.coins, l]));
  function priceLabel(p: CoinPack): string {
    const loc = localizedByCoins.get(p.coins);
    if (loc) return `${loc.symbol}${loc.price}`;
    return `₹${fmtCoins(p.priceInr)}`;
  }

  // Per-coin rate for the custom card, anchored on the 1000-coin pack
  // price (same anchor as the wallet's ≈ value). Falls back to ₹1 if
  // no localized pricing is available.
  const anchor = localizedByCoins.get(1000);
  const perCoin = anchor ? Number(anchor.price) / 1000 : 1;
  const curSymbol = anchor?.symbol ?? "₹";
  const curCode = anchor?.currency ?? "INR";
  const zeroDec = ZERO_DECIMAL.has(curCode);
  function fmtFiat(n: number): string {
    return zeroDec ? Math.round(n).toLocaleString("en-IN") : n.toFixed(2);
  }
  const fiatForCoins = perCoin * Math.max(0, coins);

  function prettyError(code: string | undefined): string {
    switch (code) {
      case "unknown_pack":
        return t("wallet.unknownPack");
      case "rate_limited":
        return t("wallet.slowDown");
      case "instant_topup_disabled":
        return t("wallet.instantDisabled");
      case "unauthorized":
        return t("wallet.unauthorized");
      default:
        return t("wallet.topUpFailed");
    }
  }

  const { data: config } = useSWR<TopupConfig>(
    "/api/wallet/topup/config",
    fetcher,
    { revalidateOnFocus: false },
  );

  async function buyViaInstant(arg: BuyArg) {
    const res = await fetch("/api/wallet/topup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arg),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(prettyError(body.error), "err");
      return;
    }
    toast(
      body.duplicate
        ? t("wallet.alreadyCreditedPack")
        : t("wallet.creditsBalance", {
            coins: fmtCoins(body.credited),
            balance: fmtCoins(body.balance),
          }),
      "ok",
    );
    setCustomOpen(false);
    startTransition(() => router.refresh());
  }

  async function buyViaCrypto(arg: BuyArg) {
    const res = await fetch("/api/wallet/topup/crypto/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arg),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.redirectUrl) {
      toast(
        body?.error === "rate_limited"
          ? "Too many attempts — slow down a moment."
          : prettyError(body?.error) ?? "Couldn't open crypto checkout.",
        "err",
      );
      return;
    }
    window.location.assign(body.redirectUrl);
  }

  async function buy(arg: BuyArg, busyKey: string) {
    setBusy(busyKey);
    try {
      if (config?.cryptoConfigured) {
        await buyViaCrypto(arg);
      } else if (config?.instantTopupEnabled) {
        await buyViaInstant(arg);
      } else {
        toast(t("wallet.askAdmin"), "err");
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="card-head">
        <div>
          <div className="card-eyebrow">{t("wallet.stepTopup")}</div>
          <div className="card-title">{t("wallet.buyCoins")}</div>
        </div>
        <button
          type="button"
          className="small-link"
          onClick={() => setCustomOpen((o) => !o)}
        >
          {customOpen ? `${t("wallet.choosePack")} ←` : `${t("wallet.customAmount")} →`}
        </button>
      </div>

      {customOpen ? (
        <div className="custom-wrap">
          <div className="custom-card">
            <label className="custom-field">
              <span className="custom-lbl">{t("wallet.coinsToBuy")}</span>
              <div className="custom-input">
                <input
                  type="number"
                  min={MIN_TOPUP_COINS}
                  inputMode="numeric"
                  value={coins}
                  onChange={(e) => setCoins(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                />
                <span className="custom-unit">coins</span>
              </div>
            </label>

            <div className="custom-arrow">↓</div>

            <label className="custom-field">
              <span className="custom-lbl">{t("wallet.youPay")} ({curCode})</span>
              <div className="custom-input">
                <span className="custom-cur">{curSymbol}</span>
                <input
                  type="number"
                  min={0}
                  step={zeroDec ? 1 : 0.01}
                  inputMode="decimal"
                  value={fmtFiat(fiatForCoins)}
                  onChange={(e) => {
                    const f = Number(e.target.value) || 0;
                    setCoins(Math.max(0, Math.round(f / perCoin)));
                  }}
                />
              </div>
            </label>

            <button
              type="button"
              className="custom-buy"
              disabled={!config || busy === "custom" || coins < MIN_TOPUP_COINS}
              onClick={() => buy({ coins }, "custom")}
            >
              {busy === "custom" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {t("wallet.buyCoins")} · {fmtCoins(coins)} {t("wallet.coins")}
                </>
              )}
            </button>
            {coins < MIN_TOPUP_COINS && (
              <div className="custom-note">
                {t("wallet.minTopup", { amount: fmtCoins(MIN_TOPUP_COINS) })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="packs">
          {packs.map((p: CoinPack) => {
            const isBusy = busy === p.id;
            const featured = !!p.highlight;
            return (
              <button
                key={p.id}
                type="button"
                className={`pack${featured ? " featured" : ""}`}
                onClick={() => buy({ packId: p.id }, p.id)}
                disabled={isBusy || !config}
                aria-disabled={isBusy || !config}
              >
                {p.highlight && <span className="pack-tag">{p.highlight}</span>}
                <div className="pack-amount">
                  {fmtCoins(p.coins)}
                  <span className="sub">{t("wallet.coins")}</span>
                </div>
                <div className="pack-rate">{priceLabel(p)}</div>
                <div className="pack-buy">
                  {isBusy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      {t("wallet.buyCoins")}
                      <span>→</span>
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="packs-foot">
        <span>{t("wallet.unifiedPromise")}</span>
        <span className="pay">
          {config?.cryptoConfigured && <span>CRYPTO</span>}
          <span>UPI</span>
          <span>BANK</span>
          <span>USDT</span>
        </span>
      </div>

      {config && !config.cryptoConfigured && !config.instantTopupEnabled && (
        <div
          style={{
            margin: "0 20px 16px",
            padding: "12px 14px",
            borderRadius: "10px",
            border: "1px solid rgba(34,211,238,0.3)",
            background: "rgba(34,211,238,0.08)",
            fontSize: "12.5px",
            color: "var(--cyan-200)",
            lineHeight: 1.5,
          }}
        >
          {config.chatAppDownloadUrl ? (
            <span>
              {t("wallet.chatAppMessage")}{" "}
              <a
                href={config.chatAppDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--cyan-300)", textDecoration: "underline", fontWeight: 600 }}
              >
                {t("wallet.downloadChatApp")}
              </a>
            </span>
          ) : (
            <span>{t("wallet.chatAppNoUrl")}</span>
          )}
        </div>
      )}
    </>
  );
}
