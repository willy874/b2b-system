export interface JitterRange {
  /** 最短延遲（毫秒，含）。 */
  min: number;
  /** 最長延遲（毫秒，不含）。 */
  max: number;
}

export interface KeyedThrottleDeps {
  /** `[0, 1)` */
  random?: () => number;
  setTimeout?: (handler: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface KeyedThrottle {
  /** 在 `[min, max)` 的隨機延遲後執行；同一個 key 還沒執行時再排，取消前一個、只留最新的。 */
  schedule(key: string, task: () => void, range: JitterRange): void;
  cancel(key: string): void;
  /** 清掉所有還沒執行的工作。 */
  stop(): void;
}

/** `[min, max)` 內均勻分布；`max <= min` 時固定為 `min`。 */
export function computeJitterDelay(random: () => number, { min, max }: JitterRange): number {
  return max > min ? min + random() * (max - min) : min;
}

/**
 * 以 key 去重、以隨機延遲削峰（參考 fortes1219/socket-meetup-frontend 的 socket-event-throttle）。
 *
 * 用在「很多參與者會在同一瞬間收到同一個訊號」的地方：例如一筆寫入推給所有線上使用者，
 * 每個人都立刻重抓就是一波同步的請求尖峰。隨機延遲把它攤開；同一個 key 的連續訊號合併成一次。
 */
export function createKeyedThrottle(deps: KeyedThrottleDeps = {}): KeyedThrottle {
  const random = deps.random ?? Math.random;
  const setTimer = deps.setTimeout ?? ((handler, ms) => globalThis.setTimeout(handler, ms));
  const clearTimer =
    deps.clearTimeout ??
    ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, unknown>();

  function cancel(key: string): void {
    const handle = pending.get(key);
    if (handle === undefined) return;
    clearTimer(handle);
    pending.delete(key);
  }

  return {
    schedule(key, task, range) {
      cancel(key);
      const handle = setTimer(
        () => {
          pending.delete(key);
          task();
        },
        computeJitterDelay(random, range),
      );
      pending.set(key, handle);
    },
    cancel,
    stop() {
      for (const handle of pending.values()) clearTimer(handle);
      pending.clear();
    },
  };
}
