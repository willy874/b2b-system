import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

import { Agent, fetch as undiciFetch } from 'undici';
import type { RequestInit as UndiciRequestInit } from 'undici';

/** 解析主機名稱的方式（測試換成假的）。 */
export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

/**
 * api 不應該代替租戶去連的位址：私有網段、loopback、link-local（含雲端的 metadata 端點
 * `169.254.169.254`）、CGNAT、保留位址。IPv6 另擋 ULA、link-local、multicast、已廢止的 site-local，
 * 以及 NAT64 的 local-use 前綴（內嵌 IPv4 的位置依各網路的設定而定，取不出來，整段擋下）。
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
  ['64:ff9b:1::', 48],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, 'ipv6');
}

function hexGroups(part: string): number[] {
  return part === '' ? [] : part.split(':').map((group) => Number.parseInt(group, 16));
}

/** 合法 IPv6 位址的 8 個 16 位元群組（呼叫前已以 `isIP` 確認格式）；結尾的點分 IPv4 換成兩個群組。 */
function ipv6Groups(address: string): number[] {
  const [text = ''] = address.split('%');
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  const [a = 0, b = 0, c = 0, d = 0] = dotted?.[2]?.split('.').map(Number) ?? [];
  const hex = dotted
    ? `${dotted[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
    : text;
  const [head = '', tail] = hex.split('::');
  if (tail === undefined) return hexGroups(head);
  const before = hexGroups(head);
  const after = hexGroups(tail);
  const zeros = Array.from({ length: 8 - before.length - after.length }, () => 0);
  return [...before, ...zeros, ...after];
}

function ipv4Of(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * IPv6 位址裡內嵌的 IPv4（RFC 6052、3056、4380）：送到這些位址的流量在路上會被轉成 IPv4，
 * 所以要用 IPv4 的清單判斷。沒有內嵌 IPv4 回 `undefined`。
 */
function embeddedIpv4(address: string): string | undefined {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = ipv6Groups(address);
  const last32 = ipv4Of(g6, g7);
  // NAT64 well-known 64:ff9b::/96
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return last32;
  // IPv4-compatible ::/96（已廢止）、IPv4-mapped ::ffff:0:0/96、IPv4-translated ::ffff:0:0:0/96
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0) {
    if (g4 === 0 && (g5 === 0 || g5 === 0xffff)) return last32;
    if (g4 === 0xffff && g5 === 0) return last32;
  }
  // 6to4 2002::/16：第 17～48 位元
  if (g0 === 0x2002) return ipv4Of(g1, g2);
  // Teredo 2001::/32：用戶端位址是最後 32 位元與 0xffffffff 做 XOR
  if (g0 === 0x2001 && g1 === 0) return ipv4Of(~g6 & 0xffff, ~g7 & 0xffff);
  return undefined;
}

/**
 * 位址是否不可連。IPv6 裡內嵌 IPv4 的（IPv4-mapped、NAT64、6to4、Teredo…）以其 IPv4 判斷：
 * 透過 NAT64 連公開 IPv4 的接收端照常可用，連內網的擋下。
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return BLOCKED.check(address, 'ipv4');
  const embedded = embeddedIpv4(address);
  if (embedded !== undefined && BLOCKED.check(embedded, 'ipv4')) return true;
  return BLOCKED.check(address, 'ipv6');
}

/** 對外連線被擋下：呼叫端轉成自己的錯誤碼（例：`AUTH_SSO_PROVIDER_UNAVAILABLE`、`WEBHOOK_URL_NOT_ALLOWED`）。 */
export class BlockedDestinationError extends Error {
  constructor(readonly hostname: string) {
    super(`不允許連到 ${hostname}：解析到私有、loopback 或保留位址`);
  }
}

/** URL 的 IPv6 hostname 帶中括號。 */
function hostnameOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

/** 解析並檢查：**每一個** 位址都必須是公開位址，回傳通過檢查的位址。 */
async function resolvePublic(
  hostname: string,
  resolve: HostLookup,
): Promise<Array<{ address: string; family: number }>> {
  const entries = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await resolve(hostname);
  if (entries.length === 0 || entries.some((entry) => isBlockedAddress(entry.address))) {
    throw new BlockedDestinationError(hostname);
  }
  return entries;
}

/**
 * 連線前檢查網址：主機名稱解析出的 **每一個** 位址都必須是公開位址。
 * 只檢查、不綁定：解析與實際連線之間仍有 DNS rebinding 的空窗。實際送出請求用 `sendOutboundRequest` 或 `pinnedFetch`；
 * 這個函式給「儲存設定時先告訴使用者不行」用。
 */
export async function assertPublicDestination(
  url: URL,
  resolve: HostLookup = systemLookup,
): Promise<void> {
  await resolvePublic(hostnameOf(url), resolve);
}

/**
 * 給 `http.request` 的 `lookup`：解析、檢查，並把 **通過檢查的位址** 交給 socket 連線。
 * 查詢與連線用的是同一次解析的結果，DNS rebinding 沒有空窗（docs/architecture/backend/17-webhook.md §9.2 D15）。
 */
export function pinnedLookup(resolve: HostLookup = systemLookup): LookupFunction {
  return (hostname, options, callback) => {
    resolvePublic(hostname, resolve).then(
      (entries) => {
        const wanted = options.family === 4 || options.family === 6 ? options.family : 0;
        const usable = wanted ? entries.filter((entry) => entry.family === wanted) : entries;
        if (options.all) {
          callback(null, usable);
          return;
        }
        const first = usable[0];
        if (!first) {
          const error = Object.assign(new Error(`${hostname} 沒有可用的位址`), {
            code: 'ENOTFOUND',
          });
          callback(error, '');
          return;
        }
        callback(null, first.address, first.family);
      },
      (error: Error) => callback(error, ''),
    );
  };
}

/** openid-client 的 `customFetch` 的形狀。 */
export type PinnedFetch = (url: string, options: RequestInit) => Promise<Response>;

/**
 * 給外部 IdP 用的 `fetch`（discovery、token、userinfo、JWKS）：連線以 `pinnedLookup` 解析，
 * 查詢與連線用的是同一次解析的結果，沒有 DNS rebinding 的空窗。openid-client 的 `customFetch` 只接受 fetch，
 * 全域的 `fetch` 不能換 `lookup`，所以用 undici 的 `fetch` ＋ 帶 `connect.lookup` 的 `Agent`。
 * 字面 IP 的網址不經過 lookup，送出前先檢查。回傳的函式共用一個 `Agent`（連線池），呼叫端建立一次重複使用。
 */
export function pinnedFetch(resolve: HostLookup = systemLookup): PinnedFetch {
  const dispatcher = new Agent({ connect: { lookup: pinnedLookup(resolve) } });
  return async (url, options) => {
    const hostname = hostnameOf(new URL(url));
    if (isIP(hostname) && isBlockedAddress(hostname)) throw new BlockedDestinationError(hostname);
    // undici 的 Response 與全域的不是同一個類別；openid-client 以 Symbol.toStringTag 判斷，兩者都是 'Response'
    return (await undiciFetch(url, {
      ...(options as UndiciRequestInit),
      dispatcher,
    })) as unknown as Response;
  };
}

export interface OutboundRequest {
  method: 'POST';
  url: URL;
  headers: Record<string, string>;
  body: string;
  /** 從開始連線到讀完回應的上限。 */
  timeoutMs: number;
  /** 回應最多讀幾個位元組；之後的內容丟棄、連線關閉。 */
  maxResponseBytes: number;
  /** 擋私有位址並綁定已驗證的位址（production）；開發環境要打本機的接收端時關掉。 */
  blockPrivateNetworks: boolean;
  resolve?: HostLookup;
}

export interface OutboundResponse {
  status: number;
  /** 回應內容的開頭（最多 `maxResponseBytes`，UTF-8 解碼）。 */
  body: string;
}

/** 逾時、連線失敗、被擋下：`code` 給紀錄用（`TIMEOUT`、`BLOCKED`、`ECONNREFUSED` 之類）。 */
export class OutboundRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function toOutboundError(error: Error & { code?: string }): OutboundRequestError {
  if (error instanceof OutboundRequestError) return error;
  if (error instanceof BlockedDestinationError) {
    return new OutboundRequestError('BLOCKED', error.message);
  }
  return new OutboundRequestError(error.code ?? 'REQUEST_FAILED', error.message);
}

/**
 * 代替租戶送出一個 HTTP 請求（目前是 webhook 投遞）：不跟隨轉址、有總逾時、只讀回應的開頭。
 * `blockPrivateNetworks` 時以 `pinnedLookup` 解析：被擋下的位址不會建立任何連線。
 */
export function sendOutboundRequest(input: OutboundRequest): Promise<OutboundResponse> {
  const { url } = input;
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return Promise.reject(new OutboundRequestError('UNSUPPORTED_PROTOCOL', url.protocol));
  }
  const hostname = hostnameOf(url);
  // 字面 IP 不經過 lookup，要在這裡擋
  if (input.blockPrivateNetworks && isIP(hostname) && isBlockedAddress(hostname)) {
    return Promise.reject(toOutboundError(new BlockedDestinationError(hostname)));
  }
  const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const options: RequestOptions = {
    method: input.method,
    headers: { ...input.headers, 'Content-Length': Buffer.byteLength(input.body).toString() },
    ...(input.blockPrivateNetworks && { lookup: pinnedLookup(input.resolve) }),
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      req.destroy(new OutboundRequestError('TIMEOUT', `${input.timeoutMs}ms 內沒有完成`));
    }, input.timeoutMs);
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(toOutboundError(error));
    };

    const req = send(url, options, (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).subarray(0, input.maxResponseBytes).toString('utf8'),
        });
      };
      res.on('data', (chunk: Buffer) => {
        if (size >= input.maxResponseBytes) return;
        chunks.push(chunk);
        size += chunk.length;
        // 讀夠了就不再等：慢慢吐資料的接收端不會拖到逾時
        if (size >= input.maxResponseBytes) {
          finish();
          res.destroy();
        }
      });
      res.on('end', finish);
      // 回應中途被切斷（含逾時）：狀態碼已經收到，以收到的部分為準
      res.on('close', finish);
    });
    req.on('error', fail);
    req.end(input.body);
  });
}
