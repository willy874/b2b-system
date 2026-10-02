import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { LookupFunction } from 'node:net';

/** 解析主機名稱的方式（測試換成假的）。 */
export type HostLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export const systemLookup: HostLookup = (hostname) => lookup(hostname, { all: true });

/**
 * api 不應該代替租戶去連的位址：私有網段、loopback、link-local（含雲端的 metadata 端點
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
 * 只檢查、不綁定：解析與實際連線之間仍有 DNS rebinding 的空窗。實際送出請求用 `sendOutboundRequest`；
 * 這個函式給「儲存設定時先告訴使用者不行」與外部 IdP（openid-client 只接受 fetch）用。
 */
export async function assertPublicDestination(
  url: URL,
  resolve: HostLookup = systemLookup,
): Promise<void> {
  await resolvePublic(hostnameOf(url), resolve);
}

/**
 * 給 `http.request` 的 `lookup`：解析、檢查，並把 **通過檢查的位址** 交給 socket 連線。
 * 查詢與連線用的是同一次解析的結果，DNS rebinding 沒有空窗（docs/adr/0030-webhooks.md D15）。
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

/** 包一層 `fetch`：每個請求（discovery、token、userinfo、JWKS）送出前都先檢查目的地。 */
export function guardedFetch(
  resolve: HostLookup = systemLookup,
): (url: string, options: RequestInit) => Promise<Response> {
  return async (url, options) => {
    await assertPublicDestination(new URL(url), resolve);
    return fetch(url, options);
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
