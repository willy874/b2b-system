import type { LookupAddress } from 'node:dns';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertPublicDestination,
  BlockedDestinationError,
  isBlockedAddress,
  OutboundRequestError,
  pinnedFetch,
  pinnedLookup,
  sendOutboundRequest,
} from '../outbound';
import type { HostLookup } from '../outbound';

function resolvesTo(...addresses: string[]): HostLookup {
  return async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

describe('對外連線的位址檢查（docs/architecture/backend/17-webhook.md §9.2 D15）', () => {
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
    ['::ffff:7f00:1', true],
    ['8.8.8.8', false],
    ['140.112.8.116', false],
    ['2001:4860:4860::8888', false],
    ['::ffff:8.8.8.8', false],
  ])('%s 是否擋下 → %s', (address, blocked) => {
    expect(isBlockedAddress(address)).toBe(blocked);
  });

  it.each([
    ['NAT64 well-known（169.254.169.254）', '64:ff9b::a9fe:a9fe', true],
    ['NAT64 well-known 的點分寫法（10.0.0.5）', '64:ff9b::10.0.0.5', true],
    ['NAT64 local-use（整段擋）', '64:ff9b:1::a00:5', true],
    ['6to4（10.0.0.5）', '2002:a00:5::1', true],
    ['IPv4-compatible（127.0.0.1）', '::7f00:1', true],
    ['IPv4-translated（10.0.0.5）', '::ffff:0:a00:5', true],
    ['Teredo（用戶端 10.0.0.5）', '2001:0:4136:e378:8000:63bf:f5ff:fffa', true],
    ['已廢止的 site-local', 'fec0::1', true],
    ['NAT64 連公開 IPv4（8.8.8.8）', '64:ff9b::808:808', false],
    ['6to4 連公開 IPv4（8.8.8.8）', '2002:808:808::1', false],
  ])('內嵌 IPv4 的 IPv6：%s %s → %s', (_name, address, blocked) => {
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

  it('外部 IdP 的 fetch：主機名稱解析到私有位址時不建立連線（DNS rebinding 也一樣，連線時才解析）', async () => {
    const server = createServer((_req, res) => res.end('{}'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    let hits = 0;
    server.on('request', () => (hits += 1));
    try {
      const pinned = pinnedFetch(resolvesTo('127.0.0.1'));
      const error = await pinned(
        `http://idp.example.com:${port}/.well-known/openid-configuration`,
        {
          method: 'GET',
        },
      ).catch((caught: unknown) => caught);
      // undici 把 lookup 的錯誤包成 TypeError('fetch failed')，原因在 cause
      expect((error as Error).cause).toBeInstanceOf(BlockedDestinationError);
      expect(hits).toBe(0);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('外部 IdP 的 fetch：字面的私有 IP 直接擋下', async () => {
    const pinned = pinnedFetch(resolvesTo('93.184.216.34'));
    await expect(
      pinned('http://169.254.169.254/latest/meta-data', { method: 'GET' }),
    ).rejects.toBeInstanceOf(BlockedDestinationError);
  });
});

describe('連線時綁定已驗證的位址（docs/architecture/backend/17-webhook.md §9.2 D15）', () => {
  function lookupAll(
    resolve: HostLookup,
    hostname: string,
  ): Promise<{ error: Error | null; addresses: LookupAddress[] }> {
    return new Promise((done) => {
      pinnedLookup(resolve)(hostname, { all: true }, (error, addresses) => {
        done({ error, addresses: Array.isArray(addresses) ? addresses : [] });
      });
    });
  }

  it('交給 socket 的就是檢查過的那一次解析結果', async () => {
    const resolve = vi.fn(resolvesTo('93.184.216.34'));
    const result = await lookupAll(resolve, 'hooks.example.com');
    expect(result.error).toBeNull();
    expect(result.addresses).toEqual([{ address: '93.184.216.34', family: 4 }]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('解析到內網位址時回錯誤，不給任何位址', async () => {
    const result = await lookupAll(resolvesTo('93.184.216.34', '127.0.0.1'), 'rebind.example.com');
    expect(result.error).toBeInstanceOf(BlockedDestinationError);
    expect(result.addresses).toEqual([]);
  });
});

describe('sendOutboundRequest（代替租戶送出的請求）', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((done) => (server ? server.close(() => done()) : done()));
    server = undefined;
  });

  /** 起一個本機的接收端，回傳它的網址；`hostname` 給「以主機名稱連」的案例用（由假的 resolve 解析）。 */
  async function listen(
    handler: Parameters<typeof createServer>[1],
    hostname = '127.0.0.1',
  ): Promise<URL> {
    server = createServer(handler);
    await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    return new URL(`http://${hostname}:${port}/hook`);
  }

  const base = {
    method: 'POST' as const,
    headers: { 'Content-Type': 'application/json' },
    body: '{"ok":true}',
    timeoutMs: 2000,
    maxResponseBytes: 16,
  };

  it('不擋內網時照常送出，回應只留開頭', async () => {
    const received: string[] = [];
    const url = await listen((req, res) => {
      req.on('data', (chunk: Buffer) => received.push(chunk.toString()));
      req.on('end', () => res.writeHead(202).end('x'.repeat(100)));
    });
    const response = await sendOutboundRequest({ ...base, url, blockPrivateNetworks: false });
    expect(received.join('')).toBe('{"ok":true}');
    expect(response.status).toBe(202);
    expect(response.body).toBe('x'.repeat(16));
  });

  it('擋內網時，解析到 loopback 的主機名稱不會建立連線', async () => {
    const handler = vi.fn((_req, res) => res.end());
    const url = await listen(handler, 'receiver.example.com');
    await expect(
      sendOutboundRequest({
        ...base,
        url,
        blockPrivateNetworks: true,
        resolve: resolvesTo('127.0.0.1'),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('擋內網時，解析到內嵌內網 IPv4 的 NAT64 位址也不會建立連線', async () => {
    const handler = vi.fn((_req, res) => res.end());
    const url = await listen(handler, 'nat64.example.com');
    await expect(
      sendOutboundRequest({
        ...base,
        url,
        blockPrivateNetworks: true,
        resolve: resolvesTo('64:ff9b::7f00:1'),
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('擋內網時，字面 IP 的內網位址直接拒絕', async () => {
    await expect(
      sendOutboundRequest({
        ...base,
        url: new URL('http://127.0.0.1:1/hook'),
        blockPrivateNetworks: true,
      }),
    ).rejects.toBeInstanceOf(OutboundRequestError);
    await expect(
      sendOutboundRequest({
        ...base,
        url: new URL('https://[64:ff9b::a00:5]/'),
        blockPrivateNetworks: true,
      }),
    ).rejects.toMatchObject({ code: 'BLOCKED' });
  });

  it('超過逾時回 TIMEOUT', async () => {
    const url = await listen(() => {
      // 不回應
    });
    await expect(
      sendOutboundRequest({
        ...base,
        url,
        timeoutMs: 100,
        blockPrivateNetworks: false,
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('不跟隨轉址：3xx 原樣回傳', async () => {
    const url = await listen((_req, res) =>
      res.writeHead(302, { Location: 'http://169.254.169.254/' }).end(),
    );
    const response = await sendOutboundRequest({ ...base, url, blockPrivateNetworks: false });
    expect(response.status).toBe(302);
  });
});
