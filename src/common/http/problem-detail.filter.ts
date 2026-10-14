import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

import { AppError } from '../errors/app-error';
import {
  ErrorCode,
  codeForHttpStatus,
  errorDescriptor,
  errorTypeUri,
  isErrorCode,
} from './error-catalog';
import { ProblemDetail, ProblemViolation } from './problem-detail';

interface MappedException {
  status: number;
  code: ErrorCode;
  title: string;
  detail: string;
  violations: ProblemViolation[];
  /** Server-side only: domain messages may name wallets and amounts. */
  logMessage: string;
  logLevel: 'warn' | 'error';
}

/**
 * The single place where an exception becomes an HTTP response.
 *
 * Two rules drive every branch:
 *   1. The client only ever sees a catalogued `code` plus generic copy -
 *      never a driver message, a wallet id or a stack trace.
 *   2. Anything 5xx is logged with its stack so it is actionable in ops.
 *
 * Domain errors (ledger.errors.ts) are recognised by duck-typing their `code`
 * property: it keeps common/http free of imports from feature modules while
 * mapping every catalogued code automatically.
 */
@Catch()
export class ProblemDetailFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemDetail');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
      throw exception;
    }

    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const mapped = this.map(exception);
    const requestId = request.requestId ?? randomUUID();
    const instance = (request.originalUrl ?? request.url ?? '').split('?')[0];

    const body: ProblemDetail = {
      type: errorTypeUri(mapped.code),
      title: mapped.title,
      status: mapped.status,
      code: mapped.code,
      detail: mapped.detail,
      instance,
      requestId,
    };
    if (mapped.violations.length > 0) {
      body.errors = mapped.violations;
    }

    const line = `${request.method ?? '?'} ${instance} -> ${mapped.status} ${mapped.code} [${requestId}]`;
    if (mapped.logLevel === 'error') {
      this.logger.error(
        `${line}: ${mapped.logMessage}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${line}: ${mapped.logMessage}`);
    }

    if (response.headersSent) {
      // Streaming/webhook handlers that already wrote a body: nothing useful
      // can be appended, but the log line above still records the failure.
      this.logger.warn(`${line}: response already sent, error not serialised`);
      return;
    }

    response.status(mapped.status).type('application/problem+json').json(body);
  }

  private map(exception: unknown): MappedException {
    if (exception instanceof AppError) {
      return this.fromCode(exception.code, exception.safeDetail ?? undefined, exception.message);
    }

    // Domain errors carry a catalogued `code` but know nothing about HTTP.
    if (
      exception instanceof Error &&
      isErrorCode((exception as { code?: unknown }).code)
    ) {
      const code = (exception as unknown as { code: ErrorCode }).code;
      return this.fromCode(code, undefined, exception.message);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaError(exception);
    }

    const logMessage = exception instanceof Error ? exception.message : String(exception);
    return this.fromCode('INTERNAL_ERROR', undefined, logMessage);
  }

  private fromCode(code: ErrorCode, detail: string | undefined, logMessage: string): MappedException {
    const descriptor = errorDescriptor(code);
    return {
      status: descriptor.status,
      code,
      title: descriptor.title,
      detail: detail ?? descriptor.detail,
      violations: [],
      logMessage,
      logLevel: descriptor.status >= 500 ? 'error' : 'warn',
    };
  }

  private fromHttpException(exception: HttpException): MappedException {
    const status = exception.getStatus();
    const code = codeForHttpStatus(status);
    const mapped = this.fromCode(code, undefined, exception.message);

    const payload = exception.getResponse();
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as { message?: unknown }).message;
      if (Array.isArray(message)) {
        mapped.violations = message
          .filter((item): item is string => typeof item === 'string')
          .map((item) => ({ message: item }));
      } else if (mapped.code === 'VALIDATION_ERROR' && typeof message === 'string' && message) {
        mapped.violations = [{ message }];
      }
    }
    return mapped;
  }

  private fromPrismaError(exception: Prisma.PrismaClientKnownRequestError): MappedException {
    const logMessage = `prisma ${exception.code}: ${exception.message}`;
    switch (exception.code) {
      case 'P2023': // inconsistent column data - e.g. a malformed uuid reached SQL
      case 'P2021':
      case 'P2022':
        return this.fromCode('VALIDATION_ERROR', undefined, logMessage);
      case 'P2025':
        return this.fromCode('NOT_FOUND', undefined, logMessage);
      case 'P2002':
        return this.fromCode('CONFLICT', undefined, logMessage);
      case 'P2003':
        return this.fromCode('CONFLICT', undefined, logMessage);
      case 'P2028':
        return this.fromCode('SERVICE_UNAVAILABLE', undefined, logMessage);
      default:
        return this.fromCode('INTERNAL_ERROR', undefined, logMessage);
    }
  }
}
