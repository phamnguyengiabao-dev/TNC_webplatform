import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'tnc:is-public';

/**
 * Opts a route (or a whole controller) out of authentication.
 * Guarded-by-default keeps new endpoints safe when someone forgets a decorator.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
