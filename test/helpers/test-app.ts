import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { BankingService } from '../../src/modules/banking/banking.service';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  banking: BankingService;
}

/**
 * Boots the real AppModule with the real global wiring. `controllers` lets a
 * spec register a probe route (e.g. to exercise @Roles) without shipping test
 * endpoints in src/.
 */
export async function createTestApp(options: { controllers?: Type[] } = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    banking: app.get(BankingService),
  };
}
