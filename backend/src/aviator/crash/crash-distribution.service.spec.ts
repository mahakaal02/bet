import { SettingsService } from '../../foundation/settings.service';
import { CrashDistributionService } from './crash-distribution.service';

/**
 * Minimal stub of `SettingsService` that lets a test set keys in
 * memory and exercises the same typed-getter surface the service
 * consumes. Keeps the spec independent of Prisma + the real foundation
 * module.
 */
class FakeSettings {
  private values = new Map<string, unknown>();

  set(key: string, value: unknown) {
    this.values.set(key, value);
  }

  async getInt(key: string, fallback: number) {
    return (this.values.get(key) as number) ?? fallback;
  }
  async getFloat(key: string, fallback: number) {
    return (this.values.get(key) as number) ?? fallback;
  }
  async getBool(key: string, fallback: boolean) {
    return (this.values.get(key) as boolean) ?? fallback;
  }
  async getString(key: string, fallback: string) {
    return (this.values.get(key) as string) ?? fallback;
  }
}

function newService(values: Record<string, unknown> = {}) {
  const settings = new FakeSettings();
  for (const [k, v] of Object.entries(values)) settings.set(k, v);
  return {
    settings,
    svc: new CrashDistributionService(settings as unknown as SettingsService),
  };
}

describe('CrashDistributionService', () => {
  it('starts disabled by default — returns null', async () => {
    const { svc } = newService();
    await svc.onModuleInit();
    expect(svc.isEnabled()).toBe(false);
    const r = svc.generate({
      serverSeed: 'a'.repeat(64),
      clientSeed: 'b'.repeat(32),
      nonce: 1,
    });
    expect(r).toBeNull();
  });

  it('produces a result when engine=heavytail', async () => {
    const { svc } = newService({ 'aviator.crash.engine': 'heavytail' });
    await svc.onModuleInit();
    expect(svc.isEnabled()).toBe(true);
    const r = svc.generate({
      serverSeed: 'a'.repeat(64),
      clientSeed: 'b'.repeat(32),
      nonce: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.multiplier).toBeGreaterThanOrEqual(1.0);
    expect(r!.mode).toBe('BALANCED');
    expect(r!.params.k).toBeGreaterThan(0);
    expect(r!.params.rtp).toBeCloseTo(0.96, 4);
    expect(r!.paramsHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('respects the configured base mode', async () => {
    const { svc } = newService({
      'aviator.crash.engine': 'heavytail',
      'aviator.crash.mode': 'fast_loss',
      'aviator.crash.adaptive_enabled': false,
    });
    await svc.onModuleInit();
    const r = svc.generate({
      serverSeed: 'a'.repeat(64),
      clientSeed: 'b'.repeat(32),
      nonce: 1,
    });
    expect(r!.mode).toBe('FAST_LOSS');
  });

  it('preserves RTP-at-C_ref after mode blending: realised wins × C ≈ target', async () => {
    // RTP semantics: C × P(M >= C) where C is the canonical cashout.
    const { svc } = newService({
      'aviator.crash.engine': 'heavytail',
      'aviator.crash.rtp': 0.96,
      'aviator.crash.adaptive_enabled': false,
    });
    await svc.onModuleInit();
    let wins = 0;
    const N = 5_000;
    const C = 2.0; // engine's default cRef
    for (let n = 1; n <= N; n++) {
      const r = svc.generate({
        serverSeed: 'cafebabe'.repeat(8),
        clientSeed: 'deadbeef'.repeat(4),
        nonce: n,
      });
      if (r!.multiplier >= C) wins += 1;
    }
    const observedRtp = (wins / N) * C;
    // ±2pp Monte-Carlo tolerance over 5k samples.
    expect(Math.abs(observedRtp - 0.96)).toBeLessThan(0.02);
  });

  it('observeRoundOutcome moves the exposure factor toward FAST_LOSS on big stakes', async () => {
    const { svc } = newService({
      'aviator.crash.engine': 'heavytail',
      'aviator.crash.adaptive_enabled': true,
      'aviator.crash.reference_stake': 1_000,
      'aviator.crash.blend_strength': 1,
      'aviator.crash.alpha': 0.5,
    });
    await svc.onModuleInit();

    // Warm-up with large rounds.
    for (let i = 0; i < 30; i++) {
      svc.observeRoundOutcome({ stake: 50_000, payout: 48_000, bettors: 20 });
    }
    const snap = svc.snapshot();
    expect(snap.exposureFactor).toBeGreaterThan(0);
    expect(snap.activeMode).toBe('FAST_LOSS');
  });

  it('observeRoundOutcome moves the exposure factor toward STREAMER on small stakes', async () => {
    const { svc } = newService({
      'aviator.crash.engine': 'heavytail',
      'aviator.crash.adaptive_enabled': true,
      'aviator.crash.reference_stake': 5_000,
      'aviator.crash.blend_strength': 1,
      'aviator.crash.alpha': 0.5,
    });
    await svc.onModuleInit();

    for (let i = 0; i < 30; i++) {
      svc.observeRoundOutcome({ stake: 100, payout: 95, bettors: 1 });
    }
    const snap = svc.snapshot();
    expect(snap.exposureFactor).toBeLessThan(0);
    expect(snap.activeMode).toBe('STREAMER');
  });

  it('snapshot reports the post-blend RTP-at-C_ref within 1e-5 of the target', async () => {
    const { svc } = newService({
      'aviator.crash.engine': 'heavytail',
      'aviator.crash.rtp': 0.97,
    });
    await svc.onModuleInit();
    const snap = svc.snapshot();
    expect(Math.abs(snap.analyticRtpAtRef - 0.97)).toBeLessThan(1e-5);
  });

  it('refreshConfig picks up runtime knob changes', async () => {
    const { settings, svc } = newService({ 'aviator.crash.engine': 'legacy' });
    await svc.onModuleInit();
    expect(svc.isEnabled()).toBe(false);

    settings.set('aviator.crash.engine', 'heavytail');
    await svc.refreshConfig();
    expect(svc.isEnabled()).toBe(true);
  });
});
