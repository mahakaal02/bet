"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { quoteBuy, quoteSell, priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toaster";
import { useMarketStream } from "@/lib/useMarketStream";
import {
  localizedPath,
  useTranslation,
  type TranslateFunction,
} from "@/lib/i18n/client";

interface Props {
  marketId: string;
  slug: string;
  yesShares: number;
  noShares: number;
  status: "OPEN" | "CLOSED" | "RESOLVED" | "CANCELLED";
  authed: boolean;
  positions: { outcome: "YES" | "NO"; shares: number; costBasis: number }[];
}

type Action = "BUY" | "SELL";

export function MarketTradePanel({
  marketId,
  slug,
  yesShares,
  noShares,
  status,
  authed,
  positions,
}: Props) {
  const router = useRouter();
  const { t: tr, locale } = useTranslation();
  const [action, setAction] = useState<Action>("BUY");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [coinsInput, setCoinsInput] = useState("100");
  const [sharesInput, setSharesInput] = useState("100");
  const [submitting, setSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  // Live tick via SSE — server pushes after every trade or resolution.
  const initialYes = priceYes({ yesShares, noShares });
  const tick = useMarketStream(slug, initialYes);
  const yesPrice = tick?.yesPrice ?? initialYes;

  // Reconstruct reserves from the latest mid price + the SSR-time `k`.
  // The stream only sends prices, so we scale the original pool size.
  const reserves = useMemo(() => {
    const k = yesShares * noShares;
    const p = Math.min(0.999, Math.max(0.001, yesPrice));
    const total = Math.sqrt(k / (p * (1 - p)));
    return { yesShares: (1 - p) * total, noShares: p * total };
  }, [yesPrice, yesShares, noShares]);

  // Flash YES/NO when a print arrives from the stream.
  const [flash, setFlash] = useState<"YES" | "NO" | null>(null);
  useEffect(() => {
    if (!tick?.lastSide) return;
    setFlash(tick.lastSide);
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [tick?.at, tick?.lastSide]);

  // For SELL, the input is shares; cap by what the user actually holds free.
  // (Orderbook reservations live in Position.locked, but we don't have that
  // here — server enforces. We still hint the cap so they don't bounce.)
  const myPos = positions.find((p) => p.outcome === outcome);
  const myShares = myPos?.shares ?? 0;

  const coins = Number(coinsInput);
  const shares = Number(sharesInput);
  const validCoins = Number.isFinite(coins) && coins >= 1 && coins <= 1_000_000;
  const validShares = Number.isFinite(shares) && shares > 0;

  const buyQuote = useMemo(
    () => (action === "BUY" && validCoins ? quoteBuy(reserves, outcome, coins) : null),
    [action, reserves, outcome, coins, validCoins],
  );
  const sellQuote = useMemo(
    () => (action === "SELL" && validShares ? quoteSell(reserves, outcome, shares) : null),
    [action, reserves, outcome, shares, validShares],
  );

  const sellOverflow = action === "SELL" && validShares && shares > myShares;
  const tradeOpen = status === "OPEN";

  // Most recent execution plan returned from /api/trade/smart. Cleared
  // whenever the user changes the trade inputs so a stale display can't
  // confuse a new quote.
  const [lastPlan, setLastPlan] = useState<TradePlan | null>(null);
  const [showRouting, setShowRouting] = useState(false);

  useEffect(() => {
    setLastPlan(null);
  }, [action, outcome, coinsInput, sharesInput]);

  const submitDisabled =
    !authed ||
    !tradeOpen ||
    submitting ||
    (action === "BUY" ? !buyQuote : !sellQuote || sellOverflow);

  async function submit() {
    setSubmitting(true);
    try {
      const body =
        action === "BUY"
          ? { side: "BUY", marketId, outcome, coins }
          : { side: "SELL", marketId, outcome, shares };
      // Smart routing is the default — server picks the cheapest mix of
      // resting orders and the AMM. Falls back to AMM-only when the book
      // can't beat the AMM marginal, which is the common case on a quiet
      // market and matches the legacy /api/trade behaviour.
      const res = await fetch("/api/trade/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(prettyTradeError(responseBody.error, tr), "err");
        return;
      }
      const plan = responseBody.plan as TradePlan | undefined;
      if (plan) {
        setLastPlan(plan);
        // Auto-open the disclosure when the route is actually mixed — i.e.
        // a book leg fired. Pure-AMM routes leave it collapsed.
        setShowRouting(plan.legs.some((l) => l.kind === "book"));
      }
      if (action === "BUY" && plan) {
        toast(
          tr("market.boughtToast", {
            shares: plan.totalShares.toFixed(1),
            outcome,
            coins: fmtCoins(Math.round(plan.totalCoins), locale),
          }),
          "ok",
        );
      } else if (action === "SELL" && plan) {
        toast(
          tr("market.soldToast", {
            shares: plan.totalShares.toFixed(1),
            outcome,
            coins: fmtCoins(Math.round(plan.totalCoins), locale),
          }),
          "ok",
        );
      }
      startTransition(() => router.refresh());
    } catch {
      toast(tr("errors.network"), "err");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="tradepanel">
      {/* BUY / SELL action tabs */}
      <div className="tp-seg">
        {(["BUY", "SELL"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={cn("tp-seg-btn", action === a && "on")}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="tp-sides">
        {/* Toggle buttons spring up when a new price tick arrives — gives
            a tactile "the market moved" cue without changing the user's
            current selection. Spring is short and tight so traders don't
            wait for a bounce to click. */}
        <motion.button
          onClick={() => setOutcome("YES")}
          animate={{ scale: flash === "YES" ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={cn(
            "tp-side yes",
            outcome === "YES" && "on",
            flash === "YES" && "ticker-up",
          )}
        >
          {tr("market.yes")} <span className="px">{fmtPrice(yesPrice, 2, locale)}</span>
        </motion.button>
        <motion.button
          onClick={() => setOutcome("NO")}
          animate={{ scale: flash === "NO" ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={cn(
            "tp-side no",
            outcome === "NO" && "on",
            flash === "NO" && "ticker-down",
          )}
        >
          {tr("market.no")} <span className="px">{fmtPrice(1 - yesPrice, 2, locale)}</span>
        </motion.button>
      </div>

      {action === "BUY" ? (
        <>
          <label className="tp-label">{tr("market.coinsToSpend")}</label>
          <input
            className="tp-input"
            type="number"
            min={1}
            max={1_000_000}
            value={coinsInput}
            onChange={(e) => setCoinsInput(e.target.value)}
            disabled={!authed || !tradeOpen}
          />
          <div className="tp-quick">
            {[50, 100, 500, 1000].map((n) => (
              <button
                key={n}
                type="button"
                disabled={!authed || !tradeOpen}
                onClick={() => setCoinsInput(String(n))}
              >
                {n}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="tp-label">
            <span>{tr("market.sharesToSell")}</span>
            <span className="hold">
              {tr("market.youHold", { amount: myShares.toFixed(1) })}
            </span>
          </label>
          <input
            className="tp-input"
            type="number"
            min={0.01}
            step="0.01"
            value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            disabled={!authed || !tradeOpen || myShares === 0}
          />
          <div className="tp-quick">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!authed || !tradeOpen || myShares === 0}
                onClick={() =>
                  setSharesInput(((myShares * pct) / 100).toFixed(2))
                }
              >
                {pct}%
              </button>
            ))}
          </div>
          {sellOverflow && (
            <span className="tp-warn">
              {tr("market.youHoldOnly", {
                amount: myShares.toFixed(1),
                outcome,
              })}
            </span>
          )}
        </>
      )}

      {!tradeOpen ? (
        <span className="tp-warn">{tr("market.tradingClosed")}</span>
      ) : !authed ? (
        <Link
          href={
            localizedPath("/login", locale) +
            "?next=" +
            encodeURIComponent(localizedPath(`/markets/${slug}`, locale))
          }
        >
          <button type="button" className="tp-cta grad">
            {tr("market.signInToTrade")}
          </button>
        </Link>
      ) : (
        <button
          type="button"
          className={cn(
            "tp-cta",
            action === "BUY"
              ? outcome === "YES"
                ? "buy-yes"
                : "buy-no"
              : "grad",
          )}
          disabled={submitDisabled}
          onClick={submit}
        >
          {submitting
            ? tr("market.placing")
            : action === "BUY"
              ? tr("market.buyOutcome", { outcome })
              : tr("market.sellOutcome", { outcome })}
        </button>
      )}

      <div className="tp-summary">
        {action === "BUY" ? (
          buyQuote ? (
            <>
              <Row
                label={tr("market.youReceive")}
                value={`${buyQuote.sharesOut.toFixed(2)} ${outcome} ${tr("market.shares")}`}
              />
              <Row label={tr("market.avgPrice")} value={fmtPrice(buyQuote.avgPrice, 2, locale)} />
              <Row label={tr("market.priceAfter")} value={fmtPrice(buyQuote.newYesPrice, 2, locale)} />
              <Row
                label={tr("market.maxPayout")}
                value={`${fmtCoins(Math.floor(buyQuote.sharesOut), locale)} ${tr("toast.coins")}`}
                hint={tr("market.maxPayoutHint")}
              />
            </>
          ) : (
            <Row label={tr("market.enterCoins")} value="—" />
          )
        ) : sellQuote ? (
          <>
            <Row
              label={tr("market.youReceive")}
              value={`${fmtCoins(Math.floor(sellQuote.coinsOut), locale)} ${tr("toast.coins")}`}
            />
            <Row label={tr("market.avgPrice")} value={fmtPrice(sellQuote.avgPrice, 2, locale)} />
            <Row label={tr("market.priceAfter")} value={fmtPrice(sellQuote.newYesPrice, 2, locale)} />
            {myPos && shares <= myShares && (
              <Row
                label={tr("market.realisedPL")}
                value={`${
                  Math.floor(sellQuote.coinsOut) -
                  Math.round((myPos.costBasis * shares) / Math.max(1, myPos.shares))
                } ${tr("toast.coins")}`}
              />
            )}
          </>
        ) : (
          <Row
            label={myShares === 0 ? tr("market.noSharesToSell") : tr("market.enterShares")}
            value="—"
          />
        )}
      </div>

      {lastPlan && (
        <RoutingDisclosure
          plan={lastPlan}
          open={showRouting}
          onToggle={() => setShowRouting((v) => !v)}
        />
      )}

      {positions.length > 0 && (
        <div className="tp-pos">
          <div className="tp-pos-title">{tr("market.yourPosition")}</div>
          {positions.map((p) => (
            <div key={p.outcome} className="tp-pos-row">
              <span className={cn("tp-tag", p.outcome === "YES" ? "yes" : "no")}>
                {p.outcome}
              </span>
              <span className="meta">
                {p.shares.toFixed(1)} {tr("market.sharesAbbrev")} · {fmtCoins(p.costBasis, locale)} {tr("market.cost")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TradePlanLeg {
  kind: "book" | "amm";
  price?: number;
  shares?: number;
  coins?: number;
  input?: number;
  output?: number;
}

interface TradePlan {
  side: "BUY" | "SELL";
  totalCoins: number;
  totalShares: number;
  avgPrice: number;
  legs: TradePlanLeg[];
}

/**
 * Post-trade routing breakdown. Collapsed by default for pure-AMM fills
 * (boring), auto-expanded when the smart router actually used the book.
 * The disclosure stays mounted until the user changes any input so they
 * can re-open it to verify what happened.
 */
function RoutingDisclosure({
  plan,
  open,
  onToggle,
}: {
  plan: TradePlan;
  open: boolean;
  onToggle: () => void;
}) {
  const { t: tr, locale } = useTranslation();
  const bookLegs = plan.legs.filter((l) => l.kind === "book");
  const ammLegs = plan.legs.filter((l) => l.kind === "amm");
  const usedBook = bookLegs.length > 0;
  const summary = usedBook
    ? tr("market.routingMixed", {
        bookLegs: bookLegs.length,
        s: bookLegs.length === 1 ? "" : "s",
        amm: ammLegs.length > 0 ? tr("market.routingMixedAMM") : "",
      })
    : tr("market.routingAMMOnly");

  return (
    <div className="tp-route">
      <button type="button" onClick={onToggle} className="tp-route-head">
        <span className="flex items-center gap-1.5">
          <Sparkles className="sparkle h-3 w-3" />
          <span style={{ fontWeight: 600 }}>{tr("market.routing")}</span>
          <span className="muted">· {summary}</span>
        </span>
        {open ? (
          <ChevronUp className="muted h-3 w-3" />
        ) : (
          <ChevronDown className="muted h-3 w-3" />
        )}
      </button>
      {open && (
        <div className="tp-route-body">
          {plan.legs.map((l, i) => {
            if (l.kind === "book") {
              return (
                <div key={i} className="tp-route-leg">
                  <span>
                    <span className="tp-tag info" style={{ marginInlineEnd: 4 }}>
                      {tr("market.book")}
                    </span>
                    {(l.shares ?? 0).toFixed(2)} {tr("market.sharesAbbrev")} @ {fmtPrice(l.price ?? 0, 2, locale)}
                  </span>
                  <span>{fmtCoins(Math.round(l.coins ?? 0), locale)}</span>
                </div>
              );
            }
            const sharesOut = plan.side === "BUY" ? (l.output ?? 0) : (l.input ?? 0);
            const coins = plan.side === "BUY" ? (l.input ?? 0) : (l.output ?? 0);
            return (
              <div key={i} className="tp-route-leg">
                <span>
                  <span className="tp-tag" style={{ marginInlineEnd: 4 }}>
                    {tr("market.amm")}
                  </span>
                  {sharesOut.toFixed(2)} {tr("market.sharesAbbrev")}
                </span>
                <span>{fmtCoins(Math.round(coins), locale)}</span>
              </div>
            );
          })}
          <div className="tp-route-total">
            <span>{tr("market.avgPrice")}</span>
            <span>{fmtPrice(plan.avgPrice, 2, locale)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="tp-row">
      <span>
        {label}
        {hint && <span className="hint">({hint})</span>}
      </span>
      <span className="v">{value}</span>
    </div>
  );
}

function prettyTradeError(
  code: string | undefined,
  t: TranslateFunction,
): string {
  switch (code) {
    case "insufficient_coins":
      return t("market.errInsufficientCoins");
    case "insufficient_shares":
      return t("market.errInsufficientShares");
    case "market_not_open":
    case "market_ended":
      return t("market.errMarketNotOpen");
    case "market_not_found":
      return t("market.errMarketNotFound");
    case "rate_limited":
      return t("market.errRateLimited");
    case "quote_failed":
      return t("market.errQuoteFailed");
    case "unauthorized":
      return t("market.errUnauthorized");
    default:
      return t("market.errTradeGeneric");
  }
}
