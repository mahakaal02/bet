/**
 * One-off merge: fold legacy `*@bet.local` users into their
 * `*@uniquebid.local` counterparts.
 *
 * Bet's auth now delegates to the auctions backend (see `lib/auth.ts`)
 * so user identity is keyed on the backend's canonical email
 * (`*@uniquebid.local`). Before this rollout, Bet's seed created its
 * own demo users at `*@bet.local`, and the auctions SSO bridge ensured
 * a parallel `*@uniquebid.local` shadow row when those users hit Bet.
 *
 * The result: each demo player has TWO Bet rows, two wallets, two coin
 * balances. This script consolidates them:
 *
 *   - If only the `@bet.local` row exists, rename its email.
 *   - If both exist, transfer the `@bet.local` user's wallet balance
 *     into the `@uniquebid.local` row, then retire the `@bet.local`
 *     row (rename its email to `<id>@legacy.local`, blank its
 *     `referralCode` so it doesn't collide with the canonical row).
 *
 * Wallet only. Position / trade / order / etc rows are not merged —
 * those reference user.id which doesn't change for either side, so
 * historical activity stays attached to whichever row it was placed
 * against. For demo data that's the right call.
 *
 *   npx tsx scripts/merge-legacy-bet-emails.ts        # apply
 *   npx tsx scripts/merge-legacy-bet-emails.ts --dry  # preview only
 *
 * Safe to run multiple times. After all legacy rows are processed it
 * exits 0 with "nothing to merge".
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const DRY = process.argv.includes("--dry");

async function main() {
  const legacy = await db.user.findMany({
    where: { email: { endsWith: "@bet.local" } },
    orderBy: { email: "asc" },
  });
  if (legacy.length === 0) {
    console.log("Nothing to merge — no `@bet.local` rows left.");
    return;
  }

  console.log(
    `Found ${legacy.length} legacy @bet.local rows. Mode: ${DRY ? "DRY RUN" : "APPLY"}\n`,
  );

  let renamed = 0;
  let merged = 0;
  let skipped = 0;

  for (const old of legacy) {
    const newEmail = old.email.replace("@bet.local", "@uniquebid.local");
    const target = await db.user.findUnique({ where: { email: newEmail } });

    if (!target) {
      // No conflict — simple rename. Username stays as-is.
      console.log(`  ${old.email} → ${newEmail} (rename)`);
      if (!DRY) {
        await db.user.update({
          where: { id: old.id },
          data: { email: newEmail },
        });
      }
      renamed += 1;
      continue;
    }
    if (target.id === old.id) {
      // Shouldn't happen but defensive.
      skipped += 1;
      continue;
    }

    // Both rows exist — fold the legacy wallet balance into the new row.
    const [legacyWallet, targetWallet] = await Promise.all([
      db.wallet.findUnique({ where: { userId: old.id } }),
      db.wallet.findUnique({ where: { userId: target.id } }),
    ]);
    const transfer = legacyWallet?.balance ?? 0;
    const targetBalanceBefore = targetWallet?.balance ?? 0;
    const targetBalanceAfter = targetBalanceBefore + transfer;

    console.log(
      `  ${old.email} (₹${transfer.toLocaleString("en-IN")}) → ${newEmail}` +
        ` (₹${targetBalanceBefore.toLocaleString("en-IN")} → ₹${targetBalanceAfter.toLocaleString("en-IN")}) (merge)`,
    );

    if (DRY) {
      merged += 1;
      continue;
    }

    await db.$transaction(async (tx) => {
      // Add legacy balance to target, log a transaction so the audit
      // ledger reflects where the coins came from.
      if (transfer > 0 && targetWallet) {
        await tx.wallet.update({
          where: { id: targetWallet.id },
          data: { balance: targetBalanceAfter },
        });
        await tx.transaction.create({
          data: {
            userId: target.id,
            delta: transfer,
            kind: "legacy_merge",
            reference: `merge:${old.id}`,
            metadata: {
              fromEmail: old.email,
              fromUserId: old.id,
            },
          },
        });
      }
      if (legacyWallet) {
        // Zero the legacy wallet so future ops can't accidentally
        // double-spend the merged amount.
        await tx.wallet.update({
          where: { id: legacyWallet.id },
          data: { balance: 0 },
        });
      }
      // Retire the legacy row: free up the canonical referralCode +
      // park the email under a `@legacy.local` slug so it can't be
      // re-signed-in to and can't collide with anything future.
      await tx.user.update({
        where: { id: old.id },
        data: {
          email: `${old.id}@legacy.local`,
          referralCode: null,
          banned: true,
        },
      });
    });
    merged += 1;
  }

  console.log(`\nSummary:`);
  console.log(`  renamed: ${renamed}`);
  console.log(`  merged : ${merged}`);
  console.log(`  skipped: ${skipped}`);
  console.log(DRY ? "\n(dry run — no DB changes)" : "\nDone.");
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
