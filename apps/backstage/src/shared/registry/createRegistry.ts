import { createStore } from '@/shared/store';
import type { StoreApi } from '@/shared/store';

import { trackRegistration } from './scope';

export interface RegistryState<K, V> {
  /** 每次變更都換成新的 `Map`：`useStore(registry.store, (s) => s.entries)` 才會重渲染。 */
  entries: ReadonlyMap<K, V>;
}

export interface Registry<K, V> {
  /**
   * 登記一筆；同一個 key 重複登記丟例外（不靜默覆寫）。
   * 回傳反註冊函式，並登記到目前的註冊範圍（`collectRegistrations`），plugin 卸載時自動執行。
   */
  register: (key: K, value: V) => () => void;
  get: (key: K) => V | undefined;
  has: (key: K) => boolean;
  keys: () => K[];
  values: () => V[];
  /** 可訂閱的狀態：React 端以 `useStore(registry.store, …)` 讀取，非 React 端用 `subscribe` / `watch`。 */
  store: StoreApi<RegistryState<K, V>>;
  /** 測試用。 */
  reset: () => void;
}

/**
 * 註冊表的共同實作（docs/adr/0021-runtime-feature-activation.md D4）：feature 可能在 App 啟動後才安裝、也可能被移除，
 * 所以讀取端要能訂閱變更，登記要能撤回。
 *
 * @param describe 重複登記時錯誤訊息裡的名稱，例：`Header tool`。
 */
export function createRegistry<K, V>(describe: string): Registry<K, V> {
  const store = createStore<RegistryState<K, V>>(() => ({ entries: new Map() }));
  const entries = () => store.getState().entries;

  const unregister = (key: K, value: V): void => {
    // 同一個 key 已被重新登記成別的值時，舊的反註冊函式不能把新的刪掉
    if (entries().get(key) !== value) return;
    const next = new Map(entries());
    next.delete(key);
    store.setState({ entries: next });
  };

  const register = (key: K, value: V): (() => void) => {
    if (entries().has(key)) throw new Error(`${describe} already registered: ${String(key)}`);
    store.setState({ entries: new Map(entries()).set(key, value) });
    const dispose = () => unregister(key, value);
    trackRegistration(dispose);
    return dispose;
  };

  return {
    register,
    get: (key) => entries().get(key),
    has: (key) => entries().has(key),
    keys: () => [...entries().keys()],
    values: () => [...entries().values()],
    store,
    reset: () => store.setState({ entries: new Map() }),
  };
}
