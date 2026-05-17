/**
 * HISTORICAL — one-shot legacy balance migration, already executed.
 *
 * This script bridged `User.coinBalance` rows to Bet's `Wallet.balance`
 * during the Phase-1 unified-wallet rollout (May 2026). After the run,
 * a follow-up migration (`20260516210000_drop_legacy_wallet_columns`)
 * dropped `User.coinBalance` and `User.walletBalance` entirely, so this
 * script can no longer run — Prisma's generated client has no
 * `coinBalance` field anymore and the SELECT below would 500 at runtime.
 *
 * Kept in-tree as a record of the migration semantics. If you ever need
 * to re-bridge balances from a backup, restore the columns in a scratch
 * database first, then adapt this script to point at it.
 */
throw new Error(
  "migrate-legacy-balances.ts already executed; User.coinBalance + walletBalance " +
    "columns no longer exist (see migration 20260516210000_drop_legacy_wallet_columns). " +
    "Remove this guard only if you've restored the schema in a scratch database.",
);

// eslint-disable-next-line @typescript-eslint/no-unreachable
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY = process.argv.includes("--dry");
const BET_BASE_URL = (process.env.BET_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const SECRET = process.env.INTERNAL_API_SECRET;

interface EnsureResponse {
  ok: true;
  userId: string;
  username: string;
  created: boolean;
}

interface WalletResponse {
  ok: true;
  balance: number;
  duplicate: boolean;
}

async function bet<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BET_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function main() {
  if (!SECRET) {
    console.error("INTERNAL_API_SECRET is not set in env. Aborting.");
    process.exit(1);
  }
  console.log(
    `Migration target: ${BET_BASE_URL}  ·  mode: ${DRY ? "DRY RUN" : "APPLY"}`,
  );

  // Users with positive legacy balance and a usable email. Anonymous
  // WhatsApp-only users (no email) can't be bridged today; surface them
  // for a manual decision rather than silently skipping.
  const candidates = await db.user.findMany({
    where: { coinBalance: { gt: 0 } },
    select: {
      id: true,
      email: true,
      username: true,
      coinBalance: true,
      betUserId: true,
    },
  });

  const noEmail = candidates.filter((u) => !u.email);
  const ready = candidates.filter((u) => u.email);
  console.log(`Found ${candidates.length} users with coinBalance > 0`);
  if (noEmail.length > 0) {
    console.warn(
      `  ⚠ ${noEmail.length} have NO email and will be skipped — review manually:`,
    );
    for (const u of noEmail) {
      console.warn(`    - ${u.username} (id ${u.id}) holds ${u.coinBalance}`);
    }
  }

  let totalCoins = 0;
  let migrated = 0;
  let already = 0;
  let failed = 0;

  for (const u of ready) {
    if (!u.email) continue;
    try {
      // 1. Ensure Bet identity. Idempotent server-side — re-uses an
      //    existing row when email matches.
      let betUserId = u.betUserId;
      if (!betUserId) {
        const ensure = await bet<EnsureResponse>("/api/internal/users/ensure", {
          email: u.email,
          username: u.username,
        });
        betUserId = ensure.userId;
        if (!DRY) {
          await db.user.update({
            where: { id: u.id },
            data: { betUserId },
          });
        }
      }

      if (DRY) {
        console.log(
          `  would migrate ${u.email}: +${u.coinBalance} (bet=${betUserId.slice(0, 12)}…)`,
        );
        totalCoins += u.coinBalance;
        migrated += 1;
        continue;
      }

      // 2. Credit Bet's wallet idempotently.
      const result = await bet<WalletResponse>("/api/internal/wallet", {
        op: "credit",
        userId: betUserId,
        amount: u.coinBalance,
        kind: "legacy_coin_migration",
        reference: `legacy:${u.id}`,
        metadata: {
          source: "auctions-backend",
          backendUserId: u.id,
          migratedAt: new Date().toISOString(),
        },
      });

      // 3. Zero out the source column so no future writer can race.
      await db.user.update({
        where: { id: u.id },
        data: { coinBalance: 0 },
      });

      if (result.duplicate) {
        already += 1;
        console.log(
          `  ${u.email}: already migrated (no change) — wallet now ${result.balance}`,
        );
      } else {
        migrated += 1;
        totalCoins += u.coinBalance;
        console.log(
          `  ${u.email}: +${u.coinBalance} → wallet ${result.balance}`,
        );
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✘ ${u.email}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  migrated     : ${migrated}`);
  console.log(`  already      : ${already}`);
  console.log(`  no email     : ${noEmail.length}`);
  console.log(`  failed       : ${failed}`);
  console.log(`  total coins  : ${totalCoins}`);
  console.log(DRY ? "\n(dry run — no DB changes)" : "\nDone.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
