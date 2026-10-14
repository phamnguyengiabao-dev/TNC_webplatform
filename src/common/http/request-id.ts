import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Accepts a client-supplied id so traces survive a proxy/gateway of our own. */
export function sanitizeRequestId(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 128) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Plain express middleware rather than a Nest middleware class: it must also
 * run for unmatched routes so even a framework 404 carries a request id.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = sanitizeRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
