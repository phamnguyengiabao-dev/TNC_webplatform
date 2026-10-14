import type { UserRole } from '@prisma/client';

/** Claims we rely on from a Supabase access token. Others are kept as-is. */
export interface SupabaseTokenClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
  [claim: string]: unknown;
}

/**
 * The principal attached to a request by AuthGuard.
 *
 * `role` and `isBlocked` come from `UserProfile` (FR-03/FR-04), never from the
 * token: a JWT stays valid after a demotion, so the DB is the only trustworthy
 * source for authorization decisions.
 */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  isBlocked: boolean;
  tokenClaims: SupabaseTokenClaims;
}
