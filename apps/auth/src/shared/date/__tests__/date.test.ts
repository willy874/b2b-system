import { afterEach, describe, expect, it } from 'vitest';

import { formatDateTime, isValidTimeZone, setDateTimeDefaults, zonedDayBoundary } from '../index';

const INSTANT = '2026-09-30T16:30:00.000Z';

afterEach(() => {
  setDateTimeDefaults({ locale: 'zh-TW', timeZone: 'Asia/Taipei' });
});

describe('formatDateTime 跟著偏好的時區與語言', () => {
  it('預設是台北時間、繁中格式', () => {
    expect(formatDateTime(INSTANT)).toContain('10月1日');
  });

  it('偏好時區改成 UTC 後位移 8 小時', () => {
    setDateTimeDefaults({ timeZone: 'UTC' });
    const text = formatDateTime(INSTANT);
    expect(text).toContain('9月30日');
    expect(text).toMatch(/4:30|16:30/);
  });

  it('語言切成英文後是英文格式', () => {
    setDateTimeDefaults({ locale: 'en-US' });
    expect(formatDateTime(INSTANT)).toMatch(/Oct 1, 2026/);
  });

  it('明確傳入的 options 優先於偏好', () => {
    setDateTimeDefaults({ timeZone: 'UTC' });
    expect(formatDateTime(INSTANT, { timeZone: 'Asia/Taipei' })).toContain('10月1日');
  });
});

describe('不合法的時區不會讓畫面壞掉', () => {
  it('isValidTimeZone', () => {
    expect(isValidTimeZone('Asia/Taipei')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('偏好是不合法的時區時忽略，維持原本的時區', () => {
    setDateTimeDefaults({ timeZone: 'Mars/Olympus' });
    expect(formatDateTime(INSTANT)).toContain('10月1日');
  });

  it('明確傳入不合法的時區時退回預設，不丟 RangeError', () => {
    expect(() => formatDateTime(INSTANT, { timeZone: 'Mars/Olympus' })).not.toThrow();
  });
});

describe('zonedDayBoundary（稽核篩選的日界線）', () => {
  it('台北的一天是前一天 16:00Z 到當天 15:59:59.999Z', () => {
    expect(zonedDayBoundary('2026-10-01', 'start', 'Asia/Taipei')).toBe('2026-09-30T16:00:00.000Z');
    expect(zonedDayBoundary('2026-10-01', 'end', 'Asia/Taipei')).toBe('2026-10-01T15:59:59.999Z');
  });

  it('UTC 的一天就是 UTC 日界線', () => {
    expect(zonedDayBoundary('2026-10-01', 'start', 'UTC')).toBe('2026-10-01T00:00:00.000Z');
    expect(zonedDayBoundary('2026-10-01', 'end', 'UTC')).toBe('2026-10-01T23:59:59.999Z');
  });

  it('夏令時間切換日也正確（紐約 2026-03-08 只有 23 小時）', () => {
    expect(zonedDayBoundary('2026-03-08', 'start', 'America/New_York')).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(zonedDayBoundary('2026-03-08', 'end', 'America/New_York')).toBe(
      '2026-03-09T03:59:59.999Z',
    );
  });

  it('沒傳時區時用偏好的時區', () => {
    setDateTimeDefaults({ timeZone: 'UTC' });
    expect(zonedDayBoundary('2026-10-01', 'start')).toBe('2026-10-01T00:00:00.000Z');
  });
});
