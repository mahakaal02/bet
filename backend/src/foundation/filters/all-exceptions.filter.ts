import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

/**
 * Standardized error envelope (PR-ARCH-AUDIT, Stage A).
 *
 * Why this exists: prior to this filter, unhandled and built-in
 * exceptions surfaced in three different shapes:
 *
 *   - `class-validator` errors → `{ statusCode, message: [...], error }`
 *     with `message` as an array of strings.
 *   - `HttpException` subclasses → `{ statusCode, message, error }`.
 *   - Any other throwable → Nest's default 500 with a raw stack.
 *
 * Mobile + admin SPA clients had to special-case all three. This
 * filter normalizes every non-2xx response to ONE shape so client
 * error handling collapses to a single branch.
 *
 * Success responses are intentionally NOT wrapped (per audit decision)
 * — adding `{ data: ... }` everywhere would force a coordinated bump
 * of every client, which the team explicitly opted out of.
 *
 *   {
 *     error: {
 *       code: string,           // machine-readable, e.g. "VALIDATION_ERROR"
 *       message: string,        // human-readable single string
 *       details?: unknown       // structured (validation issues, etc.)
 *     },
 *     requestId: string,        // for log correlation
 *     path: string,
 *     timestamp: string         // ISO-8601
 *   }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const requestId =
      (req.headers['x-request-id'] as string | undefined) ?? randomUUID();

    const { status, code, message, details } = this.extract(exception);

    // 5xx → log with stack; 4xx → debug-level only (these are
    // client errors, expected and noisy at info+).
    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status} ${code}: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.debug(`${req.method} ${req.url} → ${status} ${code}`);
    }

    res.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
      requestId,
      path: req.url,
      timestamp: new Date().toISOString(),
    });
  }

  private extract(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      // Nest HttpExceptions return either a string or
      // `{ statusCode, message, error, ... }`. class-validator
      // packs an array into `message`; we lift that to `details`.
      if (typeof resp === 'string') {
        return { status, code: toCode(status, exception.name), message: resp };
      }
      const r = resp as Record<string, unknown>;
      const rawMessage = r.message;
      let message: string;
      let details: unknown;
      if (Array.isArray(rawMessage)) {
        message = 'validation failed';
        details = rawMessage;
      } else if (typeof rawMessage === 'string') {
        message = rawMessage;
      } else {
        message = exception.message ?? 'request failed';
      }
      const code =
        typeof r.error === 'string'
          ? toCode(status, r.error)
          : toCode(status, exception.name);
      return { status, code, message, details };
    }

    // Unknown throw — assume programmer error.
    const message = exception instanceof Error ? exception.message : 'internal error';
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message,
    };
  }
}

/**
 * Map Nest exception names (and known status codes) to stable
 * UPPER_SNAKE codes. Clients should branch on `code`, not on
 * `message` (messages are humans-only and can change).
 */
function toCode(status: number, hint: string): string {
  if (hint === 'BadRequestException' || hint === 'Bad Request') return 'BAD_REQUEST';
  if (hint === 'UnauthorizedException' || hint === 'Unauthorized') return 'UNAUTHORIZED';
  if (hint === 'ForbiddenException' || hint === 'Forbidden') return 'FORBIDDEN';
  if (hint === 'NotFoundException' || hint === 'Not Found') return 'NOT_FOUND';
  if (hint === 'ConflictException' || hint === 'Conflict') return 'CONFLICT';
  if (hint === 'ThrottlerException' || hint === 'Too Many Requests')
    return 'RATE_LIMITED';
  if (hint === 'PayloadTooLargeException' || hint === 'Payload Too Large')
    return 'PAYLOAD_TOO_LARGE';
  if (hint === 'UnsupportedMediaTypeException') return 'UNSUPPORTED_MEDIA_TYPE';
  if (status >= 500) return 'INTERNAL_ERROR';
  return `HTTP_${status}`;
}
