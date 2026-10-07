import { useCallback, useEffect, useState } from 'react';

/** 倒數更新的間隔：以秒顯示，一秒一次就夠。 */
const TICK_MS = 1000;

export interface Countdown {
  /** 剩下的秒數（無條件進位）；沒有在倒數時是 0。 */
  remaining: number;
  /** 從 `seconds` 開始倒數；再次呼叫會重新開始。 */
  start: (seconds: number) => void;
}

/**
 * 以秒倒數（例：被限流後「N 秒後可再試」）。以結束時刻計算剩餘時間，分頁在背景被節流時也不會越數越慢。
 */
export function useCountdown(): Countdown {
  const [endsAt, setEndsAt] = useState<number>();
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (endsAt === undefined) return undefined;
    const update = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / TICK_MS));
      setRemaining(left);
      if (left === 0) setEndsAt(undefined);
    };
    update();
    const timer = setInterval(update, TICK_MS);
    return () => clearInterval(timer);
  }, [endsAt]);

  const start = useCallback((seconds: number) => {
    const total = Math.max(0, Math.ceil(seconds));
    // 立即反映，不等第一次 tick：呼叫端在同一次 render 就能停用按鈕
    setRemaining(total);
    setEndsAt(Date.now() + total * TICK_MS);
  }, []);

  return { remaining, start };
}
