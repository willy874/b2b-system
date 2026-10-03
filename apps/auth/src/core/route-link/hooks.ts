import { useCallback } from 'react';

import { useStore } from '@/shared/hooks';

import { resolveRouteLink, routeLinkRegistry } from './registry';
import type { ResolvedRouteLink, RouteLinkRef } from './registry';

/**
 * 回傳解析連結的函式；註冊表變了（feature 在執行期安裝或卸載）時換新的參考，讓用到它的元件重渲染
 * （docs/architecture/frontend/02-plugin-system.md §6：讀取端一律訂閱）。
 */
export function useRouteLinkResolver(): (
  link: RouteLinkRef | null | undefined,
) => ResolvedRouteLink | undefined {
  const entries = useStore(routeLinkRegistry.store, (state) => state.entries);
  return useCallback((link) => resolveRouteLink(link, entries), [entries]);
}
