import { clearUser } from './auth';

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * `credentials: 'include'` is the load-bearing flag — it tells the
 * browser to attach the `kalki_admin_session` httpOnly cookie set
 * by `/auth/admin/login` (PR-ADMIN-COOKIE-AUTH). Without this every
 * request would 401.
 *
 * Cross-origin note: in prod the admin SPA and the API live on
 * different subdomains (kalki-admin vs kalki-backend). The backend
 * MUST set CORS to allow this origin + credentials (see
 * `backend/src/main.ts` + the `CORS_ALLOWED_ORIGINS` env var).
 *
 * No Authorization header anywhere — the SPA never reads or stores
 * the JWT.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearUser();
    throw new ApiError(401, 'unauthorised');
  }
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      message = body?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

/**
 * Multipart variant — the browser sets Content-Type (with boundary)
 * automatically, so we must NOT spread the JSON headers from
 * `request`. Same credentials handling.
 */
async function postFormData<T>(path: string, form: FormData): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: form,
    credentials: 'include',
  });
  if (res.status === 401) {
    clearUser();
    throw new ApiError(401, 'unauthorised');
  }
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = await res.json();
      message = body?.message ?? message;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}

/**
 * Binary GET — used by the KYC review queue to fetch decrypted
 * document bytes for inline preview. The endpoint sets its own
 * Content-Type / Content-Disposition; we just return the Blob.
 */
async function getBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
  });
  if (res.status === 401) {
    clearUser();
    throw new ApiError(401, 'unauthorised');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `binary fetch failed: ${res.status}`);
  }
  return res.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postFormData,
  getBlob,
};
