import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';

import { AppError } from '../../common/errors/app-error';
import { IdempotencyService } from './idempotency.service';

export const IDEMPOTENT_KEY = 'tnc:idempotent';

/**
 * Marks a route as requiring an `Idempotency-Key` header (docs 11.2.3).
 * The interceptor is registered globally; this metadata switches it on.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT_KEY, true);

const MAX_KEY_LENGTH = 128;
const KEY_PATTERN = /^[!-~]+$/; // printable ASCII, no spaces

/**
 * Replays the stored response for a repeated `Idempotency-Key`, or rejects the
 * request when the key was already used for a different intent.
 *
 * Why the interceptor and not the controller: replaying must bypass the whole
 * handler, and the stored body/status must be what the client originally got.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly idempotency: IdempotencyService,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
      return next.handle();
    }

    const required = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const user = request.user;
    if (!user) {
      // @Idempotent() on a @Public() route would be a wiring mistake; failing
      // closed beats storing a response that belongs to nobody.
      throw AppError.unauthenticated('idempotent endpoint reached without a principal');
    }

    const key = readIdempotencyKey(request);
    if (!key) {
      throw AppError.idempotencyKeyRequired();
    }

    const endpoint = describeEndpoint(request);
    const requestHash = hashRequest(request, endpoint);
    const begun = await this.idempotency.begin({
      key,
      userId: user.id,
      endpoint,
      requestHash,
    });

    if (begun.kind === 'replay') {
      response.setHeader('Idempotent-Replayed', 'true');
      response.status(begun.statusCode);
      return of(begun.body);
    }

    return next.handle().pipe(
      mergeMap(async (data: unknown) => {
        // Never fail a request that already succeeded: the ledger's own
        // idempotency keys keep retries safe even if this write is lost.
        try {
          await this.idempotency.complete({
            key,
            statusCode: response.statusCode ?? 200,
            body: data ?? null,
          });
        } catch (error) {
          this.logger.error(
            `could not persist idempotency result for key ${key}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return data;
      }),
      catchError((error: unknown) =>
        from(this.abortQuietly(key)).pipe(mergeMap(() => throwError(() => error))),
      ),
    );
  }

  private async abortQuietly(key: string): Promise<void> {
    try {
      await this.idempotency.abort(key);
    } catch (error) {
      this.logger.error(
        `could not release idempotency key ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function readIdempotencyKey(request: Request): string | null {
  const header = request.headers['idempotency-key'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) return null;
  const key = raw.trim();
  if (!key || key.length > MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
    throw AppError.validation(
      'Idempotency-Key must be 1-128 printable ASCII characters without spaces',
      'Idempotency-Key không hợp lệ.',
    );
  }
  return key;
}

function describeEndpoint(request: Request): string {
  const route = (request as Request & { route?: { path?: string } }).route;
  const path = route?.path ? `${request.baseUrl ?? ''}${route.path}` : request.path;
  return `${request.method} ${path}`;
}

/**
 * Cheap canonical fingerprint of the intent: route + path params + body.
 *
 * Path params matter: `POST /orders/{id}/pay-wallet` has no body, so without
 * the order id a second order would look like a replay of the first one.
 */
function hashRequest(request: Request, endpoint: string): string {
  const payload = JSON.stringify({
    endpoint,
    params: request.params ?? {},
    body: request.body ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}
