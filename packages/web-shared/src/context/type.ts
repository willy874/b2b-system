import type { EventEmitter, ListenerDict } from '../EventEmitter';
import type { StoreApi } from '../store';

export type PluginState = Record<string, unknown>;

/** 讀寫 context 層級的狀態：只給 `key` 是讀（在 `computed` / `watch` 裡會追蹤這個欄位），給 `value` 是寫。 */
export type PropAccessor<State extends PluginState> = <K extends keyof State>(
  key: K,
  value?: State[K],
) => State[K] | undefined;

/**
 * 依賴追蹤的監聽（`store/` 的 `watch`）：`getter` 讀到的 context 狀態或任何 store 欄位改變時同步呼叫。
 * 回傳停止監聽的函式；不手動停止也會在 plugin（或 context）destroy 時自動停止。
 */
export type ContextWatch<State extends PluginState> = <T>(
  getter: (state: Readonly<Partial<State>>) => T,
  callback: (value: T, previous: T) => void,
  options?: { immediate?: boolean },
) => () => void;

export interface PluginResults<Attrs> {
  /** 唯一；同名會先 destroy 舊的再取代。 */
  name: string;
  attrs?: Partial<Attrs>;
  onInit?: () => void | Promise<void>;
  onDestroy?: () => void;
}

export interface PluginContext<Attrs, State extends PluginState, Events extends ListenerDict> {
  /** context 層級的狀態 store（與 `CoreContext.state` 同一個），不依賴 React。 */
  state: StoreApi<Partial<State>>;
  prop: PropAccessor<State>;
  /** 同 `CoreContext.watch`，但在 **這個 plugin** destroy 時自動停止。 */
  watch: ContextWatch<State>;
  on: EventEmitter<Events>['on'];
  off: EventEmitter<Events>['off'];
  emit: EventEmitter<Events>['emit'];
  clearup: (fn: () => void) => void;
  /** 逃生口：取得整個 context（含其他 plugin 掛上的 attrs）。 */
  getInstance: () => CoreContext<Attrs, State, Events>;
}

export type PluginFactory<Attrs, State extends PluginState, Events extends ListenerDict> = (
  context: PluginContext<Attrs, State, Events>,
) => PluginResults<Attrs>;

/**
 * 以 `install()` 在 App 啟動後安裝的 plugin：不能提供 `attrs`
 * （docs/architecture/frontend/02-plugin-system.md §9.2 D3）。
 */
export type DynamicPluginFactory<Attrs, State extends PluginState, Events extends ListenerDict> = (
  context: PluginContext<Attrs, State, Events>,
) => Omit<PluginResults<Attrs>, 'attrs'> & { attrs?: never };

/** `registered`：已同步註冊、尚未初始化；`initializing`：`onInit` 進行中；`failed`：`onInit` 丟了例外。 */
export type PluginStatus = 'registered' | 'initializing' | 'ready' | 'failed';

export type CoreContext<Attrs, State extends PluginState, Events extends ListenerDict> = Attrs & {
  use: (factory: PluginFactory<Attrs, State, Events>) => CoreContext<Attrs, State, Events>;
  /** 初始化所有尚未初始化的 plugin；可以重複呼叫，已初始化的不會重跑。 */
  load: () => Promise<CoreContext<Attrs, State, Events>>;
  /**
   * App 啟動後安裝一個 plugin：同步註冊後只初始化它自己；`onInit` 失敗時自動卸載並把例外往外拋。
   * 同名的 plugin 會先被卸載再取代。回傳 plugin 的名稱（給 `uninstall` 用）。
   */
  install: (factory: DynamicPluginFactory<Attrs, State, Events>) => Promise<string>;
  /** 卸載：執行 `onDestroy`、停止它的 watch、撤回它的註冊表登記。沒有這個 plugin 時什麼都不做。 */
  uninstall: (name: string) => void;
  /** 沒有這個 plugin 時回 `undefined`。 */
  pluginStatus: (name: string) => PluginStatus | undefined;
  destroy: () => void;
  /** context 層級的狀態 store：framework-agnostic，React 端以 `useStore(context.state, …)` 讀取。 */
  state: StoreApi<Partial<State>>;
  prop: PropAccessor<State>;
  /** 在 context destroy 時自動停止。 */
  watch: ContextWatch<State>;
  on: EventEmitter<Events>['on'];
  off: EventEmitter<Events>['off'];
  emit: EventEmitter<Events>['emit'];
};
