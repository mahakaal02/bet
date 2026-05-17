import Decimal from 'decimal.js';
import {
  classifyBidFor,
  classifyCandidate,
  classifyPlacedAmount,
  selectWinner,
  selectWinnerFromBids,
} from './bidding-engine';

const d = (s: string | number) => new Decimal(s);
const bidRow = (id: string, userId: string, amount: string, ms: number) => ({
  id,
  userId,
  amount: d(amount),
  createdAt: new Date(ms),
});

describe('classifyCandidate', () => {
  describe('LOWEST_UNIQUE', () => {
    it('returns LOWEST_UNIQUE when candidate is the only bid', () => {
      expect(classifyCandidate(d('1.00'), [])).toBe('LOWEST_UNIQUE');
    });

    it('returns LOWEST_UNIQUE when candidate is the lowest unique bid', () => {
      const others = [d('0.73'), d('0.73'), d('1.12'), d('3.34')];
      expect(classifyCandidate(d('0.50'), others)).toBe('LOWEST_UNIQUE');
    });

    it('returns LOWEST_UNIQUE for the spec example (A=0.73, B=0.73, C=1.12, D=3.34) viewed from C', () => {
      const others = [d('0.73'), d('0.73'), d('3.34')];
      expect(classifyCandidate(d('1.12'), others)).toBe('LOWEST_UNIQUE');
    });
  });

  describe('DUPLICATE_COLLIDING', () => {
    it('returns DUPLICATE_COLLIDING when candidate matches an existing bid at the minimum', () => {
      const others = [d('0.73'), d('1.12'), d('3.34')];
      expect(classifyCandidate(d('0.73'), others)).toBe('DUPLICATE_COLLIDING');
    });

    it('returns DUPLICATE_COLLIDING when candidate ties on the (duplicated) minimum', () => {
      const others = [d('0.73'), d('0.73'), d('1.12')];
      expect(classifyCandidate(d('0.73'), others)).toBe('DUPLICATE_COLLIDING');
    });

    it('returns DUPLICATE_COLLIDING for a duplicated non-minimum amount', () => {
      const others = [d('0.50'), d('1.00'), d('1.00')];
      expect(classifyCandidate(d('1.00'), others)).toBe('DUPLICATE_COLLIDING');
    });
  });

  describe('UNIQUE_LOSING', () => {
    it('returns UNIQUE_LOSING for a unique amount that is not the lowest unique', () => {
      const others = [d('0.50'), d('1.00')];
      expect(classifyCandidate(d('2.00'), others)).toBe('UNIQUE_LOSING');
    });

    it('returns UNIQUE_LOSING for zero', () => {
      expect(classifyCandidate(d('0'), [d('1.00')])).toBe('UNIQUE_LOSING');
    });

    it('returns UNIQUE_LOSING for negative', () => {
      expect(classifyCandidate(d('-1.00'), [d('1.00')])).toBe('UNIQUE_LOSING');
    });
  });

  describe('decimal precision', () => {
    it('treats 0.50 and 0.5 as the same amount (collides)', () => {
      const others = [new Decimal('0.5')];
      expect(classifyCandidate(new Decimal('0.50'), others)).toBe('DUPLICATE_COLLIDING');
    });

    it('does not suffer from floating-point error on 0.1 + 0.2', () => {
      const others = [new Decimal('0.1').plus(new Decimal('0.2'))];
      expect(classifyCandidate(new Decimal('0.30'), others)).toBe('DUPLICATE_COLLIDING');
    });
  });
});

describe('classifyPlacedAmount', () => {
  it('returns LOWEST_UNIQUE when the placed bid is the lowest unique', () => {
    const all = [d('0.30'), d('0.50'), d('0.50')];
    expect(classifyPlacedAmount(d('0.30'), all)).toBe('LOWEST_UNIQUE');
  });

  it('returns DUPLICATE_COLLIDING when the placed bid is the overall min but tied', () => {
    const all = [d('0.50'), d('0.50'), d('1.00')];
    expect(classifyPlacedAmount(d('0.50'), all)).toBe('DUPLICATE_COLLIDING');
  });

  it('returns UNIQUE_LOSING when placed bid is unique but not the lowest unique', () => {
    const all = [d('0.30'), d('1.00')];
    expect(classifyPlacedAmount(d('1.00'), all)).toBe('UNIQUE_LOSING');
  });

  it('returns DUPLICATE_COLLIDING when placed bid duplicates a non-minimum amount', () => {
    const all = [d('0.30'), d('1.00'), d('1.00')];
    expect(classifyPlacedAmount(d('1.00'), all)).toBe('DUPLICATE_COLLIDING');
  });

  it('returns LOWEST_UNIQUE for a single placed bid', () => {
    expect(classifyPlacedAmount(d('0.50'), [d('0.50')])).toBe('LOWEST_UNIQUE');
  });

  it('returns NO_BID when given an empty pool', () => {
    expect(classifyPlacedAmount(d('0.50'), [])).toBe('NO_BID');
  });
});

