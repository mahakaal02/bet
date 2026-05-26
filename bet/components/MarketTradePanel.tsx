"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { quoteBuy, quoteSell, priceYes } from "@/lib/amm";
import { fmtCoins, fmtPrice, cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toaster";
import { useMarketStream } from "@/lib/useMarketStream";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedPath,
  splitLocaleFromPath,
  t,
  type Locale,
} from "@/lib/i18n";

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
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const fromPath = splitLocaleFromPath(pathname ?? "/").locale;
  const locale: Locale = isLocale(params?.locale)
    ? params.locale
    : (fromPath ?? DEFAULT_LOCALE);
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
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
        toast(prettyTradeError(responseBody.error, locale), "err");
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
            coins: fmtCoins(Math.round(plan.totalCoins)),
          }),
          "ok",
        );
      } else if (action === "SELL" && plan) {
        toast(
          tr("market.soldToast", {
            shares: plan.totalShares.toFixed(1),
            outcome,
            coins: fmtCoins(Math.round(plan.totalCoins)),
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
    <Card>
      {/* BUY / SELL action tabs */}
      <div className="mb-3 flex gap-2">
        {(["BUY", "SELL"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={cn(
              "flex-1 rounded-lg border py-1.5 text-xs font-bold uppercase tracking-wider transition",
              action === a
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-200"
                : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            )}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="mb-3 flex gap-2">
        {/* Toggle buttons spring up when a new price tick arrives — gives
            a tactile "the market moved" cue without changing the user's
            current selection. Spring is short and tight so traders don't
            wait for a bounce to click. */}
        <motion.button
          onClick={() => setOutcome("YES")}
          animate={{ scale: flash === "YES" ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={cn(
            "flex-1 rounded-lg border py-2 text-sm font-bold",
            outcome === "YES"
              ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
              : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            flash === "YES" && "ticker-up",
          )}
        >
          YES · {fmtPrice(yesPrice)}
        </motion.button>
        <motion.button
          onClick={() => setOutcome("NO")}
          animate={{ scale: flash === "NO" ? 1.05 : 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 22 }}
          className={cn(
            "flex-1 rounded-lg border py-2 text-sm font-bold",
            outcome === "NO"
              ? "border-rose-500 bg-rose-500/15 text-rose-200"
              : "border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200",
            flash === "NO" && "ticker-down",
          )}
        >
          NO · {fmtPrice(1 - yesPrice)}
        </motion.button>
      </div>

      {action === "BUY" ? (
        <>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tr("market.coinsToSpend")}
          </label>
          <Input
            type="number"
            min={1}
            max={1_000_000}
            value={coinsInput}
            onChange={(e) => setCoinsInput(e.target.value)}
            disabled={!authed || !tradeOpen}
          />
          <div className="my-2 flex gap-1.5">
            {[50, 100, 500, 1000].map((n) => (
              <button
                key={n}
                type="button"
                disabled={!authed || !tradeOpen}
                onClick={() => setCoinsInput(String(n))}
                className="flex-1 rounded-md border border-slate-700 bg-slate-900/60 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                {n}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <label className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>{tr("market.sharesToSell")}</span>
            <span className="font-mono text-[10px] text-slate-400">
              {tr("market.youHold", { amount: myShares.toFixed(1) })}
            </span>
          </label>
          <Input
            type="number"
            min={0.01}
            step="0.01"
            value={sharesInput}
            onChange={(e) => setSharesInput(e.target.value)}
            disabled={!authed || !tradeOpen || myShares === 0}
          />
          <div className="my-2 flex gap-1.5">
            {[25, 50, 75, 100].map((pct) => (
              <button
                key={pct}
                type="button"
                disabled={!authed || !tradeOpen || myShares === 0}
                onClick={() =>
                  setSharesInput(((myShares * pct) / 100).toFixed(2))
                }
                className="flex-1 rounded-md border border-slate-700 bg-slate-900/60 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                {pct}%
              </button>
            ))}
          </div>
          {sellOverflow && (
            <Badge tone="warn" className="mb-2">
              {tr("market.youHoldOnly", {
                amount: myShares.toFixed(1),
                outcome,
              })}
            </Badge>
          )}
        </>
      )}

      {!tradeOpen ? (
        <Badge tone="warn" className="mb-2">
          {tr("market.tradingClosed")}
        </Badge>
      ) : !authed ? (
        <Link
          href={
            localizedPath("/login", locale) +
            "?next=" +
            encodeURIComponent(localizedPath(`/markets/${slug}`, locale))
          }
        >
          <Button className="w-full">{tr("market.signInToTrade")}</Button>
        </Link>
      ) : (
        <Button
          variant={action === "BUY" ? (outcome === "YES" ? "yes" : "no") : "secondary"}
          className="w-full"
          disabled={submitDisabled}
          onClick={submit}
        >
          {submitting
            ? tr("market.placing")
            : action === "BUY"
              ? tr("market.buyOutcome", { outcome })
              : tr("market.sellOutcome", { outcome })}
        </Button>
      )}

      <div className="mt-3 space-y-1 rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-xs text-slate-400">
        {action === "BUY" ? (
          buyQuote ? (
            <>
              <Row
                label={tr("market.youReceive")}
                value={`${buyQuote.sharesOut.toFixed(2)} ${outcome} ${tr("market.shares")}`}
              />
              <Row label={tr("market.avgPrice")} value={fmtPrice(buyQuote.avgPrice)} />
              <Row label={tr("market.priceAfter")} value={fmtPrice(buyQuote.newYesPrice)} />
              <Row
                label={tr("market.maxPayout")}
                value={`${fmtCoins(Math.floor(buyQuote.sharesOut))} ${tr("toast.coins")}`}
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
              value={`${fmtCoins(Math.floor(sellQuote.coinsOut))} ${tr("toast.coins")}`}
            />
            <Row label={tr("market.avgPrice")} value={fmtPrice(sellQuote.avgPrice)} />
            <Row label={tr("market.priceAfter")} value={fmtPrice(sellQuote.newYesPrice)} />
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
          locale={locale}
        />
      )}

      {positions.length > 0 && (
        <div className="mt-3 border-t border-slate-800 pt-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {tr("market.yourPosition")}
          </div>
          {positions.map((p) => (
            <div
              key={p.outcome}
              className="flex items-center justify-between text-sm"
            >
              <Badge tone={p.outcome === "YES" ? "yes" : "no"}>{p.outcome}</Badge>
              <span className="font-mono">
                {p.shares.toFixed(1)} {tr("market.sharesAbbrev")} · {fmtCoins(p.costBasis)} {tr("market.cost")}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
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
  locale,
}: {
  plan: TradePlan;
  open: boolean;
  onToggle: () => void;
  locale: Locale;
}) {
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
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
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2 text-start text-xs hover:bg-slate-900/40"
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span className="font-semibold text-slate-300">{tr("market.routing")}</span>
          <span className="text-slate-500">· {summary}</span>
        </span>
        {open ? (
          <ChevronUp className="h-3 w-3 text-slate-500" />
        ) : (
          <ChevronDown className="h-3 w-3 text-slate-500" />
        )}
      </button>
      {open && (
        <div className="border-t border-slate-800 px-3 py-2 text-[11px] font-mono text-slate-400">
          {plan.legs.map((l, i) => {
            if (l.kind === "book") {
              return (
                <div key={i} className="flex justify-between py-0.5">
                  <span>
                    <Badge tone="info" className="me-1">
                      {tr("market.book")}
                    </Badge>
                    {(l.shares ?? 0).toFixed(2)} {tr("market.sharesAbbrev")} @ {fmtPrice(l.price ?? 0)}
                  </span>
                  <span>{fmtCoins(Math.round(l.coins ?? 0))}</span>
                </div>
              );
            }
            const sharesOut = plan.side === "BUY" ? (l.output ?? 0) : (l.input ?? 0);
            const coins = plan.side === "BUY" ? (l.input ?? 0) : (l.output ?? 0);
            return (
              <div key={i} className="flex justify-between py-0.5">
                <span>
                  <Badge tone="default" className="me-1">
                    {tr("market.amm")}
                  </Badge>
                  {sharesOut.toFixed(2)} {tr("market.sharesAbbrev")}
                </span>
                <span>{fmtCoins(Math.round(coins))}</span>
              </div>
            );
          })}
          <div className="mt-2 flex justify-between border-t border-slate-800 pt-1.5 text-slate-300">
            <span>{tr("market.avgPrice")}</span>
            <span>{fmtPrice(plan.avgPrice)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>
        {label}
        {hint && (
          <span className="ms-1 text-[10px] text-slate-600">({hint})</span>
        )}
      </span>
      <span className="font-mono text-slate-200">{value}</span>
    </div>
  );
}

function prettyTradeError(code: string | undefined, locale: Locale): string {
  switch (code) {
    case "insufficient_coins":
      return t("market.errInsufficientCoins", locale);
    case "insufficient_shares":
      return t("market.errInsufficientShares", locale);
    case "market_not_open":
    case "market_ended":
      return t("market.errMarketNotOpen", locale);
    case "market_not_found":
      return t("market.errMarketNotFound", locale);
    case "rate_limited":
      return t("market.errRateLimited", locale);
    case "quote_failed":
      return t("market.errQuoteFailed", locale);
    case "unauthorized":
      return t("market.errUnauthorized", locale);
    default:
      return t("market.errTradeGeneric", locale);
  }
}
