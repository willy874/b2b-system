const NAMESPACE_PREFIX = 'game-editor:';

export interface DictStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /** 跨分頁：監聽 `storage` 事件。 */
  subscribe(key: string, listener: (value: unknown) => void): () => void;
}

/**
 * 命名空間化的 localStorage。
 * 私密瀏覽、儲存空間已滿、使用者關閉 cookie 都會讓 localStorage 拋例外——
 * 一律 try/catch 並回 fallback，絕不讓 app 掛掉。
 */
export function createDictStorage(namespace: string): DictStorage {
  const prefix = `${NAMESPACE_PREFIX}${namespace}:`;

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
    },
    remove(key: string): void {
      try {
        globalThis.localStorage?.removeItem(prefix + key);
      } catch {
        /* 忽略 */
      }
    },
    subscribe(key: string, listener: (value: unknown) => void): () => void {
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
    },
  };
}
