import { describe, expect, it } from 'vitest';

import { isTenantRedirectAllowed } from '../tenant-redirect';

/** 登記的網域：一個只登記 hostname、一個含 port。 */
const DOMAINS = new Map([
  ['acme.example.com', 'tenant-acme'],
  ['beta.example.com:8443', 'tenant-beta'],
]);

const directory = {
  tenantIdOfExactHost: (host: string) => DOMAINS.get(host),
  // 與 TenantDirectory 相同：找不到 host:port 時退回只比 hostname
  tenantIdOfHost: (host: string) => DOMAINS.get(host) ?? DOMAINS.get(host.split(':')[0] ?? ''),
};

const CALLBACK = '/auth/callback';

describe('isTenantRedirectAllowed（docs/issues/02-security.md SEC-17）', () => {
  it.each([
    ['https://acme.example.com/auth/callback', true],
    ['https://acme.example.com:443/auth/callback', true],
    ['https://beta.example.com:8443/auth/callback', true],
    // production 不接受明文 http
    ['http://acme.example.com/auth/callback', false],
    // 帶了 port 就要與登記的完全相符：同一台主機的其他 port 不算
    ['https://acme.example.com:8443/auth/callback', false],
    ['https://beta.example.com/auth/callback', false],
    ['https://evil.example.com/auth/callback', false],
    ['https://acme.example.com/auth/callback?x=1', false],
    ['https://acme.example.com/other', false],
  ])('production：%s → %s', (value, expected) => {
    expect(isTenantRedirectAllowed(value, CALLBACK, directory, true)).toBe(expected);
  });

  it.each([
    ['http://acme.example.com:5173/auth/callback', true],
    ['https://acme.example.com/auth/callback', true],
    ['ftp://acme.example.com/auth/callback', false],
    ['https://evil.example.com/auth/callback', false],
  ])('開發環境（只登記 hostname 也可以）：%s → %s', (value, expected) => {
    expect(isTenantRedirectAllowed(value, CALLBACK, directory, false)).toBe(expected);
  });
});
