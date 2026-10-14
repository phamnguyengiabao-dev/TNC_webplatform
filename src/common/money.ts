import { Prisma } from '@prisma/client';

/**
 * Money handling for TNC.
 *
 * Rule: a monetary value is NEVER a JS `number`. `number` is an IEEE-754
 * double; it cannot represent every đồng above 2^53 and it silently rounds
 * during arithmetic. Every amount in this codebase is a `Prisma.Decimal`
 * (decimal.js) from the moment it is parsed until the moment it is serialised.
 *
 * At the API boundary, amounts go out as JSON *strings* for the same reason:
 * `JSON.parse` would turn them back into doubles on the client.
 */
export type Money = Prisma.Decimal;

export const ZERO: Money = new Prisma.Decimal(0);

/** VND, the only currency the platform supports today. */
export const CURRENCY = 'VND';

/**
 * Build a Money value. `number` is intentionally not accepted: if a number got
 * this far it has already been through a lossy representation. Use
 * {@link moneyFromInt} when the source really is a safe integer.
 */
export function money(value: string | bigint | Prisma.Decimal): Money {
  const d = new Prisma.Decimal(value.toString());
  if (!d.isFinite()) {
    throw new TypeError(`Not a finite monetary value: ${value.toString()}`);
  }
  return d;
}

/** Escape hatch for integer literals and counters that are provably exact. */
export function moneyFromInt(value: number): Money {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Not a safe integer amount: ${value}`);
  }
  return new Prisma.Decimal(value);
}

/**
 * VND has no sub-unit, so every amount that reaches the ledger must be a whole
 * đồng. Mirrors the `ledger_entry_whole_dong` CHECK constraint; failing here
 * gives a readable error instead of a raw Postgres violation.
 */
export function assertWholeDong(value: Money, field: string): void {
  if (!value.isInteger()) {
    throw new RangeError(`${field} must be a whole VND amount, got ${value.toString()}`);
  }
}

export function assertPositive(value: Money, field: string): void {
  if (value.lessThanOrEqualTo(0)) {
    throw new RangeError(`${field} must be greater than 0, got ${value.toString()}`);
  }
}

export function sumMoney(values: readonly Money[]): Money {
  return values.reduce<Money>((acc, v) => acc.add(v), ZERO);
}

/**
 * Split a gross amount into platform commission and seller payout.
 *
 * Only the commission is rounded; the payout is the *remainder*. That ordering
 * matters: if both sides were rounded independently they could add up to one
 * đồng more or less than the gross, and the resulting ledger transfer would not
 * balance. Here `commission + sellerAmount === gross` holds by construction.
 *
 * @param gross  amount the buyer pays, in whole đồng
 * @param rateBps commission rate in basis points (500 = 5.00%)
 */
export function splitCommission(
  gross: Money,
  rateBps: number,
): { commission: Money; sellerAmount: Money } {
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new RangeError(`Commission rate must be 0..10000 bps, got ${rateBps}`);
  }
  assertWholeDong(gross, 'gross');

  const commission = gross
    .mul(rateBps)
    .div(10_000)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return { commission, sellerAmount: gross.sub(commission) };
}

/**
 * Render a Money value for interpolation into a `$queryRaw` template.
 *
 * Passing the Decimal object straight into a tagged template leaves the exact
 * wire type up to the driver, so we hand Postgres an unambiguous string and
 * cast it with `::numeric` at the call site.
 */
export function toNumericParam(value: Money): string {
  return value.toFixed(2);
}

/** Serialise for a JSON response body. Always a string, never a number. */
export function toJson(value: Money): string {
  return value.toFixed(0);
}
