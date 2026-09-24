import { useSyncExternalStore } from 'react';

export type StateCreator<T> = (
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T,
) => T;

export interface StoreApi<T> {
  getState: () => T;
  setState: (partial: Partial<T> | ((state: T) => Partial<T>)) => void;
  subscribe: (listener: (state: T, previous: T) => void) => () => void;
}

export interface UseBoundStore<T> extends StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
}

/**
 * ~60 行的 signal store，介面刻意與 Zustand 相容。
 * 讀取一律用 selector，避免無關欄位變動造成重渲染。
 */
export function create<T extends object>(creator: StateCreator<T>): UseBoundStore<T> {
  let state: T;
  const listeners = new Set<(state: T, previous: T) => void>();

  const setState: StoreApi<T>['setState'] = (partial) => {
    const next = typeof partial === 'function' ? partial(state) : partial;
    const previous = state;
    state = { ...state, ...next };
    for (const listener of listeners) listener(state, previous);
  };

  const getState = () => state;
  const subscribe: StoreApi<T>['subscribe'] = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  state = creator(setState, getState);

  // 沒有 selector 時 U 就是 T；TS 無法從可選參數推導出這個關係，只能在這裡轉型
  const useStore = (<U>(selector?: (state: T) => U) =>
    useSyncExternalStore(
      subscribe,
      () => (selector ? selector(state) : (state as unknown as U)),
      () => (selector ? selector(state) : (state as unknown as U)),
    )) as UseBoundStore<T>;

  useStore.getState = getState;
  useStore.setState = setState;
  useStore.subscribe = subscribe;
  return useStore;
}
