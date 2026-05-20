import { Injectable, Logger } from '@nestjs/common';

/**
 * Image processing pipeline used before every avatar / KYC / auction
 * image hits storage. Two responsibilities:
 *
 *   1. **EXIF strip** — phone-camera uploads carry GPS coordinates,
 *      device serials, sometimes timestamps. Stripping EXIF is the
 *      single most important step for user privacy on a platform
 *      that surfaces other users' avatars publicly. Auction images
 *      get the same treatment so a sloppy supplier upload doesn't
 *      leak warehouse GPS.
 *   2. **Resize** — admins / users upload 12MP camera shots; we
 *      need a 256x256 avatar thumb and a 1600px-wide auction photo.
 *      Resizing at upload time saves bandwidth + CDN $ on every
 *      subsequent read.
 *
 * Two implementations:
 *
 *   - `PassthroughImageProcessor` — returns the bytes unchanged.
 *     The default in dev/CI; lets the rest of the pipeline + tests
 *     run without a native dependency.
 *   - `SharpImageProcessor` — uses `sharp` (libvips). Lazy-loaded
 *     via dynamic import so the dep is only required when the env
 *     selects it. Production should set
 *     `IMAGE_PROCESSOR=sharp` and run `npm install sharp` in the
 *     image-build step.
 *
 * Why not include `sharp` by default: it's a 30-MB native module
 * with platform-specific binaries. Excluding it from the base
 * dependency tree keeps the CI test container small + lets non-
 * image-heavy services (the worker pod, the migration init
 * container) skip the install entirely.
 */

export interface ProcessedImage {
  /** Stripped + resized bytes ready for storage. */
  bytes: Buffer;
  /** Final width/height after processing. Useful for DB columns. */
  width: number;
  height: number;
  /** Final mime type. May differ from input (e.g. HEIC → JPEG). */
  mimeType: string;
}

export interface ImageProcessor {
  /**
   * Run the pipeline on the given input. Throws on:
   *   - decode failure (corrupt file / unsupported format)
   *   - dimensions > MAX_PIXELS_TOTAL (decompression bomb defence)
   *
   * `targetWidth` is a maximum — smaller images are left alone, not
   * upscaled. Aspect ratio is preserved.
   */
  process(input: {
    bytes: Buffer;
    sourceMimeType: string;
    targetWidth: number;
    stripExif?: boolean;     // defaults to true
    quality?: number;        // JPEG/WebP quality 1-100; defaults to 82
  }): Promise<ProcessedImage>;
}

/** Decompression-bomb defence — refuse anything that decodes to > this. */
export const MAX_PIXELS_TOTAL = 50_000_000;  // ~50 MP

/**
 * No-op processor — bytes through, mime preserved. Defensive
 * dimensions reported as 0×0 since we can't measure without a
 * decoder. Callers that store width/height should fall back to the
 * sharp path or accept the zeros.
 */
@Injectable()
export class PassthroughImageProcessor implements ImageProcessor {
  private readonly logger = new Logger(PassthroughImageProcessor.name);

  async process(input: {
    bytes: Buffer;
    sourceMimeType: string;
    targetWidth: number;
  }): Promise<ProcessedImage> {
    this.logger.debug(`passthrough ${input.bytes.length}B mime=${input.sourceMimeType}`);
    return {
      bytes: input.bytes,
      width: 0,
      height: 0,
      mimeType: input.sourceMimeType,
    };
  }
}

/**
 * sharp-backed processor. The class file compiles + types check
 * without sharp present — the dep is loaded on first use via a
 * dynamic import inside `process`. If sharp isn't installed the
 * first call throws a clear message rather than blowing up at boot.
 */
@Injectable()
export class SharpImageProcessor implements ImageProcessor {
  private readonly logger = new Logger(SharpImageProcessor.name);

  // Cache the lazily-loaded sharp module after first call.
  private sharpModulePromise: Promise<unknown> | null = null;

  private loadSharp(): Promise<unknown> {
    if (this.sharpModulePromise) return this.sharpModulePromise;
    // Dynamic import keeps `sharp` out of the static module graph,
    // so `tsc` + `nest build` don't fail when the dep isn't installed.
    // The `as unknown as` cast tells TypeScript we know what we're
    // doing — the runtime type is asserted on first call below.
    this.sharpModulePromise = (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        return await (Function('return import("sharp")')() as Promise<unknown>);
      } catch (err) {
        throw new Error(
          `SharpImageProcessor: failed to load 'sharp' — run \`npm install sharp\` ` +
            `in the image-build step (Roadmap §1H). underlying: ${(err as Error).message}`,
        );
      }
    })();
    return this.sharpModulePromise;
  }

  async process(input: {
    bytes: Buffer;
    sourceMimeType: string;
    targetWidth: number;
    stripExif?: boolean;
    quality?: number;
  }): Promise<ProcessedImage> {
    const sharpModule = (await this.loadSharp()) as { default: (b: Buffer) => SharpHandle };
    const sharp = sharpModule.default;

    const pipeline = sharp(input.bytes);
    const meta = await pipeline.metadata();
    if (!meta.width || !meta.height) {
      throw new Error('image_decode_failed');
    }
    if (meta.width * meta.height > MAX_PIXELS_TOTAL) {
      throw new Error(`image_too_large: ${meta.width}x${meta.height} > ${MAX_PIXELS_TOTAL}`);
    }

    const stripExif = input.stripExif !== false;
    const quality = input.quality ?? 82;

    // Resize only if input is larger than the target width.
    let processed = pipeline;
    if (meta.width > input.targetWidth) {
      processed = processed.resize({ width: input.targetWidth, withoutEnlargement: true });
    }

    // EXIF strip: sharp by default writes metadata-stripped output
    // unless `.withMetadata()` is called. We're explicit about it.
    if (!stripExif) {
      processed = processed.withMetadata();
    }

    // Re-encode as JPEG for photo-ish formats, WebP if the source
    // already was. HEIC inputs get JPEG out (broader compatibility).
    let outBuf: Buffer;
    let outMime: string;
    if (input.sourceMimeType === 'image/png') {
      outBuf = await processed.png({ compressionLevel: 9 }).toBuffer();
      outMime = 'image/png';
    } else if (input.sourceMimeType === 'image/webp') {
      outBuf = await processed.webp({ quality }).toBuffer();
      outMime = 'image/webp';
    } else {
      outBuf = await processed.jpeg({ quality, mozjpeg: true }).toBuffer();
      outMime = 'image/jpeg';
    }

    // Re-decode to get final dimensions. Cheap — just header.
    const outMeta = await sharp(outBuf).metadata();
    return {
      bytes: outBuf,
      width: outMeta.width ?? 0,
      height: outMeta.height ?? 0,
      mimeType: outMime,
    };
  }
}

// ─── Minimal sharp type stub ─────────────────────────────────────
// We don't import @types/sharp because that would also require the
// sharp dep to be installed. The interface below covers exactly the
// surface we use; sharp's real API is a superset so the cast is safe.

interface SharpMetadata {
  width?: number;
  height?: number;
  format?: string;
}

interface SharpHandle {
  metadata(): Promise<SharpMetadata>;
  resize(opts: { width: number; withoutEnlargement: boolean }): SharpHandle;
  withMetadata(): SharpHandle;
  jpeg(opts: { quality: number; mozjpeg: boolean }): SharpHandle;
  png(opts: { compressionLevel: number }): SharpHandle;
  webp(opts: { quality: number }): SharpHandle;
  toBuffer(): Promise<Buffer>;
}
