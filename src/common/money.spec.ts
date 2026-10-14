import {
  assertPositive,
  assertWholeDong,
  money,
  moneyFromInt,
  splitCommission,
  sumMoney,
  toJson,
  toNumericParam,
} from './money';

describe('money', () => {
  describe('money()', () => {
    it('preserves đồng values beyond 2^53 by staying off JS numbers', () => {
      expect(money('9007199254740993').toFixed(0)).toBe('9007199254740993');
    });

    it('rejects values that are not finite decimal numbers', () => {
      expect(() => money('NaN')).toThrow(TypeError);
      expect(() => money('Infinity')).toThrow(TypeError);
    });
  });

  describe('moneyFromInt()', () => {
    it('accepts safe integers', () => {
      expect(moneyFromInt(100000).toFixed(0)).toBe('100000');
    });

    it('refuses integers a double cannot represent', () => {
      expect(() => moneyFromInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    });
  });

  describe('assertWholeDong()', () => {
    it('accepts whole đồng', () => {
      expect(() => assertWholeDong(money('100000'), 'amount')).not.toThrow();
    });

    it('rejects fractional đồng, mirroring the DB constraint', () => {
      expect(() => assertWholeDong(money('100.50'), 'amount')).toThrow(RangeError);
    });
  });

  describe('assertPositive()', () => {
    it('rejects zero and negative amounts', () => {
      expect(() => assertPositive(money('0'), 'amount')).toThrow(RangeError);
      expect(() => assertPositive(money('-1'), 'amount')).toThrow(RangeError);
      expect(() => assertPositive(money('1'), 'amount')).not.toThrow();
    });
  });

  describe('sumMoney()', () => {
    it('sums to zero when there is nothing to sum', () => {
      expect(sumMoney([]).isZero()).toBe(true);
    });

    it('adds signed legs exactly', () => {
      expect(sumMoney([money('-100000'), money('95000'), money('5000')]).isZero()).toBe(true);
    });
  });

  describe('splitCommission()', () => {
    it('splits 5% of a round amount exactly', () => {
      const { commission, sellerAmount } = splitCommission(money('100000'), 500);
      expect(commission.toFixed(0)).toBe('5000');
      expect(sellerAmount.toFixed(0)).toBe('95000');
    });

    it('rounds only the commission (HALF_UP); the seller gets the remainder', () => {
      const gross = money('99999');
      const { commission, sellerAmount } = splitCommission(gross, 500);
      // 99999 * 5% = 4999.95 -> 5000. If both sides were rounded, the legs
      // would sum to 99999.95 and the transfer could never balance.
      expect(commission.toFixed(0)).toBe('5000');
      expect(sellerAmount.toFixed(0)).toBe('94999');
      expect(commission.add(sellerAmount).equals(gross)).toBe(true);
    });

    it('keeps commission + seller === gross for every valid rate', () => {
      const gross = money('123457');
      for (let bps = 0; bps <= 10000; bps += 25) {
        const { commission, sellerAmount } = splitCommission(gross, bps);
        expect(commission.add(sellerAmount).equals(gross)).toBe(true);
      }
    });

    it('handles the boundary rates', () => {
      const gross = money('100000');
      const zero = splitCommission(gross, 0);
      expect(zero.commission.isZero()).toBe(true);
      expect(zero.sellerAmount.equals(gross)).toBe(true);

      const all = splitCommission(gross, 10000);
      expect(all.commission.equals(gross)).toBe(true);
      expect(all.sellerAmount.isZero()).toBe(true);
    });

    it('rejects out-of-range or fractional rates', () => {
      expect(() => splitCommission(money('1000'), -1)).toThrow(RangeError);
      expect(() => splitCommission(money('1000'), 10001)).toThrow(RangeError);
      expect(() => splitCommission(money('1000'), 12.5)).toThrow(RangeError);
    });

    it('rejects a fractional gross', () => {
      expect(() => splitCommission(money('1000.5'), 500)).toThrow(RangeError);
    });
  });

  describe('serialisation', () => {
    it('toJson renders whole đồng for API responses, never a JS number', () => {
      expect(toJson(money('95000'))).toBe('95000');
    });

    it('toNumericParam renders the exact wire format for ::numeric casts', () => {
      expect(toNumericParam(money('95000'))).toBe('95000.00');
    });
  });
});
