/**
 * 表單草稿的加密儲存（docs/architecture/frontend/09-state-and-storage.md §4.4）：session 非自願結束時，
 * 選擇加入的表單把未儲存的內容存在這裡，重新登入回到同一頁時提示還原。
 *
 * - IndexedDB，以 WebCrypto AES-GCM 加密；金鑰是每個瀏覽器產生一次、**不可匯出** 的 `CryptoKey`，存在同一個 IndexedDB：
 *   磁碟上不是明文，XSS 也帶不走金鑰（但能在頁面內解密——XSS 本來就讀得到畫面上的表單）。
 * - 以「擁有者（`<租戶>:<使用者>`）× key」索引；24 小時過期，最多 20 筆、每筆 256 KiB（超過的不存）。
 * - IndexedDB 或 WebCrypto 不可用（隱私模式、測試環境）時只存在記憶體：重新登入的頂層導向之後就沒了，等於不保留。
 */
export interface DraftRecord<T = unknown> {
  data: T;
  /** 存下的時刻（epoch 毫秒）。 */
  savedAt: number;
}

export interface DraftStore {
  /** 存一份草稿（同一個擁有者與 key 覆蓋舊的）；太大的不存，回傳是否存下。 */
  save(owner: string, key: string, data: unknown): Promise<boolean>;
  /** 讀一份草稿；不存在、過期或解不開回 `undefined`（過期與解不開的順便刪掉）。 */
  load<T = unknown>(owner: string, key: string): Promise<DraftRecord<T> | undefined>;
  remove(owner: string, key: string): Promise<void>;
  /** 刪掉這個擁有者的全部草稿（自己登出、帳號可能落在別人手上）。 */
  removeOwner(owner: string): Promise<void>;
  /** 只留這個擁有者的草稿（登入成為另一個人時，上一個人的草稿不留給他）。 */
  keepOnlyOwner(owner: string): Promise<void>;
}

export interface DraftStoreOptions {
  /** 預設 `globalThis.indexedDB`；測試可注入 `undefined` 只用記憶體。 */
  indexedDB?: IDBFactory | undefined;
  /** 預設 `globalThis.crypto.subtle`。 */
  subtle?: SubtleCrypto | undefined;
  now?: () => number;
  /** 預設 24 小時。 */
  ttlMs?: number;
  /** 預設 20 筆；超過時刪掉最舊的。 */
  maxEntries?: number;
  /** 預設 256 KiB（序列化後的 UTF-8 位元組）。 */
  maxBytes?: number;
}

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_MAX_ENTRIES = 20;
export const DRAFT_MAX_BYTES = 256 * 1024;

interface StoredDraft {
  owner: string;
  key: string;
  iv: Uint8Array<ArrayBuffer>;
  cipher: ArrayBuffer;
  savedAt: number;
}

/** 最小的鍵值介面：IndexedDB 與記憶體各一份實作。 */
interface Backend {
  get<T>(store: string, key: string): Promise<T | undefined>;
  put(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  values<T>(store: string): Promise<Array<{ key: string; value: T }>>;
}

const DB_NAME = 'b2b-system:drafts';
const DRAFTS = 'drafts';
const META = 'meta';
const KEY_ID = 'aes-gcm';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener('success', () => resolve(req.result));
    req.addEventListener('error', () => reject(req.error));
  });
}

