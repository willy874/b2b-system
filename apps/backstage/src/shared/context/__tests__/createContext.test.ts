import { describe, expect, it, vi } from 'vitest';

import { computed, createStore } from '@/shared/store';

import { createCoreContext } from '../createContext';

interface State extends Record<string, unknown> {
  locale: string;
  count: number;
}

function createContext() {
  return createCoreContext<object, State>();
}

describe('createCoreContext 的狀態 store', () => {
  it('prop 讀寫的是 context.state', () => {
    const context = createContext();
    context.prop('locale', 'zh_TW');

    expect(context.prop('locale')).toBe('zh_TW');
    expect(context.state.getState()).toEqual({ locale: 'zh_TW' });
  });

  it('prop 的讀取會被追蹤，只依賴讀到的欄位', () => {
    const context = createContext();
    context.prop('count', 1);
    const getter = vi.fn(() => (context.prop('count') ?? 0) * 2);
    const doubled = computed(getter);

    expect(doubled.value).toBe(2);
    context.prop('locale', 'en_US');
    expect(doubled.value).toBe(2);
    expect(getter).toHaveBeenCalledOnce();
  });

  it('watch 可同時追蹤 context 狀態與其他 store', () => {
    const context = createContext();
    const other = createStore(() => ({ offset: 10 }));
    const callback = vi.fn();
    context.watch((state) => (state.count ?? 0) + other.state.offset, callback);

    context.prop('count', 1);
    other.setState({ offset: 20 });
    expect(callback.mock.calls).toEqual([
      [11, 10],
      [21, 11],
    ]);
  });

  it('plugin 的 watch 在 plugin destroy 時自動停止', () => {
    const context = createContext();
    const callback = vi.fn();
    const plugin = () =>
      context.use((ctx) => {
        ctx.watch((state) => state.count, callback);
        return { name: 'counter' };
      });
    plugin();

    // 同名 plugin 取代時會 destroy 舊的：舊的監聽要停掉，只剩新的一個
    plugin();
    context.prop('count', 1);
    expect(callback).toHaveBeenCalledOnce();

    context.destroy();
    context.prop('count', 2);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('destroy 清空狀態並停止 context 層級的 watch', () => {
    const context = createContext();
    const callback = vi.fn();
    context.prop('count', 1);
    context.watch((state) => state.count, callback);

    context.destroy();
    expect(context.state.getState()).toEqual({});
    expect(callback).not.toHaveBeenCalled();
  });

  it('手動停止 watch', () => {
    const context = createContext();
    const callback = vi.fn();
    const stop = context.watch((state) => state.count, callback);

    stop();
    context.prop('count', 1);
    expect(callback).not.toHaveBeenCalled();
  });
});
