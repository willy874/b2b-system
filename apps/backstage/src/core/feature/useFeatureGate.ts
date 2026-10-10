import { useStore } from '@b2b-system/web-shared/hooks';

import { featureStore, findFeaturesByPath } from './store';
import type { FeatureState } from './store';

/**
 * - `open`：不屬於任何可啟用的 feature，或所屬的 feature 都已安裝
 * - `pending`：清單還沒到、或正在安裝
 * - `disabled`：未啟用
 * - `failed`：安裝失敗
 */
export type FeatureGate = 'open' | 'pending' | 'disabled' | 'failed';

/** 由嚴到寬；`open` 不列，沒有命中任何一個就是 `open`。 */
const GATE_SEVERITY: readonly FeatureGate[] = ['disabled', 'failed', 'pending'];

/**
 * 目前頁面所屬的可啟用 feature 是否可以渲染。Layout 的第二道防線（docs/architecture/frontend/02-plugin-system.md §9.2 D7）：
 * 正常情況下 route 的 `requireFeature` 已經擋住，這裡確保未安裝的 feature 的頁面不會因為「頁面權限還沒註冊」而被放行。
 */
export function useFeatureGate(pathname: string): FeatureGate {
  return useStore(featureStore, (state) => {
    const gates = new Set(
      findFeaturesByPath(pathname, state.basePaths).map((id) => gateOf(state, id)),
    );
    // 頁面同時屬於多個 feature 時（例：`/group/import` 屬於 group 與 dataTransfer），取最嚴的：任一個未啟用就是 404
    return GATE_SEVERITY.find((gate) => gates.has(gate)) ?? 'open';
  });
}

function gateOf(state: FeatureState, id: string): FeatureGate {
  const status = state.statuses.get(id);
  if (status === 'ready') return 'open';
  if (status === 'disabled') return state.resolved ? 'disabled' : 'pending';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/** 某個可啟用 feature 目前是否已安裝。 */
export function useIsFeatureReady(id: string): boolean {
  return useStore(featureStore, (state) => state.statuses.get(id) === 'ready');
}
