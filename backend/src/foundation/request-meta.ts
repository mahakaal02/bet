/**
 * Tiny helper for pulling forwarded IP + user-agent off the request
 * (PR-ARCH-AUDIT, Stage D — replaces a copy-pasted extractIp /
 * pickHeader pair living in 4+ controllers).
 *
 * Trusts the X-Forwarded-For header — the deployment terminates TLS
 * at the ingress / load balancer, which sets XFF before passing the
 * request through. If you're running this backend behind a chain of
 * proxies you don't control, harden the splitting upstream.
 */

type ReqLike = {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

export function extractIp(req: ReqLike): string | undefined {
  const xff = req.headers['x-forwarded-for'];
  if (Array.isArray(xff)) return xff[0]?.split(',')[0]?.trim();
  if (typeof xff === 'string') return xff.split(',')[0]?.trim();
  return req.ip;
}

export function pickHeader(req: ReqLike, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Convenience: extract both IP + UA for an audit-log row. */
export function requestMeta(req: ReqLike): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: extractIp(req),
    userAgent: pickHeader(req, 'user-agent') ?? undefined,
  };
}
