import { useCallback, useState } from 'react';

import { useLatestRef } from './useLatestRef';

/**
 * 受控／非受控兩用的狀態（docs/architecture/frontend/07-ui-system.md §3.1 規則 3）。
 * `value !== undefined` 時為受控，只呼叫 `onChange`；否則自己保存。
 * 回傳的 setter 參考固定，可以放進 `memo` 元件的 props。
 */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState(defaultValue);
  const isControlled = value !== undefined;
  const current = isControlled ? value : inner;

  const latest = useLatestRef({ isControlled, onChange });

  const setValue = useCallback(
    (next: T) => {
      if (!latest.current.isControlled) setInner(next);
      latest.current.onChange?.(next);
    },
    [latest],
  );

  return [current, setValue];
}
