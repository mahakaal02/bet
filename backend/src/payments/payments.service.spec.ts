import { PaymentsService } from './payments.service';

/**
 * Razorpay was removed platform-wide; PaymentsService is now just a
 * Bet-wallet balance read. The old coin-pack / wallet-topup order +
 * signature-verify tests went with the deleted methods.
 */
describe('PaymentsService.walletBalance', () => {
  function make(
    betWallet: Partial<{
      isConfigured(): boolean;
      balance(id: string): Promise<number>;
    }>,
  ) {
    return new PaymentsService(
      {} as never, // prisma — unused by walletBalance
      betWallet as never,
    );
  }

  it('returns 0 when the Bet wallet bridge is not configured', async () => {
    const svc = make({ isConfigured: () => false, balance: async () => 999 });
    await expect(svc.walletBalance('u-1')).resolves.toBe(0);
  });

  it('reads the live balance from Bet when configured', async () => {
    const svc = make({ isConfigured: () => true, balance: async () => 4242 });
    await expect(svc.walletBalance('u-1')).resolves.toBe(4242);
  });
});
