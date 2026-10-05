import type { Channel } from '../channel';

const NAMESPACE_PREFIX = 'b2b-system:';

/** 有頻道的 dictStorage 在寫入後廣播的訊息；收訊方只通知訂閱者，不再寫一次 localStorage。 */
export type DictStorageMessages = {
  set: { key: string; value: unknown };
  remove: { key: string };
};

export interface DictStorageOptions {
  /**
   * 寫入後經這個頻道通知其他參與者，`subscribe` 改聽頻道而不是 `storage` 事件。
   * 交給 dictStorage 後由它負責關閉（`dispose()`）。
   *
   * 收訊方不寫入：本機分頁共用同一份 localStorage，發訊方已經寫過。
   * 跨裝置的傳輸層（WebSocket）不適用——各裝置的 localStorage 不共用。
   */
  channel?: Channel<DictStorageMessages>;
}

export interface DictStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /**
   * 其他參與者改了 `key`（移除時收到 `undefined`）；本實例自己的寫入不會通知。
   * 有頻道時聽頻道，沒有時聽 `storage` 事件。
   */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
  /** 關閉頻道；沒有頻道時什麼都不做。 */
  dispose(): void;
}

function subscribeChannel(
  source: Channel<DictStorageMessages>,
  key: string,
  listener: (value: unknown) => void,
): () => void {
  const offSet = source.on('set', (message) => {
    if (message.key === key) listener(message.value);
  });
  const offRemove = source.on('remove', (message) => {
    if (message.key === key) listener(undefined);
  });
  return () => {
    offSet();
    offRemove();
  };
}

/**
 * 命名空間化的 localStorage。
 * 私密瀏覽、儲存空間已滿、使用者關閉 cookie 都會讓 localStorage 拋例外——
 * 一律 try/catch 並回 fallback，絕不讓 app 掛掉。
 */
export function createDictStorage(
  namespace: string,
  options: DictStorageOptions = {},
): DictStorage {
  const prefix = `${NAMESPACE_PREFIX}${namespace}:`;
  const { channel } = options;

  function subscribeStorageEvent(key: string, listener: (value: unknown) => void): () => void {
    const handler = (event: StorageEvent) => {
      if (event.key !== prefix + key) return;
      try {
        listener(event.newValue === null ? undefined : JSON.parse(event.newValue));
      } catch {
        listener(undefined);
      }
    };
    globalThis.addEventListener?.('storage', handler);
    return () => globalThis.removeEventListener?.('storage', handler);
  }

  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = globalThis.localStorage?.getItem(prefix + key);
        return raw === null || raw === undefined ? fallback : (JSON.parse(raw) as T);
      } catch {
        return fallback;
      }
    },
    set<T>(key: string, value: T): void {
      try {
        globalThis.localStorage?.setItem(prefix + key, JSON.stringify(value));
      } catch {
        /* 忽略：儲存失敗不影響功能 */
      }
      // 寫入失敗也通知：其他分頁至少在這次執行期間跟上
      channel?.post('set', { key, value });
    },
    remove(key: string): void {
      try {
        globalThis.localStorage?.removeItem(prefix + key);
      } catch {
        /* 忽略 */
      }
      channel?.post('remove', { key });
    },
    subscribe(key: string, listener: (value: unknown) => void): () => void {
      return channel
        ? subscribeChannel(channel, key, listener)
        : subscribeStorageEvent(key, listener);
    },
    dispose(): void {
      channel?.close();
    },
  };
}
