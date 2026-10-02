import { createStore } from '@/shared/store';

/**
 * 可啟用 feature 的狀態（docs/architecture/frontend/02-plugin-system.md §9.2 D8）。
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
  /**
   * 目前生效為開的 feature flag（docs/architecture/05-tenancy.md §11.2 D6、D9），來自 `/auth/profile` 的 `flags`。
   * 讀取用 `useFlag()`；profile 還沒到時是空的（一律視為關）。
   */
  flags: ReadonlySet<string>;
}

export const featureStore = createStore<FeatureState>(() => ({
  resolved: false,
  statuses: new Map(),
  basePaths: new Map(),
  flags: new Set(),
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
  featureStore.setState(
    { resolved: false, statuses: new Map(), basePaths: new Map(), flags: new Set() },
    true,
  );
}
