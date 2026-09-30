import { useMemo } from 'react';

import { useHeaderToolbarStore } from '@/core/store';

import { getHeaderTools, resolveHeaderTools } from './registry';
import type { ResolvedHeaderTool } from './registry';

/** 套用使用者設定後的頂列工具（含隱藏的，`visible` 標示）；設定在其他分頁改了也會跟著更新。 */
export function useHeaderTools(): ResolvedHeaderTool[] {
  const settings = useHeaderToolbarStore((state) => state.settings);
  // 登記只發生在 plugin 的同步階段，render 期間不會再變
  return useMemo(() => resolveHeaderTools(getHeaderTools(), settings), [settings]);
}
