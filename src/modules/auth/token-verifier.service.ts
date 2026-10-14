import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
  type JsonWebKey,
} from 'node:crypto';

import type { SupabaseTokenClaims } from '../../common/auth/authenticated-user';

export type TokenRejectionReason =
  | 'not-configured'
  | 'malformed'
  | 'unsupported-algorithm'
  | 'expired'
  | 'not-yet-valid'
  | 'bad-signature'
  | 'unknown-key'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'missing-subject'
  | 'jwks-unavailable';

/**
 * Thrown by SupabaseTokenVerifier. The guard turns it into a 401 (or 503 for a
 * JWKS outage) and logs the reason; `message` stays server-side.
 */
export class TokenVerificationError extends Error {
  constructor(
    readonly reason: TokenRejectionReason,
    detail?: string,
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'TokenVerificationError';
  }
}

interface JwksKey extends JsonWebKey {
  kid?: string;
  alg?: string;
  use?: string;
}

interface DecodedToken {
  header: { alg: string; kid?: string };
  payload: SupabaseTokenClaims;
  signingInput: Buffer;
  signature: Buffer;
}

const ALLOWED_ALGORITHMS = new Set(['ES256', 'RS256', 'HS256']);

/**
 * Verifies Supabase access tokens.
 *
 * Two verification modes exist because Supabase has both on the road:
 *   - Asymmetric (ES256/RS256): public keys from the project JWKS endpoint.
 *     This is the current default for new projects.
 *   - HS256: the legacy shared "JWT secret" from the project settings.
 *
 * The JWKS is cached for `auth.jwksCacheTtlSeconds`; an unknown `kid` forces
 * one refetch so key rotation needs no deploy. A JWKS fetch failure falls back
 * to the last good cache - a Supabase blip must not invalidate every session.
 */
@Injectable()
export class SupabaseTokenVerifier {
  private readonly logger = new Logger(SupabaseTokenVerifier.name);
  private cache: { keys: JwksKey[]; fetchedAt: number } | null = null;
  private inflight: Promise<JwksKey[]> | null = null;

  constructor(private readonly config: ConfigService) {}

  private get jwksCacheTtlMs(): number {
    return this.config.get<number>('auth.jwksCacheTtlSeconds', 300) * 1000;
  }

  async verify(token: string): Promise<SupabaseTokenClaims> {
    const decoded = decodeToken(token);

    switch (decoded.header.alg) {
      case 'HS256':
        this.verifyHmac(decoded);
        break;
      case 'ES256':
      case 'RS256':
        await this.verifyAsymmetric(decoded);
        break;
      default:
        throw new TokenVerificationError(
          'unsupported-algorithm',
          `alg=${decoded.header.alg || '<empty>'}`,
        );
    }

    this.assertRegisteredClaims(decoded.payload);
    return decoded.payload;
  }

  // ---------------------------------------------------------------------------
  // HS256 (legacy shared secret)
  // ---------------------------------------------------------------------------

  private verifyHmac(decoded: DecodedToken): void {
    const secret = this.config.get<string>('auth.jwtSecret', '');
    if (!secret) {
      throw new TokenVerificationError(
        'not-configured',
        'token is HS256 but SUPABASE_JWT_SECRET is not set',
      );
    }

    const expected = createHmac('sha256', secret).update(decoded.signingInput).digest();
    if (
      expected.length !== decoded.signature.length ||
      !timingSafeEqual(expected, decoded.signature)
    ) {
      throw new TokenVerificationError('bad-signature');
    }
  }

  // ---------------------------------------------------------------------------
  // ES256 / RS256 (JWKS)
  // ---------------------------------------------------------------------------

