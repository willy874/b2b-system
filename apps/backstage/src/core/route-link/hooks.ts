import { useCallback } from 'react';

import { usePageAccess } from '@/core/permission';
import { useStore } from '@/shared/hooks';

import { resolveRouteLink, routeLinkPathname, routeLinkRegistry } from './registry';
import type { ResolvedRouteLink, RouteLinkParams, RouteLinkRef } from './registry';

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

/**
 * 連結能不能點（docs/architecture/frontend/03-feature-anatomy.md §4.1）：
 * - `unavailable`：route id 沒登記（所屬 feature 沒安裝或已卸載）或缺參數
 * - `pending`：目標頁受權限管制，但權限還沒水合
 * - `forbidden`：檢視者進不了目標頁（與 route guard 同一個判斷：`usePageAccess`）
 * - `ready`：可以點
 */
export type RouteLinkAccess =
  | { status: 'ready'; link: ResolvedRouteLink }
  | { status: 'unavailable' | 'pending' | 'forbidden' };

/** 註冊表與權限都訂閱：feature 安裝／卸載、權限變更時重新判斷。`to` 必須寫完整的字面量（完整性測試靠它）。 */
export function useRouteLinkAccess(to: string, params: RouteLinkParams): RouteLinkAccess {
  const resolve = useRouteLinkResolver();
  const link = resolve({ route: to, params });
  const access = usePageAccess(link ? routeLinkPathname(link) : '');
  if (!link) return { status: 'unavailable' };
  if (!access.gated) return { status: 'ready', link };
  if (!access.hydrated) return { status: 'pending' };
  return access.canAccess ? { status: 'ready', link } : { status: 'forbidden' };
}
