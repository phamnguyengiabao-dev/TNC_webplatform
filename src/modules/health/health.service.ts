import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

export interface LivenessView {
  status: 'ok';
  version: string;
}

export interface ReadinessView {
  status: 'ok';
  database: 'ok';
  /** Latest applied migration; null only when no migration has ever run. */
  migration: string | null;
  latencyMs: number;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Process liveness - deliberately does not touch the database. */
  liveness(): LivenessView {
    return { status: 'ok', version: this.config.get<string>('app.version', '0.0.0') };
  }

  async readiness(): Promise<ReadinessView> {
    const startedAt = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new AppError('SERVICE_UNAVAILABLE', {
        logMessage: `database ping failed: ${error instanceof Error ? error.message : String(error)}`,
        cause: error,
      });
    }

    const rows = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name
        FROM "_prisma_migrations"
       WHERE finished_at IS NOT NULL
       ORDER BY finished_at DESC
       LIMIT 1
    `;

    return {
      status: 'ok',
      database: 'ok',
      migration: rows[0]?.migration_name ?? null,
      latencyMs: Date.now() - startedAt,
    };
  }
}
