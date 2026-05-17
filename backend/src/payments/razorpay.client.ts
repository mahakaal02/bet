import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import Razorpay = require('razorpay');

/**
 * Thin wrapper over the Razorpay Node SDK. If no key/secret is configured,
 * order creation throws 503 — useful for local dev where you might want the
 * rest of the backend running without payment creds.
 */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger(RazorpayClient.name);
  private client: Razorpay | null = null;
  private keyId: string | null = null;
  private keySecret: string | null = null;

  constructor(config: ConfigService) {
    const keyId = config.get<string>('RAZORPAY_KEY_ID');
    const keySecret = config.get<string>('RAZORPAY_KEY_SECRET');
    if (!keyId || !keySecret) {
      this.logger.warn('Razorpay key/secret not configured — payment endpoints will 503');
      return;
    }
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  /** Throws if Razorpay isn't configured. */
  private require(): { client: Razorpay; keyId: string; keySecret: string } {
    if (!this.client || !this.keyId || !this.keySecret) {
      throw new ServiceUnavailableException('payments not configured');
    }
    return { client: this.client, keyId: this.keyId, keySecret: this.keySecret };
  }

  publicKeyId(): string {
    return this.require().keyId;
  }

  async createOrder(amountInPaise: number, currency: string, receipt: string) {
    const { client } = this.require();
    return client.orders.create({ amount: amountInPaise, currency, receipt, payment_capture: true });
  }

  /**
   * Verify the Razorpay client-side signature.
   * sig = hmac_sha256(keySecret, orderId + "|" + paymentId)
   */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    const { keySecret } = this.require();
    const expected = crypto
      .createHmac('sha256', keySecret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    // Constant-time compare.
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }
}
