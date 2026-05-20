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

async function parseError(res: Response): Promise<BackendApiError> {
  const text = await res.text();
  let code = "internal";
  let message = text;
  try {
    const body = JSON.parse(text);
    // NestJS standard error shape: { message, error, statusCode } where
    // `error` is a short slug and `message` may be a string or string[].
    code =
      body?.error?.code ??
      body?.error ??
      (Array.isArray(body?.message) ? body.message[0] : null) ??
      "internal";
    message = Array.isArray(body?.message)
      ? body.message.join("; ")
      : body?.message ?? body?.error ?? code;
  } catch {
    // Non-JSON error (HTML proxy page, etc) — leave defaults.
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
