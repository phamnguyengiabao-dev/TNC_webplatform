/**
 * Runs before the test framework in every worker. Jest runs globalSetup in a
 * separate process, so the resolved URL travels through the file written by
 * test/setup/global-setup.ts.
 *
 * Setting process.env here (rather than relying on .env) is deliberate: it
 * takes precedence over any real Supabase credentials in a developer's .env,
 * so tests can never accidentally point at a production database - or verify
 * tokens against a real project.
 */
import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { TEST_ENV_FILE } from './global-setup';
import { TEST_JWT_SECRET } from '../helpers/test-token';

const db = JSON.parse(readFileSync(TEST_ENV_FILE, 'utf8')) as { url: string };
process.env.DATABASE_URL = db.url;
process.env.DIRECT_URL = db.url;

// Auth for the HTTP suite: HMAC secret only, so tests sign their own tokens.
// An empty SUPABASE_URL also keeps a developer's .env from leaking in.
process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
process.env.SUPABASE_URL = '';
process.env.SUPABASE_JWKS_URL = '';
process.env.SUPABASE_JWT_ISSUER = '';
process.env.CORS_ORIGINS = '';
// Keep generated catalog links deterministic even when a developer has set
// PUBLIC_API_ORIGIN in their local .env file.
process.env.PUBLIC_API_ORIGIN = '';
// Never let developer Shopee credentials start scheduled network syncs in tests.
process.env.SHOPEE_SYNC_PROVIDER = 'csv';
process.env.SHOPEE_SHOP_ID = '';
process.env.SHOPEE_AFFILIATE_APP_ID = '';
process.env.SHOPEE_AFFILIATE_SECRET = '';

// The services log every posted transfer at "log" level; in tests that is
// expected noise on stdout, and the assertions are the signal.
Logger.overrideLogger(false);
