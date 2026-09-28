import { describe, it, expect } from 'vitest';
import { easternClock, isSweepDue, schedulerEnabled } from './scheduler';

describe('easternClock', () => {
  it('reads New York time in summer (EDT, UTC-4)', () => {
    // 13:30 UTC = 09:30 EDT
    expect(easternClock(new Date('2026-09-28T13:30:00Z'))).toEqual({ day: '2026-09-28', hour: 9 });
  });

  it('reads New York time in winter (EST, UTC-5)', () => {
    // 13:30 UTC = 08:30 EST
    expect(easternClock(new Date('2026-12-01T13:30:00Z'))).toEqual({ day: '2026-12-01', hour: 8 });
  });

  it('stays on the previous day late in the evening ET', () => {
    // 02:00 UTC Sep 29 = 22:00 EDT Sep 28
    expect(easternClock(new Date('2026-09-29T02:00:00Z'))).toEqual({ day: '2026-09-28', hour: 22 });
  });
});

describe('isSweepDue', () => {
  const nineThirtyET = new Date('2026-09-28T13:30:00Z');
  const sevenAmET = new Date('2026-09-28T11:00:00Z');

  it('runs once the run hour has arrived and today has not run', () => {
    expect(isSweepDue(nineThirtyET, null)).toBe(true);
  });

  it('does not run before the run hour', () => {
    expect(isSweepDue(sevenAmET, null)).toBe(false);
  });

  it('does not run twice on the same day', () => {
    expect(isSweepDue(nineThirtyET, '2026-09-28')).toBe(false);
  });

  it('runs again the next day', () => {
    expect(isSweepDue(new Date('2026-09-29T13:30:00Z'), '2026-09-28')).toBe(true);
  });
});

describe('schedulerEnabled', () => {
  it('is off in local dev', () => {
    expect(schedulerEnabled({})).toBe(false);
  });

  it('is on in production', () => {
    expect(schedulerEnabled({ NODE_ENV: 'production' })).toBe(true);
  });

  it('is on when running on Railway', () => {
    expect(schedulerEnabled({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true);
  });

  it('SCHEDULER=off wins over production', () => {
    expect(schedulerEnabled({ NODE_ENV: 'production', SCHEDULER: 'off' })).toBe(false);
  });

  it('SCHEDULER=on turns it on locally', () => {
    expect(schedulerEnabled({ SCHEDULER: 'on' })).toBe(true);
  });
});
