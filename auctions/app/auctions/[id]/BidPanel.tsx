"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { publicBackendWsUrl } from "@/lib/backend-url";
import { walletTopupUrl } from "@/lib/exchange-url";

type Auction = "UPCOMING" | "LIVE" | "ENDED";

/**
 * Status `kind` mirrors the backend's `classifyPlacedAmount` enum. Three
 * outcomes a player ever sees for their most recent bid:
 *
 *  - LOWEST_UNIQUE   — only one user picked this amount AND it's the
 *                      lowest such amount. If the auction ended now,
 *                      you'd win.
 *  - NOT_UNIQUE      — multiple users (you + at least one other) picked
 *                      this exact amount. Tied bids are disqualified.
 *  - NOT_LOWEST      — your amount is unique but somebody picked a
 *                      lower unique amount. They're winning, not you.
 *
 * Labels here are the public-facing copy — the user spec calls these
 * "Duplicate / Colliding Bid", "Lowest & Unique (winning)", and
 * "Unique Losing Bid" respectively.
 */
const STATUS_COPY: Record<string, { tone: "winning" | "outbid"; label: string; hint: string }> = {
  LOWEST_UNIQUE: {
    tone: "winning",
    label: "Lowest & Unique",
    hint: "You're winning. Your bid is the lowest amount no one else has picked — if the auction ended right now, you'd take the product.",
  },
  DUPLICATE_COLLIDING: {
    tone: "outbid",
    label: "Duplicate / Colliding Bid",
    hint: "Another user picked the same amount. Tied bids are disqualified — pick a different number to get back in the running.",
  },
  UNIQUE_LOSING: {
    tone: "outbid",
    label: "Unique Losing Bid",
    hint: "Your bid is unique but somebody picked a lower unique amount. Pick a smaller number to take the lead.",
  },
};

interface BidStatus {
  amount: string;
  kind: string;
}

/**
 * Interactive bid panel. Three behaviours bundled:
 *
 *   1. **Submit** — POSTs `/api/bid/[id]` which proxies to backend
 *      with the user's JWT attached server-side.
 *   2. **Live status** — opens a WebSocket to `backend /ws` and sends a
 *      `subscribe` message with the auction id + the user's JWT (read
 *      once from `/api/auth/token`). The gateway pushes `status`
 *      messages whenever ANY bid is placed on this auction, recalculated
 *      against this user's most recent bid. That's the "real-time" UX —
 *      you watch your bid go from "winning" to "outbid" as competitors
 *      place lower numbers.
 *   3. **Disabled states** — clear hints for signed-out / not-live cases
 *      so the page never silently does nothing.
 */
