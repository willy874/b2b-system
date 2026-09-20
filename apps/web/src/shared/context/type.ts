import type { EventEmitter, ListenerDict } from '@/shared/EventEmitter';

export type PluginState = Record<string, unknown>;

export interface PluginResults<Attrs> {
  /** 唯一；同名會先 destroy 舊的再取代。 */
  name: string;
  attrs?: Partial<Attrs>;
  onInit?: () => void | Promise<void>;
  onDestroy?: () => void;
}

export interface PluginContext<Attrs, State extends PluginState, Events extends ListenerDict> {
  /** 讀寫 context 層級的狀態。 */
  prop: <K extends keyof State>(key: K, value?: State[K]) => State[K] | undefined;
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

export type CoreContext<Attrs, State extends PluginState, Events extends ListenerDict> = Attrs & {
  use: (factory: PluginFactory<Attrs, State, Events>) => CoreContext<Attrs, State, Events>;
  load: () => Promise<CoreContext<Attrs, State, Events>>;
  destroy: () => void;
  prop: <K extends keyof State>(key: K, value?: State[K]) => State[K] | undefined;
  on: EventEmitter<Events>['on'];
  off: EventEmitter<Events>['off'];
  emit: EventEmitter<Events>['emit'];
};
