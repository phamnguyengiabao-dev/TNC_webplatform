import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Single PrismaClient for the process.
 *
 * Nest's lifecycle hooks are used instead of calling `$connect()` from main.ts
 * so shutdown is also handled: on SIGTERM/SIGINT the module is destroyed and
 * the pool is drained rather than being torn down mid-transaction.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * Options are injectable so integration tests can silence the log output
   * from *expected* races (a replayed webhook surfaces as P2002 by design).
   */
  constructor(options?: Prisma.PrismaClientOptions) {
    // `query` logging is deliberately absent from the default: it would print
    // wallet ids and amounts into log aggregation. Slow-query logging is a DB
    // concern.
    super(options ?? { log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