async function openIndexedDb(factory: IDBFactory): Promise<Backend> {
  const open = factory.open(DB_NAME, 1);
  open.addEventListener('upgradeneeded', () => {
    for (const name of [DRAFTS, META]) {
      if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name);
    }
  });
  const db = await request(open);
  const run = <T>(
    store: string,
    mode: IDBTransactionMode,
    fn: (s: IDBObjectStore) => IDBRequest<T>,
  ) => request(fn(db.transaction(store, mode).objectStore(store)));
  return {
    get: <T>(store: string, key: string) =>
      run(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
    put: async (store, key, value) => {
      await run(store, 'readwrite', (s) => s.put(value, key));
    },
    delete: async (store, key) => {
      await run(store, 'readwrite', (s) => s.delete(key));
    },
    values: async <T>(store: string) => {
      const [keys, values] = await Promise.all([
        run(store, 'readonly', (s) => s.getAllKeys()),
        run(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
      ]);
      return keys.map((key, index) => ({ key: String(key), value: values[index] as T }));
    },
  };
}

function memoryBackend(): Backend {
  const stores = new Map<string, Map<string, unknown>>();
  const of = (store: string) => {
    let map = stores.get(store);
    if (!map) stores.set(store, (map = new Map()));
    return map;
  };
  return {
    get: async <T>(store: string, key: string) => of(store).get(key) as T | undefined,
    put: async (store, key, value) => {
      of(store).set(key, value);
    },
    delete: async (store, key) => {
      of(store).delete(key);
    },
    values: async <T>(store: string) =>
      [...of(store)].map(([key, value]) => ({ key, value: value as T })),
  };
}

const recordKey = (owner: string, key: string) => `${owner}\n${key}`;

export function createDraftStore(options: DraftStoreOptions = {}): DraftStore {
  const factory = 'indexedDB' in options ? options.indexedDB : globalThis.indexedDB;
  const subtle = 'subtle' in options ? options.subtle : globalThis.crypto?.subtle;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DRAFT_TTL_MS;
  const maxEntries = options.maxEntries ?? DRAFT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DRAFT_MAX_BYTES;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let backend: Promise<Backend> | undefined;
  const db = (): Promise<Backend> => {
    // 沒有 WebCrypto 就不寫 IndexedDB：不在磁碟上留明文
    backend ??=
      factory && subtle
        ? openIndexedDb(factory).catch(() => memoryBackend())
        : Promise.resolve(memoryBackend());
    return backend;
  };

  let cryptoKey: Promise<CryptoKey | undefined> | undefined;
  const keyOf = (): Promise<CryptoKey | undefined> => {
    cryptoKey ??= (async () => {
      if (!subtle) return undefined;
      const store = await db();
      const existing = await store.get<CryptoKey>(META, KEY_ID);
      if (existing) return existing;
      const created = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
        'encrypt',
        'decrypt',
      ]);
      await store.put(META, KEY_ID, created);
      return created;
    })().catch(() => undefined);
    return cryptoKey;
  };

  const all = async () => (await db()).values<StoredDraft>(DRAFTS);

  return {
    async save(owner, key, data) {
      const plain = encoder.encode(JSON.stringify(data));
      if (plain.byteLength > maxBytes) return false;
      const aes = await keyOf();
      if (!subtle || !aes) return false;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain);
      const store = await db();
      await store.put(DRAFTS, recordKey(owner, key), {
        owner,
        key,
        iv,
        cipher,
        savedAt: now(),
      } satisfies StoredDraft);
      // 超過筆數：刪掉最舊的
      const entries = await all();
      const excess = entries
        .toSorted((a, b) => a.value.savedAt - b.value.savedAt)
        .slice(0, Math.max(0, entries.length - maxEntries));
      await Promise.all(excess.map((entry) => store.delete(DRAFTS, entry.key)));
      return true;
    },

    async load<T>(owner: string, key: string) {
      const store = await db();
      const id = recordKey(owner, key);
      const stored = await store.get<StoredDraft>(DRAFTS, id);
      if (!stored) return undefined;
      const aes = await keyOf();
      if (stored.savedAt + ttlMs <= now() || !subtle || !aes) {
        await store.delete(DRAFTS, id);
        return undefined;
      }
      try {
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: stored.iv }, aes, stored.cipher);
        return { data: JSON.parse(decoder.decode(plain)) as T, savedAt: stored.savedAt };
      } catch {
        // 金鑰換過（例：清掉了 meta）或內容損壞：解不開就丟掉
        await store.delete(DRAFTS, id);
        return undefined;
      }
    },

    async remove(owner, key) {
      await (await db()).delete(DRAFTS, recordKey(owner, key));
    },

    async removeOwner(owner) {
      const store = await db();
      const entries = await all();
      await Promise.all(
        entries
          .filter((entry) => entry.value.owner === owner)
          .map((entry) => store.delete(DRAFTS, entry.key)),
      );
    },

    async keepOnlyOwner(owner) {
      const store = await db();
      const entries = await all();
      await Promise.all(
        entries
          .filter((entry) => entry.value.owner !== owner)
          .map((entry) => store.delete(DRAFTS, entry.key)),
      );
    },
  };
}
