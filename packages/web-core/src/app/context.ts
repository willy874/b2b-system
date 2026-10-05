import { createCoreContext } from '@b2b-system/web-shared/context';
import type {
  CoreContext,
  DynamicPluginFactory,
  PluginFactory,
  PluginState,
} from '@b2b-system/web-shared/context';

/** 各 plugin 以 declaration merging 擴充這個介面，核心不需要認識任何 plugin。 */
// oxlint-disable-next-line typescript/no-empty-object-type
export interface AppPluginProperties {}

export interface AppContextState extends PluginState {}

export type AppContextEvents = {
  'session:ended': (reason: string) => void;
  'permissions:changed': () => void;
};

export type AppContext = CoreContext<AppPluginProperties, AppContextState, AppContextEvents>;
export type AppPluginFactory = PluginFactory<
  AppPluginProperties,
  AppContextState,
  AppContextEvents
>;

/** 以 `context.install()` 在 App 啟動後安裝的 feature plugin（docs/architecture/frontend/02-plugin-system.md §9.2 D2、D3）。 */
export type AppDynamicPluginFactory = DynamicPluginFactory<
  AppPluginProperties,
  AppContextState,
  AppContextEvents
>;

let current: AppContext | undefined;

export function createAppContext(): AppContext {
  current = createCoreContext<AppPluginProperties, AppContextState, AppContextEvents>();
  return current;
}

/** 給 fetcher 等非 React 程式碼用。 */
export function getAppContext(): AppContext {
  if (!current) throw new Error('AppContext 尚未建立：請先呼叫 createAppContext()');
  return current;
}

export function hasAppContext(): boolean {
  return current !== undefined;
}
