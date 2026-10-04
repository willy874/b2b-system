import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * 保存每次 render 最新值的 ref，給參考固定的 callback 讀取（避免把會變的值放進依賴而讓 `memo` 失效）。
 * 在 layout effect 更新：render 期間不寫 ref（react/refs），而事件處理一定發生在 commit 之後。
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}
