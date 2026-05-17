import { subscribe, Channels } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

/**
 * Global activity SSE — every trade across every market lands here. Used by
 * the landing-page live ticker. Public (no auth) — only public-safe fields
 * are published from the trade/orders routes (username, market title,
 * coins, side, price). No userId or other PII.
 */
export async function GET(req: Request) {
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
          /* closed */
        }
      };

      safeSend({ type: "connected", at: Date.now() });

      const unsub = subscribe(Channels.global(), (data) => safeSend(data));
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, 25_000);

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
