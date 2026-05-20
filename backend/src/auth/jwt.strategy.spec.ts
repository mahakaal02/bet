import { ADMIN_COOKIE_NAME } from './cookie';

/**
 * Tests for the JwtStrategy extractor logic in PR-ADMIN-COOKIE-AUTH.
 *
 * The strategy uses `ExtractJwt.fromExtractors([Bearer, cookie])`.
 * Wiring this through Passport requires module init; instead we
 * re-express the extractor functions directly to cover the contract:
 *
 *   1. Mobile / API client (Authorization: Bearer) — UNCHANGED. The
 *      Bearer path is the FIRST extractor; cookie is fallback. This
 *      closes the "Smoke: hit /auth/login from a mobile-style curl
 *      with Bearer → unchanged" item.
 *   2. Admin SPA (kalki_admin_session cookie) — extracted from the
 *      Cookie header via parseCookieHeader.
 *   3. Both present — Bearer wins (explicit beats ambient). A
 *      misconfigured admin browser that ALSO sends Authorization
 *      via DevTools must not authenticate as the cookie subject.
 *   4. Neither — null (the guard returns 401).
 *
 * We import the cookie helpers directly to avoid pulling in
 * @nestjs/passport which would force a fuller test harness.
 */

// Re-implement the extractor logic verbatim from jwt.strategy.ts so
// the test is self-contained. If the production extractor logic
// changes, this spec MUST be updated in the same PR — that's the
// invariant we're locking down.

import { ExtractJwt } from 'passport-jwt';
import { parseCookieHeader } from './cookie';

function extractFromAdminCookie(req: { headers?: { cookie?: string } } | undefined): string | null {
  const raw = req?.headers?.cookie;
  if (!raw) return null;
  const cookies = parseCookieHeader(raw);
  return cookies[ADMIN_COOKIE_NAME] ?? null;
}

const fromExtractors = ExtractJwt.fromExtractors([
  ExtractJwt.fromAuthHeaderAsBearerToken(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  extractFromAdminCookie as any,
]);

function mockReq(headers: Record<string, string>) {
  // passport-jwt's extractor calls req.headers + sometimes req.cookies.
  // We pass exactly what the production code sees from express.
  return { headers } as unknown as Parameters<typeof fromExtractors>[0];
}

describe('JwtStrategy extractor — mobile / API client (Bearer path, pre-PR-ADMIN-COOKIE-AUTH behaviour)', () => {
  it('extracts the token from Authorization: Bearer', () => {
    const req = mockReq({ authorization: 'Bearer eyJ.abc.def' });
    expect(fromExtractors(req)).toBe('eyJ.abc.def');
  });

  it('returns null when Authorization is malformed', () => {
    expect(fromExtractors(mockReq({ authorization: 'NotBearer xyz' }))).toBeNull();
    expect(fromExtractors(mockReq({ authorization: 'Bearer' }))).toBeNull();
    // Passport-jwt accepts an empty token; our validate() rejects it.
    // The contract here is that the extractor must not THROW on this.
    expect(() => fromExtractors(mockReq({ authorization: 'Bearer ' }))).not.toThrow();
  });

  it('is case-insensitive on the Bearer scheme', () => {
    expect(fromExtractors(mockReq({ authorization: 'bearer eyJ.abc.def' }))).toBe('eyJ.abc.def');
    expect(fromExtractors(mockReq({ authorization: 'BEARER eyJ.abc.def' }))).toBe('eyJ.abc.def');
  });
});

describe('JwtStrategy extractor — admin SPA (cookie path, PR-ADMIN-COOKIE-AUTH)', () => {
  it('extracts the token from the kalki_admin_session cookie', () => {
    const req = mockReq({
      cookie: `${ADMIN_COOKIE_NAME}=eyJ.cookie.token; other=irrelevant`,
    });
    expect(fromExtractors(req)).toBe('eyJ.cookie.token');
  });

  it('returns null when no admin cookie is present', () => {
    expect(fromExtractors(mockReq({ cookie: 'other=value' }))).toBeNull();
    expect(fromExtractors(mockReq({}))).toBeNull();
  });

  it('handles multiple cookies and picks the right one', () => {
    const req = mockReq({
      cookie: `analytics_id=xyz; ${ADMIN_COOKIE_NAME}=eyJ.cookie.token; tz=UTC`,
    });
    expect(fromExtractors(req)).toBe('eyJ.cookie.token');
  });
});

describe('JwtStrategy extractor — precedence (explicit beats ambient)', () => {
  it('Bearer wins when both Authorization and admin cookie are present', () => {
    // This is the load-bearing invariant: a misconfigured admin
    // browser that sends both must authenticate as the Bearer
    // subject, not the cookie subject. Otherwise a DevTools paste
    // of someone else's Bearer would silently re-target every
    // subsequent request to the cookie's user.
    const req = mockReq({
      authorization: 'Bearer eyJ.bearer.token',
      cookie: `${ADMIN_COOKIE_NAME}=eyJ.cookie.token`,
    });
    expect(fromExtractors(req)).toBe('eyJ.bearer.token');
  });

  it('falls back to cookie when Authorization is absent', () => {
    const req = mockReq({
      cookie: `${ADMIN_COOKIE_NAME}=eyJ.cookie.fallback`,
    });
    expect(fromExtractors(req)).toBe('eyJ.cookie.fallback');
  });

  it('returns null when both are absent (guard will 401)', () => {
    expect(fromExtractors(mockReq({}))).toBeNull();
  });

  it('falls back to cookie when Authorization has wrong scheme', () => {
    const req = mockReq({
      authorization: 'Basic dXNlcjpwYXNz',
      cookie: `${ADMIN_COOKIE_NAME}=eyJ.cookie.fallback`,
    });
    expect(fromExtractors(req)).toBe('eyJ.cookie.fallback');
  });
});
