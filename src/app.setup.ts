import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { requestIdMiddleware } from './common/http/request-id';

/**
 * Transport-level setup shared by `main.ts` and the HTTP test suite.
 *
 * Everything that can be expressed as a provider (pipes, filters, guards,
 * interceptors) lives in AppModule instead; this function only touches the
 * express instance, which providers cannot reach.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');

  // Before the router, so even framework 404s carry a request id.
  app.use(requestIdMiddleware);

  const config = app.get(ConfigService);
  const origins = config.get<string[]>('app.corsOrigins', ['http://localhost:3000']);
  app.enableCors(
    origins.includes('*')
      ? { origin: true, credentials: true }
      : { origin: origins, credentials: true },
  );

  app.enableShutdownHooks();
}
