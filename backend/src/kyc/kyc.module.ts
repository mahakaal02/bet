import { Module, Provider } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { FoundationModule } from '../foundation/foundation.module';
import { KycService } from './kyc.service';
import { KycController } from './kyc.controller';
import { KycAdminController } from './kyc-admin.controller';
import { DOCUMENT_CIPHER, KYC_STORAGE, VIRUS_SCANNER } from './kyc.tokens';
import { DiskKycStorage, S3KycStorage } from './kyc-storage';
import { ClamAvVirusScanner, StubVirusScanner } from './virus-scanner';
import { KmsDocumentCipher, LocalKeyDocumentCipher } from './document-cipher';

/**
 * KYC module wiring.
 *
 * Adapter selection is driven by env vars so the same image runs in
 * dev (disk + stub scanner + local key) and prod (S3 + ClamAV + KMS)
 * without code changes:
 *
 *   KYC_STORAGE_DRIVER:  'disk' | 's3'      (default: 'disk')
 *   KYC_VIRUS_SCANNER:   'stub' | 'clamav'  (default: 'stub')
 *   KYC_CIPHER_DRIVER:   'local' | 'kms'    (default: 'local')
 *
 * The infra PRs (PR-INFRA-S3-1, PR-INFRA-CLAMAV-1, PR-INFRA-KMS-1)
 * flip the env vars + ship the missing SDK deps. This PR ships the
 * full pipeline behind interfaces so the rest of the app can be
 * built against it.
 */

const storageProvider: Provider = {
  provide: KYC_STORAGE,
  useFactory: () => {
    const driver = process.env.KYC_STORAGE_DRIVER ?? 'disk';
    return driver === 's3' ? new S3KycStorage() : new DiskKycStorage();
  },
};

const scannerProvider: Provider = {
  provide: VIRUS_SCANNER,
  useFactory: () => {
    const driver = process.env.KYC_VIRUS_SCANNER ?? 'stub';
    return driver === 'clamav' ? new ClamAvVirusScanner() : new StubVirusScanner();
  },
};

const cipherProvider: Provider = {
  provide: DOCUMENT_CIPHER,
  useFactory: () => {
    const driver = process.env.KYC_CIPHER_DRIVER ?? 'local';
    return driver === 'kms' ? new KmsDocumentCipher() : new LocalKeyDocumentCipher();
  },
};

@Module({
  imports: [PrismaModule, FoundationModule],
  controllers: [KycController, KycAdminController],
  providers: [KycService, storageProvider, scannerProvider, cipherProvider],
  exports: [KycService],
})
export class KycModule {}
