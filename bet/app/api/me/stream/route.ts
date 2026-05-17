import { getAuthedUser } from "@/lib/auth";
import { subscribe, Channels } from "@/lib/pubsub";

export const dynamic = "force-dynamic";

/**
 * Per-user SSE stream for personal events: notification bumps and
 * achievement unlocks. Anonymous callers get 401 — there's no public-channel
 * use case here.
 */
export async function GET(req: Request) {
  const u = await getAuthedUser();
  if (!u) return new Response("unauthorized", { status: 401 });

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

      const unsub = subscribe(Channels.user(u.id), (data) => safeSend(data));
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
