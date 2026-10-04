import { computed, signal, untracked } from '@sigrea/core';

import { watch } from './watch';

/** `replace` 為 `true` 時以 `partial` 取代整份狀態（同 Zustand），否則合併。 */
export type SetState<T> = (
  partial: Partial<T> | ((state: T) => Partial<T>),
  replace?: boolean,
) => void;

export type StateCreator<T> = (set: SetState<T>, get: () => T) => T;

/** 可追蹤的唯讀值：在 `computed()` / `useComputed()` 裡讀 `.value` 會被記為依賴；`peek()` 不會。 */
export interface ReadonlySource<T> {
  readonly value: T;
  peek(): T;
}

export interface StoreApi<T> {
  /** 目前的快照，**不** 追蹤依賴——給 action、事件處理與非響應式程式碼用。 */
  getState: () => T;
  setState: SetState<T>;
  /** 狀態改變後同步通知；沒有欄位真的改變的 `setState` 不通知。 */
  subscribe: (listener: (state: T, previous: T) => void) => () => void;
  /**
   * 追蹤依賴的唯讀視圖：在 `computed()` / `select()` / `useComputed()` 裡讀 `state.count`，
   * 只會依賴 `count` 這個欄位，其他欄位變動不會讓它重算。
   */
  readonly state: Readonly<T>;
  /** 衍生值：`selector` 收到的是 `state`（追蹤依賴），只在讀到的欄位變動、且結果不同時才通知。 */
  select: <U>(selector: (state: Readonly<T>) => U) => ReadonlySource<U>;
}

/**
 * 以 `@sigrea/core` 的 signal 為底的 store，不依賴任何 UI 框架（React 綁定見 `./react`）。
 *
 * - 整份狀態是 **一個** signal，`setState` 一次寫入：多個欄位同時改變只通知一次，訂閱者看不到中間狀態。
 * - 每個欄位各有一個 `computed` 從快照取值：讀 `state.<key>` 只依賴那個欄位，
 *   其他欄位變動時 computed 的值不變，依賴它的衍生值與元件不會重算。
 * - `setState` 以 `Object.is` 比對欄位，全部相同就不寫入——傳入新的 `Set` / 物件才算改變；`replace` 一律寫入。
 */
export function createStore<T extends object>(creator: StateCreator<T>): StoreApi<T> {
  const snapshot = signal<T>({} as T);
  const fields = new Map<PropertyKey, ReadonlySource<unknown>>();

  const getState = () => snapshot.peek();

  const setState: SetState<T> = (partial, replace = false) => {
    const current = snapshot.peek();
    const next = typeof partial === 'function' ? partial(current) : partial;
    if (replace) {
      snapshot.value = { ...next } as T;
      return;
    }
    const changed = (Object.keys(next) as (keyof T)[]).some(
      (key) => !Object.is(next[key], current[key]),
    );
    if (changed) snapshot.value = { ...current, ...next };
  };

  const subscribe: StoreApi<T>['subscribe'] = (listener) => watch(() => snapshot.value, listener);

  const field = (key: PropertyKey): ReadonlySource<unknown> => {
    let source = fields.get(key);
    if (!source) {
      source = computed(() => (snapshot.value as Record<PropertyKey, unknown>)[key]);
      fields.set(key, source);
    }
    return source;
  };

  const state = new Proxy({} as Readonly<T>, {
    get: (_, key) => field(key).value,
    // 列舉欄位時無從得知會用到哪些，只能依賴整份快照
    has: (_, key) => key in snapshot.value,
    ownKeys: () => Reflect.ownKeys(snapshot.value),
    getOwnPropertyDescriptor: (_, key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(snapshot.value, key);
      return descriptor && { ...descriptor, configurable: true, writable: false };
    },
    set: () => {
      throw new TypeError('store.state 是唯讀的，請用 setState 修改');
    },
  });

  const select: StoreApi<T>['select'] = (selector) => computed(() => selector(state));

  snapshot.value = untracked(() => creator(setState, getState));

  return { getState, setState, subscribe, state, select };
}
