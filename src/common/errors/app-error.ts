import { ErrorCode } from '../http/error-catalog';

export interface AppErrorOptions {
  /**
   * Safe, client-facing text. Omit it to use the generic catalog copy for the
   * code - which is almost always the right choice: anything dynamic risks
   * carrying an id or a balance to a caller that should not see it.
   */
  detail?: string;
  /** Free text for the server log only. Never serialised into a response. */
  logMessage?: string;
  /** Original exception, kept for logging - also never serialised. */
  cause?: unknown;
}

/**
 * Error with a catalogued, stable `code` (docs 11.15).
 *
 * Controllers and guards throw these; the global ProblemDetail filter turns
 * them into RFC 7807 responses. Whatever is in `message` stays server-side.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly safeDetail: string | null;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.logMessage ?? options.detail ?? code);
    this.name = `AppError(${code})`;
    this.code = code;
    this.safeDetail = options.detail ?? null;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }

  static unauthenticated(logMessage: string): AppError {
    return new AppError('UNAUTHENTICATED', { logMessage });
  }

  static forbidden(logMessage: string, detail?: string): AppError {
    return new AppError('FORBIDDEN', { logMessage, detail });
  }

  static notFound(logMessage: string, detail?: string): AppError {
    return new AppError('NOT_FOUND', { logMessage, detail });
  }

  static validation(logMessage: string, detail?: string): AppError {
    return new AppError('VALIDATION_ERROR', { logMessage, detail });
  }

  static idempotencyKeyRequired(): AppError {
    return new AppError('IDEMPOTENCY_KEY_REQUIRED', {
      logMessage: 'idempotent endpoint called without an Idempotency-Key header',
    });
  }

  static idempotencyConflict(logMessage: string): AppError {
    return new AppError('IDEMPOTENCY_CONFLICT', { logMessage });
  }

  static idempotencyInProgress(logMessage: string): AppError {
    return new AppError('IDEMPOTENCY_IN_PROGRESS', { logMessage });
  }

  static internal(logMessage: string, cause?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', { logMessage, cause });
  }
}
