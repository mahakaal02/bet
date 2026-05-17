/**
 * Platform "house" account — the destination for all collected commissions.
 *
 * Why a real User row instead of a special-case counter: it lets the wallet
 * invariant `SUM(Wallet.balance) === SUM(Transaction.delta)` hold without
 * carving out an exception for fees, and it gives ops a single account they
 * can reconcile, withdraw from, or audit like any other.
 *
 * The row is created lazily on the first commission. The email + username
 * are chosen so they cannot collide with a real signup (`@kalki.local`
 * domain, leading-underscore username). `passwordHash` stays null so
 * nobody can log in as the house.
 *
 * All callers pass a Prisma transaction client. NEVER call this with the
 * top-level `db` — the credit MUST happen inside the same atomic txn as
 * the trade/settlement, otherwise a crash mid-trade could collect a fee
 * without the matching debit (or vice versa).
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type TxClient = Prisma.TransactionClient | PrismaClient;

const HOUSE_EMAIL = "house@kalki.local";
const HOUSE_USERNAME = "_house";

// In-process cache. The house id is stable per database; once we've fetched
// it we can skip the upsert on every trade. Reset on process restart, so
// safe across deploys.
let cachedHouseUserId: string | null = null;

/**
 * Returns the house user id, creating the User + Wallet rows on first call
 * within this database. Idempotent — safe to call in parallel.
 */
export async function ensureHouseUser(tx: TxClient): Promise<string> {
  if (cachedHouseUserId) return cachedHouseUserId;
  const existing = await tx.user.findUnique({
    where: { email: HOUSE_EMAIL },
    select: { id: true },
  });
  if (existing) {
    cachedHouseUserId = existing.id;
    return existing.id;
  }
  // First-ever fee. Upsert in case two concurrent trades race here — the
  // unique-email constraint makes one of them lose and find the row on
  // the next read.
  const created = await tx.user.upsert({
    where: { email: HOUSE_EMAIL },
    update: {},
    create: {
      email: HOUSE_EMAIL,
      username: HOUSE_USERNAME,
      // passwordHash is null → nobody can log in as the house.
      // banned=true belt-and-braces so even if someone forged a session,
      // sign-in checks would reject them.
      banned: true,
      wallet: { create: { balance: 0 } },
    },
    select: { id: true },
  });
  cachedHouseUserId = created.id;
  return created.id;
}

export type FeeKind =
  | "commission_buy"
  | "commission_sell"
  | "commission_settlement";

/**
 * Booking the fee:
 *
 *   1. Increment the house wallet by `amount` (atomic Postgres `+=`).
 *   2. Write a Transaction audit row tagged `(kind, reference)`. The
 *      unique-index on those two columns is the dedupe gate — if the
 *      caller passes a stable reference (typically `<tradeId>` or
 *      `settlement-fee:<positionId>`), a retried trade can't double-book.
 *   3. Bump the PlatformRevenue singleton's cached counters so the admin
 *      dashboard read stays O(1).
 *
 * Returns the transaction id; throws on any DB error so the caller's
 * outer `$transaction` rolls the whole trade back.
 *
 * Pass `amount: 0` and we no-op — convenient for callers that compute
 * the fee from a sometimes-zero quote without branching at every site.
 */
export async function collectFee(
  tx: TxClient,
  args: {
    amount: number;
    kind: FeeKind;
    reference: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const { amount, kind, reference, metadata } = args;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const fee = Math.floor(amount);
  if (fee <= 0) return;

  const houseId = await ensureHouseUser(tx);

  await tx.wallet.update({
    where: { userId: houseId },
    data: { balance: { increment: fee } },
  });

  await tx.transaction.create({
    data: {
      userId: houseId,
      delta: fee,
      kind,
      reference,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });

  // Trading vs settlement bucketing on the singleton row.
  const isSettlement = kind === "commission_settlement";
  await tx.platformRevenue.update({
    where: { id: "singleton" },
    data: {
      totalTradingFees: isSettlement ? undefined : { increment: fee },
      totalSettlementFees: isSettlement ? { increment: fee } : undefined,
      totalPlatformRevenue: { increment: fee },
    },
  });
}
