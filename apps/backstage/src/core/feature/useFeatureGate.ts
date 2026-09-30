import { useStore } from '@/shared/hooks';

import { featureStore, findFeatureByPath } from './store';

/**
 * - `open`：不屬於任何可啟用的 feature，或該 feature 已安裝
 * - `pending`：清單還沒到、或正在安裝
 * - `disabled`：未啟用
 * - `failed`：安裝失敗
 */
export type FeatureGate = 'open' | 'pending' | 'disabled' | 'failed';

/**
 * 目前頁面所屬的可啟用 feature 是否可以渲染。Layout 的第二道防線（docs/adr/0021-runtime-feature-activation.md D7）：
 * 正常情況下 route 的 `requireFeature` 已經擋住，這裡確保未安裝的 feature 的頁面不會因為「頁面權限還沒註冊」而被放行。
 */
export function useFeatureGate(pathname: string): FeatureGate {
  return useStore(featureStore, (state) => {
    const id = findFeatureByPath(pathname, state.basePaths);
    if (id === undefined) return 'open';
    const status = state.statuses.get(id);
    if (status === 'ready') return 'open';
    if (status === 'disabled') return state.resolved ? 'disabled' : 'pending';
    if (status === 'failed') return 'failed';
    return 'pending';
  });
}

/** 某個可啟用 feature 目前是否已安裝。 */
export function useIsFeatureReady(id: string): boolean {
  return useStore(featureStore, (state) => state.statuses.get(id) === 'ready');
}
