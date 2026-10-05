import { useStore } from '@b2b-system/web-shared/hooks';
import { useMemo } from 'react';

import { useHeaderToolbarStore } from '../store';
import { headerToolRegistry, resolveHeaderTools, sortHeaderTools } from './registry';
import type { ResolvedHeaderTool } from './registry';

/** 套用使用者設定後的頂列工具（含隱藏的，`visible` 標示）；設定在其他分頁改了也會跟著更新。 */
export function useHeaderTools(): ResolvedHeaderTool[] {
  const settings = useHeaderToolbarStore((state) => state.settings);
  // feature 可能在執行期安裝或卸載，登記的工具要訂閱（docs/architecture/frontend/02-plugin-system.md §9.2 D4）
  const tools = useStore(headerToolRegistry.store, (state) => state.entries);
  return useMemo(
    () => resolveHeaderTools(sortHeaderTools(tools.values()), settings),
    [settings, tools],
  );
}
