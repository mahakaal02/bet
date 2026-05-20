import { EmailSuppressionReason } from '@prisma/client';
import { EmailWebhookService, SnsEnvelope } from './email-webhook.service';

/**
 * Tests cover the four envelope flavours SNS sends:
 *
 *   1. SubscriptionConfirmation — must fire a GET to SubscribeURL.
 *   2. Notification + Bounce(Permanent) — inserts HARD_BOUNCE rows.
 *   3. Notification + Bounce(Transient) — no row, ignored.
 *   4. Notification + Complaint — inserts COMPLAINT rows.
 *
 * Plus three behavioural invariants:
 *
 *   - Multiple bouncedRecipients in one envelope → multiple
 *     suppression rows.
 *   - Repeated bounces upsert without overwriting the first
 *     reason / createdAt.
 *   - Emails are lower-cased before insert (so the lookup in the
 *     email adapter matches a mixed-case recipient).
 */

function makePrismaMock() {
  const rows = new Map<string, { email: string; reason: string; subtype: string | null; metadata: unknown; createdAt: Date }>();
  return {
    emailSuppression: {
      findUnique: jest.fn(async ({ where }: any) => rows.get(where.email) ?? null),
      upsert: jest.fn(async ({ where, create, update }: any) => {
        const existing = rows.get(where.email);
        if (existing) {
          rows.set(where.email, { ...existing, ...update });
          return rows.get(where.email)!;
        }
        const row = {
          ...create,
          createdAt: new Date(),
        };
        rows.set(where.email, row);
        return row;
      }),
    },
    _rows: () => Array.from(rows.values()),
  };
}

function makeService() {
  const prisma = makePrismaMock();
  const fetchMock = jest.fn(async (_url: string, _init?: unknown) => ({
    ok: true,
    status: 200,
    text: async () => 'ok',
  })) as unknown as typeof globalThis.fetch;
  const svc = new EmailWebhookService(prisma as any, fetchMock);
  return { svc, prisma, fetchMock };
}

describe('EmailWebhookService.handle', () => {
  it('confirms SubscriptionConfirmation by fetching the SubscribeURL', async () => {
    const { svc, fetchMock } = makeService();
    const env: SnsEnvelope = {
      Type: 'SubscriptionConfirmation',
      MessageId: 'm-1',
      TopicArn: 'arn:aws:sns:test',
      Message: '',
      Timestamp: new Date().toISOString(),
      SubscribeURL: 'https://sns.test/confirm?token=abc',
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('confirmed_subscription');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sns.test/confirm?token=abc',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('records permanent bounces as HARD_BOUNCE', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-2',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bounceSubType: 'General',
          bouncedRecipients: [{ emailAddress: 'gone@example.com', diagnosticCode: '550 nope' }],
        },
        mail: { messageId: 'ses-msg-1' },
      }),
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('recorded_bounce');
    expect(res.suppressedEmails).toEqual(['gone@example.com']);
    expect(prisma._rows()).toHaveLength(1);
    expect(prisma._rows()[0].reason).toBe(EmailSuppressionReason.HARD_BOUNCE);
    expect(prisma._rows()[0].subtype).toBe('General');
  });

  it('ignores Transient bounces (SES handles retry)', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-3',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Transient',
          bounceSubType: 'MailboxFull',
          bouncedRecipients: [{ emailAddress: 'full@example.com' }],
        },
        mail: { messageId: 'ses-msg-2' },
      }),
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('ignored');
    expect(res.detail).toBe('transient_bounce');
    expect(prisma._rows()).toHaveLength(0);
  });

  it('records complaints as COMPLAINT', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-4',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Complaint',
        complaint: {
          complainedRecipients: [{ emailAddress: 'angry@example.com' }],
          complaintFeedbackType: 'abuse',
        },
        mail: { messageId: 'ses-msg-3' },
      }),
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('recorded_complaint');
    expect(prisma._rows()[0].reason).toBe(EmailSuppressionReason.COMPLAINT);
  });

  it('handles multiple bouncedRecipients in one envelope', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-5',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [
            { emailAddress: 'a@x.com' },
            { emailAddress: 'b@x.com' },
            { emailAddress: 'c@x.com' },
          ],
        },
        mail: { messageId: 'ses-msg-4' },
      }),
    };
    const res = await svc.handle(env);
    expect(res.suppressedEmails).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
    expect(prisma._rows()).toHaveLength(3);
  });

  it('lower-cases recipient emails (case-insensitive suppression)', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-6',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'Mixed@Example.COM' }],
        },
        mail: { messageId: 'ses-msg-5' },
      }),
    };
    await svc.handle(env);
    expect(prisma._rows()[0].email).toBe('mixed@example.com');
  });

  it('upsert keeps the original suppression when the same address re-bounces', async () => {
    const { svc, prisma } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-7',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'repeat@example.com', diagnosticCode: 'first' }],
        },
        mail: { messageId: 'ses-msg-1' },
      }),
    };
    await svc.handle(env);
    // Same address, second bounce — should NOT create a duplicate row.
    await svc.handle({
      ...env,
      MessageId: 'm-8',
      Message: JSON.stringify({
        notificationType: 'Bounce',
        bounce: {
          bounceType: 'Permanent',
          bouncedRecipients: [{ emailAddress: 'repeat@example.com', diagnosticCode: 'second' }],
        },
        mail: { messageId: 'ses-msg-2' },
      }),
    });
    expect(prisma._rows()).toHaveLength(1);
    // Metadata refreshed but reason untouched.
    expect(prisma._rows()[0].reason).toBe(EmailSuppressionReason.HARD_BOUNCE);
  });

  it('ignores envelopes with unknown notification types', async () => {
    const { svc } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-9',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: JSON.stringify({ notificationType: 'Delivery' }),
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('ignored');
  });

  it('ignores malformed Message JSON (does not throw)', async () => {
    const { svc } = makeService();
    const env: SnsEnvelope = {
      Type: 'Notification',
      MessageId: 'm-10',
      TopicArn: 'arn:aws:sns:test',
      Timestamp: new Date().toISOString(),
      Message: 'not valid json {{',
    };
    const res = await svc.handle(env);
    expect(res.action).toBe('ignored');
    expect(res.detail).toBe('message_parse_failed');
  });
});
