/** 假的 IDBRequest：在下一個 microtask 完成（呼叫端先拿到 request 才掛 listener）。 */
function fakeRequest<T>(compute: () => T): IDBRequest<T> {
  const request = new EventTarget() as EventTarget & { result?: T; error: unknown };
  request.error = null;
  queueMicrotask(() => {
    try {
      request.result = compute();
      request.dispatchEvent(new Event('success'));
    } catch (error) {
      request.error = error;
      request.dispatchEvent(new Event('error'));
    }
  });
  return request as unknown as IDBRequest<T>;
}

export interface FakeIndexedDBOptions {
  /** 開啟資料庫失敗（例：隱私模式、配額不足）。 */
  failOpen?: boolean;
  /** 開啟成功，但每個交易都丟例外。 */
  failTransaction?: boolean;
}

/**
 * 最小的 IndexedDB（只有 storage 用到的部分）：每個資料庫可有多個 object store，請求在下一個 microtask 完成。
 * 同一個 factory 建立的多個 store 共用資料，相當於同源的多個分頁。
 */
export function createFakeIndexedDB(options: FakeIndexedDBOptions = {}) {
  const databases = new Map<string, Map<string, Map<IDBValidKey, unknown>>>();

  const factory = {
    open(name: string) {
      const isNew = !databases.has(name);
      const stores = databases.get(name) ?? new Map<string, Map<IDBValidKey, unknown>>();
      databases.set(name, stores);
      const objectStore = (storeName: string) => {
        const data = stores.get(storeName);
        if (!data) throw new Error(`NotFoundError: ${storeName}`);
        return {
          put: (value: unknown, key: IDBValidKey) => fakeRequest(() => data.set(key, value) && key),
          get: (key: IDBValidKey) => fakeRequest(() => data.get(key)),
          delete: (key: IDBValidKey) => fakeRequest(() => void data.delete(key)),
          getAllKeys: () => fakeRequest(() => [...data.keys()]),
          getAll: () => fakeRequest(() => [...data.values()]),
          clear: () => fakeRequest(() => data.clear()),
        };
      };
      const db = {
        objectStoreNames: { contains: (storeName: string) => stores.has(storeName) },
        createObjectStore: (storeName: string) => stores.set(storeName, new Map()),
        transaction: (storeName: string) => {
          if (options.failTransaction) throw new Error('InvalidStateError');
          return { objectStore: () => objectStore(storeName) };
        },
      };
      const request = new EventTarget() as EventTarget & { result?: unknown; error: unknown };
      request.error = null;
      queueMicrotask(() => {
        if (options.failOpen) {
          request.error = new Error('UnknownError');
          request.dispatchEvent(new Event('error'));
          return;
        }
        request.result = db;
        if (isNew) request.dispatchEvent(new Event('upgradeneeded'));
        request.dispatchEvent(new Event('success'));
      });
      return request;
    },
  };
  return { indexedDB: factory as unknown as IDBFactory, databases };
}
