import type { Channel } from '@/shared/channel';

import type { StoreApi } from './create';

export type SyncStoreMessages<S> = { state: S };

/**
 * 讓同一個 store 在所有參與者（分頁、其他裝置，視傳輸層而定）保持一致：
 * 本地 `setState` 改到 `keys` 裡的欄位時廣播，其他參與者收到後直接 `setState`（不再廣播，避免迴圈）。
 *
 * - 只同步 `keys` 列出的資料欄位；action（函式）無法傳遞，也不該傳。
 * - 只同步「之後的變更」，不負責新參與者的初始值——需要的話由持久化（`dictStorage`）水合。
 * - 持久化寫在 action 裡的 store，收訊方不必再寫一次：發訊方已經寫進共用的 localStorage
 *   （跨裝置時例外：各裝置的 localStorage 不共用，收訊方要自己持久化）。
 *
 * @param channel 所有參與者同名的頻道（慣例 `createChannel('store:<name>')`）；交給 `syncStore` 後由它負責關閉
 * @returns 停止同步並關閉頻道
 */
export function syncStore<T extends object, K extends keyof T>(
  store: StoreApi<T>,
  keys: readonly K[],
  channel: Channel<SyncStoreMessages<Pick<T, K>>>,
): () => void {
  let isApplyingRemote = false;

  const pick = (state: T): Pick<T, K> => {
    const picked = {} as Pick<T, K>;
    for (const key of keys) picked[key] = state[key];
    return picked;
  };

  const offStore = store.subscribe((state, previous) => {
    if (isApplyingRemote) return;
    if (keys.every((key) => Object.is(state[key], previous[key]))) return;
    channel.post('state', pick(state));
  });

  const offChannel = channel.on('state', (partial) => {
    isApplyingRemote = true;
    try {
      store.setState(partial as Partial<T>);
    } finally {
      isApplyingRemote = false;
    }
  });

  return () => {
    offStore();
    offChannel();
    channel.close();
  };
}
