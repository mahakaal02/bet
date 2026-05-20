import { Injectable, Logger } from '@nestjs/common';
import { OutboxKind, type Outbox } from '@prisma/client';
import { BetWalletService } from '../../bet-wallet/bet-wallet.service';
import { type DispatchResult, type OutboxDispatcher } from '../outbox-dispatcher';

/**
 * Dispatcher for `OutboxKind.BET_WALLET_CREDIT`.
 *
 * Used for:
 *   - Compensating refunds when a bid is rolled back
 *   - Aviator cashout payouts
 *   - Referral payouts (PR-REFERRAL-1)
 *   - Daily-login streak rewards (PR-DAILY-1)
 *   - Manual admin grants (PR-ADMIN-CORE-1)
 *
 * Same idempotency contract as the debit dispatcher: Bet dedupes
 * on `(kind, reference)`. Same error classification (4xx →
 * permanent, 5xx → transient).
 */
@Injectable()
export class BetWalletCreditDispatcher implements OutboxDispatcher {
  readonly kind = OutboxKind.BET_WALLET_CREDIT;

  private readonly logger = new Logger(BetWalletCreditDispatcher.name);

  constructor(private readonly betWallet: BetWalletService) {}

  async dispatch(row: Outbox): Promise<DispatchResult> {
    if (!this.betWallet.isConfigured()) {
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
    if (!payload.userId || !payload.amount || !payload.kind || !payload.reference) {
      return {
        ok: false,
        permanent: true,
        error: 'invalid payload: missing userId / amount / kind / reference',
      };
    }
    try {
      await this.betWallet.credit({
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
