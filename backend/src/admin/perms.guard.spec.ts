import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { PermsGuard, PERMS_METADATA_KEY } from './perms.guard';
import { Permission } from './permissions';

/**
 * PermsGuard tests. The guard composition is the meaningful unit —
 * metadata read + user resolution + grant lookup + decision. We
 * mock the Reflector and Prisma layer so the tests stay focused
 * on the decision logic.
 */

function makeCtx({
  user,
  required,
}: {
  user?: { id: string; isAdmin?: boolean };
  required?: Permission[];
}): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = {
    get: jest.fn((key: string) => (key === PERMS_METADATA_KEY ? required : undefined)),
  } as unknown as Reflector;
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => {},
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

function makePrisma(roles: Role[] = []) {
  return {
    userRole: {
      findMany: jest.fn(async () => roles.map((role) => ({ role }))),
    },
  };
}

describe('PermsGuard', () => {
  it('passes when no @Perm metadata is set (route is unguarded)', async () => {
    const { ctx, reflector } = makeCtx({ user: { id: 'u' }, required: undefined });
    const guard = new PermsGuard(reflector, makePrisma() as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('denies an unauthenticated request even when the route is guarded', async () => {
    const { ctx, reflector } = makeCtx({ user: undefined, required: ['audit.view'] });
    const guard = new PermsGuard(reflector, makePrisma() as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('legacy isAdmin user bypasses every permission check', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u', isAdmin: true },
      required: ['audit.view', 'withdrawal.approve'],
    });
    const guard = new PermsGuard(reflector, makePrisma() as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('grants MODERATOR access to audit.view', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['audit.view'],
    });
    const guard = new PermsGuard(reflector, makePrisma([Role.MODERATOR]) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('grants AUDITOR access to a *.view permission via the wildcard', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['withdrawal.view'],
    });
    const guard = new PermsGuard(reflector, makePrisma([Role.AUDITOR]) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('denies AUDITOR a mutating permission', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['withdrawal.approve'],
    });
    const guard = new PermsGuard(reflector, makePrisma([Role.AUDITOR]) as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies SUPPORT access to audit.view (not in the SUPPORT slug set)', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['audit.view'],
    });
    const guard = new PermsGuard(reflector, makePrisma([Role.SUPPORT]) as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('multi-perm @Perm(...) is OR — passes when any one matches', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['ledger.view', 'audit.view'],
    });
    // MODERATOR has audit.view but not ledger.view — should still pass.
    const guard = new PermsGuard(reflector, makePrisma([Role.MODERATOR]) as any);
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('denies when none of the OR-ed perms match', async () => {
    const { ctx, reflector } = makeCtx({
      user: { id: 'u' },
      required: ['ledger.export', 'withdrawal.approve'],
    });
    const guard = new PermsGuard(reflector, makePrisma([Role.MODERATOR]) as any);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
