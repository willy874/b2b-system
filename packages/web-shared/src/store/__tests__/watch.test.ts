import { describe, expect, it, vi } from 'vitest';

import { createStore } from '../createStore';
import { watch } from '../watch';

function createPair() {
  return [createStore(() => ({ a: 1, b: 1 })), createStore(() => ({ c: 1 }))] as const;
}

describe('watch', () => {
  it('跨 store 追蹤，結果改變時同步呼叫並帶上舊值', () => {
    const [x, y] = createPair();
    const callback = vi.fn();
    watch(() => x.state.a + y.state.c, callback);

    x.setState({ a: 2 });
    y.setState({ c: 5 });
    expect(callback.mock.calls).toEqual([
      [3, 2],
      [7, 3],
    ]);
  });

  it('沒讀到的欄位、或結果沒變時不呼叫', () => {
    const [x] = createPair();
    const callback = vi.fn();
    watch(() => x.state.a > 0, callback);

    x.setState({ b: 2 });
    x.setState({ a: 3 });
    expect(callback).not.toHaveBeenCalled();
  });

  it('immediate 先以目前的值呼叫一次', () => {
    const [x] = createPair();
    const callback = vi.fn();
    watch(() => x.state.a, callback, { immediate: true });
    expect(callback).toHaveBeenCalledWith(1, 1);
  });

  it('停止後不再呼叫', () => {
    const [x] = createPair();
    const callback = vi.fn();
    const stop = watch(() => x.state.a, callback);

    stop();
    x.setState({ a: 2 });
    expect(callback).not.toHaveBeenCalled();
  });
});
