/**
 * Wallet debit/credit primitives that are safe under concurrency.
 *
 * The naive pattern `tx.wallet.update({ decrement: n })` will happily push
 * a balance negative if the row was decremented by a concurrent transaction
 * between the read-side balance check and the write. Postgres' default
 * READ COMMITTED isolation doesn't lock the row, and Prisma's `decrement`
 * compiles to `balance = balance - n` without a `WHERE balance >= n` guard.
 *
 * `safeDebit` runs the decrement as an `updateMany` filtered on
 * `balance >= amount`, which Postgres evaluates atomically against the row
 * version. If the funds aren't there at write time, zero rows are affected
 * and we throw `InsufficientFundsError` — the caller's `$transaction`
 * rolls back, no partial state remains.
 *
 * Use this for:
 *   - any user wallet debit driven by a trade / order / withdrawal
 *   - aviator stake debits (when routed through Bet)
 *
 * Don't use it for credits — `tx.wallet.update({ increment: n })` is
 * already concurrency-safe (no lower bound to check).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

export class InsufficientFundsError extends Error {
  constructor(
    public userId: string,
    public requested: number,
  ) {
    super("insufficient_coins");
  }
}

/**
 * Atomically decrement `userId`'s wallet by `amount`, refusing if the
 * post-update balance would be negative. Throws `InsufficientFundsError`
 * on insufficient funds (which the caller is expected to map to a 4xx
 * — typically a `HttpError(400, "insufficient_coins")`).
 *
 * `amount` is floor()'d to an integer. Pass 0 and this is a no-op.
 */
export async function safeDebit(
  tx: TxClient,
  userId: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const need = Math.floor(amount);
  if (need <= 0) return;

  const result = await tx.wallet.updateMany({
    where: { userId, balance: { gte: need } },
    data: { balance: { decrement: need } },
  });
  if (result.count !== 1) {
    throw new InsufficientFundsError(userId, need);
  }
}

/**
 * Credit a wallet by `amount`. Thin wrapper that exists mainly for
 * symmetry with `safeDebit` so call-sites read uniformly. Credits cannot
 * underflow, so this is just a normal increment.
 */
export async function safeCredit(
  tx: TxClient,
  userId: string,
  amount: number,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const add = Math.floor(amount);
  if (add <= 0) return;
  await tx.wallet.update({
    where: { userId },
    data: { balance: { increment: add } },
  });
}
