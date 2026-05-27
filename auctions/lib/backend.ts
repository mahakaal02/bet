/**
 * Server-side fetch wrapper for the auctions backend (NestJS on :4000).
 *
 * Two modes:
 *   - `backend.public.get(path)`        — anonymous reads.
 *   - `backend.authed.get/post(path)`   — attaches the user's JWT from the
 *                                          session cookie. Throws
 *                                          `BackendUnauthorized` if there's
 *                                          no token or upstream returns 401.
 *
 * All errors come back as `BackendApiError` carrying the upstream HTTP
 * status + a short code, so route handlers / pages can branch on
 * `err.code === "insufficient_coins"` without parsing the message.
 */

const BACKEND_URL = (
  process.env.AUCTIONS_BACKEND_URL ?? "http://localhost:4000"
).replace(/\/$/, "");

export class BackendApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export class BackendUnauthorized extends BackendApiError {
  constructor() {
    super(401, "unauthorized", "No session — please sign in again.");
  }
}

/**
 * Coerce a value of unknown shape into a human-readable string. The
 * backend emits THREE different error envelopes depending on which
 * layer rejected the request, and several of them are nested objects —
 * if we just assign one to `Error.message`, JS coerces it via
 * `String(value)` and the user sees `[object Object]`.
 *
 *   1. AllExceptionsFilter (PR-ARCH-AUDIT, Stage A) — the canonical
 *      modern envelope:
 *        { error: { code: "RATE_LIMITED", message: "..." },
 *          requestId, path, timestamp }
 *   2. NestJS validation pipe:
 *        { statusCode, message: string | string[], error: "Bad Request" }
 *   3. Express / proxy fallback (HTML or text/plain):
 *        "Internal Server Error\n"
 *
 * This helper inspects each in turn and always returns a finite,
 * readable string. Anything we genuinely can't unpack falls back to
 * `JSON.stringify` so at least the raw fields are visible — never
 * `[object Object]`.
 */
function stringifyError(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((v) => stringifyError(v, "")).filter(Boolean).join("; ");
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.detail === "string") return obj.detail;
    try {
      return JSON.stringify(value);
    } catch {
      // Circular ref or non-serialisable — fall through.
    }
  }
  return fallback;
}

async function parseError(res: Response): Promise<BackendApiError> {
  const text = await res.text();
  let code = "internal";
  let message = text || `HTTP ${res.status}`;
  try {
    const body = JSON.parse(text);

    // Stage-A envelope: { error: { code, message }, requestId, path }.
    // Match this first because it's the canonical modern shape, and
    // `body.error` is the OBJECT (not a string) — getting confused
    // between code and message here is what caused the original
    // `[object Object]` bug.
    if (body && typeof body === "object" && body.error && typeof body.error === "object") {
      code =
        typeof body.error.code === "string" ? body.error.code : `http_${res.status}`;
      message = stringifyError(body.error, `HTTP ${res.status}`);
    } else if (body && typeof body === "object") {
      // Legacy NestJS shape: { statusCode, message: string|string[], error: string }
      code =
        typeof body.error === "string"
          ? body.error
          : Array.isArray(body.message) && typeof body.message[0] === "string"
            ? body.message[0]
            : `http_${res.status}`;
      message = stringifyError(
        body.message ?? body.error ?? body,
        `HTTP ${res.status}`,
      );
    } else {
      message = stringifyError(body, `HTTP ${res.status}`);
    }
  } catch {
    // Non-JSON error (nginx 502 HTML page, proxy timeout text, etc).
    // Keep the raw text but cap it so an entire HTML page doesn't end
    // up in a thrown Error.
    message = text ? text.slice(0, 300) : `HTTP ${res.status}`;
  }
  return new BackendApiError(res.status, code, message);
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token: string | null,
): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    // Auction state changes every minute (scheduler) and every bid —
    // never cache at the data-fetch layer.
    cache: "no-store",
  });
  if (res.status === 401) throw new BackendUnauthorized();
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as unknown as T;
  return (await res.json()) as T;
}

export const backend = {
  publicGet: <T>(path: string) => request<T>(path, { method: "GET" }, null),
  authed(token: string) {
    if (!token) throw new BackendUnauthorized();
    return {
      get: <T>(path: string) =>
        request<T>(path, { method: "GET" }, token),
      post: <T>(path: string, body: unknown) =>
        request<T>(
          path,
          { method: "POST", body: JSON.stringify(body) },
          token,
        ),
      patch: <T>(path: string, body: unknown) =>
        request<T>(
          path,
          { method: "PATCH", body: JSON.stringify(body) },
          token,
        ),
      delete: <T>(path: string) =>
        request<T>(path, { method: "DELETE" }, token),
    };
  },
};

// ─── Notification types (PR-NOTIFY-1) ───────────────────────────────

export interface NotificationListItem {
  id: string;
  templateCode: string;
  subject: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  items: NotificationListItem[];
  nextCursor: string | null;
}

export interface NotificationPreferences {
  outbid: boolean;
  auctionEnding: boolean;
  orderUpdates: boolean;
  dailyStreak: boolean;
  marketingPush: boolean;
  marketingEmail: boolean;
  // Regulatory: server force-true on every write — the toggle is
  // surfaced as read-only in the UI for transparency.
  responsibleGambling: boolean;
}

export interface Auction {
  id: string;
  title: string;
  description: string;
  imageUrls: string[];
  retailPrice: string;
  coinsPerBid: number;
  startsAt: string | null;
  endsAt: string;
  status: "UPCOMING" | "LIVE" | "ENDED";
  winnerId: string | null;
  winnerAmount: string | null;
  closedAt: string | null;
  createdAt: string;
  winner?: { username: string } | null;
}

// ─── Watchlist types (PR-WATCHLIST-1) ───────────────────────────────

export interface WatchlistItem {
  id: string;
  watchedAt: string;
  lastNotifiedAt: string | null;
  auction: {
    id: string;
    title: string;
    description: string;
    imageUrl: string | null;
    status: "UPCOMING" | "LIVE" | "ENDED";
    startsAt: string | null;
    endsAt: string | null;
    coinsPerBid: number;
    retailPrice: string;
  };
}

export interface WatchlistListResponse {
  items: WatchlistItem[];
  counts: {
    live: number;
    upcoming: number;
    other: number;
    total: number;
    cap: number;
  };
}

export interface WatchToggleResponse {
  watching: boolean;
  since?: string;
  alreadyWatching?: boolean;
  removed?: number;
}

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string | null;
    username: string;
    emailVerified: boolean;
    isAdmin: boolean;
    coinBalance: number;
  };
}
