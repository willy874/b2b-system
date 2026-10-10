import { useEffect, useState } from 'react';

/**
 * 停止變動 `delayMs` 之後才更新的值：搜尋框打字時不必每個字都發請求。
 * 第一次 render 直接回傳初始值（不必等延遲）。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}
