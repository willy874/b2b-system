import type { AppContext, AppDynamicPluginFactory } from '@/core/app';
import { routeBasePath } from '@/core/permission';

import { featureStore } from './store';
import type { FeatureStatus } from './store';

export interface FeatureDefinition {
  plugin: AppDynamicPluginFactory;
  /** 這個 feature 擁有的最上層 route 物件：用來判斷目前頁面屬於誰，以及掛上 `requireFeature`。 */
  routes: readonly unknown[];
  /**
   * 安裝條件（docs/architecture/05-tenancy.md §11.2 D9），列出的都要成立；省略 = `{ feature: <catalog 的 id> }`。
   * - `feature`：租戶啟用的 feature（`/auth/profile` 的 `features`，docs/architecture/frontend/02-plugin-system.md §9）
   * - `flag`：生效為開的 feature flag（`flags`）。試行中、之後會成為常駐的 feature 只宣告 `flag`；
   *   flag 移除時把它從 catalog 拿掉、改回 `main.tsx` 的 `.use()`
   */
  requires?: { feature?: string; flag?: string };
}

export interface FeatureActivatorOptions {
  context: AppContext;
  catalog: Readonly<Record<string, FeatureDefinition>>;
  /**
   * 卸載前呼叫：目前頁面屬於這個 feature 時，呼叫端負責離開（導向首頁、提示），並回傳導航完成的 promise。
   * 卸載會等它完成：頁面還掛著時撤回權限註冊，`requirePagePermission` 會丟例外。
   */
  beforeDisable?: (id: string, basePaths: readonly string[]) => void | Promise<void>;
  /**
   * 安裝完成後呼叫：目前頁面屬於這個 feature 時（例：停在它的 404），呼叫端讓 router 重新判斷，
   * route 的 `requireFeature` 已經擋過一次，不重跑就會一直停在 404。
   */
  afterEnable?: (id: string, basePaths: readonly string[]) => void;
  /** 安裝失敗（`onInit` 丟例外）。feature 已自動卸載，狀態是 `failed`。 */
  onInstallError?: (id: string, error: unknown) => void;
}

/**
 * 依啟用清單安裝與卸載 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D2、D8、D9）。
 * 每次 `apply()` 都排在上一次之後執行，清單快速變動時不會同時安裝又卸載同一個 feature。
 */
export class FeatureActivator {
  private readonly context: AppContext;
  private readonly catalog: Readonly<Record<string, FeatureDefinition>>;
  private readonly beforeDisable: FeatureActivatorOptions['beforeDisable'];
  private readonly afterEnable: FeatureActivatorOptions['afterEnable'];
  private readonly onInstallError: FeatureActivatorOptions['onInstallError'];
  /** feature id → 安裝後的 plugin 名稱。 */
  private readonly installed = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: FeatureActivatorOptions) {
    this.context = options.context;
    this.catalog = options.catalog;
    this.beforeDisable = options.beforeDisable;
    this.afterEnable = options.afterEnable;
    this.onInstallError = options.onInstallError;
    featureStore.setState({
      basePaths: new Map(
        Object.entries(this.catalog).map(([id, definition]) => [
          id,
          definition.routes.map((route) => routeBasePath(route)),
        ]),
      ),
    });
  }

  /**
   * 套用新的啟用清單與生效的 flag；不在 catalog 裡的 id 忽略（前端比後端舊或新時不會壞）。
   * flag 立即寫進 store（`useFlag` 同步反映），feature 的安裝與卸載排在上一次套用之後。
   */
  apply(enabled: readonly string[], flags: readonly string[] = []): Promise<void> {
    const features = new Set(enabled);
    const on = new Set(flags);
    featureStore.setState({ flags: on });
    const wanted = new Set(
      Object.entries(this.catalog)
        .filter(([id, definition]) => {
          const { feature, flag } = definition.requires ?? { feature: id };
          return (!feature || features.has(feature)) && (!flag || on.has(flag));
        })
        .map(([id]) => id),
    );
    this.queue = this.queue.then(() => this.reconcile(wanted));
    return this.queue;
  }

  private async reconcile(wanted: ReadonlySet<string>): Promise<void> {
    const ids = Object.keys(this.catalog);
    // 先卸載再安裝：兩者之間沒有相依，先撤掉的頁面越早離開越好
    for (const id of ids) {
      // oxlint-disable-next-line no-await-in-loop -- 逐一離開再卸載；目前頁面最多只屬於一個 feature
      if (!wanted.has(id)) await this.disable(id);
    }
    // 並行安裝：一個 feature 的 onInit 慢或失敗，不拖住其他的
    await Promise.all(ids.filter((id) => wanted.has(id)).map((id) => this.enable(id)));
    featureStore.setState({ resolved: true });
  }

  private async disable(id: string): Promise<void> {
    const name = this.installed.get(id);
    if (name !== undefined) {
      await this.beforeDisable?.(id, featureStore.getState().basePaths.get(id) ?? []);
      // 先標成 disabled 再撤回註冊：Layout 的 useFeatureGate 同一次渲染就不再掛著這個 feature 的頁面
      this.setStatus(id, 'disabled');
      this.context.uninstall(name);
      this.installed.delete(id);
    }
    this.setStatus(id, 'disabled');
  }

  private async enable(id: string): Promise<void> {
    if (this.installed.has(id)) return;
    const definition = this.catalog[id];
    if (!definition) return;
    this.setStatus(id, 'installing');
    try {
      this.installed.set(id, await this.context.install(definition.plugin));
      this.setStatus(id, 'ready');
    } catch (error) {
      this.setStatus(id, 'failed');
      this.onInstallError?.(id, error);
      return;
    }
    // 放在 try 之外：呼叫端的錯誤不該讓已經裝好的 feature 被標成 failed
    this.afterEnable?.(id, featureStore.getState().basePaths.get(id) ?? []);
  }

  private setStatus(id: string, status: FeatureStatus): void {
    const statuses = featureStore.getState().statuses;
    if (statuses.get(id) === status) return;
    featureStore.setState({ statuses: new Map(statuses).set(id, status) });
  }
}
