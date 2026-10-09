import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** 清理的對象：明確的路徑清單（`/storage/<bucket>/<key>`），或整個快取（緊急下架、重新打開 CDN 前）。 */
export type CdnPurgeTarget = { paths: readonly string[] } | { all: true };

/** 一個邊緣節點的結果。 */
export interface CdnPurgeNodeResult {
  /** 解析出來的位址（不含埠）。 */
  address: string;
  result: 'ok' | 'error' | 'timeout';
  /** 節點回報的數量（`ok` 時）：刪掉的快取檔、本來就不在的路徑。 */
  purged?: number;
  missing?: number;
  /** 失敗的原因（狀態碼或錯誤訊息），給工作的 output 與日誌。 */
  detail?: string;
}

/** 單次清理請求的本體上限（與邊緣的 `client_max_body_size` 相同；docs/architecture/backend/09-file.md §16.6）。 */
export const CDN_PURGE_MAX_BODY_BYTES = 1024 * 1024;

/** 簽章：`hex(HMAC-SHA256(secret, ts + "\n" + 本體))`，放在 `X-Purge-Signature`；`ts` 也在本體裡（防重放）。 */
export function cdnPurgeSignature(secret: Buffer, ts: number, body: string): string {
  return createHmac('sha256', secret).update(`${ts}\n${body}`).digest('hex');
}

/** `GET /_status` 的簽章內容（docs/architecture/backend/09-file.md §16.10）：沒有本體，以方法與路徑代替，簽章只能用在這個端點。 */
export const CDN_STATUS_SIGNED_CONTENT = 'GET /_status';

/** 邊緣的 `/_status` 回報的內容：只有 kid、不回金鑰；簽章被接受本身就證明清理密鑰一致。 */
export interface CdnEdgeStatus {
  kids: string[];
  cache: { maxSize: string; inactive: string; valid: string };
  build: string;
  startedAt: string;
}

/** 一個節點的 `/_status`：`rejected` 是 403（清理密鑰不同）、`invalid` 是 200 但形狀不對。 */
export type CdnEdgeStatusResult =
  | { address: string; result: 'ok'; status: CdnEdgeStatus }
  | { address: string; result: 'rejected' | 'invalid' | 'error' | 'timeout'; detail?: string };

export interface NginxCdnEdgePurgerOptions {
  /** 例：`http://cdn-purge:8081`。主機名稱解析到多個位址時每一個都送（headless Service、compose 的多個副本）。 */
  purgeUrl: string;
  secret: Buffer;
  timeoutMs: number;
  /** 測試替換 DNS 用。 */
  resolve?: (hostname: string) => Promise<string[]>;
  now?: () => number;
}

async function resolveAll(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, { all: true });
  return [...new Set(addresses.map((entry) => entry.address))];
}

/**
 * 自架 nginx 邊緣的清理端點（deploy/cdn.js 的 `purge`；docs/architecture/backend/09-file.md §16.6）。
 * 每個節點各有自己的快取，所以 **每一個** 位址都要送；請求帶原本的 `Host`。任一節點失敗由呼叫端整筆重試（清理是冪等的）。
 * 不經過 Nest：`cdn.purge` 的 handler 與 `cli:cdn-purge` 共用。
 */
export class NginxCdnEdgePurger {
  private readonly url: URL;
  private readonly resolve: (hostname: string) => Promise<string[]>;
  private readonly now: () => number;

  constructor(private readonly options: NginxCdnEdgePurgerOptions) {
    this.url = new URL(options.purgeUrl);
    this.resolve = options.resolve ?? resolveAll;
    this.now = options.now ?? Date.now;
  }

  /** 解析出來的節點位址（`--all` 不加 `--confirm` 時只列出它們）。 */
  async nodes(): Promise<string[]> {
    const hostname = this.url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await this.resolve(hostname);
    if (addresses.length === 0) throw new Error(`${hostname} 沒有解析到任何位址`);
    return addresses;
  }

  async purge(target: CdnPurgeTarget, signal?: AbortSignal): Promise<CdnPurgeNodeResult[]> {
    const ts = Math.floor(this.now() / 1000);
    const isAll = 'all' in target;
    const body = JSON.stringify(isAll ? { ts } : { paths: target.paths, ts });
    if (Buffer.byteLength(body) > CDN_PURGE_MAX_BODY_BYTES) {
      throw new Error(`一次清理的本體超過 ${CDN_PURGE_MAX_BODY_BYTES} bytes：請分批`);
    }
    const signature = cdnPurgeSignature(this.options.secret, ts, body);
    const addresses = await this.nodes();
    return Promise.all(
      addresses.map((address) =>
        this.send(address, isAll ? '/_purge/all' : '/_purge', body, signature, signal),
      ),
    );
  }

