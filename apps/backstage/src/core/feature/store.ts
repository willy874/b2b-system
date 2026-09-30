import { createStore } from '@/shared/store';

/**
 * 可啟用 feature 的狀態（docs/adr/0021-runtime-feature-activation.md D8）。
 * - `installing`：清單說要啟用，`context.install()` 進行中
 * - `ready`：已安裝，頁面可以進入
 * - `disabled`：清單沒有它（或已被卸載）
 * - `failed`：安裝時 `onInit` 丟了例外，已自動卸載；下一次套用清單時重試
 */
export type FeatureStatus = 'installing' | 'ready' | 'disabled' | 'failed';

export interface FeatureState {
  /** 這個 session 的啟用清單是否已經套用過一次；之前所有可啟用的 feature 都是「未定」。 */
  resolved: boolean;
  statuses: ReadonlyMap<string, FeatureStatus>;
  /** 每個可啟用 feature 擁有的 base path（`/file`），給 Layout 判斷目前頁面屬於誰。 */
  basePaths: ReadonlyMap<string, readonly string[]>;
}

export const featureStore = createStore<FeatureState>(() => ({
  resolved: false,
  statuses: new Map(),
  basePaths: new Map(),
}));

/** 找出擁有這個路徑的可啟用 feature；常駐 feature 的頁面回 `undefined`。 */
export function findFeatureByPath(
  pathname: string,
  basePaths: ReadonlyMap<string, readonly string[]> = featureStore.getState().basePaths,
): string | undefined {
  for (const [id, paths] of basePaths) {
    if (paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return id;
  }
  return undefined;
}

/** 測試用。 */
export function resetFeatureStore(): void {
  featureStore.setState({ resolved: false, statuses: new Map(), basePaths: new Map() }, true);
}
