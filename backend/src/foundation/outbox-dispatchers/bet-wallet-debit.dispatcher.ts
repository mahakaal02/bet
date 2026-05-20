import { Injectable, Logger } from '@nestjs/common';
import { OutboxKind, type Outbox } from '@prisma/client';
import { BetWalletService } from '../../bet-wallet/bet-wallet.service';
import { type DispatchResult, type OutboxDispatcher } from '../outbox-dispatcher';

/**
 * Dispatcher for `OutboxKind.BET_WALLET_DEBIT`.
 *
 * Payload shape (validated at consumption time — producers pass it
 * verbatim, see `bids.service.ts`):
 *
 *   {
 *     userId: string;
 *     amount: number;          // coins
 *     kind: string;            // ledger reason, e.g. "auction_bid"
 *     reference: string;       // unique handle: "bid:<bidId>"
 *     metadata?: object;       // optional, forwarded for audit
 *   }
 *
 * Idempotency: Bet's wallet service dedupes by
 * `(kind, reference)` — see `bet/app/api/internal/wallet/route.ts`.
 * Resending the same payload (e.g. after a transient 5xx) credits
 * once on Bet, not twice. The OutboxService's
 * `idempotencyKey` mirrors that pair so this dispatcher and Bet
 * agree on the same dedupe identity.
 *
 * Error classification:
 *   - 400 / 402 / 404 from Bet → permanent (DEAD on first
 *     failure). Examples: user not found, insufficient balance,
 *     malformed request.
 *   - 5xx / network / 503 → transient. Backoff + retry.
 */
@Injectable()
export class BetWalletDebitDispatcher implements OutboxDispatcher {
  readonly kind = OutboxKind.BET_WALLET_DEBIT;

  private readonly logger = new Logger(BetWalletDebitDispatcher.name);

  constructor(private readonly betWallet: BetWalletService) {}

  async dispatch(row: Outbox): Promise<DispatchResult> {
    if (!this.betWallet.isConfigured()) {
      // Production deploy missing creds → permanent failure (DEAD)
      // is too harsh; we want the row to retry once an operator
      // sets BET_BASE_URL / INTERNAL_API_SECRET. Mark transient
      // and let the backoff handle it.
      return {
        ok: false,
        permanent: false,
        error: 'bet_wallet_not_configured',
      };
    }
    const payload = row.payload as {
      userId?: string;
      amount?: number;
      kind?: string;
      reference?: string;
      metadata?: Record<string, unknown>;
    };
    // Producer-side validation should have caught these; treat
    // missing fields as permanent (no retry will fix it).
    if (!payload.userId || !payload.amount || !payload.kind || !payload.reference) {
      return {
        ok: false,
        permanent: true,
        error: 'invalid payload: missing userId / amount / kind / reference',
      };
    }
    try {
      await this.betWallet.debit({
        userId: payload.userId,
        amount: payload.amount,
        kind: payload.kind,
        reference: payload.reference,
        metadata: payload.metadata ?? {},
      });
      return { ok: true };
    } catch (e) {
      const status = (e as { status?: number }).status;
      const msg = e instanceof Error ? e.message : String(e);
      // 4xx → permanent. NestJS HttpException carries .status.
      // Defensive: 402 insufficient_coins is a business-logic
      // error and DOES warrant manual review, but no amount of
      // retry will resolve it — DEAD with a clear `lastError`
      // surfaces it to the admin queue.
      const permanent = !!status && status >= 400 && status < 500;
      return {
        ok: false,
        permanent,
        error: msg,
        detail: { status, payload: { ...payload, metadata: undefined } },
      };
    }
  }
}
