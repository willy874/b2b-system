const WINDOW_MS = 60_000;
/** 記錄的來源數上限；超過時清掉已過期的，避免被大量偽造來源吃光記憶體。 */
const MAX_KEYS = 50_000;

/**
 * 固定視窗的計數（每個來源、每個專案、每分鐘）。只在本程序內：apm-service 是單一實例的服務。
 * 超過時回 429，SDK 會依 `Retry-After` 與 `X-Sentry-Rate-Limits` 暫停送出（設計決策 D3）。
 */
export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(private readonly limitPerMinute: number) {}

  /** 回傳 `undefined` 代表放行，否則是要等的秒數。 */
  hit(key: string, now: number = Date.now()): number | undefined {
    let window = this.windows.get(key);
    if (!window || now - window.startedAt >= WINDOW_MS) {
      if (this.windows.size >= MAX_KEYS) this.sweep(now);
      window = { startedAt: now, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= this.limitPerMinute) return undefined;
    return Math.max(1, Math.ceil((window.startedAt + WINDOW_MS - now) / 1000));
  }

  private sweep(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= WINDOW_MS) this.windows.delete(key);
    }
  }
}
