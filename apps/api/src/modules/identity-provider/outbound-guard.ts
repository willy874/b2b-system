import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/** 解析主機名稱的方式（測試換成假的）。 */
export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

/**
 * api 不應該代替租戶管理員去連的位址：私有網段、loopback、link-local（含雲端的 metadata 端點
 * `169.254.169.254`）、CGNAT、保留位址。
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** 位址是否不可連（IPv4-mapped IPv6 以其 IPv4 判斷）。 */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return BLOCKED.check(mapped, 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return BLOCKED.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** 對外連線被擋下：呼叫端轉成 `AUTH_SSO_PROVIDER_UNAVAILABLE`。 */
export class BlockedDestinationError extends Error {
  constructor(readonly hostname: string) {
    super(`不允許連到 ${hostname}：解析到私有、loopback 或保留位址`);
  }
}

/**
 * 連線前檢查網址：主機名稱解析出的 **每一個** 位址都必須是公開位址。
 * 解析與實際連線之間仍有 DNS rebinding 的空窗；這一層擋的是「管理員直接填內網位址」。
 */
export async function assertPublicDestination(
  url: URL,
  resolve: HostLookup = systemLookup,
): Promise<void> {
  // URL 的 IPv6 hostname 帶中括號
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [hostname]
    : (await resolve(hostname)).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) {
    throw new BlockedDestinationError(hostname);
  }
}

/** 包一層 `fetch`：每個請求（discovery、token、userinfo、JWKS）送出前都先檢查目的地。 */
export function guardedFetch(
  resolve: HostLookup = systemLookup,
): (url: string, options: RequestInit) => Promise<Response> {
  return async (url, options) => {
    await assertPublicDestination(new URL(url), resolve);
    return fetch(url, options);
  };
}
