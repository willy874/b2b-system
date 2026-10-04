/**
 * 存放 `Blob`（例：排隊中的上傳檔案）的鍵值儲存：同一個分頁先放記憶體，並盡量寫進 IndexedDB，
 * 讓同源的其他分頁也讀得到（docs/architecture/frontend/12-file-manager.md §14）。
 *
 * - IndexedDB 不可用（隱私模式、測試環境、配額不足）時只剩記憶體：本分頁照常，其他分頁讀不到。
 * - 不放 localStorage：它只能存字串，而且容量只有幾 MB。
 */
export interface BlobStore {
  put(key: string, blob: Blob): Promise<void>;
  /** 先查本分頁的記憶體，再查 IndexedDB；都沒有回 `undefined`。 */
  get(key: string): Promise<Blob | undefined>;
  delete(key: string): Promise<void>;
  /** 刪掉存進來超過 `maxAgeMs` 的項目（例：分頁當掉沒來得及清的上傳）。 */
  prune(maxAgeMs: number): Promise<void>;
}

export interface BlobStoreOptions {
  /** 預設 `globalThis.indexedDB`；測試可注入 `undefined` 只用記憶體。 */
  indexedDB?: IDBFactory | undefined;
  now?: () => number;
}

interface StoredBlob {
  blob: Blob;
  storedAt: number;
}

const DB_PREFIX = 'b2b-system:blob:';
const STORE = 'blobs';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener('success', () => resolve(req.result));
    req.addEventListener('error', () => reject(req.error));
  });
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const open = factory.open(DB_PREFIX + name, 1);
  open.addEventListener('upgradeneeded', () => {
    if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE);
  });
  return request(open);
}

/** `name` 是資料庫的名稱（加上 `b2b-system:blob:` 前綴），不同用途用不同的名稱。 */
export function createBlobStore(name: string, options: BlobStoreOptions = {}): BlobStore {
  const factory = 'indexedDB' in options ? options.indexedDB : globalThis.indexedDB;
  const now = options.now ?? Date.now;
  const memory = new Map<string, StoredBlob>();
  let database: Promise<IDBDatabase | undefined> | undefined;

  const db = (): Promise<IDBDatabase | undefined> => {
    database ??= factory
      ? openDatabase(factory, name).catch(() => undefined)
      : Promise.resolve(undefined);
    return database;
  };

  /** IndexedDB 的失敗一律吞掉：它只是讓其他分頁也讀得到的加分，本分頁的記憶體仍然可用。 */
  const withStore = async <T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T | undefined> => {
    const handle = await db();
    if (!handle) return undefined;
    try {
      return await run(handle.transaction(STORE, mode).objectStore(STORE));
    } catch {
      return undefined;
    }
  };

  return {
    async put(key, blob) {
      const entry = { blob, storedAt: now() };
      memory.set(key, entry);
      await withStore('readwrite', (store) => request(store.put(entry, key)));
    },
    async get(key) {
      const cached = memory.get(key);
      if (cached) return cached.blob;
      const stored = await withStore('readonly', (store) =>
        request(store.get(key) as IDBRequest<StoredBlob | undefined>),
      );
      return stored?.blob;
    },
    async delete(key) {
      memory.delete(key);
      await withStore('readwrite', (store) => request(store.delete(key)));
    },
    async prune(maxAgeMs) {
      const cutoff = now() - maxAgeMs;
      for (const [key, entry] of memory) if (entry.storedAt < cutoff) memory.delete(key);
      await withStore('readwrite', async (store) => {
        const keys = await request(store.getAllKeys());
        for (const key of keys) {
          const entry = (await request(store.get(key))) as StoredBlob | undefined;
          if (!entry || entry.storedAt < cutoff) await request(store.delete(key));
        }
      });
    },
  };
}
