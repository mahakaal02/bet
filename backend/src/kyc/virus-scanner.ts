import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';
import { ScanStatus } from '@prisma/client';

/**
 * Virus scanner abstraction. Two production-grade backends:
 *
 *   - **ClamAV** — self-hosted daemon (clamd) reached over TCP. The
 *     usual hosted choice for KYC documents because it doesn't expose
 *     user PII to a third-party scanning service.
 *   - **AWS Macie / GuardDuty** — managed; trade-off discussed in
 *     `docs/CONTEXT.md` open architecture question #2.
 *
 * Why an interface, not a direct daemon call: ClamAV daemon presence
 * is an infra concern — the scanner adapter lets us run the full KYC
 * flow in unit tests + dev without needing clamd running, and lets us
 * swap providers later without touching the service.
 *
 * The stub (default in dev) returns CLEAN immediately. Production
 * MUST set `KYC_VIRUS_SCANNER=clamav` and supply
 * `CLAMD_HOST` / `CLAMD_PORT` (env vars consumed by the daemon impl).
 */
export interface VirusScanner {
  /**
   * Run the scan synchronously against the provided plaintext bytes
   * (the scanner must see the un-encrypted payload — encrypting first
   * defeats signature detection). Implementations are responsible for
   * timing out themselves; the service caller never blocks > 30s.
   */
  scan(plaintext: Buffer): Promise<{
    status: ScanStatus;
    signature?: string; // when INFECTED — e.g. "Eicar-Test-Signature"
    error?: string;     // when ERROR
  }>;
}

/**
 * Always-CLEAN stub for dev + tests. Trips on the EICAR test string
 * so the integration test can verify INFECTED handling end-to-end
 * without dragging in a real scanner.
 *
 * EICAR (https://en.wikipedia.org/wiki/EICAR_test_file) is the
 * standard "is your AV alive" test pattern — every real scanner
 * trips on it, so matching it here keeps the contract honest.
 */
@Injectable()
export class StubVirusScanner implements VirusScanner {
  private static readonly EICAR_SIGNATURE =
    'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  async scan(plaintext: Buffer): Promise<{ status: ScanStatus; signature?: string }> {
    const ascii = plaintext.toString('latin1');
    if (ascii.includes(StubVirusScanner.EICAR_SIGNATURE)) {
      return { status: ScanStatus.INFECTED, signature: 'Eicar-Test-Signature' };
    }
    return { status: ScanStatus.CLEAN };
  }
}

/**
 * ClamAV daemon scanner (PR-INFRA-CLAMAV-1).
 *
 * Speaks ClamAV's `INSTREAM` TCP protocol natively — no client
 * library, no dep. The protocol is small + well-documented enough
 * that a third-party wrapper would be more code to read than the
 * inline implementation.
 *
 * Wire format (clamd docs §INSTREAM):
 *
 *   client → server:  "zINSTREAM\0"
 *   client → server:  <4-byte big-endian length><payload chunk>  (repeat for chunks)
 *   client → server:  <4-byte big-endian 0>      (end marker)
 *   server → client:  "stream: OK\0"            // CLEAN
 *                     or
 *                     "stream: <SIG> FOUND\0"   // INFECTED
 *                     or
 *                     "stream: <ERR> ERROR\0"
 *
 *   The 'z' prefix on the command + the null terminator on responses
 *   selects the "zero-terminated" command variant — it's the safer
 *   mode (no newline ambiguity vs file payloads).
 *
 * Env vars (set via Helm `kalki-shared`):
 *   CLAMD_HOST  — default: clamd
 *   CLAMD_PORT  — default: 3310
 *   CLAMD_TIMEOUT_MS — default: 30_000 (clamd's own timeout is ~120s)
 *
 * Activation: `KYC_VIRUS_SCANNER=clamav`. Already wired in kyc.module.ts
 * from PR-KYC-1.
 *
 * Failure modes:
 *   - connection refused → ScanStatus.ERROR with error="clamd_connect_failed"
 *   - timeout            → ScanStatus.ERROR with error="clamd_timeout"
 *   - daemon ERROR reply → ScanStatus.ERROR with error=<daemon message>
 *
 * The KycService caller treats ERROR as "let the doc through but log
 * a warning + flag for re-scan in the admin queue" — see
 * kyc.service.ts §submitDocument. That keeps a scanner outage from
 * blocking legitimate user uploads while still surfacing the issue.
 */
@Injectable()
export class ClamAvVirusScanner implements VirusScanner {
  private readonly logger = new Logger(ClamAvVirusScanner.name);
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  // Override hook for tests — lets the spec inject a fake net.Socket.
  private readonly connectFn: (port: number, host: string) => net.Socket;

