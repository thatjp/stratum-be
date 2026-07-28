import { describe, expect, it } from 'vitest';
import {
  MAX_EASE_FACTOR,
  MAX_INTERVAL_DAYS,
  MIN_EASE_FACTOR,
  applySm2,
  dueAtFromInterval,
  normalizeSm2State,
} from '../src/services/sm2';

describe('normalizeSm2State', () => {
  it('clamps out-of-range values from earlier unbounded writes', () => {
    expect(normalizeSm2State({ easeFactor: 9, intervalDays: 10_000 })).toEqual({
      easeFactor: MAX_EASE_FACTOR,
      intervalDays: MAX_INTERVAL_DAYS,
    });
    expect(normalizeSm2State({ easeFactor: 0.5, intervalDays: 0 })).toEqual({
      easeFactor: MIN_EASE_FACTOR,
      intervalDays: 1,
    });
  });
});

describe('applySm2', () => {
  it('grows the interval on a correct answer without exceeding the caps', () => {
    const next = applySm2({ easeFactor: 2.5, intervalDays: 1 }, 'correct');
    expect(next.intervalDays).toBe(3);
    expect(next.easeFactor).toBe(MAX_EASE_FACTOR);
  });

  it('resets the interval on an incorrect answer and lowers ease', () => {
    const next = applySm2({ easeFactor: 2.5, intervalDays: 30 }, 'incorrect');
    expect(next.intervalDays).toBe(1);
    expect(next.easeFactor).toBeCloseTo(2.3);
  });

  it('leaves scheduling unchanged for skipped', () => {
    const state = { easeFactor: 2.1, intervalDays: 14 };
    expect(applySm2(state, 'skipped')).toEqual(state);
  });

  it('never overflows Date range after a long correct streak', () => {
    let state = { easeFactor: 2.5, intervalDays: 1 };
    for (let i = 0; i < 40; i++) {
      state = applySm2(state, 'correct');
    }
    expect(state.intervalDays).toBeLessThanOrEqual(MAX_INTERVAL_DAYS);
    expect(state.easeFactor).toBeLessThanOrEqual(MAX_EASE_FACTOR);
    // Must not throw RangeError the way the unbounded version did.
    expect(() => dueAtFromInterval(state.intervalDays)).not.toThrow();
  });
});
