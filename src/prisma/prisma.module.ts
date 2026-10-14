import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so feature modules (banking first) can inject PrismaService without
 * re-importing this module everywhere.
 *
 * A factory rather than `useClass`: PrismaService's constructor takes an
 * optional PrismaClientOptions argument, which Nest would otherwise try to
 * resolve from the container. Tests that need different options construct the
 * service directly; the DI-managed instance always takes the defaults.
 */
@Global()
@Module({
  providers: [
    {
      provide: PrismaService,
      useFactory: () => new PrismaService(),
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
