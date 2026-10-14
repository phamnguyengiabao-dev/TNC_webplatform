import type { AuthenticatedUser } from '../common/auth/authenticated-user';

/**
 * Express request augmentations used across the HTTP layer.
 */
declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requestIdMiddleware on every request. */
    requestId: string;
    /** Set by AuthGuard on authenticated (non-@Public) routes. */
    user?: AuthenticatedUser;
  }
}
