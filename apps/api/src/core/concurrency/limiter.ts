/** 等待的名額已滿或等太久：呼叫端轉成自己的錯誤（例：`503 AUTH_BUSY`）。 */
export class LimiterBusyError extends Error {
  constructor(readonly reason: 'queue-full' | 'timeout') {
    super(reason === 'queue-full' ? '等待的名額已滿' : '等待逾時');
  }
}

export interface LimiterOptions {
  /** 同時執行的上限。 */
  concurrency: number;
  /** 等待中的上限；超過時立刻拋 `LimiterBusyError('queue-full')`。不設 = 不限。 */
  maxQueue?: number;
  /** 等待超過這麼久就放棄（毫秒），拋 `LimiterBusyError('timeout')`。不設 = 一直等。 */
  queueTimeoutMs?: number;
}

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * 程序內的並行上限（FIFO）：名額空出時直接交給排最前面的等待者，新來的不能插隊。
 * 給佔用 libuv threadpool 的工作用（argon2、sharp）：不限的話一陣尖峰就能佔滿整個 threadpool，
 * 連帶拖慢 DNS 查詢與檔案 I/O（docs/architecture/backend/04-auth.md §4.1）。上限是 **每程序**，多實例時不共享。
 */
export function createLimiter(options: LimiterOptions): Limiter {
  const { concurrency, maxQueue, queueTimeoutMs } = options;
  let active = 0;
  const waiting: Array<{ resolve: () => void; timer?: NodeJS.Timeout }> = [];

  const release = (): void => {
    const next = waiting.shift();
    if (next) {
      if (next.timer) clearTimeout(next.timer);
      next.resolve();
    } else {
      active -= 1;
    }
  };

  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    if (maxQueue !== undefined && waiting.length >= maxQueue) {
      return Promise.reject(new LimiterBusyError('queue-full'));
    }
    return new Promise<void>((resolve, reject) => {
      const entry: { resolve: () => void; timer?: NodeJS.Timeout } = { resolve };
      if (queueTimeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          reject(new LimiterBusyError('timeout'));
        }, queueTimeoutMs);
      }
      waiting.push(entry);
    });
  };

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
    }
  };
}
