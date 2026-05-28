import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './foundation/filters/all-exceptions.filter';

/**
 * Two-mode bootstrap (PR-WORKER-EXTRACT, Roadmap §Q2 hardening).
 *
 *   KALKI_ROLE=api     (default) — HTTP server + WebSocket + Cron.
 *                                  All @Cron decorators still fire,
 *                                  same as the legacy single-pod
 *                                  topology. Backwards-compatible.
 *   KALKI_ROLE=worker             — No HTTP listener. The Nest app
 *                                  is still created (modules + DI +
 *                                  schedule registry boot) so @Cron
 *                                  jobs run. SIGTERM handled cleanly.
 *
 * The intent is to deploy a dedicated worker pod with `replicas: 1`
 * (Helm `worker-deployment.yaml`) so the chatty CPU-heavy jobs
 * (notification drains, outbox dispatch, recon, fraud sweep) don't
 * compete with HTTP request latency.
 *
 * Concurrency safety: every worker job already uses Postgres SKIP
 * LOCKED row-level locking (outbox + notification queue) — running
 * two replicas would be safe at the data layer. We still default to
 * `replicas: 1` until we add leader election (a Postgres advisory
 * lock or Redis SETNX), tracked as PR-LEADER-ELECT.
 *
 * api-mode is the default so existing Helm values + dev `npm start`
 * keep working without any config change.
 */

const logger = new Logger('Bootstrap');
const ROLE = (process.env.KALKI_ROLE ?? 'api').toLowerCase();

// ── Resilience: keep the process alive on a fire-and-forget rejection ──
//
// The Aviator round-lifecycle drives BETTING → RUNNING → CRASHED via
// `setTimeout/setInterval(() => void this.<phase>())`. Those discard the
// promise, so a transient DB blip (Prisma P1001 "can't reach database")
// inside a tick surfaces as an UNHANDLED rejection. Node's default
// (`--unhandled-rejections=throw`) then exits the process — taking down
// auth, markets, wallet, pricing and every other API for ALL users
// because they share this one process. A single round's DB hiccup must
// not do that. Log it loudly and keep serving; the lifecycle self-heals
// on its next tick (and orphaned rounds are reconciled on restart).
//
// Scoped to logging only — we do NOT swallow `uncaughtException` (a
// synchronous throw can leave state corrupt), just async rejections
// from these background timers.
process.on('unhandledRejection', (reason: unknown) => {
  const e = reason as { code?: string; message?: string } | undefined;
  logger.error(
    `unhandledRejection (process kept alive): ${e?.code ?? ''} ${e?.message ?? String(reason)}`,
  );
});

async function bootstrapApi(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  // Standardized error envelope (PR-ARCH-AUDIT, Stage A). Success
  // responses remain raw to avoid breaking existing clients; only
  // non-2xx is normalized.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new WsAdapter(app));

  // CORS — admin SPA uses httpOnly cookies (PR-ADMIN-COOKIE-AUTH),
  // so we must (a) allow credentials and (b) pin the allowed origins
  // rather than reflecting `*` (browsers reject `*` + credentials).
  //
  // Reads `CORS_ALLOWED_ORIGINS` (comma-separated). Empty / unset
  // falls back to wildcard + no credentials, which keeps existing
  // mobile + bearer-only clients working unchanged.
  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      // Omit `allowedHeaders` so the cors middleware echoes
      // `Access-Control-Request-Headers` back verbatim. The literal
      // `'*'` does NOT act as a wildcard when `credentials: true` —
      // per the CORS spec it's treated as the literal header name,
      // which causes browsers to reject preflights for `authorization`
      // / `content-type`.
      exposedHeaders: ['Set-Cookie'],
    });
  } else {
    app.enableCors();
  }

  // Serve uploaded auction images at /uploads/<filename>.
  const uploadsDir = join(process.cwd(), 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  logger.log(`UniqueBid backend (api) listening on :${port}`);
}

async function bootstrapWorker(): Promise<void> {
  // createApplicationContext skips the HTTP listener but still
  // initialises every module → @Cron decorators self-register on
  // the ScheduleModule registry → jobs fire on schedule. WebSocket
  // gateways are also instantiated (they listen on the same HTTP
  // server in api-mode; in worker-mode the gateway is inert because
  // there's no HTTP server underneath).
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });
  logger.log('UniqueBid backend (worker) booted — Cron jobs active, no HTTP listener');

  // Graceful shutdown so Kubernetes pre-stop hooks can drain a
  // running batch before the pod terminates.
  const shutdown = async (signal: string) => {
    logger.log(`worker: received ${signal}, shutting down`);
    try {
      await app.close();
    } catch (err) {
      logger.error(`worker shutdown error: ${(err as Error).message}`);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Keep the event loop alive. Node would otherwise exit when the
  // current task drains since nothing else holds a reference. A
  // 1-minute heartbeat (debug-level, off in prod by default) is
  // enough to hold the loop without flooding logs.
  const heartbeat = setInterval(() => {
    logger.debug('worker heartbeat');
  }, 60_000);
  // We do NOT unref `heartbeat` — leaving it referenced is what
  // keeps the process alive. SIGTERM clears it via app.close +
  // process.exit so shutdown still works cleanly.
  void heartbeat;
}

async function bootstrap(): Promise<void> {
  switch (ROLE) {
    case 'worker':
      await bootstrapWorker();
      return;
    case 'api':
      await bootstrapApi();
      return;
    default:
      throw new Error(
        `Unknown KALKI_ROLE=${ROLE}. Valid: 'api' (default) | 'worker'.`,
      );
  }
}

bootstrap().catch((err) => {
  logger.error(`bootstrap failed: ${(err as Error).message}`);
  process.exit(1);
});