export function BidPanel({
  auctionId,
  coinsPerBid,
  status,
  signedIn,
}: {
  auctionId: string;
  coinsPerBid: number;
  status: Auction;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  // We grab a ref to the bid input so we can blur it once the bid lands.
  // Without an explicit blur, iOS keeps the input focused after submit
  // and the page stays zoomed in until the user navigates away. See the
  // viewport / 16px-input fixes in `app/layout.tsx` and `ui/Input.tsx`.
  const amountInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `insufficientFunds` is a separate piece of state from the generic
  // error so we can swap the inline error string for a top-up CTA
  // without losing other errors (rate_limit, duplicate_bid, etc.) that
  // still want the plain text rendering.
  const [insufficientFunds, setInsufficientFunds] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<BidStatus | null>(null);
  const [wsState, setWsState] = useState<"idle" | "connecting" | "live" | "lost">(
    "idle",
  );
  const wsRef = useRef<WebSocket | null>(null);

  // Open the WebSocket once on mount if the user is signed in + the
  // auction is biddable. Closed on unmount. Reconnect-on-drop is
  // simple (single retry after 2s) — fancier backoff isn't worth the
  // code for a demo surface.
  useEffect(() => {
    if (!signedIn || status !== "LIVE") return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    async function connect() {
      try {
        const tokenRes = await fetch("/api/auth/token", { cache: "no-store" });
        if (!tokenRes.ok) return; // not signed in after all
        const { token } = (await tokenRes.json()) as { token: string };
        if (cancelled) return;

        setWsState("connecting");
        const ws = new WebSocket(publicBackendWsUrl());
        wsRef.current = ws;
        ws.onopen = () => {
          ws.send(
            JSON.stringify({ type: "subscribe", auctionId, token }),
          );
        };
        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data) as {
              type: "subscribed" | "status" | "error";
              auctionId?: string;
              amount?: string;
              kind?: string;
              message?: string;
            };
            if (msg.type === "subscribed") {
              setWsState("live");
            } else if (msg.type === "status" && msg.amount && msg.kind) {
              setLiveStatus({ amount: msg.amount, kind: msg.kind });
            } else if (msg.type === "error") {
              // Don't surface every backend error as a panel error —
              // these are usually subscribe rejections (expired token).
              // Mark the stream as lost and stop retrying.
              setWsState("lost");
            }
          } catch {
            /* ignore parse failures */
          }
        };
        ws.onclose = () => {
          if (cancelled) return;
          setWsState("lost");
          // One retry after 2s — beyond that the user can reload.
          retry = setTimeout(connect, 2000);
        };
        ws.onerror = () => {
          // Browser will fire onclose right after; the close handler
          // owns the retry.
        };
      } catch {
        setWsState("lost");
      }
    }
    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [auctionId, signedIn, status]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInsufficientFunds(false);
    setNotice(null);
    try {
      const res = await fetch(`/api/bid/${auctionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          router.replace(`/login?next=/auctions/${auctionId}`);
          return;
        }
        // Specific case: the wallet is too low to afford even one bid.
        // The bid spec says "if wallet is zero, send the user to the
        // Buy Now screen" — we do that by flipping a flag, which the
        // render block below converts into a topup CTA button.
        if (body?.code === "insufficient_coins") {
          setInsufficientFunds(true);
          return;
        }
        setError(body?.message ?? "Couldn't place that bid.");
        return;
      }
      setNotice(`Bid placed: ₹${body.bid.amount}.`);
      setAmount("");
      // Release iOS's "input is focused, stay zoomed in" state. The viewport
      // + 16px-input fixes prevent the zoom from triggering in the first
      // place; this is the belt-and-braces tier for older WebKit builds
      // that still latch focus across the form submit.
      amountInputRef.current?.blur();
      router.refresh();
    } catch {
      setError("Network error. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Click handler for the topup button. Fetches the bearer token from
   * the same-origin endpoint we expose for the WebSocket subscribe (we
   * can't read the cookie from JS), then opens the wallet topup page
   * on the Exchange app with the token attached for SSO.
   */
  async function goToTopup() {
    try {
      const res = await fetch("/api/auth/token", { cache: "no-store" });
      const body = (await res.json()) as { token: string | null };
      window.location.href = walletTopupUrl(body.token);
    } catch {
      // Fallback: open the wallet page anonymously; user signs in there.
      window.location.href = walletTopupUrl(null);
    }
  }

  if (status === "UPCOMING") {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
        This auction hasn&apos;t started yet — check back at the start time
        above.
      </div>
    );
  }
  if (status === "ENDED") {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 px-3 py-2 text-sm text-slate-400">
        This auction has ended. See the winner panel above.
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
        <Link
          href={`/login?next=/auctions/${auctionId}`}
          className="font-semibold underline-offset-2 hover:underline"
        >
          Sign in
        </Link>{" "}
        to place a bid and watch your standing update in real time.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex items-stretch gap-2">
        <div className="relative flex-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            ₹
          </span>
          <Input
            ref={amountInputRef}
            name="amount"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0.01"
            placeholder="Your bid"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="pl-7"
          />
        </div>
        <Button type="submit" disabled={busy || !amount}>
          {busy ? "Placing…" : `Bid · ${coinsPerBid} coin${coinsPerBid === 1 ? "" : "s"}`}
        </Button>
      </div>
      <p className="text-[11px] text-slate-500">
        Pick the lowest amount no one else has picked yet. Each attempt costs{" "}
        {coinsPerBid} coin{coinsPerBid === 1 ? "" : "s"} from your wallet.
      </p>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      {notice && <p className="text-xs text-emerald-300">{notice}</p>}
      {insufficientFunds && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p className="mb-2 text-amber-200">
            Your wallet doesn&apos;t have enough coins for this bid. Top up to
            keep playing.
          </p>
          <button
            type="button"
            onClick={goToTopup}
            className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25"
          >
            Buy coins →
          </button>
        </div>
      )}

      <LiveStatusBlock state={wsState} bid={liveStatus} />
    </form>
  );
}

function LiveStatusBlock({
  state,
  bid,
}: {
  state: "idle" | "connecting" | "live" | "lost";
  bid: BidStatus | null;
}) {
  if (state === "idle") return null;
  if (state === "connecting") {
    return (
      <p className="text-[11px] text-slate-500">
        Connecting to live bid stream…
      </p>
    );
  }
  if (state === "lost") {
    return (
      <p className="text-[11px] text-amber-300/80">
        Live stream disconnected. You can still place bids — refresh the page
        to retry the connection.
      </p>
    );
  }
  // state === "live"
  if (!bid) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-[11px] text-cyan-200">
        Live stream connected. Place your first bid to start watching your
        standing in real time.
      </div>
    );
  }
  const copy = STATUS_COPY[bid.kind];
  if (!copy) {
    return (
      <p className="text-[11px] text-slate-500">
        Latest bid: ₹{bid.amount} ({bid.kind})
      </p>
    );
  }
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone={copy.tone}>{copy.label}</Badge>
        <span className="font-mono text-sm font-semibold text-slate-100">
          ₹{bid.amount}
        </span>
      </div>
      <p className="text-[11px] text-slate-400">{copy.hint}</p>
    </div>
  );
}
