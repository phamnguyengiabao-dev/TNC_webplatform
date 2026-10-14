import { hideReasonFor, isInStock, isPurchasable, notSeenCutoff, purchaseStateFor } from './catalog.policy';

const NOW = new Date('2026-10-14T08:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

describe('hideReasonFor', () => {
  it('hides BANNED and DELETED immediately', () => {
    expect(hideReasonFor({ itemStatus: 'BANNED', lastSeenAt: NOW, stock: 5 }, NOW, 7)).toBe('BANNED');
    expect(hideReasonFor({ itemStatus: 'DELETED', lastSeenAt: NOW, stock: 5 }, NOW, 7)).toBe('DELETED');
  });

  it('keeps NORMAL and UNLIST visible', () => {
    expect(hideReasonFor({ itemStatus: 'NORMAL', lastSeenAt: daysAgo(400), stock: 1 }, NOW, 7)).toBeNull();
    expect(hideReasonFor({ itemStatus: 'UNLIST', lastSeenAt: NOW, stock: 0 }, NOW, 7)).toBeNull();
  });

  it('hides NOT_SEEN only once the window has elapsed', () => {
    expect(hideReasonFor({ itemStatus: 'NOT_SEEN', lastSeenAt: daysAgo(6), stock: null }, NOW, 7)).toBeNull();
    expect(hideReasonFor({ itemStatus: 'NOT_SEEN', lastSeenAt: daysAgo(8), stock: null }, NOW, 7)).toBe(
      'NOT_SEEN_EXPIRED',
    );
  });

  it('does not hide a product with no linked Shopee item', () => {
    expect(hideReasonFor(null, NOW, 7)).toBeNull();
  });
});

describe('notSeenCutoff', () => {
  it('is the oldest lastSeenAt still allowed', () => {
    expect(notSeenCutoff(NOW, 7).toISOString()).toBe('2026-10-07T08:00:00.000Z');
  });
});

describe('isInStock / isPurchasable', () => {
  it('treats unknown stock as in stock', () => {
    expect(isInStock({ stock: null })).toBe(true);
    expect(isInStock({ stock: 0 })).toBe(false);
  });

  it('cannot be purchased when the listing is paused or empty', () => {
    expect(isPurchasable({ itemStatus: 'NORMAL', lastSeenAt: NOW, stock: 3 })).toBe(true);
    expect(isPurchasable({ itemStatus: 'NORMAL', lastSeenAt: NOW, stock: 0 })).toBe(false);
    expect(isPurchasable({ itemStatus: 'UNLIST', lastSeenAt: NOW, stock: 3 })).toBe(false);
    expect(isPurchasable(null)).toBe(true);
  });
});

describe('purchaseStateFor', () => {
  it('maps each listing state onto a stable token', () => {
    expect(purchaseStateFor({ itemStatus: 'NORMAL', lastSeenAt: NOW, stock: 1 })).toBe('ON_SALE');
    expect(purchaseStateFor({ itemStatus: 'NORMAL', lastSeenAt: NOW, stock: 0 })).toBe('OUT_OF_STOCK');
    expect(purchaseStateFor({ itemStatus: 'UNLIST', lastSeenAt: NOW, stock: 1 })).toBe('PAUSED');
    expect(purchaseStateFor({ itemStatus: 'NOT_SEEN', lastSeenAt: NOW, stock: 1 })).toBe('PAUSED');
    expect(purchaseStateFor({ itemStatus: 'BANNED', lastSeenAt: NOW, stock: 1 })).toBe('UNAVAILABLE');
    expect(purchaseStateFor(null)).toBe('ON_SALE');
  });
});
