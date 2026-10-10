import { createStore } from '@b2b-system/web-shared/store';

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

/**
 * 找出擁有這個路徑的所有可啟用 feature，base path 越長（越具體）的排越前面；常駐 feature 的頁面回空陣列。
 * 一個頁面可能同時屬於兩個 feature：`/group/import` 屬於 `group`（`/group`）也屬於 `dataTransfer`（`/group/import`），
 * 兩個都要啟用才進得去（route 的 `beforeLoad` 也是兩個都檢查），所以不能只取第一個命中的。
 */
export function findFeaturesByPath(
  pathname: string,
  basePaths: ReadonlyMap<string, readonly string[]> = featureStore.getState().basePaths,
): string[] {
  const matches: Array<{ id: string; length: number }> = [];
  for (const [id, paths] of basePaths) {
    const owned = paths.filter((path) => pathname === path || pathname.startsWith(`${path}/`));
    if (owned.length > 0)
      matches.push({ id, length: Math.max(...owned.map((path) => path.length)) });
  }
  return matches.toSorted((a, b) => b.length - a.length).map(({ id }) => id);
}

/** 測試用。 */
export function resetFeatureStore(): void {
  featureStore.setState(
    { resolved: false, statuses: new Map(), basePaths: new Map(), flags: new Set() },
    true,
  );
}
