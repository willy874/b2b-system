import { EventEmitter } from '@/shared/EventEmitter';
import type { ListenerDict } from '@/shared/EventEmitter';

import type { CoreContext, PluginFactory, PluginResults, PluginState } from './type';

interface RegisteredPlugin<Attrs> {
  results: PluginResults<Attrs>;
  cleanups: Array<() => void>;
}

/**
 * Plugin 容器。
 * - `use()` 同步執行 factory，attrs 立刻合併到 context（權限註冊必須在這個階段）
 * - `load()` 依註冊順序依序 await 每個 `onInit`（I/O 在這個階段）
 * - `destroy()` 逆向清理，每個 plugin 各自 try/catch
 */
export function createCoreContext<
  Attrs extends object,
  State extends PluginState = PluginState,
  Events extends ListenerDict = ListenerDict,
>(): CoreContext<Attrs, State, Events> {
  const plugins = new Map<string, RegisteredPlugin<Attrs>>();
  const state = new Map<keyof State, State[keyof State]>();
  const emitter = new EventEmitter<Events>();

  const prop = <K extends keyof State>(key: K, value?: State[K]): State[K] | undefined => {
    if (value !== undefined) state.set(key, value);
    return state.get(key) as State[K] | undefined;
  };

  const context = {
    prop,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  } as CoreContext<Attrs, State, Events>;

  const destroyPlugin = (name: string): void => {
    const plugin = plugins.get(name);
    if (!plugin) return;
    try {
      plugin.results.onDestroy?.();
      for (const cleanup of plugin.cleanups) cleanup();
    } catch (error) {
      // 清理失敗不能中斷後續 plugin 的清理；shared/ 沒有 logger 可用，只能回報到 console
      // oxlint-disable-next-line no-console
      console.error(`[context] plugin "${name}" 清理失敗`, error);
    }
    plugins.delete(name);
  };

  context.use = (factory: PluginFactory<Attrs, State, Events>) => {
    const cleanups: Array<() => void> = [];
    const results = factory({
      prop,
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      clearup: (fn) => cleanups.push(fn),
      getInstance: () => context,
    });

    if (plugins.has(results.name)) destroyPlugin(results.name);
    plugins.set(results.name, { results, cleanups });
    Object.assign(context, results.attrs ?? {});
    return context;
  };

  context.load = async () => {
    for (const { results } of plugins.values()) {
      await results.onInit?.();
    }
    return context;
  };

  context.destroy = () => {
    for (const name of [...plugins.keys()].reverse()) destroyPlugin(name);
    state.clear();
    emitter.clear();
  };

  return context;
}
