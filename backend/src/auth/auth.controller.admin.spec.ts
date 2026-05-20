import { ForbiddenException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { ADMIN_COOKIE_NAME } from './cookie';

/**
 * Tests for the cookie-setting admin endpoints introduced in
 * PR-ADMIN-COOKIE-AUTH. The plain-bearer endpoints (`/auth/login`,
 * `/auth/login/2fa`) keep their old behaviour and are exercised by
 * the higher-level integration tests.
 *
 * What we lock down here:
 *   1. `adminLogin` sets the cookie + suppresses the token in the
 *      response body (so the SPA never sees the JWT).
 *   2. Non-admin login → 403 + no cookie set.
 *   3. 2FA challenge path passes through unchanged (no cookie yet).
 *   4. `adminLogout` emits a Max-Age=0 cookie regardless of session
 *      state (idempotent).
 *   5. The configured cookie options (Secure / Domain) thread
 *      through into the actual Set-Cookie value.
 *   6. `adminSsoToken` returns a 60s token only for admins.
 */

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
    _headers: headers,
  } as unknown as import('express').Response & { _headers: Record<string, string> };
}

function makeAuthService(overrides: Partial<{
  login: jest.Mock; completeLoginWith2FA: jest.Mock;
  issueShortLivedSsoToken: jest.Mock; reissueSessionToken: jest.Mock;
}> = {}) {
  return {
    login: overrides.login ?? jest.fn(),
    completeLoginWith2FA: overrides.completeLoginWith2FA ?? jest.fn(),
    issueShortLivedSsoToken: overrides.issueShortLivedSsoToken ?? jest.fn(() => 'short-jwt'),
    reissueSessionToken: overrides.reissueSessionToken ?? jest.fn(() => 'full-session-jwt'),
  };
}

function makeConfig(env: Record<string, string | undefined> = {}) {
  return {
    get: (k: string) => env[k],
  };
}

function makeController(opts: {
  auth: ReturnType<typeof makeAuthService>;
  config?: { get: (k: string) => string | undefined };
}) {
  return new AuthController(
    opts.auth as never,
    { isConfigured: () => false } as never,
    (opts.config ?? makeConfig()) as never,
  );
}

const ADMIN_USER = {
  id: 'u-1', email: 'admin@kalki.test', username: 'admin',
  emailVerified: true, coinBalance: 0, isAdmin: true,
};
const NON_ADMIN_USER = { ...ADMIN_USER, isAdmin: false };

