/**
 * Prisma error helpers.
 *
 * Centralised so the many optimistic-insert / lost-the-race retry
 * handlers across services don't each re-implement the structural check.
 */

/**
 * True when `err` is a Prisma unique-constraint violation (P2002).
 *
 * We do a structural `code === 'P2002'` check rather than an
 * `instanceof Prisma.PrismaClientKnownRequestError` so the helper works
 * regardless of which `@prisma/client` instance threw (and so unit tests
 * can throw a plain `{ code: 'P2002' }` object).
 */
export function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002',
  );
}
