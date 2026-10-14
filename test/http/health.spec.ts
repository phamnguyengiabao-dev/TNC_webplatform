import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';

import { createTestApp, TestApp } from '../helpers/test-app';

/** Tên migration mới nhất trong prisma/migrations - health phải báo đúng nó. */
function latestMigrationName(): string {
  const migrationsDir = join(__dirname, '..', '..', 'prisma', 'migrations');
  const head = readdirSync(migrationsDir)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .at(-1);
  if (!head) throw new Error('no migration found');
  return head;
}

describe('HTTP: health endpoints', () => {
  let ctx: TestApp;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /api/v1/health reports the process as alive', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200);

    expect(res.body).toEqual({ status: 'ok', version: '0.0.0' });
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('GET /api/v1/health/db pings the database and reports the migration head', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/v1/health/db').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.database).toBe('ok');
    expect(typeof res.body.migration).toBe('string');
    expect(res.body.migration).toBe(latestMigrationName());
    expect(typeof res.body.latencyMs).toBe('number');
  });

  it('echoes a caller-supplied X-Request-Id', async () => {
    const requestId = 'spec-request-id-0001';
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(res.headers['x-request-id']).toBe(requestId);
  });

  it('an unknown route still returns RFC 7807 with a requestId', async () => {
    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/definitely-not-a-route')
      .expect(404);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      type: 'https://tnc.vn/errors/not-found',
      status: 404,
      code: 'NOT_FOUND',
      instance: '/api/v1/definitely-not-a-route',
    });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });
});
