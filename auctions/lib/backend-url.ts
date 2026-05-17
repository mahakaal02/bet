/**
 * Returns the browser-reachable URL for the backend. The trick: server-
 * side rendering happens INSIDE the Next.js process where the backend
 * is at `localhost:4000`, but a Client Component fetches from the
 * actual user's browser — which might be:
 *
 *   - A desktop browser on the host machine     → localhost:4000
 *   - An Android emulator's WebView             → 10.0.2.2:4000
 *   - A device on the same LAN as the host      → <host LAN ip>:4000
 *
 * We choose at runtime based on `window.location.hostname` so the same
 * built bundle works in all three environments without a config flag.
 *
 * Exposed via `NEXT_PUBLIC_BACKEND_URL` first — if you've set that to
 * something concrete (production, or a tunnelled dev URL), it wins.
 */
export function publicBackendUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:4000`;
    }
  }
  return "http://localhost:4000";
}

/** WebSocket variant for the bid-status gateway at backend's /ws path. */
export function publicBackendWsUrl(): string {
  const http = publicBackendUrl();
  return http.replace(/^http/, "ws") + "/ws";
}
