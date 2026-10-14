import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { Request } from 'express';

import { ACTIVE_ACCOUNT_KEY } from '../../common/auth/require-active-account.decorator';
import { ROLES_KEY } from '../../common/auth/roles.decorator';
import { AppError } from '../../common/errors/app-error';

/**
 * Authorization on top of the authenticated principal.
 *
 * One guard rather than two because both checks read the same principal and
 * both must run after AuthGuard - which global-guard ordering guarantees.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly logger = new Logger(AccessGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType<'http' | 'rpc' | 'ws'>() !== 'http') {
      return true;
    }

    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiresActiveAccount = this.reflector.getAllAndOverride<boolean>(ACTIVE_ACCOUNT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length && !requiresActiveAccount) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) {
      // Only possible on a @Public() route; there is no principal to restrict.
      return true;
    }

    if (requiresActiveAccount && user.isBlocked) {
      this.logger.warn(`blocked account ${user.id} attempted a money endpoint`);
      throw new AppError('ACCOUNT_BLOCKED', { logMessage: `account ${user.id} is blocked` });
    }

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      this.logger.warn(`role ${user.role} not allowed (needs ${requiredRoles.join('/')})`);
      throw AppError.forbidden(`role ${user.role} not in [${requiredRoles.join(', ')}]`);
    }

    return true;
  }
}