  /**
   * 每個節點的狀態（`GET /_status`，只在清理埠）：連得到、清理密鑰被接受、節點的金鑰環。開啟 CDN 前的檢查與
   * `cdn.healthCheck` 用（docs/architecture/backend/09-file.md §16.10）。名稱解析失敗時拋錯（一個節點都沒有）。
   */
  async status(signal?: AbortSignal): Promise<CdnEdgeStatusResult[]> {
    const ts = Math.floor(this.now() / 1000);
    const signature = cdnPurgeSignature(this.options.secret, ts, CDN_STATUS_SIGNED_CONTENT);
    const addresses = await this.nodes();
    return Promise.all(
      addresses.map(async (address): Promise<CdnEdgeStatusResult> => {
        const response = await this.exchange(
          address,
          'GET',
          `/_status?ts=${ts}`,
          undefined,
          signature,
          signal,
        );
        if (response.kind !== 'response') {
          return { address, result: response.failure.result, detail: response.failure.detail };
        }
        if (response.status === 403) return { address, result: 'rejected', detail: 'HTTP 403' };
        if (response.status !== 200) {
          return { address, result: 'error', detail: `HTTP ${response.status}` };
        }
        const status = parseStatus(response.text);
        return status
          ? { address, result: 'ok', status }
          : { address, result: 'invalid', detail: '回應的形狀不對' };
      }),
    );
  }

  private async send(
    address: string,
    path: string,
    body: string,
    signature: string,
    signal: AbortSignal | undefined,
  ): Promise<CdnPurgeNodeResult> {
    const response = await this.exchange(address, 'POST', path, body, signature, signal);
    if (response.kind !== 'response') return { address, ...response.failure };
    return parseResult(address, response.status, response.text);
  }

  private exchange(
    address: string,
    method: 'GET' | 'POST',
    path: string,
    body: string | undefined,
    signature: string,
    signal: AbortSignal | undefined,
  ): Promise<
    | { kind: 'response'; status: number; text: string }
    | { kind: 'failure'; failure: { result: 'error' | 'timeout'; detail?: string } }
  > {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const isHttps = this.url.protocol === 'https:';
    const port = this.url.port || (isHttps ? '443' : '80');
    const failed = (error: unknown) => ({
      kind: 'failure' as const,
      failure: failure(error, timeout),
    });
    return new Promise((resolve) => {
      const req = (isHttps ? httpsRequest : request)(
        {
          host: address,
          port,
          method,
          path: `${this.url.pathname.replace(/\/+$/, '')}${path}`,
          // 以 IP 連線、帶原本的 Host：同一個名稱背後的每個節點都收到同一個請求（https 時 SNI 也用原本的名稱）
          headers: {
            Host: this.url.host,
            ...(body !== undefined && {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            }),
            'X-Purge-Signature': signature,
          },
          servername: isHttps ? this.url.hostname : undefined,
          signal: combined,
        },
        (res) => {
          readBody(res)
            .then((text) => resolve({ kind: 'response', status: res.statusCode ?? 0, text }))
            .catch((error: unknown) => resolve(failed(error)));
        },
      );
      req.on('error', (error) => resolve(failed(error)));
      req.end(body);
    });
  }
}

function readBody(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

function parseResult(address: string, status: number, text: string): CdnPurgeNodeResult {
  if (status !== 200) return { address, result: 'error', detail: `HTTP ${status}` };
  try {
    const parsed = JSON.parse(text) as { purged?: unknown; missing?: unknown };
    return {
      address,
      result: 'ok',
      purged: typeof parsed.purged === 'number' ? parsed.purged : undefined,
      missing: typeof parsed.missing === 'number' ? parsed.missing : undefined,
    };
  } catch {
    return { address, result: 'ok' };
  }
}

function failure(
  error: unknown,
  timeout: AbortSignal,
): { result: 'error' | 'timeout'; detail?: string } {
  if (timeout.aborted) return { result: 'timeout' };
  return { result: 'error', detail: error instanceof Error ? error.message : String(error) };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseStatus(text: string): CdnEdgeStatus | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { kids, cache, build, startedAt } = parsed as Record<string, unknown>;
  if (!isStringArray(kids) || typeof cache !== 'object' || cache === null) return undefined;
  const { maxSize, inactive, valid } = cache as Record<string, unknown>;
  return {
    kids,
    cache: {
      maxSize: String(maxSize ?? ''),
      inactive: String(inactive ?? ''),
      valid: String(valid ?? ''),
    },
    build: typeof build === 'string' ? build : '',
    startedAt: typeof startedAt === 'string' ? startedAt : '',
  };
}
