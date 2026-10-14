import { SetMetadata } from '@nestjs/common';

export const ACTIVE_ACCOUNT_KEY = 'tnc:active-account';

/**
 * Rejects blocked accounts with 403 ACCOUNT_BLOCKED (FR-04).
 *
 * Apply to every endpoint that moves or exposes money. Deliberately opt-in:
 * a blocked user must still be able to fetch their profile to read the reason.
 */
export const RequireActiveAccount = () => SetMetadata(ACTIVE_ACCOUNT_KEY, true);
