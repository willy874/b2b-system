import { describe, expect, it } from 'vitest';

import { accountOf, rateLimitBucketsOf, rateLimitSettingsOf } from '../rate-limit';

const ENV = {
  DEFAULT_RATE_LIMIT: 600,
  ANONYMOUS_RATE_LIMIT: 3000,
  AUTH_RATE_LIMIT: 10,
  AUTH_IP_RATE_LIMIT: 300,
  REFRESH_RATE_LIMIT: 30,
  REFRESH_IP_RATE_LIMIT: 2000,
};

describe('rateLimitSettingsOf', () => {
  it('預設值：寄信類是登入類的 1/3（帳號）與 1/10（IP）', () => {
    expect(rateLimitSettingsOf(ENV)).toEqual({
      user: 600,
      anonymous: 3000,
      authAccount: 10,
      authIp: 300,
      authMailAccount: 3,
      authMailIp: 30,
      refreshSession: 30,
      refreshIp: 2000,
    });
  });

  it('IP 桶不會比帳號桶嚴格（E2E 把 AUTH_RATE_LIMIT 調高時 IP 桶跟著放寬）', () => {
    const settings = rateLimitSettingsOf({
      ...ENV,
      AUTH_RATE_LIMIT: 1000,
      REFRESH_RATE_LIMIT: 5000,
    });
    expect(settings.authIp).toBe(1000);
    expect(settings.authMailAccount).toBe(333);
    expect(settings.authMailIp).toBe(333);
    expect(settings.refreshIp).toBe(5000);
  });
});

describe('rateLimitBucketsOf', () => {
  const settings = rateLimitSettingsOf(ENV);

  it('一般端點：有身分用使用者桶，沒有用 IP 桶', () => {
    expect(rateLimitBucketsOf(undefined, { ip: '1.1.1.1', principal: 't:a:u' }, settings)).toEqual([
      { name: 'user', key: 't:a:u', limit: 600 },
    ]);
    expect(rateLimitBucketsOf(undefined, { ip: '1.1.1.1' }, settings)).toEqual([
      { name: 'anonymous', key: '1.1.1.1', limit: 3000 },
    ]);
  });

  it('登入類：IP 桶 ＋「帳號｜IP」桶；沒有帳號時只有 IP 桶', () => {
    expect(rateLimitBucketsOf('auth', { ip: '1.1.1.1', account: 't:a@x' }, settings)).toEqual([
      { name: 'auth-ip', key: '1.1.1.1', limit: 300 },
      { name: 'auth-account', key: 't:a@x|1.1.1.1', limit: 10 },
    ]);
    expect(rateLimitBucketsOf('authMail', { ip: '1.1.1.1' }, settings)).toEqual([
      { name: 'authMail-ip', key: '1.1.1.1', limit: 30 },
    ]);
  });

  it('續期：IP 桶 ＋ session 桶', () => {
    expect(rateLimitBucketsOf('refresh', { ip: '1.1.1.1', session: 'h' }, settings)).toEqual([
      { name: 'refresh-ip', key: '1.1.1.1', limit: 2000 },
      { name: 'refresh-session', key: 'h', limit: 30 },
    ]);
  });
});

describe('accountOf', () => {
  it('email 去空白、轉小寫，帶範圍', () => {
    expect(accountOf({ email: ' Alice@Example.COM ' }, 'tenant-1')).toBe(
      'tenant-1:alice@example.com',
    );
  });

  it.each([
    [undefined],
    ['x'],
    [{}],
    [{ email: 3 }],
    [{ email: '   ' }],
    [{ email: 'a'.repeat(256) }],
  ])('取不到 email（%j）時回 undefined', (body) => {
    expect(accountOf(body, 'platform')).toBeUndefined();
  });
});
