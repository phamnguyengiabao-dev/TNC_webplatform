import { ErrorCode } from './error-catalog';

/** One field-level violation, attached to VALIDATION_ERROR bodies. */
export interface ProblemViolation {
  field?: string;
  message: string;
}

/**
 * RFC 7807 body. `code` is the contract; everything else is presentation.
 * `requestId` matches the `X-Request-Id` response header so a user can quote it
 * in a support ticket and the log line can be found in seconds.
 */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail: string;
  instance: string;
  requestId: string;
  errors?: ProblemViolation[];
}
