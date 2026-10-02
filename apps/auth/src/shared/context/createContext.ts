import { EventEmitter } from '@/shared/EventEmitter';
import type { ListenerDict } from '@/shared/EventEmitter';
import { collectRegistrations } from '@/shared/registry';
import { createStore, watch as watchStore } from '@/shared/store';

import type {
  ContextWatch,
  CoreContext,
  DynamicPluginFactory,
  PluginFactory,
  PluginResults,
  PluginState,
  PluginStatus,
  PropAccessor,
} from './type';

interface RegisteredPlugin<Attrs> {
  results: PluginResults<Attrs>;
  cleanups: Array<() => void>;
  watches: Set<() => void>;
  status: PluginStatus;
  /** 進行中或已完成的 `onInit`；同一個 plugin 只初始化一次。 */
  init?: Promise<void>;
}

/**
 * Plugin 容器。
 * - `use()` 同步執行 factory，attrs 立刻合併到 context（權限註冊必須在這個階段）
 * - `load()` 依註冊順序依序 await 每個 **尚未初始化** 的 `onInit`（I/O 在這個階段）；可以重複呼叫
 * - `install()` / `uninstall()`：App 啟動後才決定的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D2）。
 *   `install` 同步註冊後只初始化這一個 plugin；失敗時自動卸載，不影響其他 plugin
 * - `destroy()` 逆向清理，每個 plugin 各自 try/catch；最後停止 context 層級的 `watch`、清空狀態
 *
 * factory 與 `onInit` 同步部分裡的註冊表登記（`@/shared/registry`）會被收集起來，plugin 卸載時一併撤回。
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
    plugins.delete(name);
    // 每一步各自 try/catch：onDestroy 失敗仍要撤回註冊表登記，否則之後重新安裝會撞到「already registered」
    const steps = [() => plugin.results.onDestroy?.(), ...plugin.watches, ...plugin.cleanups];
    for (const step of steps) {
      try {
        step();
      } catch (error) {
        // 清理失敗不能中斷後續的清理；shared/ 沒有 logger 可用，只能回報到 console
        // oxlint-disable-next-line no-console
        console.error(`[context] plugin "${name}" 清理失敗`, error);
      }
    }
  };

  const register = (factory: PluginFactory<Attrs, State, Events>): PluginResults<Attrs> => {
    const cleanups: Array<() => void> = [];
    const watches = new Set<() => void>();
    const { result: results, dispose } = collectRegistrations(() =>
      factory({
        state,
        prop,
        watch: watchInto(watches),
        on: emitter.on.bind(emitter),
        off: emitter.off.bind(emitter),
        emit: emitter.emit.bind(emitter),
        clearup: (fn) => cleanups.push(fn),
        getInstance: () => context,
      }),
    );
    cleanups.push(dispose);

    if (plugins.has(results.name)) destroyPlugin(results.name);
    plugins.set(results.name, { results, cleanups, watches, status: 'registered' });
    return results;
  };

  const initPlugin = (name: string): Promise<void> => {
    const plugin = plugins.get(name);
    if (!plugin) return Promise.resolve();
    plugin.init ??= (async () => {
      plugin.status = 'initializing';
      try {
        // 語系包這類在 onInit 裡的登記同樣要能撤回；只收得到同步的部分
        const { result, dispose } = collectRegistrations(() => plugin.results.onInit?.());
        plugin.cleanups.push(dispose);
        await result;
        plugin.status = 'ready';
      } catch (error) {
        plugin.status = 'failed';
        throw error;
      }
    })();
    return plugin.init;
  };

  context.use = (factory: PluginFactory<Attrs, State, Events>) => {
    const results = register(factory);
    Object.assign(context, results.attrs ?? {});
    return context;
  };

  context.load = async () => {
    // 逐一 await：後面的 plugin 可能依賴前面的初始化結果（例：httpContext 之後才有 session）
    for (const name of plugins.keys()) {
      await initPlugin(name);
    }
    return context;
  };

  context.install = async (factory: DynamicPluginFactory<Attrs, State, Events>) => {
    const results = register(factory);
    // attrs 的型別由 declaration merging 永遠存在，執行期卻可能被卸載，是型別說謊（docs/architecture/frontend/02-plugin-system.md §9.2 D3）
    if ('attrs' in results && results.attrs !== undefined) {
      destroyPlugin(results.name);
      throw new Error(`plugin "${results.name}" 以 install() 安裝，不可提供 attrs`);
    }
    const entry = plugins.get(results.name);
    try {
      await initPlugin(results.name);
    } catch (error) {
      // 安裝期間被卸載或被同名 plugin 取代時，不去動新的那一個
      if (plugins.get(results.name) === entry) destroyPlugin(results.name);
      throw error;
    }
    return results.name;
  };

  context.uninstall = (name: string) => destroyPlugin(name);

  context.pluginStatus = (name: string) => plugins.get(name)?.status;

  context.destroy = () => {
    for (const name of [...plugins.keys()].reverse()) destroyPlugin(name);
    for (const stop of contextWatches) stop();
    state.setState({}, true);
    emitter.clear();
  };

  return context;
}
