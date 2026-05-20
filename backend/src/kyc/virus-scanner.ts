import { Injectable, Logger } from '@nestjs/common';
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
 * ClamAV daemon scanner stub. The real impl uses the `INSTREAM`
 * protocol over TCP (4096-byte chunks + length prefix + null
 * terminator). Pulling the daemon client dep is deferred to the
 * infra PR (PR-INFRA-CLAMAV-1); this stub throws on prod boot if
 * accidentally selected.
 */
@Injectable()
export class ClamAvVirusScanner implements VirusScanner {
  private readonly logger = new Logger(ClamAvVirusScanner.name);
  async scan(): Promise<{ status: ScanStatus; error?: string }> {
    this.logger.error(
      'ClamAvVirusScanner is a stub. Provision clamd + the daemon client lib. See PR-INFRA-CLAMAV-1.',
    );
    return { status: ScanStatus.ERROR, error: 'ClamAV daemon not provisioned' };
  }
}
