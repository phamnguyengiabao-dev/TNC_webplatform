import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { AuthenticatedUser } from '../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseTokenVerifier, TokenVerificationError } from './token-verifier.service';

/**
 * Resolves the principal for every request.
 *
 * Runs globally (APP_GUARD) and rejects by default; a route opts out with
 * `@Public()`. Role and block state are read from `UserProfile` on every
 * request: a JWT stays valid after a role change, so the token alone must never
 * be the source of authorization (FR-03, FR-04).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: SupabaseTokenVerifier,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw AppError.unauthenticated('missing or malformed Authorization header');
    }

    let claims;
    try {
      claims = await this.verifier.verify(token);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        this.logger.warn(`rejected bearer token (${error.reason})`);
        if (error.reason === 'not-configured') {
          throw new AppError('AUTH_NOT_CONFIGURED', { logMessage: error.message, cause: error });
        }
        if (error.reason === 'jwks-unavailable') {
          // The token may be perfectly valid; we just cannot check it now.
          // 503 lets clients retry instead of logging the user out.
          throw new AppError('SERVICE_UNAVAILABLE', {
            logMessage: `cannot verify tokens: ${error.message}`,
            cause: error,
          });
        }
        throw AppError.unauthenticated(`token verification failed: ${error.message}`);
      }
      throw error;
    }

    const profile = await this.prisma.userProfile.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, displayName: true, role: true, isBlocked: true },
    });
    if (!profile) {
      // Valid token, missing profile row: signup provisioning failed or the
      // user was removed. Worth investigating - see docs 11.4.1.
      this.logger.warn(`no UserProfile for sub=${claims.sub}`);
      throw new AppError('PROFILE_NOT_FOUND', {
        logMessage: `no UserProfile for sub=${claims.sub}`,
      });
    }

    const user: AuthenticatedUser = {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      role: profile.role,
      isBlocked: profile.isBlocked,
      tokenClaims: claims,
    };
    request.user = user;
    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}
