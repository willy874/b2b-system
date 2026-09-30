import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPublicDestination,
  BlockedDestinationError,
  guardedFetch,
  isBlockedAddress,
} from '../outbound-guard';
import type { HostLookup } from '../outbound-guard';

function resolvesTo(...addresses: string[]): HostLookup {
  return async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

describe('外部 IdP 的對外連線檢查（docs/issues/02-security.md SEC-11）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ['10.0.0.5', true],
    ['127.0.0.1', true],
    ['169.254.169.254', true],
    ['172.20.1.1', true],
    ['192.168.1.10', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:127.0.0.1', true],
    ['8.8.8.8', false],
    ['140.112.8.116', false],
    ['2001:4860:4860::8888', false],
  ])('%s 是否擋下 → %s', (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });

  it('主機名稱解析到內網位址時擋下（任何一個位址是內網就擋）', async () => {
    await expect(
      assertPublicDestination(
        new URL('https://internal-admin.corp/.well-known/openid-configuration'),
        resolvesTo('93.184.216.34', '10.1.2.3'),
      ),
    ).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('網址直接寫 IP（含 IPv6）時不查 DNS 就判斷', async () => {
    const resolve = vi.fn(resolvesTo('8.8.8.8'));
    await expect(
      assertPublicDestination(new URL('https://10.0.0.5/'), resolve),
    ).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(assertPublicDestination(new URL('https://[::1]/'), resolve)).rejects.toThrow();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('公開位址放行', async () => {
    await expect(
      assertPublicDestination(new URL('https://login.example.com/'), resolvesTo('93.184.216.34')),
    ).resolves.toBeUndefined();
  });

  it('被擋下的請求不會送出', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const guarded = guardedFetch(resolvesTo('169.254.169.254'));
    await expect(
      guarded('https://metadata.example.com/latest', { method: 'GET' }),
    ).rejects.toBeInstanceOf(BlockedDestinationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('通過檢查的請求照常送出', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchSpy);
    const guarded = guardedFetch(resolvesTo('93.184.216.34'));
    await guarded('https://login.example.com/token', { method: 'POST' });
    expect(fetchSpy).toHaveBeenCalledWith('https://login.example.com/token', { method: 'POST' });
  });
});
