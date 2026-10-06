import { afterEach, describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatRelativeTime,
  isValidTimeZone,
  setDateTimeDefaults,
  supportedTimeZones,
  todayInZone,
  toZonedParts,
  zonedDateTime,
  zonedDayBoundary,
} from '../index';

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

describe('formatRelativeTime（通知的相對時間）', () => {
  const now = Date.parse(INSTANT);
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('一分鐘內是「現在」', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('現在');
  });

  it('取最大且至少一個單位的時間單位', () => {
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 分鐘前');
    expect(formatRelativeTime(ago(3 * 60 * 60_000), now)).toBe('3 小時前');
    expect(formatRelativeTime(ago(24 * 60 * 60_000), now)).toBe('昨天');
  });

  it('跟著偏好的語言', () => {
    setDateTimeDefaults({ locale: 'en-US' });
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 minutes ago');
  });

  it('不合法的值顯示 -', () => {
    expect(formatRelativeTime('not a date', now)).toBe('-');
    expect(formatRelativeTime(null, now)).toBe('-');
  });
});

describe('zonedDateTime / toZonedParts（公告排程的日期與時間）', () => {
  it('偏好時區的日期與時間 → 那一刻（ISO）', () => {
    expect(zonedDateTime('2026-10-10', '18:00', 'Asia/Taipei')).toBe('2026-10-10T10:00:00.000Z');
    expect(zonedDateTime('2026-10-10', '18:00', 'UTC')).toBe('2026-10-10T18:00:00.000Z');
  });

  it('夏令時間：紐約 7 月是 UTC-4、1 月是 UTC-5', () => {
    expect(zonedDateTime('2026-07-01', '09:00', 'America/New_York')).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(zonedDateTime('2026-01-15', '09:00', 'America/New_York')).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('夏令時間開始：不存在的 02:30 順延成 03:30；重複的 01:30 取較早的一次', () => {
    expect(zonedDateTime('2026-03-08', '02:30', 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(zonedDateTime('2026-11-01', '01:30', 'America/New_York')).toBe(
      '2026-11-01T05:30:00.000Z',
    );
  });

  it('午夜就切換的時區：當天的日界線落在 01:00', () => {
    // 聖地牙哥 2026-09-06 00:00 跳到 01:00
    expect(zonedDayBoundary('2026-09-06', 'start', 'America/Santiago')).toBe(
      '2026-09-06T04:00:00.000Z',
    );
  });

  it('格式不對 → undefined', () => {
    expect(zonedDateTime('2026/10/10', '18:00')).toBeUndefined();
    expect(zonedDateTime('2026-10-10', '6pm')).toBeUndefined();
  });

  it('反向：某一刻在偏好時區的日期與時間；可以來回轉換', () => {
    expect(toZonedParts('2026-10-10T10:00:00.000Z', 'Asia/Taipei')).toEqual({
      day: '2026-10-10',
      time: '18:00',
    });
    const parts = toZonedParts('2026-03-08T07:30:00.000Z', 'America/New_York')!;
    expect(zonedDateTime(parts.day, parts.time, 'America/New_York')).toBe(
      '2026-03-08T07:30:00.000Z',
    );
    expect(toZonedParts('not a date')).toBeUndefined();
  });
});

describe('todayInZone（偏好時區的「今天」）', () => {
  // 2026-10-06T23:30:00Z：台北已經是 10/07，洛杉磯還是 10/06
  const now = new Date('2026-10-06T23:30:00.000Z');

  it('跨日：同一刻在不同時區是不同的日期', () => {
    expect(todayInZone('Asia/Taipei', now)).toBe('2026-10-07');
    expect(todayInZone('America/Los_Angeles', now)).toBe('2026-10-06');
    expect(todayInZone('UTC', now)).toBe('2026-10-06');
  });

  it('沒有傳時區時用偏好的時區（setDateTimeDefaults）', () => {
    setDateTimeDefaults({ timeZone: 'America/Los_Angeles' });
    expect(todayInZone(undefined, now)).toBe('2026-10-06');
  });
});

describe('supportedTimeZones（偏好頁與系統設定的時區下拉）', () => {
  it('完整的 IANA 清單，另外包含 UTC', () => {
    const zones = supportedTimeZones();
    expect(zones).toEqual(expect.arrayContaining(['UTC', 'Asia/Taipei', 'Europe/Berlin']));
    expect(zones.length).toBeGreaterThan(100);
  });

  it('目前的值不在清單裡時也放進去，且不重複', () => {
    expect(supportedTimeZones('Etc/Unknown-Zone')).toContain('Etc/Unknown-Zone');
    const zones = supportedTimeZones('Asia/Taipei');
    expect(zones.filter((zone) => zone === 'Asia/Taipei')).toHaveLength(1);
  });
});
