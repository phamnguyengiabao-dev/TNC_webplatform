import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { ProblemDetailFilter } from './common/http/problem-detail.filter';
import configuration from './config/configuration';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { CurationModule } from './modules/curation/curation.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IdempotencyInterceptor } from './modules/idempotency/idempotency.interceptor';
import { IdempotencyModule } from './modules/idempotency/idempotency.module';
import { OrdersModule } from './modules/orders/orders.module';
import { SyncModule } from './modules/sync/sync.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Cross-cutting wiring lives here so `main.ts` and the HTTP tests are built
 * from the same configuration: there is no second, hand-assembled test app to
 * drift away from production.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      load: [configuration],
    }),
    PrismaModule,
    AuthModule,
    IdempotencyModule,
    HealthModule,
    IdentityModule,
    CatalogModule,
    CurationModule,
    WalletModule,
    OrdersModule,
    SyncModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useFactory: () =>
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          // Echoing the rejected value back would leak it into logs and
          // responses; field names and messages are enough.
          validationError: { target: false, value: false },
        }),
    },
    { provide: APP_FILTER, useClass: ProblemDetailFilter },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
