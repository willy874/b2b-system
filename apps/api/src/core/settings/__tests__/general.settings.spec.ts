import { describe, expect, it } from 'vitest';

import type { Env } from '../../config/env.schema';
import { DEFAULT_TIMEZONE_SETTING, isTimeZone, TimeZoneSchema } from '../general.settings';
import { resolveSetting } from '../setting-definition';

const noEnv = <K extends keyof Env>(_key: K): Env[K] => undefined as Env[K];

describe('isTimeZone', () => {
  it.each(['Asia/Taipei', 'UTC', 'America/New_York', 'Europe/London'])(
    'IANA 時區 %s → true',
    (value) => {
      expect(isTimeZone(value)).toBe(true);
    },
  );

  it.each(['Mars/Olympus', 'Taipei', 'not a zone', '+25:00'])('不認得的值 %s → false', (value) => {
    expect(isTimeZone(value)).toBe(false);
  });
});

describe('DEFAULT_TIMEZONE_SETTING（docs/architecture/backend/19-announcement.md §9.2 D11）', () => {
  const resolved = resolveSetting(DEFAULT_TIMEZONE_SETTING, noEnv);

  it('key、分類與公開：登入前的頁面也讀得到', () => {
    expect(resolved).toMatchObject({
      key: 'general.defaultTimezone',
      category: 'general',
      isPublic: true,
      defaultValue: 'Asia/Taipei',
    });
  });

  it('合法的時區：前後空白被去掉', () => {
    expect(resolved.schema.safeParse('  UTC ')).toEqual({ success: true, data: 'UTC' });
  });

  it.each([
    ['空字串', ''],
    ['只有空白', '   '],
    ['不認得的時區', 'Mars/Olympus'],
    ['超過 64 字', `Asia/${'x'.repeat(64)}`],
    ['不是字串', 8],
  ])('拒絕：%s', (_name, value) => {
    expect(resolved.schema.safeParse(value).success).toBe(false);
  });
});

describe('TimeZoneSchema（使用者的時區偏好與租戶的預設時區共用）', () => {
  it('合法的時區通過', () => {
    expect(TimeZoneSchema.parse('Asia/Tokyo')).toBe('Asia/Tokyo');
  });

  it('不認得的時區被拒絕：之後的日期計算會拋 RangeError', () => {
    expect(TimeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
});
