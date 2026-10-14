import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';

import { resetDatabase, seedUser } from '../helpers/test-db';
import { createTestApp, TestApp } from '../helpers/test-app';
import { signEs256TestToken } from '../helpers/test-token';

/**
 * Exercises the JWKS path of SupabaseTokenVerifier: a local server advertises
 * an ES256 public key, tokens are signed with the matching private key. No
 * Supabase project is involved, but the code path is the production one.
 */
describe('HTTP: bearer tokens verified via JWKS (ES256)', () => {
  let jwksServer: Server;
  let baseUrl: string;
  let issuer: string;
  let ctx: TestApp;
  let userId: string;
  let primary: { publicKey: KeyObject; privateKey: KeyObject };
  let rotated: { publicKey: KeyObject; privateKey: KeyObject };
  let servedKeys: Array<Record<string, unknown>>;

  const toJwk = (publicKey: KeyObject, kid: string): Record<string, unknown> => ({
    ...publicKey.export({ format: 'jwk' }),
    kid,
    alg: 'ES256',
    use: 'sig',
  });

  beforeAll(async () => {
    primary = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    rotated = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    servedKeys = [toJwk(primary.publicKey, 'test-key-primary')];

    jwksServer = createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: servedKeys }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => jwksServer.listen(0, '127.0.0.1', resolve));
    const { port } = jwksServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    issuer = `${baseUrl}/auth/v1`;

    // Must be set before AppModule reads the environment.
    process.env.SUPABASE_URL = baseUrl;

    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    userId = await seedUser(ctx.prisma, 'jwks-user@example.com');
  });

  afterAll(async () => {
    await ctx.app.close();
    await new Promise<void>((resolve) => jwksServer.close(() => resolve()));
    process.env.SUPABASE_URL = '';
  });

  it('accepts a token signed with the advertised ES256 key', async () => {
    const token = signEs256TestToken({
      sub: userId,
      privateKey: primary.privateKey,
      kid: 'test-key-primary',
      issuer,
    });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.id).toBe(userId);
  });

  it('rejects a token whose kid is not in the JWKS', async () => {
    const token = signEs256TestToken({
      sub: userId,
      privateKey: primary.privateKey,
      kid: 'kid-that-does-not-exist',
      issuer,
    });

    const res = await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);

    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a token signed by a different private key', async () => {
    const token = signEs256TestToken({
      sub: userId,
      privateKey: rotated.privateKey,
      kid: 'test-key-primary',
      issuer,
    });

    await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('rejects a token from a different issuer', async () => {
    const token = signEs256TestToken({
      sub: userId,
      privateKey: primary.privateKey,
      kid: 'test-key-primary',
      issuer: 'https://another-project.supabase.co/auth/v1',
    });

    await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('picks up a rotated signing key after the unknown-kid refresh', async () => {
    servedKeys = [toJwk(rotated.publicKey, 'test-key-rotated')];

    const token = signEs256TestToken({
      sub: userId,
      privateKey: rotated.privateKey,
      kid: 'test-key-rotated',
      issuer,
    });

    await request(ctx.app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
