import { EmailWebhookController } from './email-webhook.controller';
import { EmailWebhookService, SnsEnvelope } from './email-webhook.service';
import { SnsSignatureVerifier } from './sns-signature-verifier';

/**
 * Controller-level test for PR-NOTIFY-3.
 *
 * The verifier itself is tested exhaustively in
 * sns-signature-verifier.spec.ts. Here we lock down the env-driven
 * gating behaviour:
 *
 *   1. `NOTIFY_SNS_VERIFY` unset → the verifier is NEVER called.
 *      The topic-ARN-only path that shipped in PR-NOTIFY-2
 *      continues working untouched. Closes the "Smoke: leave
 *      NOTIFY_SNS_VERIFY unset → confirm existing topic-ARN-only
 *      path continues working unchanged" item.
 *   2. `NOTIFY_SNS_VERIFY=true` → the verifier IS called; an
 *      invalid signature short-circuits the EmailWebhookService.
 *   3. The truthy string list (`true`/`1`/`yes`, case-insensitive)
 *      all enable verification. Anything else leaves it off.
 *   4. Topic-ARN mismatch still wins (precedence): even with
 *      verification on, a wrong topic-ARN returns 200+topic_mismatch
 *      without calling the verifier.
 */

function makeController(env: Record<string, string | undefined>) {
  const svc = {
    handle: jest.fn(async () => ({ action: 'recorded_bounce' as const })),
  } as unknown as EmailWebhookService;
  const verifier = {
    verify: jest.fn(async () => ({ valid: true as const })),
  } as unknown as SnsSignatureVerifier;
  const config = {
    get: (k: string) => env[k],
  } as never;
  return {
    controller: new EmailWebhookController(svc, verifier, config),
    svc,
    verifier,
  };
}

const NOTIFICATION_ENVELOPE: SnsEnvelope = {
  Type: 'Notification',
  MessageId: 'm-1',
  TopicArn: 'arn:aws:sns:test',
  Message: JSON.stringify({
    notificationType: 'Bounce',
    bounce: { bounceType: 'Permanent', bouncedRecipients: [] },
    mail: { messageId: 'ses-msg-1' },
  }),
  Timestamp: '2026-05-20T11:00:00.000Z',
};

describe('EmailWebhookController — NOTIFY_SNS_VERIFY unset (default / pre-PR-NOTIFY-3 behaviour)', () => {
  it('does NOT call the verifier; webhook service runs as before', async () => {
    const { controller, svc, verifier } = makeController({});
    const result = await controller.receive(NOTIFICATION_ENVELOPE);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(svc.handle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, action: 'recorded_bounce' });
  });

  it('topic-ARN mismatch still rejects (precedence preserved)', async () => {
    const { controller, svc, verifier } = makeController({
      NOTIFY_WEBHOOK_TOPIC_ARN: 'arn:aws:sns:expected',
    });
    const result = await controller.receive(NOTIFICATION_ENVELOPE);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(svc.handle).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, action: 'topic_mismatch' });
  });
});

describe('EmailWebhookController — NOTIFY_SNS_VERIFY enabled', () => {
  it("calls the verifier when NOTIFY_SNS_VERIFY='true'", async () => {
    const { controller, svc, verifier } = makeController({
      NOTIFY_SNS_VERIFY: 'true',
    });
    await controller.receive(NOTIFICATION_ENVELOPE);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    expect(svc.handle).toHaveBeenCalledTimes(1);
  });

  it("accepts case-insensitive truthy values ('TRUE', '1', 'yes')", async () => {
    for (const val of ['TRUE', '1', 'yes', 'Yes', 'True']) {
      const { controller, verifier } = makeController({
        NOTIFY_SNS_VERIFY: val,
      });
      await controller.receive(NOTIFICATION_ENVELOPE);
      expect(verifier.verify).toHaveBeenCalled();
    }
  });

  it.each(['false', '0', 'no', 'maybe', ''])(
    'does NOT enable verifier for non-truthy NOTIFY_SNS_VERIFY=%s',
    async (val) => {
      const { controller, verifier } = makeController({
        NOTIFY_SNS_VERIFY: val,
      });
      await controller.receive(NOTIFICATION_ENVELOPE);
      expect(verifier.verify).not.toHaveBeenCalled();
    },
  );

  it('short-circuits to invalid_signature when verifier returns invalid', async () => {
    const { controller, svc, verifier } = makeController({
      NOTIFY_SNS_VERIFY: 'true',
    });
    (verifier.verify as jest.Mock).mockResolvedValueOnce({
      valid: false,
      reason: 'signature_mismatch',
    });
    const result = await controller.receive(NOTIFICATION_ENVELOPE);
    expect(svc.handle).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      action: 'invalid_signature:signature_mismatch',
    });
  });

  it('topic-ARN check still runs FIRST, before signature verification', async () => {
    // Ensures we don't waste a cert fetch on an envelope from a
    // topic we don't subscribe to.
    const { controller, verifier } = makeController({
      NOTIFY_SNS_VERIFY: 'true',
      NOTIFY_WEBHOOK_TOPIC_ARN: 'arn:aws:sns:expected',
    });
    const result = await controller.receive(NOTIFICATION_ENVELOPE);
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(result.action).toBe('topic_mismatch');
  });
});
