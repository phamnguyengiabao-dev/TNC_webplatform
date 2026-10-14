import { Money } from '../../common/money';

/**
 * Domain errors. Deliberately plain `Error` subclasses rather than NestJS HTTP
 * exceptions: the ledger must not know about HTTP. Map them to status codes in
 * a single `@Catch()` exception filter, keeping `code` as the stable
 * machine-readable field in the response body.
 *
 * `message` is for server logs. The filter must NOT copy it into the response:
 * some of these messages carry wallet ids and amounts.
 */
export abstract class LedgerError extends Error {
  abstract readonly code: string;

  protected constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class InsufficientFundsError extends LedgerError {
  readonly code = 'INSUFFICIENT_FUNDS';

  constructor(
    readonly walletId: string,
    readonly requested: Money,
  ) {
    // The available balance is deliberately NOT in the message. A caller who
    // is not the wallet owner must not learn it from an error, and messages
    // have a habit of ending up in responses.
    super(`Wallet ${walletId} cannot cover ${requested.abs().toFixed(0)}`);
  }
}

export class WalletNotFoundError extends LedgerError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} does not exist`);
  }
}

export class SystemWalletMissingError extends LedgerError {
  readonly code = 'SYSTEM_WALLET_MISSING';

  constructor(readonly walletCode: string) {
    super(
      `System wallet "${walletCode}" is not provisioned. Run prisma/sql/finance_guards.sql section 6.`,
    );
  }
}

/** Raised before anything is written, so it is a programming error, not a 4xx. */
export class UnbalancedTransferError extends LedgerError {
  readonly code = 'UNBALANCED_TRANSFER';

  constructor(
    readonly drift: Money,
    readonly legCount: number,
  ) {
    super(
      `Refusing to post a transfer with ${legCount} leg(s) and a drift of ${drift.toFixed(2)}`,
    );
  }
}

export class DuplicateLegError extends LedgerError {
  readonly code = 'DUPLICATE_LEG';

  constructor(readonly walletId: string) {
    super(`Wallet ${walletId} appears twice in one transfer; net the legs before posting`);
  }
}

export class InvalidStateTransitionError extends LedgerError {
  readonly code = 'INVALID_STATE_TRANSITION';

  constructor(entity: string, id: string, expected: string) {
    super(`${entity} ${id} is not in state ${expected}`);
  }
}

export class AlreadyReversedError extends LedgerError {
  readonly code = 'ALREADY_REVERSED';

  constructor(readonly transferId: string) {
    super(`Transfer ${transferId} has already been reversed`);
  }
}

/**
 * There is nothing held in escrow for this order, so there is nothing to
 * release or refund. Either the order was never paid through the ledger, or it
 * has already been settled.
 *
 * This is the guard that stops an order from draining escrow that belongs to
 * other buyers: the amount to move is derived from the ledger, never from the
 * (mutable) order row.
 */
export class EscrowEmptyError extends LedgerError {
  readonly code = 'ESCROW_EMPTY';

  constructor(readonly orderId: string) {
    super(`Order ${orderId} holds nothing in escrow`);
  }
}

/**
 * A database-level money invariant was violated - an unbalanced transfer, a
 * transfer with no legs, or a frozen column being rewritten. This should be
 * impossible through LedgerService, so treat it as a 500 and page someone.
 * The original Postgres message is logged, never returned.
 */
export class LedgerIntegrityViolationError extends LedgerError {
  readonly code = 'LEDGER_INTEGRITY_VIOLATION';

  constructor(detail: string) {
    super(`Ledger integrity violation: ${detail}`);
  }
}
