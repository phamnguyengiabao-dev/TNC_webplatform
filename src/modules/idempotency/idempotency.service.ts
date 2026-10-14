import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IdempotencyState, Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

export interface IdempotencyBeginInput {
  key: string;
  userId: string;
  /** Stable route identity, e.g. `POST /api/v1/orders/:id/pay-wallet`. */
  endpoint: string;
  requestHash: string;
}

export type IdempotencyBeginResult =
  | { kind: 'proceed' }
  | { kind: 'replay'; statusCode: number; body: unknown };

/**
 * Second idempotency layer: the client-facing `Idempotency-Key` header backed by
 * `IdempotencyRecord` (docs 06 §6.5). The ledger's own transfer keys remain the
 * last line of defence, so a cleaned-up record can never mint money twice.
 *
 * Lifecycle: begin -> (work) -> complete | abort. A record is aborted - not
 * stored - when the request failed, so the client may retry the same key after
 * fixing the cause; only successful responses are replayed.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get ttlMs(): number {
    return this.config.get<number>('app.idempotencyTtlHours', 24) * 3_600_000;
  }

  async begin(input: IdempotencyBeginInput): Promise<IdempotencyBeginResult> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { key: input.key },
    });
    const now = new Date();

    if (existing && existing.expiresAt > now) {
      if (
        existing.userId !== input.userId ||
        existing.endpoint !== input.endpoint ||
        existing.requestHash !== input.requestHash
      ) {
        this.logger.warn(`idempotency conflict on key ${input.key}`);
        throw AppError.idempotencyConflict(
          `key ${input.key} reused for a different intent (user/endpoint/payload)`,
        );
      }
      if (existing.state === IdempotencyState.COMPLETED) {
        return {
          kind: 'replay',
          statusCode: existing.statusCode ?? 200,
          body: existing.responseBody ?? null,
        };
      }
      throw AppError.idempotencyInProgress(`key ${input.key} is still being processed`);
    }

    // No record, or an expired one: take ownership. The upsert also covers the
    // race where two retries arrive together - one wins the row, the other
    // re-reads and correctly reports "in progress".
    try {
      await this.prisma.idempotencyRecord.upsert({
        where: { key: input.key },
        create: {
          key: input.key,
          userId: input.userId,
          endpoint: input.endpoint,
          requestHash: input.requestHash,
          state: IdempotencyState.IN_PROGRESS,
          expiresAt: new Date(now.getTime() + this.ttlMs),
        },
        update: {
          userId: input.userId,
          endpoint: input.endpoint,
          requestHash: input.requestHash,
          state: IdempotencyState.IN_PROGRESS,
          statusCode: null,
          responseBody: Prisma.DbNull,
          expiresAt: new Date(now.getTime() + this.ttlMs),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return this.begin(input);
      }
      throw error;
    }

    return { kind: 'proceed' };
  }

  async complete(input: { key: string; statusCode: number; body: unknown }): Promise<void> {
    await this.prisma.idempotencyRecord.updateMany({
      where: { key: input.key, state: IdempotencyState.IN_PROGRESS },
      data: {
        state: IdempotencyState.COMPLETED,
        statusCode: input.statusCode,
        responseBody: (input.body ?? null) as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
  }

  /** Drops the reservation so the same key can be retried after a failure. */
  async abort(key: string): Promise<void> {
    await this.prisma.idempotencyRecord.deleteMany({ where: { key } });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
