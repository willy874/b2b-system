import { computed } from '@sigrea/core';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { DependencyList } from 'react';

import { createStore } from './createStore';
import type { ReadonlySource, StateCreator, StoreApi } from './createStore';
import { watch } from './watch';

export interface UseBoundStore<T> extends StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
}

const identity = <T>(value: T): T => value;

/**
 * 以 selector 讀 store：只在 selector 的結果（`Object.is`）改變時重渲染。
 * selector 每次渲染都可以是新的函式；回傳新物件或陣列會讓每次變更都重渲染，要組合多個欄位時改用 `useComputed`。
 */
export function useStore<T>(store: StoreApi<T>): T;
export function useStore<T, U>(store: StoreApi<T>, selector: (state: T) => U): U;
export function useStore<T, U>(store: StoreApi<T>, selector?: (state: T) => U): T | U {
  const select: (state: T) => T | U = selector ?? identity;
  const getSnapshot = () => select(store.getState());
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** 訂閱一個可追蹤的值（`store.select()`、`computed()` 的結果）。 */
export function useValue<T>(source: ReadonlySource<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) => watch(() => source.value, onChange),
    [source],
  );
  const getSnapshot = () => source.peek();
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * 依賴追蹤的衍生值：`getter` 裡讀到的 `store.state.<key>`（可以跨多個 store）自動成為依賴，
 * 只有那些欄位變動、且結果不同時才重渲染。
 *
 * `getter` 只在 `deps` 改變時換新（同 `useMemo`）：閉包用到的 props 或 state 必須列進 `deps`，
 * store 的欄位則不必——它們由追蹤處理。
 *
 * @example
 * const canEdit = useComputed(() => permission.state.permissions.has(key) && !layout.state.readonly, [key]);
 */
export function useComputed<T>(getter: () => T, deps: DependencyList): T {
  // deps 由呼叫端決定（同 useMemo），無法是陣列字面值
  // oxlint-disable-next-line react/use-memo, react-hooks/exhaustive-deps
  const source = useMemo(() => computed(getter), deps);
  return useValue(source);
}

/**
 * 建立 store 並回傳可直接當 hook 用的函式；介面與 Zustand 的 `create` 相容：
 *
 * ```ts
 * const useCounter = create<Counter>((set) => ({ count: 0, inc: () => set((s) => ({ count: s.count + 1 })) }));
 * const count = useCounter((s) => s.count);
 * useCounter.getState().inc();
 * ```
 *
 * 讀取一律用 selector，避免無關欄位變動造成重渲染。
 */
export function create<T extends object>(creator: StateCreator<T>): UseBoundStore<T> {
  const store = createStore(creator);
  const useBoundStore = <U>(selector?: (state: T) => U) =>
    useStore(store, selector ?? (identity as (state: T) => U));
  return Object.assign(useBoundStore, store) as UseBoundStore<T>;
}
