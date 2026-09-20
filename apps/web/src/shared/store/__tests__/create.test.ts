import { describe, expect, it, vi } from 'vitest';

import { create } from '../create';

interface CounterStore {
  count: number;
  label: string;
  increment: () => void;
}

function createStore() {
  return create<CounterStore>((set) => ({
    count: 0,
    label: 'counter',
    increment: () => set((state) => ({ count: state.count + 1 })),
  }));
}

describe('signal store', () => {
  it('setState 以函式形式更新', () => {
    const useStore = createStore();
    useStore.getState().increment();
    expect(useStore.getState().count).toBe(1);
  });

  it('setState 以物件形式合併', () => {
    const useStore = createStore();
    useStore.setState({ label: 'changed' });
    expect(useStore.getState()).toMatchObject({ label: 'changed', count: 0 });
  });

  it('訂閱者會收到新舊值', () => {
    const useStore = createStore();
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);

    useStore.getState().increment();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ count: 1 }),
      expect.objectContaining({ count: 0 }),
    );

    unsubscribe();
    useStore.getState().increment();
    expect(listener).toHaveBeenCalledOnce();
  });
});
