import { untracked, watch as watchSource } from '@sigrea/core';

export interface WatchOptions {
  /** 建立時先以目前的值呼叫一次（`previous` 與 `value` 相同）。 */
  immediate?: boolean;
}

/**
 * 依賴追蹤的監聽：`getter` 裡讀到的 `store.state.<key>`（可跨多個 store）自動成為依賴，
 * 結果（`Object.is`）改變時 **同步** 呼叫 `callback`。不依賴任何 UI 框架，給 plugin、服務等非 React 程式碼用。
 *
 * @returns 停止監聽
 */
export function watch<T>(
  getter: () => T,
  callback: (value: T, previous: T) => void,
  options: WatchOptions = {},
): () => void {
  let previous = untracked(getter);
  const handle = untracked(() =>
    watchSource(
      getter,
      (value) => {
        const before = previous;
        previous = value;
        callback(value, before);
      },
      { flush: 'sync' },
    ),
  );
  if (options.immediate) callback(previous, previous);
  return () => handle.stop();
}
