import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { createTestApp, TestApp } from '../helpers/test-app';
import { seedUser } from '../helpers/test-db';
import { signTestToken } from '../helpers/test-token';

describe('Meta social media library', () => {
  let ctx: TestApp;
  let adminToken: string;
  let userToken: string;
  let config: ConfigService;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    ctx = await createTestApp();
    config = ctx.app.get(ConfigService);
    const adminId = await seedUser(ctx.prisma, 'social-media-admin@example.com');
    const userId = await seedUser(ctx.prisma, 'social-media-user@example.com');
    await ctx.prisma.userProfile.update({ where: { id: adminId }, data: { role: 'ADMIN' } });
    adminToken = signTestToken({ sub: adminId });
    userToken = signTestToken({ sub: userId });
    config.set('meta.accessToken', 'test-token');
    config.set('meta.facebookPageId', 'test-page');
    config.set('meta.instagramAccountId', 'test-instagram');
  });

  beforeEach(async () => {
    await ctx.prisma.socialMediaItem.deleteMany();
    await ctx.prisma.syncRun.deleteMany({ where: { provider: 'META' } });
  });

  afterAll(async () => {
    global.fetch = originalFetch;
    await ctx.app.close();
  });

  it('returns only public posts to guests and keeps administration closed to USER', async () => {
    const base = {
      caption: 'TNC photo', mediaType: 'PHOTO', mediaUrls: ['https://scontent.example/photo.jpg'],
      permalink: 'https://instagram.com/p/test', publishedAt: new Date('2026-10-16T10:00:00Z'),
      externalId: 'post-public', platform: 'INSTAGRAM' as const,
    };
    await ctx.prisma.socialMediaItem.create({ data: { ...base, visibility: 'PUBLIC' } });
    await ctx.prisma.socialMediaItem.create({ data: { ...base, externalId: 'post-pending', visibility: 'PENDING' } });
    await ctx.prisma.socialMediaItem.create({ data: { ...base, externalId: 'post-hidden', visibility: 'HIDDEN' } });

    const publicFeed = await request(ctx.app.getHttpServer()).get('/api/v1/social-media').expect(200);
    expect(publicFeed.body.items).toHaveLength(1);
    expect(publicFeed.body.items[0]).toMatchObject({ externalId: 'post-public', visibility: 'PUBLIC' });

    await request(ctx.app.getHttpServer()).get('/api/v1/admin/social-media')
      .set('Authorization', `Bearer ${userToken}`).expect(403);
  });

  it('syncs both configured sources into pending review and records the run', async () => {
    global.fetch = jest.fn(async (input) => {
      const url = String(input);
      if (url.includes('/test-page/published_posts')) {
        return new Response(JSON.stringify({ data: [{
          id: 'fb-post-1', message: 'Facebook launch photo', permalink_url: 'https://facebook.com/post/1',
          full_picture: 'https://scontent.example/fb.jpg', created_time: '2026-10-16T09:00:00+0000',
        }] }), { status: 200 });
      }
      if (url.includes('/test-instagram/media')) {
        return new Response(JSON.stringify({ data: [{
          id: 'ig-post-1', caption: 'Instagram launch photo', media_type: 'IMAGE',
          media_url: 'https://scontent.example/ig.jpg', permalink: 'https://instagram.com/p/1', timestamp: '2026-10-16T10:00:00+0000',
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'unexpected path' } }), { status: 404 });
    }) as typeof fetch;

    const response = await request(ctx.app.getHttpServer()).post('/api/v1/admin/social-media/sync')
      .set('Authorization', `Bearer ${adminToken}`).set('Idempotency-Key', randomUUID()).send({}).expect(200);

    expect(response.body).toMatchObject({ status: 'SUCCEEDED', stats: { receivedRows: 2, created: 2, updated: 0 } });
    const items = await ctx.prisma.socialMediaItem.findMany({ orderBy: { platform: 'asc' } });
    expect(items.map(({ platform, visibility }) => [platform, visibility])).toEqual([
      ['FACEBOOK', 'PENDING'], ['INSTAGRAM', 'PENDING'],
    ]);
    expect(await ctx.prisma.syncRun.count({ where: { id: response.body.runId, provider: 'META', status: 'SUCCEEDED' } })).toBe(1);
  });

  it('lets ADMIN publish an item and writes an audit entry', async () => {
    const item = await ctx.prisma.socialMediaItem.create({
      data: { platform: 'FACEBOOK', externalId: 'fb-review-1', mediaType: 'PHOTO', mediaUrls: ['https://scontent.example/photo.jpg'] },
    });
    const imageUrl = 'https://scontent.example/photo.jpg';
    await request(ctx.app.getHttpServer()).patch(`/api/v1/admin/social-media/${item.id}/visibility`)
      .set('Authorization', `Bearer ${adminToken}`).send({ visibility: 'PUBLIC', selectedMediaUrls: [imageUrl] }).expect(200);
    expect(await ctx.prisma.auditLog.findFirst({ where: { entityId: item.id, action: 'SET_VISIBILITY' } }))
      .toMatchObject({ oldStatus: 'PENDING', newStatus: 'PUBLIC', actorRole: 'ADMIN' });
    expect((await request(ctx.app.getHttpServer()).get('/api/v1/social-media').expect(200)).body.items)
      .toEqual([expect.objectContaining({ id: item.id, visibility: 'PUBLIC', mediaUrls: [imageUrl] })]);
  });
});
