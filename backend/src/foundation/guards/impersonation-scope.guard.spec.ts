import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ImpersonationScopeGuard } from './impersonation-scope.guard';
import type { AuthedUser } from '../../auth/current-user.decorator';

function makeCtx(user: AuthedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeUser(overrides: Partial<AuthedUser> = {}): AuthedUser {
  return {
    id: 'u1',
    email: 'u1@example.com',
    username: 'u1',
    emailVerified: true,
    coinBalance: 0,
    isAdmin: false,
    ...overrides,
  };
}

describe('ImpersonationScopeGuard', () => {
  function build(denyValue: boolean | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(denyValue),
    } as unknown as Reflector;
    return new ImpersonationScopeGuard(reflector);
  }

  it('lets the request through when the route is NOT @DenyImpersonated', () => {
    const guard = build(undefined);
    expect(
      guard.canActivate(makeCtx(makeUser({ _impersonation: { actorId: 'admin', impersonationId: 'i1' } }))),
    ).toBe(true);
  });

  it('lets a normal session through on a denied route', () => {
    const guard = build(true);
    expect(guard.canActivate(makeCtx(makeUser()))).toBe(true);
  });

  it('blocks an impersonation session on a denied route', () => {
    const guard = build(true);
    expect(() =>
      guard.canActivate(
        makeCtx(makeUser({ _impersonation: { actorId: 'admin', impersonationId: 'i1' } })),
      ),
    ).toThrow(ForbiddenException);
  });

  it('lets an unauthed request through (JwtAuthGuard handles 401 elsewhere)', () => {
    const guard = build(true);
    expect(guard.canActivate(makeCtx(undefined))).toBe(true);
  });
});
