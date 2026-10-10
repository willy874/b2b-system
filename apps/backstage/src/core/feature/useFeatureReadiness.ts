import { useStore } from '@b2b-system/web-shared/hooks';
import { useCallback } from 'react';

import { featureStore } from './store';

/**
 * 一次判斷多個可啟用 feature 是否已安裝；`null` 是常駐（永遠為 true）。
 *
 * 給「選項各自屬於不同 feature」的清單用（篩選的資源類型、事件類型…）：平台沒有啟用的 feature 的選項不列出，
 * 而不是停用或標成未啟用（docs/architecture/frontend/02-plugin-system.md §7）。選項數量不固定，
 * 不能逐一呼叫 `useIsFeatureReady`。回傳的函式只在 feature 的狀態改變時換新，可以放進 `useMemo` 的依賴。
 */
export function useFeatureReadiness(): (id: string | null) => boolean {
  const statuses = useStore(featureStore, (state) => state.statuses);
  return useCallback((id) => id === null || statuses.get(id) === 'ready', [statuses]);
}