describe('classifyPlacedAmount (FIXED_WINNER)', () => {
  it('LOWEST_UNIQUE when amount matches fixed and is unique', () => {
    const all = [d('0.10'), d('5.00'), d('7.42')];
    expect(
      classifyPlacedAmount(d('7.42'), all, { fixedWinningAmount: d('7.42') }),
    ).toBe('LOWEST_UNIQUE');
  });

  it('UNIQUE_LOSING when amount is unique but doesn’t match the fixed amount', () => {
    const all = [d('0.10'), d('5.00'), d('7.42')];
    expect(
      classifyPlacedAmount(d('0.10'), all, { fixedWinningAmount: d('7.42') }),
    ).toBe('UNIQUE_LOSING');
  });

  it('DUPLICATE_COLLIDING when amount matches fixed but is tied (amount-only mode)', () => {
    const all = [d('7.42'), d('7.42'), d('5.00')];
    expect(
      classifyPlacedAmount(d('7.42'), all, { fixedWinningAmount: d('7.42') }),
    ).toBe('DUPLICATE_COLLIDING');
  });
});

describe('classifyBidFor (FIXED_WINNER with timestamps)', () => {
  it('first bidder at fixed wins; later ties collide', () => {
    const bids = [
      bidRow('a', 'A', '7.42', 100),
      bidRow('b', 'B', '7.42', 200),
      bidRow('c', 'C', '5.00', 300),
    ];
    const opts = { fixedWinningAmount: d('7.42') };
    expect(classifyBidFor('a', bids, opts)).toBe('LOWEST_UNIQUE');
    expect(classifyBidFor('b', bids, opts)).toBe('DUPLICATE_COLLIDING');
    expect(classifyBidFor('c', bids, opts)).toBe('UNIQUE_LOSING');
  });

  it('demotes a natural lowest-unique to UNIQUE_LOSING when admin fixes a different winner', () => {
    const bids = [
      bidRow('a', 'A', '7.42', 100),
      bidRow('b', 'B', '0.10', 200), // would naturally be LOWEST_UNIQUE
      bidRow('c', 'C', '5.00', 300),
    ];
    expect(classifyBidFor('b', bids, { fixedWinningAmount: d('7.42') })).toBe('UNIQUE_LOSING');
  });
});

describe('selectWinner', () => {
  it('returns null on empty input', () => {
    expect(selectWinner([])).toBeNull();
  });

  it('returns null when no bid is unique', () => {
    const bids = [
      { userId: 'u1', amount: d('1.00') },
      { userId: 'u2', amount: d('1.00') },
      { userId: 'u3', amount: d('2.00') },
      { userId: 'u4', amount: d('2.00') },
    ];
    expect(selectWinner(bids)).toBeNull();
  });

  it('picks the user with the lowest unique bid (spec example)', () => {
    const bids = [
      { userId: 'A', amount: d('0.73') },
      { userId: 'B', amount: d('0.73') },
      { userId: 'C', amount: d('1.12') },
      { userId: 'D', amount: d('3.34') },
    ];
    const w = selectWinner(bids);
    expect(w?.userId).toBe('C');
    expect(w?.amount.toFixed(2)).toBe('1.12');
  });

  it('skips duplicated minima and finds the next unique', () => {
    const bids = [
      { userId: 'A', amount: d('0.50') },
      { userId: 'B', amount: d('0.50') },
      { userId: 'C', amount: d('0.50') },
      { userId: 'D', amount: d('0.75') },
      { userId: 'E', amount: d('1.00') },
      { userId: 'F', amount: d('1.00') },
    ];
    const w = selectWinner(bids);
    expect(w?.userId).toBe('D');
    expect(w?.amount.toFixed(2)).toBe('0.75');
  });

  it('handles a single bid', () => {
    const bids = [{ userId: 'A', amount: d('0.01') }];
    expect(selectWinner(bids)?.userId).toBe('A');
  });

  it('treats 1.5 and 1.50 as the same amount', () => {
    const bids = [
      { userId: 'A', amount: new Decimal('1.5') },
      { userId: 'B', amount: new Decimal('1.50') },
      { userId: 'C', amount: new Decimal('2.00') },
    ];
    expect(selectWinner(bids)?.userId).toBe('C');
  });
});

describe('selectWinnerFromBids (FIXED_WINNER)', () => {
  it('picks the earliest bidder at the fixed amount', () => {
    const bids = [
      bidRow('a', 'A', '7.42', 100),
      bidRow('b', 'B', '7.42', 200),
      bidRow('c', 'C', '0.10', 300),
    ];
    const w = selectWinnerFromBids(bids, { fixedWinningAmount: d('7.42') });
    expect(w?.userId).toBe('A');
  });

  it('returns null if nobody hit the fixed amount', () => {
    const bids = [
      bidRow('a', 'A', '5.00', 100),
      bidRow('b', 'B', '6.00', 200),
    ];
    expect(selectWinnerFromBids(bids, { fixedWinningAmount: d('7.42') })).toBeNull();
  });

  it('falls back to lowest-unique under NORMAL mode', () => {
    const bids = [
      bidRow('a', 'A', '0.73', 100),
      bidRow('b', 'B', '0.73', 200),
      bidRow('c', 'C', '1.12', 300),
    ];
    const w = selectWinnerFromBids(bids);
    expect(w?.userId).toBe('C');
  });
});
