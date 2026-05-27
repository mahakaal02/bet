import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BetWalletService } from './bet-wallet.service';

/**
 * Service-level coverage for the BetWalletService — the HTTP shim
 * to Bet's `/api/internal/wallet` (PR-ARCH-AUDIT, Stage G). Was
 * untested at the service level despite being the only path that
 * mutates the canonical wallet balance.
 *
 * We stub `fetch` globally because Bet is a remote service; the
 * tests assert that the right URL + headers + body shape go out,
 * and that error responses are mapped to NestJS exceptions
 * correctly.
 */

type FetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

function makeConfig(overrides: { baseUrl?: string | null; secret?: string | null } = {}) {
  // Use `in` so `{ baseUrl: null }` actually sets null (not the default).
  // `??` would treat `null` as "use default".
  const baseUrl = 'baseUrl' in overrides ? overrides.baseUrl : 'https://bet.example.test';
  const secret = 'secret' in overrides ? overrides.secret : 's3cr3t';
  return {
    get: jest.fn((key: string) => {
      if (key === 'BET_BASE_URL') return baseUrl ?? undefined;
      if (key === 'INTERNAL_API_SECRET') return secret ?? undefined;
      return undefined;
    }),
  };
}

function makePrisma(overrides: { user?: Record<string, unknown> | null } = {}) {
  const user = overrides.user;
  return {
    user: {
      findUnique: jest.fn(async () => user),
      update: jest.fn(async () => ({})),
    },
  };
}

describe('BetWalletService', () => {
  let fetchSpy: jest.SpyInstance;
  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('isConfigured', () => {
    it('false when BET_BASE_URL is missing', () => {
      const svc = new BetWalletService(
        makeConfig({ baseUrl: null }) as never,
        makePrisma() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it('false when INTERNAL_API_SECRET is missing', () => {
      const svc = new BetWalletService(
        makeConfig({ secret: null }) as never,
        makePrisma() as never,
      );
      expect(svc.isConfigured()).toBe(false);
    });

    it('true when both are set', () => {
      const svc = new BetWalletService(
        makeConfig() as never,
        makePrisma() as never,
      );
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe('debit/credit error mapping', () => {
    it('insufficient_coins → BadRequestException', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'b1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'insufficient_coins' }),
      } as FetchResponse as never);
      await expect(
        svc.debit({
          userId: 'u1',
          amount: 1000,
          kind: 'bid',
          reference: 'r1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('user_not_found → NotFoundException', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'b1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'user_not_found' }),
      } as FetchResponse as never);
      await expect(
        svc.credit({ userId: 'u1', amount: 100, kind: 'topup', reference: 'r1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forbidden → ForbiddenException', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'b1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden' }),
      } as FetchResponse as never);
      await expect(
        svc.debit({ userId: 'u1', amount: 50, kind: 'bid', reference: 'r1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('unknown error → ServiceUnavailableException', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'b1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'fire' }),
      } as FetchResponse as never);
      await expect(
        svc.debit({ userId: 'u1', amount: 50, kind: 'bid', reference: 'r1' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('emits the correct payload + Bearer header on success', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'bet-7' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ balance: 250, duplicate: false }),
      } as FetchResponse as never);
      const result = await svc.debit({
        userId: 'u1',
        amount: 50,
        kind: 'aviator_stake',
        reference: 'r-abc',
        metadata: { round: 5 },
      });
      expect(result).toEqual({ balance: 250, duplicate: false });

      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('https://bet.example.test/api/internal/wallet');
      expect(call[1].method).toBe('POST');
      expect(call[1].headers.Authorization).toBe('Bearer s3cr3t');
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({
        op: 'debit',
        userId: 'bet-7',
        amount: 50,
        kind: 'aviator_stake',
        reference: 'r-abc',
        metadata: { round: 5 },
      });
    });

    it('not-configured → ServiceUnavailable before any fetch', async () => {
      const svc = new BetWalletService(
        makeConfig({ baseUrl: null }) as never,
        makePrisma({
          user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'b1' },
        }) as never,
      );
      await expect(
        svc.debit({ userId: 'u1', amount: 1, kind: 'k', reference: 'r' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('ensureUser caching', () => {
    it('returns cached betUserId without hitting Bet', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'bet-cached' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      const out = await svc.ensureUser('u1');
      expect(out).toEqual({ betUserId: 'bet-cached', created: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('calls /users/ensure when betUserId is not cached', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: null },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ userId: 'bet-fresh', created: true }),
      } as FetchResponse as never);
      const out = await svc.ensureUser('u1');
      expect(out).toEqual({ betUserId: 'bet-fresh', created: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][0]).toBe(
        'https://bet.example.test/api/internal/users/ensure',
      );
    });

    it('user_not_found row → NotFoundException', async () => {
      const svc = new BetWalletService(
        makeConfig() as never,
        makePrisma({ user: null }) as never,
      );
      await expect(svc.ensureUser('u1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('user without email → BadRequestException (can\'t bridge to Bet)', async () => {
      const svc = new BetWalletService(
        makeConfig() as never,
        makePrisma({
          user: { id: 'u1', email: null, username: 'u', betUserId: null },
        }) as never,
      );
      await expect(svc.ensureUser('u1')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('balance', () => {
    it('reads balance via /api/internal/wallet op=balance', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'bet-1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ balance: 1234 }),
      } as FetchResponse as never);
      const b = await svc.balance('u1');
      expect(b).toBe(1234);
      const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
      expect(body).toEqual({ op: 'balance', userId: 'bet-1' });
    });

    it('5xx from Bet → ServiceUnavailableException', async () => {
      const prisma = makePrisma({
        user: { id: 'u1', email: 'u@x', username: 'u', betUserId: 'bet-1' },
      });
      const svc = new BetWalletService(makeConfig() as never, prisma as never);
      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'down' }),
      } as FetchResponse as never);
      await expect(svc.balance('u1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
