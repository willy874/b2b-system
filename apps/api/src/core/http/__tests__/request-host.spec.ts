import { describe, expect, it } from 'vitest';

import { hostnameOf, requestHost } from '../request-host';

const trustAll = () => true;
const trustNone = () => false;

describe('requestHost（docs/adr/0020-physical-tenant-isolation.md D2）', () => {
  it('不信任代理時只看 Host（X-Forwarded-Host 不能用來換租戶）', () => {
    expect(
      requestHost(
        { host: 'acme.test:5173', 'x-forwarded-host': 'evil.test' },
        '10.0.0.1',
        trustNone,
      ),
    ).toBe('acme.test:5173');
  });

  it('上一跳是受信任的代理時讀 X-Forwarded-Host 的第一個值', () => {
    expect(
      requestHost(
        { host: 'api:3000', 'x-forwarded-host': 'Acme.Test, proxy.internal' },
        '10.0.0.1',
        trustAll,
      ),
    ).toBe('acme.test');
  });

  it('沒有 Host 時回 undefined', () => {
    expect(requestHost({}, '10.0.0.1', trustNone)).toBeUndefined();
  });
});

describe('hostnameOf', () => {
  it.each([
    ['localhost:5173', 'localhost'],
    ['acme.example.com', 'acme.example.com'],
    ['[::1]:5173', '[::1]'],
    ['[::1]', '[::1]'],
  ])('%s → %s', (host, expected) => {
    expect(hostnameOf(host)).toBe(expected);
  });
});
