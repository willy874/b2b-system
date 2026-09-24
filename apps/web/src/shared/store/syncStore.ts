import { createChannel } from '@/shared/channel';
import type { ChannelOptions } from '@/shared/channel';

import type { StoreApi } from './create';

/**
 * 讓同一個 store 在所有參與者（分頁、其他裝置，視傳輸層而定）保持一致：
 * 本地 `setState` 改到 `keys` 裡的欄位時廣播，其他參與者收到後直接 `setState`（不再廣播，避免迴圈）。
 *
 * - 只同步 `keys` 列出的資料欄位；action（函式）無法傳遞，也不該傳。
 * - 只同步「之後的變更」，不負責新參與者的初始值——需要的話由持久化（`dictStorage`）水合。
 * - 持久化寫在 action 裡的 store，收訊方不必再寫一次：發訊方已經寫進共用的 localStorage
 *   （跨裝置時例外：各裝置的 localStorage 不共用，收訊方要自己持久化）。
 *
 * @param name 頻道名稱，同一個 store 在所有參與者要一致（實際頻道為 `ge:store:<name>`）
 * @param options 傳輸層，預設只在本機分頁之間（`BroadcastChannel`）
 * @returns 停止同步
 */
export function syncStore<T extends object, K extends keyof T>(
  store: StoreApi<T>,
  name: string,
  keys: readonly K[],
  options?: ChannelOptions,
): () => void {
  const channel = createChannel<{ state: Pick<T, K> }>(`store:${name}`, options);
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
