"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Pencil, X, Check } from "lucide-react";
import { useMarketStream } from "@/lib/useMarketStream";
import { Card, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { fmtCoins, fmtPrice, timeAgo, cn } from "@/lib/utils";
import { toast } from "@/components/ui/Toaster";
import {
  DEFAULT_LOCALE,
  isLocale,
  splitLocaleFromPath,
  t,
  type Locale,
} from "@/lib/i18n";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Order {
  id: string;
  outcome: "YES" | "NO";
  side: "BUY" | "SELL";
  limitPrice: number;
  shares: number;
  remaining: number;
  filledShares: number;
  filledCost: number;
  status: "OPEN" | "PARTIAL" | "FILLED" | "CANCELLED";
  createdAt: string;
  market: { slug: string; title: string };
}

export function OpenOrdersPanel({ marketId }: { marketId?: string }) {
  const router = useRouter();
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const fromPath = splitLocaleFromPath(pathname ?? "/").locale;
  const locale: Locale = isLocale(params?.locale)
    ? params.locale
    : (fromPath ?? DEFAULT_LOCALE);
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const [, startTransition] = useTransition();
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // When a marketId is supplied, scope the list to that market — without
  // this, an OPEN order from a different market would render here and the
  // user could cancel the wrong market's order from this page.
  const url = marketId
    ? `/api/orders?marketId=${encodeURIComponent(marketId)}`
    : "/api/orders";
  const { data, mutate } = useSWR<{ orders: Order[] }>(url, fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: true,
  });

  // Live-refresh when the market's book changes (so a fill on one of our
  // resting orders updates this panel without a manual reload).
  const tick = useMarketStream(marketId ?? "");
  useEffect(() => {
    if (!marketId || !tick) return;
    void mutate();
  }, [marketId, tick?.at, mutate]);

  if (!data) {
    return (
      <Card>
        <div className="skeleton h-20 w-full" />
      </Card>
    );
  }

  const visible = data.orders;

  async function cancel(id: string) {
    setCancelling(id);
    const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
    setCancelling(null);
    if (res.ok) {
      toast(tr("market.orderCancelledToast"), "ok");
      void mutate();
      startTransition(() => router.refresh());
    } else {
      toast(tr("market.couldNotCancelToast"), "err");
    }
  }

  async function applyEdit(id: string, limitPrice: number, shares: number) {
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limitPrice, shares }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(prettyReplaceError(body.error, locale), "err");
      return false;
    }
    toast(tr("market.orderUpdatedToast"), "ok");
    setEditingId(null);
    void mutate();
    startTransition(() => router.refresh());
    return true;
  }

  if (visible.length === 0) {
    return (
      <Card>
        <CardTitle className="mb-2">{tr("market.yourOrders")}</CardTitle>
        <p className="text-sm text-slate-500">{tr("market.noOrdersPlaced")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr("market.yourOrders")}</CardTitle>
      </CardHeader>
      <ul className="divide-y divide-slate-800">
        {visible.slice(0, 20).map((o) => {
          const open = o.status === "OPEN" || o.status === "PARTIAL";
          const isEditing = editingId === o.id;
          return (
            <li key={o.id} className="py-2">
              {isEditing ? (
                <EditRow
                  order={o}
                  locale={locale}
                  onCancel={() => setEditingId(null)}
                  onApply={(price, shares) => applyEdit(o.id, price, shares)}
                />
              ) : (
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <Badge tone={o.outcome === "YES" ? "yes" : "no"}>
                        {o.side} {o.outcome}
                      </Badge>
                      <span className="font-mono">{fmtPrice(o.limitPrice)}</span>
                      <span className="font-mono text-slate-400">
                        {o.shares.toFixed(2)} {tr("market.sharesAbbrev")}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {o.status} ·{" "}
                      {tr("market.filledLabel", {
                        filled: o.filledShares.toFixed(2),
                        remaining: o.remaining.toFixed(2),
                      })}{" "}
                      · {timeAgo(o.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    {open ? (
                      <>
                        <button
                          onClick={() => setEditingId(o.id)}
                          className="p-1 text-slate-400 hover:text-slate-200"
                          aria-label={tr("market.editAriaLabel")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => cancel(o.id)}
                          disabled={cancelling === o.id}
                          className="text-xs text-rose-300 hover:text-rose-200 disabled:opacity-50"
                        >
                          {cancelling === o.id ? tr("market.cancelling") : tr("market.cancel")}
                        </button>
                      </>
                    ) : (
                      <span className="font-mono text-xs text-slate-500">
                        {Math.abs(o.filledCost)
                          ? `${fmtCoins(Math.abs(o.filledCost))} ${tr("toast.coins")}`
                          : "—"}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/**
 * Inline edit row. The replace endpoint refuses size increases (matcher
 * would have to run), so we cap the size input at the order's current
 * `remaining` and disable up-arrows beyond that.
 */
function EditRow({
  order,
  locale,
  onCancel,
  onApply,
}: {
  order: Order;
  locale: Locale;
  onCancel: () => void;
  onApply: (limitPrice: number, shares: number) => Promise<boolean>;
}) {
  const tr = (k: string, vars?: Record<string, string | number>) =>
    t(k, locale, vars);
  const [price, setPrice] = useState(order.limitPrice.toFixed(2));
  const [shares, setShares] = useState(order.remaining.toFixed(2));
  const [busy, setBusy] = useState(false);

  const priceNum = Number(price);
  const sharesNum = Number(shares);
  const valid =
    Number.isFinite(priceNum) &&
    priceNum > 0 &&
    priceNum < 1 &&
    Number.isFinite(sharesNum) &&
    sharesNum > 0 &&
    sharesNum <= order.remaining + 1e-9;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    await onApply(priceNum, sharesNum);
    setBusy(false);
  }

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-2">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <Badge tone={order.outcome === "YES" ? "yes" : "no"}>
          {order.side} {order.outcome}
        </Badge>
        <span className="text-slate-500">
          {tr("market.editAtPrice")}{" "}
          <span className="font-mono">{fmtPrice(order.limitPrice)}</span>
          {" → "}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">
            {tr("market.newPriceLabel")}
          </span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max="0.99"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            disabled={busy}
            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wider text-slate-500">
            {tr("market.newSizeLabel", { max: order.remaining.toFixed(2) })}
          </span>
          <input
            type="number"
            step="0.01"
            min="0.01"
            max={order.remaining}
            value={shares}
            onChange={(e) => setShares(e.target.value)}
            disabled={busy}
            className="h-8 w-full rounded-md border border-slate-700 bg-slate-900/60 px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          />
        </label>
        <div className="flex gap-1">
          <button
            onClick={submit}
            disabled={!valid || busy}
            className={cn(
              "grid h-8 w-8 place-items-center rounded-md bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50",
            )}
            aria-label={tr("market.saveAriaLabel")}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="grid h-8 w-8 place-items-center rounded-md bg-slate-800 text-slate-300 hover:bg-slate-700"
            aria-label={tr("market.cancelEditAriaLabel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-[10px] text-slate-500">{tr("market.repositionNote")}</p>
    </div>
  );
}

function prettyReplaceError(code: string | undefined, locale: Locale): string {
  switch (code) {
    case "insufficient_coins":
      return t("market.errReplaceInsufficientCoins", locale);
    case "insufficient_shares":
      return t("market.errReplaceInsufficientShares", locale);
    case "size_increase_requires_new_order":
      return t("market.errSizeIncreaseNew", locale);
    case "order_closed":
      return t("market.errOrderClosed", locale);
    case "market_not_open":
    case "market_ended":
      return t("market.errMarketEnded", locale);
    case "invalid_input":
      return t("market.errInvalidPriceSize", locale);
    default:
      return t("market.errReplaceGeneric", locale);
  }
}
