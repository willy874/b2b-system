import type { IncomingMessage } from 'node:http';

import proxyaddr from 'proxy-addr';

/** 固定視窗計數器（in-memory，單一執行個體；docs/architecture/backend/08-realtime.md §11）。 */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly windowMs: number,
    /** 異常情況下的上限，避免無限成長。 */
    private readonly maxKeys = 10_000,
  ) {}

  /** 記一次並回傳視窗內的累計次數。 */
  hit(key: string, now = Date.now()): number {
    const current = this.windows.get(key);
    if (current && current.resetAt > now) {
      current.count += 1;
      return current.count;
    }
    if (!current && this.windows.size >= this.maxKeys) this.sweep(now);
    this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
    return 1;
  }

  forget(key: string): void {
    this.windows.delete(key);
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    if (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next();
      if (!oldest.done) this.windows.delete(oldest.value);
    }
  }
}

/** Express 依 `trust proxy` 編譯出的判定函式（`app.get('trust proxy fn')`）。 */
export type TrustProxyFn = (address: string, hop: number) => boolean;

/**
 * 與 HTTP 的 `req.ip` 相同的客戶端 IP 判定：同一個 `trust proxy` 設定、同一套演算法（`proxy-addr`）。
 * 不信任代理時就是連線的對端位址；信任時才沿 `X-Forwarded-For` 往回找。
 */
export function clientIpOf(req: IncomingMessage, trust: TrustProxyFn): string {
  if (!req.socket.remoteAddress) return 'unknown';
  return proxyaddr(req, trust);
}
