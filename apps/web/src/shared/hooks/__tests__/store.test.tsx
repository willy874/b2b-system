import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { create, useComputed, useStore, useValue } from '../store';

interface CounterStore {
  count: number;
  label: string;
  increment: () => void;
}

function createCounter() {
  return create<CounterStore>((set) => ({
    count: 0,
    label: 'counter',
    increment: () => set((state) => ({ count: state.count + 1 })),
  }));
}

describe('create（React 綁定）', () => {
  it('以 selector 讀取，改變時重渲染', () => {
    const useCounter = createCounter();
    const { result } = renderHook(() => useCounter((state) => state.count));

    act(() => useCounter.getState().increment());
    expect(result.current).toBe(1);
  });

  it('無關欄位變動不重渲染', () => {
    const useCounter = createCounter();
    const onRender = vi.fn();
    function Count() {
      onRender();
      return <span>{useCounter((state) => state.count)}</span>;
    }
    render(<Count />);

    act(() => useCounter.setState({ label: 'other' }));
    expect(onRender).toHaveBeenCalledOnce();
  });
});

describe('useStore', () => {
  it('沒有 selector 時回傳整份狀態', () => {
    const useCounter = createCounter();
    const { result } = renderHook(() => useStore(useCounter));

    act(() => useCounter.setState({ label: 'changed' }));
    expect(result.current.label).toBe('changed');
  });
});

describe('useValue', () => {
  it('訂閱 select() 的結果', () => {
    const useCounter = createCounter();
    const doubled = useCounter.select((state) => state.count * 2);
    const { result } = renderHook(() => useValue(doubled));

    act(() => useCounter.setState({ count: 4 }));
    expect(result.current).toBe(8);
  });
});

describe('useComputed', () => {
  it('跨 store 追蹤依賴，只在讀到的欄位改變時重渲染', () => {
    const a = createCounter();
    const b = createCounter();
    const onRender = vi.fn();
    function Total({ offset }: { offset: number }) {
      onRender();
      const total = useComputed(() => a.state.count + b.state.count + offset, [offset]);
      return <span>{total}</span>;
    }
    const { rerender } = render(<Total offset={0} />);

    act(() => a.setState({ count: 1 }));
    act(() => b.setState({ count: 2 }));
    expect(screen.getByText('3')).toBeInTheDocument();

    const before = onRender.mock.calls.length;
    act(() => a.setState({ label: 'other' }));
    expect(onRender).toHaveBeenCalledTimes(before);

    rerender(<Total offset={10} />);
    expect(screen.getByText('13')).toBeInTheDocument();
  });
});
