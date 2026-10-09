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

  private send(
    address: string,
    path: string,
    body: string,
    signature: string,
    signal: AbortSignal | undefined,
  ): Promise<CdnPurgeNodeResult> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const isHttps = this.url.protocol === 'https:';
    const port = this.url.port || (isHttps ? '443' : '80');
    return new Promise((resolve) => {
      const req = (isHttps ? httpsRequest : request)(
        {
          host: address,
          port,
          method: 'POST',
          path: `${this.url.pathname.replace(/\/+$/, '')}${path}`,
          // 以 IP 連線、帶原本的 Host：同一個名稱背後的每個節點都收到同一個請求（https 時 SNI 也用原本的名稱）
          headers: {
            Host: this.url.host,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-Purge-Signature': signature,
          },
          servername: isHttps ? this.url.hostname : undefined,
          signal: combined,
        },
        (res) => {
          readBody(res)
            .then((text) => resolve(parseResult(address, res.statusCode ?? 0, text)))
            .catch((error: unknown) => resolve(failure(address, error, timeout)));
        },
      );
      req.on('error', (error) => resolve(failure(address, error, timeout)));
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

function failure(address: string, error: unknown, timeout: AbortSignal): CdnPurgeNodeResult {
  if (timeout.aborted) return { address, result: 'timeout' };
  return {
    address,
    result: 'error',
    detail: error instanceof Error ? error.message : String(error),
  };
}
