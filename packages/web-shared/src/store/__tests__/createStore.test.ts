import { describe, expect, it, vi } from 'vitest';

import { computed } from '..';
import { createStore } from '../createStore';

interface CounterStore {
  count: number;
  label: string;
  increment: () => void;
}

function createCounter() {
  return createStore<CounterStore>((set) => ({
    count: 0,
    label: 'counter',
    increment: () => set((state) => ({ count: state.count + 1 })),
  }));
}

describe('createStore', () => {
  it('setState 以函式形式更新', () => {
    const store = createCounter();
    store.getState().increment();
    expect(store.getState().count).toBe(1);
  });

  it('setState 以物件形式合併', () => {
    const store = createCounter();
    store.setState({ label: 'changed' });
    expect(store.getState()).toMatchObject({ label: 'changed', count: 0 });
  });

  it('訂閱者會收到新舊值，取消後不再收到', () => {
    const store = createCounter();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().increment();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 0 }),
    );

    unsubscribe();
    store.getState().increment();
    expect(listener).toHaveBeenCalledOnce();
  });

  it('沒有欄位改變的 setState 不通知', () => {
    const store = createCounter();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 0, label: 'counter' });
    expect(listener).not.toHaveBeenCalled();
  });

  it('一次改多個欄位只通知一次', () => {
    const store = createCounter();
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 5, label: 'five' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('訂閱者裡再 setState：每次通知的舊值都是上一次通知的新值', () => {
    const store = createCounter();
    const calls: [number, number][] = [];
    store.subscribe((state, previous) => {
      calls.push([state.count, previous.count]);
      if (state.count === 1) store.setState({ count: 2 });
    });

    store.setState({ count: 1 });
    expect(calls).toEqual([
      [1, 0],
      [2, 1],
    ]);
  });

  it('state 只追蹤讀到的欄位', () => {
    const store = createCounter();
    const getter = vi.fn(() => store.state.count * 2);
    const doubled = computed(getter);

    expect(doubled.value).toBe(0);
    store.setState({ label: 'other' });
    expect(doubled.value).toBe(0);
    expect(getter).toHaveBeenCalledOnce();

    store.setState({ count: 3 });
    expect(doubled.value).toBe(6);
    expect(getter).toHaveBeenCalledTimes(2);
  });

  it('state 是唯讀的', () => {
    const store = createCounter();
    expect(() => {
      (store.state as CounterStore).count = 1;
    }).toThrow(TypeError);
  });

  it('select 可以跨 store 組合', () => {
    const a = createCounter();
    const b = createCounter();
    const total = computed(() => a.state.count + b.state.count);
    const label = a.select((state) => state.label.toUpperCase());

    a.setState({ count: 1 });
    b.setState({ count: 2 });
    expect(total.value).toBe(3);
    expect(label.value).toBe('COUNTER');
  });

  it('replace 以傳入的內容取代整份狀態，即使欄位沒變也通知', () => {
    const store = createStore<{ a?: number; b?: number }>(() => ({ a: 1, b: 2 }));
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ a: 1 }, true);

    expect(store.getState()).toEqual({ a: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('state 可以列舉欄位、用 in 判斷欄位是否存在', () => {
    const store = createStore<{ a: number; b?: string }>(() => ({ a: 1 }));

    expect('a' in store.state).toBe(true);
    expect('b' in store.state).toBe(false);
    expect(Object.keys(store.state)).toEqual(['a']);
    expect({ ...store.state }).toEqual({ a: 1 });
    expect(Object.getOwnPropertyDescriptor(store.state, 'a')).toMatchObject({
      value: 1,
      writable: false,
    });
    expect(Object.getOwnPropertyDescriptor(store.state, 'b')).toBeUndefined();
  });

  it('列舉 state 的衍生值在任何欄位變動時都會更新', () => {
    const store = createStore<{ a: number; b: number }>(() => ({ a: 1, b: 2 }));
    const keys = computed(() => Object.keys(store.state).length);
    expect(keys.value).toBe(2);

    store.setState({ c: 3 } as never);

    expect(keys.value).toBe(3);
  });
});
