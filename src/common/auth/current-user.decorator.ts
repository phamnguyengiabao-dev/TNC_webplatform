import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { AppError } from '../errors/app-error';
import type { AuthenticatedUser } from './authenticated-user';

/**
 * Injects the principal AuthGuard resolved from the bearer token.
 * `@CurrentUser('id')` narrows to a single field.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;
    if (!user) {
      // Only reachable on a @Public() route that forgot to opt out of this
      // decorator - a wiring bug, not a client problem.
      throw AppError.unauthenticated('no principal on request');
    }
    return field ? user[field] : user;
  },
);