describe('AuthController.adminLogin', () => {
  it('sets the admin cookie + returns user (no token in body) on happy path', async () => {
    const auth = makeAuthService({
      login: jest.fn(async () => ({ token: 'sess.jwt.value', user: ADMIN_USER })),
    });
    const config = makeConfig({ NODE_ENV: 'production' });
    const controller = makeController({ auth, config });
    const res = makeRes();

    const out = await controller.adminLogin(
      { email: 'admin@kalki.test', password: 'pw' } as never,
      res,
      undefined,
    );

    expect(out).toEqual({ user: ADMIN_USER });
    // Token MUST NOT leak in the response body.
    expect(JSON.stringify(out)).not.toContain('sess.jwt.value');

    const setCookie = (res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie'];
    expect(setCookie).toContain(`${ADMIN_COOKIE_NAME}=sess.jwt.value`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Secure'); // prod env
  });

  it('throws 403 + sets NO cookie when the user is not an admin', async () => {
    const auth = makeAuthService({
      login: jest.fn(async () => ({ token: 't', user: NON_ADMIN_USER })),
    });
    const controller = makeController({ auth });
    const res = makeRes();

    await expect(
      controller.adminLogin({ email: 'u', password: 'pw' } as never, res, undefined),
    ).rejects.toThrow(ForbiddenException);
    expect((res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie']).toBeUndefined();
  });

  it('passes the 2FA challenge through (no cookie yet)', async () => {
    const auth = makeAuthService({
      login: jest.fn(async () => ({ needs2FA: true, challengeToken: 'chal' })),
    });
    const controller = makeController({ auth });
    const res = makeRes();

    const out = await controller.adminLogin(
      { email: 'u', password: 'pw' } as never,
      res,
      undefined,
    );

    expect(out).toEqual({ needs2FA: true, challengeToken: 'chal' });
    expect((res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie']).toBeUndefined();
  });

  it('honours ADMIN_COOKIE_DOMAIN env', async () => {
    const auth = makeAuthService({
      login: jest.fn(async () => ({ token: 'tok', user: ADMIN_USER })),
    });
    const config = makeConfig({
      NODE_ENV: 'production',
      ADMIN_COOKIE_DOMAIN: '.cloud.podstack.ai',
    });
    const controller = makeController({ auth, config });
    const res = makeRes();
    await controller.adminLogin({ email: 'u', password: 'pw' } as never, res, undefined);
    const setCookie = (res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie'];
    expect(setCookie).toContain('Domain=.cloud.podstack.ai');
  });

  it('drops Secure in development env', async () => {
    const auth = makeAuthService({
      login: jest.fn(async () => ({ token: 'tok', user: ADMIN_USER })),
    });
    const config = makeConfig({ NODE_ENV: 'development' });
    const controller = makeController({ auth, config });
    const res = makeRes();
    await controller.adminLogin({ email: 'u', password: 'pw' } as never, res, undefined);
    const setCookie = (res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie'];
    expect(setCookie).not.toContain('Secure');
  });
});

describe('AuthController.adminLoginTwoFactor', () => {
  it('sets the cookie + returns user after a successful 2FA completion', async () => {
    const auth = makeAuthService({
      completeLoginWith2FA: jest.fn(async () => ({ token: 'sess.tok', user: ADMIN_USER })),
    });
    const controller = makeController({ auth });
    const res = makeRes();
    const out = await controller.adminLoginTwoFactor(
      { challengeToken: 'chal', code: '123456' } as never,
      res,
      undefined, undefined,
    );
    expect(out).toEqual({ user: ADMIN_USER, trustedDevice: null });
    expect((res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie']).toContain('sess.tok');
  });

  it('throws 403 if the 2FA-completed user is not an admin', async () => {
    const auth = makeAuthService({
      completeLoginWith2FA: jest.fn(async () => ({ token: 'sess.tok', user: NON_ADMIN_USER })),
    });
    const controller = makeController({ auth });
    const res = makeRes();
    await expect(
      controller.adminLoginTwoFactor(
        { challengeToken: 'chal', code: '123456' } as never,
        res,
        undefined, undefined,
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('AuthController.adminLogout', () => {
  it('emits a Max-Age=0 cookie regardless of session presence', () => {
    const controller = makeController({ auth: makeAuthService() });
    const res = makeRes();
    const out = controller.adminLogout(res);
    expect(out).toEqual({ ok: true });
    const setCookie = (res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie'];
    expect(setCookie).toContain(`${ADMIN_COOKIE_NAME}=`);
    expect(setCookie).toContain('Max-Age=0');
  });
});

describe('AuthController.adminSsoToken', () => {
  it('returns a token + 60s TTL', () => {
    const auth = makeAuthService();
    const controller = makeController({ auth });
    const out = controller.adminSsoToken(ADMIN_USER as never);
    expect(out).toEqual({ token: 'short-jwt', expiresIn: 60 });
    expect(auth.issueShortLivedSsoToken).toHaveBeenCalledWith(ADMIN_USER);
  });
});

describe('AuthController.adminSsoAccept', () => {
  it('throws 403 if the bearer subject is not an admin', async () => {
    const auth = makeAuthService();
    const controller = makeController({ auth });
    const res = makeRes();
    await expect(controller.adminSsoAccept(NON_ADMIN_USER as never, res)).rejects.toThrow(
      ForbiddenException,
    );
    expect(auth.reissueSessionToken).not.toHaveBeenCalled();
  });

  it('re-issues a session token + sets cookie for admins', async () => {
    const auth = makeAuthService();
    const controller = makeController({ auth });
    const res = makeRes();
    const out = await controller.adminSsoAccept(ADMIN_USER as never, res);
    expect(out).toEqual({ user: ADMIN_USER });
    expect(auth.reissueSessionToken).toHaveBeenCalledWith(ADMIN_USER);
    expect((res as unknown as { _headers: Record<string, string> })._headers['Set-Cookie']).toContain(
      'full-session-jwt',
    );
  });
});
