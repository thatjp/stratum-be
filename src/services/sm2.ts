// SM-2 spaced repetition scheduling. Pure so it can be unit-tested without a
// database. Bounds prevent the interval from overflowing INT / Date range
// after a long streak of correct answers.

export const MIN_EASE_FACTOR   = 1.3;
export const MAX_EASE_FACTOR   = 2.5;
export const MAX_INTERVAL_DAYS = 365;

export type RecallResult = 'correct' | 'incorrect' | 'skipped';

export interface Sm2State {
  easeFactor: number;
  intervalDays: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSm2State(state: Sm2State): Sm2State {
  return {
    easeFactor:   clamp(state.easeFactor, MIN_EASE_FACTOR, MAX_EASE_FACTOR),
    intervalDays: clamp(state.intervalDays, 1, MAX_INTERVAL_DAYS),
  };
}

export function applySm2(state: Sm2State, result: RecallResult): Sm2State {
  let { easeFactor, intervalDays } = normalizeSm2State(state);

  if (result === 'correct') {
    intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalDays * easeFactor));
    easeFactor   = Math.min(MAX_EASE_FACTOR, easeFactor + 0.1);
  } else if (result === 'incorrect') {
    intervalDays = 1;
    easeFactor   = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2);
  }
  // skipped: no scheduling change

  return { easeFactor, intervalDays };
}

export function dueAtFromInterval(intervalDays: number, nowMs = Date.now()): string {
  return new Date(nowMs + intervalDays * 86_400_000).toISOString();
}
