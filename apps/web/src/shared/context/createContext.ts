import { EventEmitter } from '@/shared/EventEmitter';
import type { ListenerDict } from '@/shared/EventEmitter';
import { createStore, watch as watchStore } from '@/shared/store';

import type {
  ContextWatch,
  CoreContext,
  PluginFactory,
  PluginResults,
  PluginState,
  PropAccessor,
} from './type';

interface RegisteredPlugin<Attrs> {
  results: PluginResults<Attrs>;
  cleanups: Array<() => void>;
  watches: Set<() => void>;
}

/**
 * Plugin 容器。
 * - `use()` 同步執行 factory，attrs 立刻合併到 context（權限註冊必須在這個階段）
 * - `load()` 依註冊順序依序 await 每個 `onInit`（I/O 在這個階段）
 * - `destroy()` 逆向清理，每個 plugin 各自 try/catch；最後停止 context 層級的 `watch`、清空狀態
 *
 * context 狀態是 `@/shared/store` 的 store（signal 為底、依賴追蹤），不依賴 React：
 * `prop()` / `state` / `watch()` 在 plugin、fetcher 等非 React 程式碼都能用。
 */
export function createCoreContext<
  Attrs extends object,
  State extends PluginState = PluginState,
  Events extends ListenerDict = ListenerDict,
>(): CoreContext<Attrs, State, Events> {
  const plugins = new Map<string, RegisteredPlugin<Attrs>>();
  const state = createStore<Partial<State>>(() => ({}));
  const emitter = new EventEmitter<Events>();
  const contextWatches = new Set<() => void>();

  const prop: PropAccessor<State> = (key, value) => {
    if (value !== undefined) state.setState({ [key]: value } as Partial<State>);
    return state.state[key];
  };

  /** 建立監聽並登記到 `stops`，回傳的停止函式也會把自己從 `stops` 移除。 */
  const watchInto =
    (stops: Set<() => void>): ContextWatch<State> =>
    (getter, callback, options) => {
      const stop = watchStore(() => getter(state.state), callback, options);
      const dispose = () => {
        stops.delete(dispose);
        stop();
      };
      stops.add(dispose);
      return dispose;
    };

  const context = {
    state,
    prop,
    watch: watchInto(contextWatches),
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  } as CoreContext<Attrs, State, Events>;

  const destroyPlugin = (name: string): void => {
    const plugin = plugins.get(name);
    if (!plugin) return;
    try {
      plugin.results.onDestroy?.();
      for (const stop of plugin.watches) stop();
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
    const watches = new Set<() => void>();
    const results = factory({
      state,
      prop,
      watch: watchInto(watches),
      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      emit: emitter.emit.bind(emitter),
      clearup: (fn) => cleanups.push(fn),
      getInstance: () => context,
    });

    if (plugins.has(results.name)) destroyPlugin(results.name);
    plugins.set(results.name, { results, cleanups, watches });
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
    for (const stop of contextWatches) stop();
    state.setState({}, true);
    emitter.clear();
  };

  return context;
}
