import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';

import { Roles } from '../../src/common/auth/roles.decorator';
import { resetDatabase, seedUser } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signTestToken } from '../helpers/test-token';

/**
 * Test-only route. `@Roles` has no production consumer yet (the staff module
 * comes later), so a probe controller exercises the guard without shipping
 * test endpoints in src/.
 */
@Controller('__probe')
class RoleProbeController {
  @Get('staff')
  @Roles('STAFF')
  staffOnly() {
    return { ok: true };
  }
}

describe('HTTP: authentication and authorization', () => {
  let ctx: TestApp;
  let app: INestApplication;
  let userId: string;
  let staffId: string;
  let blockedId: string;

  beforeAll(async () => {
    ctx = await createTestApp({ controllers: [RoleProbeController] });
    app = ctx.app;
    await resetDatabase(ctx.prisma);

    userId = await seedUser(ctx.prisma, 'buyer@example.com');
    staffId = await seedUser(ctx.prisma, 'staff@example.com');
    await ctx.prisma.userProfile.update({ where: { id: staffId }, data: { role: 'STAFF' } });
    blockedId = await seedUser(ctx.prisma, 'blocked@example.com');
    await ctx.prisma.userProfile.update({ where: { id: blockedId }, data: { isBlocked: true } });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request without a token', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').expect(401);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(res.body.message).toBeUndefined();
  });

  it.each([
    ['a non-bearer header', 'Token abc.def.ghi'],
    ['a malformed token', 'Bearer not-a-jwt'],
    ['a token signed with the wrong secret', `Bearer ${signTestToken({ sub: 'irrelevant', secret: 'wrong-secret' })}`],
    ['an expired token', `Bearer ${signTestToken({ sub: 'irrelevant', expiresInSeconds: -120 })}`],
  ])('rejects %s', async (_label, header) => {
    const res = await request(app.getHttpServer()).get('/api/v1/me').set('Authorization', header).expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a valid token whose user profile does not exist', async () => {
    const token = signTestToken({ sub: '00000000-0000-4000-8000-000000000000' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect(res.body.code).toBe('PROFILE_NOT_FOUND');
  });

  it('returns the profile and wallet summary for a valid token', async () => {
    const token = signTestToken({ sub: userId, email: 'buyer@example.com' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({
      id: userId,
      email: 'buyer@example.com',
      displayName: null,
      role: 'USER',
      isBlocked: false,
      wallet: { balance: '0', currency: 'VND' },
    });
  });

  it('reads the role from the database, not from the token', async () => {
    const asUser = signTestToken({ sub: userId });
    await request(app.getHttpServer())
      .get('/api/v1/__probe/staff')
      .set('Authorization', `Bearer ${asUser}`)
      .expect(403);

    const asStaff = signTestToken({ sub: staffId });
    await request(app.getHttpServer())
      .get('/api/v1/__probe/staff')
      .set('Authorization', `Bearer ${asStaff}`)
      .expect(200);
  });

  it('blocks a blocked account from money endpoints with ACCOUNT_BLOCKED', async () => {
    const token = signTestToken({ sub: blockedId });
    const res = await request(app.getHttpServer())
      .get('/api/v1/wallet')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(res.body).toMatchObject({ status: 403, code: 'ACCOUNT_BLOCKED' });
  });

  it('still lets a blocked account read its own profile', async () => {
    const token = signTestToken({ sub: blockedId });
    const res = await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.isBlocked).toBe(true);
  });
});
