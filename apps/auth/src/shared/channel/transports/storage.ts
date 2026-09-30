import { createDictStorage } from '@/shared/storage';

import type { ChannelTransportFactory } from './types';

/**
 * 以 localStorage 的 `storage` 事件傳遞：寫入後立刻刪除，其他分頁會收到寫入那一次的事件。
 * 給沒有 `BroadcastChannel` 的環境當後備（搭配 `fallbackTransport`）。
 *
 * ⚠️ 訊息會短暫寫進 localStorage，任何腳本都讀得到：**不可傳 token 或個人資料**
 * （docs/architecture/frontend/09-state-and-storage.md §4.2）。payload 必須能 JSON 序列化。
 */
export function storageTransport(): ChannelTransportFactory {
  const storage = createDictStorage('channel');
  return (channelName) => {
    if (!isLocalStorageAvailable()) return undefined;
    return {
      post(envelope) {
        // 外框帶唯一的 id，相同 payload 連送兩次仍然是不同的值，一定會觸發事件
        storage.set(channelName, envelope);
        storage.remove(channelName);
      },
      subscribe(listener) {
        return storage.subscribe(channelName, (value) => {
          // 刪除那一次的事件值是 undefined
          if (value !== undefined) listener(value);
        });
      },
      close() {},
    };
  };
}

function isLocalStorageAvailable(): boolean {
  try {
    return globalThis.localStorage !== undefined;
  } catch {
    // 使用者封鎖 cookie 時，連讀取 localStorage 屬性都會拋 SecurityError
    return false;
  }
}