  // 4096 chunk size — clamd's default StreamMaxLength is 25 MB but
  // chunks must each be ≤ 2^32 bytes (4-byte length prefix). 4 KB is
  // a comfortable middle ground that doesn't trigger TCP fragmentation
  // and lets the scanner pipeline alongside the upload.
  static readonly CHUNK_BYTES = 4096;

  constructor(connectFn?: (port: number, host: string) => net.Socket) {
    this.host = process.env.CLAMD_HOST ?? 'clamd';
    this.port = Number(process.env.CLAMD_PORT ?? 3310);
    this.timeoutMs = Number(process.env.CLAMD_TIMEOUT_MS ?? 30_000);
    this.connectFn = connectFn ?? ((port, host) => net.connect(port, host));
  }

  async scan(plaintext: Buffer): Promise<{
    status: ScanStatus;
    signature?: string;
    error?: string;
  }> {
    if (plaintext.length === 0) {
      // clamd refuses empty stream; treat as CLEAN — empty bytes
      // can't carry a virus signature.
      return { status: ScanStatus.CLEAN };
    }
    try {
      const reply = await this.sendInstream(plaintext);
      return this.parseReply(reply);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`clamd scan failed: ${msg}`);
      return { status: ScanStatus.ERROR, error: msg };
    }
  }

  /**
   * Send the INSTREAM session and collect the reply. Exposed for
   * unit tests via `connectFn`.
   */
  private sendInstream(plaintext: Buffer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const socket = this.connectFn(this.port, this.host);
      const chunks: Buffer[] = [];
      let finished = false;
      const finishOnce = (err: Error | null, reply?: string) => {
        if (finished) return;
        finished = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        if (err) reject(err);
        else resolve(reply ?? '');
      };

      const timer = setTimeout(
        () => finishOnce(new Error('clamd_timeout')),
        this.timeoutMs,
      );
      timer.unref();

      socket.on('error', (err) => finishOnce(new Error(`clamd_connect_failed: ${err.message}`)));
      socket.on('data', (data) => chunks.push(data));
      socket.on('end', () => {
        clearTimeout(timer);
        finishOnce(null, Buffer.concat(chunks).toString('utf8'));
      });
      socket.on('close', () => {
        clearTimeout(timer);
        if (!finished) {
          // close without `end` usually means clamd hung up early —
          // we may already have a reply buffered.
          finishOnce(null, Buffer.concat(chunks).toString('utf8'));
        }
      });

      socket.on('connect', () => {
        // Command: zINSTREAM\0
        socket.write(Buffer.from('zINSTREAM\0', 'utf8'));

        // Chunked payload.
        for (let i = 0; i < plaintext.length; i += ClamAvVirusScanner.CHUNK_BYTES) {
          const chunk = plaintext.subarray(i, i + ClamAvVirusScanner.CHUNK_BYTES);
          const lenBuf = Buffer.alloc(4);
          lenBuf.writeUInt32BE(chunk.length, 0);
          socket.write(lenBuf);
          socket.write(chunk);
        }

        // Zero-length end marker.
        const zero = Buffer.alloc(4);
        zero.writeUInt32BE(0, 0);
        socket.write(zero);
      });
    });
  }

  /**
   * Parse a clamd INSTREAM reply. The format is one of:
   *   "stream: OK\0"
   *   "stream: <SIGNATURE> FOUND\0"
   *   "stream: <ERR> ERROR\0"
   *
   * The trailing `\0` is consumed by clamd's `z` mode; some clamd
   * versions also include a `\n`. We trim both. Exposed for unit tests.
   */
  parseReply(raw: string): { status: ScanStatus; signature?: string; error?: string } {
    const reply = raw.replace(/\0\s*$/u, '').replace(/\n+$/u, '').trim();
    if (reply === '' || !reply.startsWith('stream:')) {
      return { status: ScanStatus.ERROR, error: `unexpected_reply: ${reply.slice(0, 100)}` };
    }
    const body = reply.slice('stream:'.length).trim();
    if (body === 'OK') {
      return { status: ScanStatus.CLEAN };
    }
    if (body.endsWith(' FOUND')) {
      const signature = body.slice(0, -' FOUND'.length).trim();
      return { status: ScanStatus.INFECTED, signature };
    }
    if (body.endsWith(' ERROR')) {
      const error = body.slice(0, -' ERROR'.length).trim();
      return { status: ScanStatus.ERROR, error };
    }
    return { status: ScanStatus.ERROR, error: `unparseable_reply: ${body.slice(0, 100)}` };
  }
}
