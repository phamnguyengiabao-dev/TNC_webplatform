import { createHmac, sign, type KeyObject } from 'node:crypto';

/**
 * Secret the HTTP tests sign their own tokens with. load-test-env.ts exports it
 * into `SUPABASE_JWT_SECRET`, so no Supabase project is involved in the suite.
 */
export const TEST_JWT_SECRET = 'tnc-test-jwt-secret-not-for-any-real-environment';

export interface Hs256TokenOptions {
  sub: string;
  email?: string;
  secret?: string;
  expiresInSeconds?: number;
  audience?: string;
  issuer?: string;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

/** Minimal HS256 JWT - mirrors what a legacy Supabase project issues. */
export function signTestToken(options: Hs256TokenOptions): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: Record<string, unknown> = {
    sub: options.sub,
    aud: options.audience ?? 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + (options.expiresInSeconds ?? 3600),
  };
  if (options.email) payload.email = options.email;
  if (options.issuer) payload.iss = options.issuer;

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', options.secret ?? TEST_JWT_SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

/** ES256 JWT, as projects with asymmetric signing keys issue. */
export function signEs256TestToken(options: {
  sub: string;
  privateKey: KeyObject;
  kid: string;
  issuer: string;
  expiresInSeconds?: number;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'JWT', kid: options.kid };
  const payload = {
    sub: options.sub,
    aud: 'authenticated',
    role: 'authenticated',
    iss: options.issuer,
    iat: now,
    exp: now + (options.expiresInSeconds ?? 3600),
  };

  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign('sha256', Buffer.from(signingInput, 'utf8'), {
    key: options.privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  return `${signingInput}.${signature}`;
}