  private async verifyAsymmetric(decoded: DecodedToken): Promise<void> {
    const kid = decoded.header.kid;
    let keys = await this.getJwksKeys(false);
    let jwk = keys.find((key) => key.kid && key.kid === kid);

    if (!jwk && kid) {
      // Possible key rotation: refresh once before rejecting.
      this.logger.log(`kid ${kid} not in cache, refreshing JWKS`);
      keys = await this.getJwksKeys(true);
      jwk = keys.find((key) => key.kid && key.kid === kid);
    }

    if (!jwk) {
      throw new TokenVerificationError('unknown-key', `kid=${kid ?? '<none>'}`);
    }
    if (jwk.alg && jwk.alg !== decoded.header.alg) {
      throw new TokenVerificationError(
        'unsupported-algorithm',
        `header alg ${decoded.header.alg} does not match jwk alg ${jwk.alg}`,
      );
    }

    let publicKey;
    try {
      publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    } catch (error) {
      throw new TokenVerificationError(
        'unknown-key',
        `unusable jwk (kind=${jwk.kty}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const valid =
      decoded.header.alg === 'ES256'
        ? // JWS packs ECDSA signatures as raw r||s; Node defaults to DER.
          verifySignature(
            'sha256',
            decoded.signingInput,
            { key: publicKey, dsaEncoding: 'ieee-p1363' },
            decoded.signature,
          )
        : verifySignature('sha256', decoded.signingInput, publicKey, decoded.signature);

    if (!valid) {
      throw new TokenVerificationError('bad-signature');
    }
  }

  private async getJwksKeys(forceRefresh: boolean): Promise<JwksKey[]> {
    const fresh = this.cache && Date.now() - this.cache.fetchedAt < this.jwksCacheTtlMs;
    if (!forceRefresh && fresh) {
      return this.cache!.keys;
    }

    const url = this.resolveJwksUrl();
    if (!url) {
      throw new TokenVerificationError(
        'not-configured',
        'token is asymmetric but neither SUPABASE_URL nor SUPABASE_JWKS_URL is set',
      );
    }

    if (!this.inflight) {
      this.inflight = this.fetchJwks(url).finally(() => {
        this.inflight = null;
      });
    }

    try {
      const keys = await this.inflight;
      this.cache = { keys, fetchedAt: Date.now() };
      return keys;
    } catch (error) {
      if (this.cache) {
        // Stale beats broken: keep the previous key set for availability.
        this.logger.warn(
          `JWKS refresh failed, serving cached keys: ${error instanceof Error ? error.message : String(error)}`,
        );
        return this.cache.keys;
      }
      throw new TokenVerificationError(
        'jwks-unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async fetchJwks(url: string): Promise<JwksKey[]> {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      throw new Error(`JWKS endpoint responded ${response.status}`);
    }
    const body = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(body.keys)) {
      throw new Error('JWKS payload has no keys array');
    }
    return body.keys as JwksKey[];
  }

  private resolveJwksUrl(): string {
    const explicit = this.config.get<string>('auth.jwksUrl', '').replace(/\/+$/, '');
    if (explicit) return explicit;
    const supabaseUrl = this.config.get<string>('auth.supabaseUrl', '').replace(/\/+$/, '');
    return supabaseUrl ? `${supabaseUrl}/auth/v1/.well-known/jwks.json` : '';
  }

  // ---------------------------------------------------------------------------
  // Registered claims
  // ---------------------------------------------------------------------------

  private assertRegisteredClaims(payload: SupabaseTokenClaims): void {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const tolerance = this.config.get<number>('auth.clockToleranceSeconds', 30);

    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      throw new TokenVerificationError('malformed', 'claim exp is missing');
    }
    if (payload.exp < nowSeconds - tolerance) {
      throw new TokenVerificationError('expired');
    }
    if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + tolerance) {
      throw new TokenVerificationError('not-yet-valid');
    }

    const expectedIssuer = this.resolveIssuer();
    if (expectedIssuer && typeof payload.iss === 'string' && payload.iss !== expectedIssuer) {
      throw new TokenVerificationError('wrong-issuer', `iss=${payload.iss}`);
    }

    const expectedAudience = this.config.get<string>('auth.audience', 'authenticated');
    if (expectedAudience) {
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(expectedAudience)) {
        throw new TokenVerificationError('wrong-audience', `aud=${JSON.stringify(payload.aud)}`);
      }
    }

    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new TokenVerificationError('missing-subject');
    }
  }

  private resolveIssuer(): string {
    const explicit = this.config.get<string>('auth.issuer', '');
    if (explicit) return explicit;
    const supabaseUrl = this.config.get<string>('auth.supabaseUrl', '').replace(/\/+$/, '');
    return supabaseUrl ? `${supabaseUrl}/auth/v1` : '';
  }
}

function decodeToken(token: string): DecodedToken {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new TokenVerificationError('malformed', `expected 3 non-empty segments`);
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  const header = parseSegment(headerPart, 'header');
  const payload = parseSegment(payloadPart, 'payload');

  if (typeof header !== 'object' || Array.isArray(header) || typeof header.alg !== 'string') {
    throw new TokenVerificationError('malformed', 'header has no alg');
  }
  if (!ALLOWED_ALGORITHMS.has(header.alg)) {
    throw new TokenVerificationError('unsupported-algorithm', `alg=${header.alg}`);
  }
  if (typeof payload !== 'object' || Array.isArray(payload) || payload === null) {
    throw new TokenVerificationError('malformed', 'payload is not an object');
  }

  return {
    header: { alg: header.alg, kid: typeof header.kid === 'string' ? header.kid : undefined },
    payload: payload as SupabaseTokenClaims,
    signingInput: Buffer.from(`${headerPart}.${payloadPart}`, 'utf8'),
    signature: Buffer.from(signaturePart, 'base64url'),
  };
}

function parseSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new TokenVerificationError(
      'malformed',
      `${label} is not valid json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
