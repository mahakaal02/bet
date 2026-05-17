import { db } from "@/lib/db";
import { priceYes } from "@/lib/amm";
import { subscribe, Channels } from "@/lib/pubsub";

// SSE requires the response to stream — Next caches static routes by default.
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events stream of live market price changes.
 *
 * Wire format: standard `text/event-stream`.
 *   data: {"type":"snapshot", "yesPrice":0.62, "noPrice":0.38, "volumeCoins":1234}
 *   data: {"type":"trade","yesPrice":0.65,"noPrice":0.35,"side":"YES","cost":100,"at":…}
 *   data: {"type":"resolved","outcome":"YES","yesPrice":1,"noPrice":0,"at":…}
 *   : ping            <- comment line every 25s to keep proxies from closing the conn
 *
 * Why SSE rather than WebSockets:
 *   - Next.js 15 supports streaming responses out of the box, no custom server
 *     and no Socket.IO adapter. Edge / Lambda compatible.
 *   - Price ticks are server→client only — duplex isn't needed.
 *   - Browsers auto-reconnect via EventSource on network blips.
 *
 * The matching pubsub channel is `market:<id>`; trade and resolve routes
 * publish there post-commit.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const market = await db.market.findFirst({
    where: { OR: [{ id }, { slug: id }] },
    select: {
      id: true,
      yesShares: true,
      noShares: true,
      volumeCoins: true,
      status: true,
    },
  });
  if (!market) {
    return new Response("not_found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const safeSend = (payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          /* controller closed mid-write — ignore */
        }
      };

      // Initial snapshot so the client doesn't sit empty waiting for a trade.
      const yes = priceYes({
        yesShares: market.yesShares,
        noShares: market.noShares,
      });
      safeSend({
        type: "snapshot",
        yesPrice: yes,
        noPrice: 1 - yes,
        volumeCoins: market.volumeCoins,
        status: market.status,
      });

      const unsub = subscribe(Channels.market(market.id), (data) => {
        safeSend(data);
      });

      // Heartbeat. Proxies (nginx, cloudflare, ngrok…) idle out long-lived
      // connections after ~30-60s of silence; a comment line resets that.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* same — closed */
        }
      }, 25_000);

      const onAbort = () => {
        closed = true;
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      // Browser tab closed / EventSource.close() — clean up everything.
      req.signal.addEventListener("abort", onAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // disable nginx buffering on this route
    },
  });
}
