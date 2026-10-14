import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccessGuard } from './access.guard';
import { AuthGuard } from './auth.guard';
import { SupabaseTokenVerifier } from './token-verifier.service';

/**
 * Guard order matters: APP_GUARD providers execute in registration order, so
 * AuthGuard must be listed before AccessGuard.
 */
@Module({
  providers: [
    SupabaseTokenVerifier,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [SupabaseTokenVerifier],
})
export class AuthModule {}
