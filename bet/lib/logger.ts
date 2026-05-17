/**
 * Vendor-agnostic structured logger. Two sinks:
 *
 *   - console (always): pretty-printed in dev, JSON in production.
 *   - Sentry (optional): activates if `SENTRY_DSN` is set. Loaded lazily so
 *     the dependency only resolves when actually needed — keeps the demo
 *     dev install Sentry-free.
 *
 * Drop-in replacement for `console.error(err, ctx)`:
 *
 *   logger.error(err, { route: "/api/trade", userId, marketId });
 *
 * Calling code stays free of vendor-specific imports; swapping Sentry for
 * Datadog / Pino / etc. only touches this file.
 */

type Level = "info" | "warn" | "error";

interface Ctx {
  [k: string]: unknown;
}

interface SentryLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureException(err: unknown, opts?: { tags?: Record<string, any>; extra?: Record<string, any> }): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureMessage(msg: string, opts?: { level?: string; tags?: Record<string, any>; extra?: Record<string, any> }): void;
}

const globalForLogger = globalThis as unknown as {
  __betSentry?: SentryLike | null;
  __betSentryAttempted?: boolean;
};

async function maybeConnectSentry() {
  if (globalForLogger.__betSentryAttempted) return;
  globalForLogger.__betSentryAttempted = true;
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  try {
    // String-typed import so TypeScript doesn't require @sentry/node types
    // until the package is actually installed.
    const moduleName = "@sentry/node";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(moduleName).catch(() => null);
    if (!mod) {
      console.warn(
        "[logger] SENTRY_DSN is set but @sentry/node is not installed — `npm i @sentry/node` to enable.",
      );
      return;
    }
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      // Conservative defaults — sample 10% of traces, all errors.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    });
    globalForLogger.__betSentry = mod;
    console.log("[logger] Sentry initialised");
  } catch (err) {
    console.error("[logger] Sentry init failed, staying on console", err);
  }
}
void maybeConnectSentry();

function emit(level: Level, msgOrErr: unknown, ctx?: Ctx) {
  const err = msgOrErr instanceof Error ? msgOrErr : undefined;
  const message =
    msgOrErr instanceof Error ? msgOrErr.message : String(msgOrErr ?? "");

  // Console sink. Dev uses Node's defaults (with colors via the inspector
  // in `console.error`); prod emits a single JSON line so log aggregators
  // can parse without a custom format.
  if (process.env.NODE_ENV === "production") {
    const line = {
      level,
      message,
      ...(err && { stack: err.stack, name: err.name }),
      ...(ctx ?? {}),
      ts: new Date().toISOString(),
    };
    const text = JSON.stringify(line);
    if (level === "error") console.error(text);
    else if (level === "warn") console.warn(text);
    else console.log(text);
  } else {
    const head = `[${level}] ${message}`;
    const args = ctx ? [head, ctx] : [head];
    if (level === "error") {
      if (err) console.error(head, ctx ?? {}, err);
      else console.error(...args);
    } else if (level === "warn") {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }

  // Sentry sink. Errors capture the exception with full stack; non-errors
  // become captureMessage so they're searchable by their level.
  const sentry = globalForLogger.__betSentry;
  if (sentry) {
    try {
      if (err) {
        sentry.captureException(err, { extra: ctx });
      } else if (level !== "info") {
        sentry.captureMessage(message, { level, extra: ctx });
      }
    } catch {
      // Sentry transport failed — swallow so a logging error never breaks
      // the calling request.
    }
  }
}

export const logger = {
  info: (msg: unknown, ctx?: Ctx) => emit("info", msg, ctx),
  warn: (msg: unknown, ctx?: Ctx) => emit("warn", msg, ctx),
  error: (err: unknown, ctx?: Ctx) => emit("error", err, ctx),
};

/**
 * Install global crash handlers — fires once per Node process. Imported
 * from lib/boot.ts so the first request to the app wires it up.
 */
let installed = false;
export function installGlobalHandlers() {
  if (installed) return;
  installed = true;
  process.on("unhandledRejection", (reason) => {
    logger.error(reason, { source: "unhandledRejection" });
  });
  process.on("uncaughtException", (err) => {
    logger.error(err, { source: "uncaughtException" });
    // Don't exit — Next would crash the dev server otherwise. In prod,
    // operators typically restart on uncaught.
  });
}
