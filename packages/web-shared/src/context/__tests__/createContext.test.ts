import { describe, expect, it, vi } from 'vitest';

import { createRegistry } from '../../registry';
import { computed, createStore } from '../../store';
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

describe('createCoreContext 的執行期安裝（docs/architecture/frontend/02-plugin-system.md §9.2 D2）', () => {
  it('load() 可以重複呼叫，已初始化的 plugin 不會重跑 onInit', async () => {
    const context = createContext();
    const onInit = vi.fn();
    context.use(() => ({ name: 'a', onInit }));

    await context.load();
    await context.load();
    expect(onInit).toHaveBeenCalledOnce();
    expect(context.pluginStatus('a')).toBe('ready');
  });

  it('install() 只初始化新安裝的 plugin', async () => {
    const context = createContext();
    const resident = vi.fn();
    const dynamic = vi.fn();
    context.use(() => ({ name: 'resident', onInit: resident }));
    await context.load();

    const name = await context.install(() => ({ name: 'dynamic', onInit: dynamic }));
    expect(name).toBe('dynamic');
    expect(resident).toHaveBeenCalledOnce();
    expect(dynamic).toHaveBeenCalledOnce();
  });

  it('factory 與 onInit 同步部分的註冊表登記，在 uninstall 時撤回', async () => {
    const context = createContext();
    const registry = createRegistry<string, number>('Thing');

    await context.install(() => {
      registry.register('sync', 1);
      return { name: 'dynamic', onInit: () => void registry.register('init', 2) };
    });
    expect(registry.keys()).toEqual(['sync', 'init']);

    context.uninstall('dynamic');
    expect(registry.keys()).toEqual([]);
    expect(context.pluginStatus('dynamic')).toBeUndefined();
  });

  it('卸載後可以重新安裝同一個 plugin（不撞到 already registered）', async () => {
    const context = createContext();
    const registry = createRegistry<string, number>('Thing');
    const plugin = () => {
      registry.register('page', 1);
      return { name: 'dynamic' };
    };

    await context.install(plugin);
    context.uninstall('dynamic');
    await expect(context.install(plugin)).resolves.toBe('dynamic');
  });

  it('onInit 失敗時自動卸載、撤回登記，並把例外往外拋', async () => {
    const context = createContext();
    const registry = createRegistry<string, number>('Thing');
    const onDestroy = vi.fn();

    await expect(
      context.install(() => {
        registry.register('page', 1);
        return {
          name: 'broken',
          onInit: () => Promise.reject(new Error('boom')),
          onDestroy,
        };
      }),
    ).rejects.toThrow('boom');
    expect(registry.keys()).toEqual([]);
    expect(onDestroy).toHaveBeenCalledOnce();
    expect(context.pluginStatus('broken')).toBeUndefined();
  });

  it('onDestroy 丟例外時仍撤回登記', async () => {
    const context = createContext();
    const registry = createRegistry<string, number>('Thing');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await context.install(() => {
      registry.register('page', 1);
      return {
        name: 'dynamic',
        onDestroy: () => {
          throw new Error('boom');
        },
      };
    });
    context.uninstall('dynamic');

    expect(registry.keys()).toEqual([]);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('install() 的 plugin 提供 attrs 時拒絕並卸載', async () => {
    const context = createCoreContext<{ extra: number }, State>();

    await expect(
      // 型別已擋下 attrs；這裡驗證執行期同樣拒絕
      context.install(() => ({ name: 'with-attrs', attrs: { extra: 1 } }) as never),
    ).rejects.toThrow('不可提供 attrs');
    expect(context.pluginStatus('with-attrs')).toBeUndefined();
    expect(context.extra).toBeUndefined();
  });
});
