import { useCallback, useSyncExternalStore } from 'react';

/**
 * 訂閱 CSS media query（例：`(max-width: 767px)`）。沒有 `matchMedia` 的環境（測試）一律回 `false`。
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = globalThis.matchMedia?.(query);
      media?.addEventListener('change', onChange);
      return () => media?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia?.(query).matches ?? false,
    () => false,
  );
}
