import { describe, it, expect } from 'vitest';
import { shouldReport } from './problems';

describe('shouldReport', () => {
  it('reports a problem once a day, not on every retry', () => {
    const seen = new Map<string, number>();
    expect(shouldReport('a', 0, seen)).toBe(true);
    expect(shouldReport('a', 60_000, seen)).toBe(false);
    expect(shouldReport('b', 60_000, seen)).toBe(true);
    expect(shouldReport('a', 24 * 60 * 60 * 1000 + 1, seen)).toBe(true);
  });
});
