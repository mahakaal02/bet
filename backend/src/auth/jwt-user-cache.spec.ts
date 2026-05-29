import type { User } from '@prisma/client';
import { JwtUserCache } from './jwt-user-cache';

/**
 * JwtUserCache is a thin, keyed-by-id wrapper over the foundation
 * TtlCache. These tests lock down the contract validateJwt + the
 * password-reset invalidation hook rely on: set stores by `user.id`,
 * get returns the row until invalidated or until the TTL lapses.
 */
function makeUser(id: string): User {
  // Only `id` matters for the cache; cast the rest.
  return { id } as User;
}

describe('JwtUserCache', () => {
  afterEach(() => jest.useRealTimers());

  it('stores and returns a user by id', () => {
    const cache = new JwtUserCache();
    cache.set(makeUser('u-1'));
    expect(cache.get('u-1')?.id).toBe('u-1');
  });

  it('returns undefined for an unknown id', () => {
    expect(new JwtUserCache().get('nope')).toBeUndefined();
  });

  it('invalidate drops the entry (immediate, for password resets)', () => {
    const cache = new JwtUserCache();
    cache.set(makeUser('u-1'));
    cache.invalidate('u-1');
    expect(cache.get('u-1')).toBeUndefined();
  });

  it('entries expire after the TTL', () => {
    jest.useFakeTimers();
    const cache = new JwtUserCache();
    cache.set(makeUser('u-1'));
    jest.advanceTimersByTime(JwtUserCache.TTL_MS + 1);
    expect(cache.get('u-1')).toBeUndefined();
  });
});
