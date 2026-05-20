import { Module, Provider } from '@nestjs/common';
import { DiskStorage, S3Storage, type Storage } from './storage';
import {
  PassthroughImageProcessor,
  SharpImageProcessor,
  type ImageProcessor,
} from './image-processor';

/**
 * @Global storage module. Adapter selection is driven by env so the
 * same image runs in dev (disk + passthrough) and prod (s3 + sharp)
 * without code changes:
 *
 *   STORAGE_DRIVER:    'disk' | 's3'           (default: 'disk')
 *   IMAGE_PROCESSOR:   'passthrough' | 'sharp' (default: 'passthrough')
 *
 * The infra PRs (PR-INFRA-S3-1 and the eventual sharp install)
 * flip the env vars + ship the missing implementations.
 */

export const STORAGE = Symbol('STORAGE');
export const IMAGE_PROCESSOR = Symbol('IMAGE_PROCESSOR');

const storageProvider: Provider = {
  provide: STORAGE,
  useFactory: (): Storage => {
    const driver = process.env.STORAGE_DRIVER ?? 'disk';
    return driver === 's3' ? new S3Storage() : new DiskStorage();
  },
};

const imageProcessorProvider: Provider = {
  provide: IMAGE_PROCESSOR,
  useFactory: (): ImageProcessor => {
    const driver = process.env.IMAGE_PROCESSOR ?? 'passthrough';
    return driver === 'sharp' ? new SharpImageProcessor() : new PassthroughImageProcessor();
  },
};

@Module({
  providers: [storageProvider, imageProcessorProvider],
  exports: [STORAGE, IMAGE_PROCESSOR],
})
export class StorageModule {}
