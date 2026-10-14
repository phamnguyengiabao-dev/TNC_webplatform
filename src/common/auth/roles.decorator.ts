import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

export const ROLES_KEY = 'tnc:roles';

/**
 * Restricts a route to the given DB roles (FR-03). Roles are read from
 * `UserProfile`, so a role change takes effect on the next request.
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
