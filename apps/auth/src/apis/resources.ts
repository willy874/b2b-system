/**
 * apps/auth 的資源依賴圖（機制見 `core/cache/resourceGraph.ts`，寫法同 apps/backstage 的 `apis/resources.ts`）。
 *
 * 寫入後不要手列 query key，改成宣告「後端改了什麼」：
 *
 *   invalidateResources([{ resource: Resource.PROFILE, kind: 'update' }]);
 *
 * 這一版沒有推播：只有本分頁與其他分頁（BroadcastChannel）會失效。
 * 租戶管理（交付順序第 4 步）加入時在這裡登記它的資源。
 */
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { createResourceGraph, queryClient } from '@/core/cache';
import type { ResourceChange } from '@/core/cache';

export const Resource = {
  /** 登入中的平台管理者 */
  PROFILE: 'profile',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

export type ResourceChangeEvent = ResourceChange<Resource>;

const graph = createResourceGraph<Resource>({
  [Resource.PROFILE]: {
    collection: [AUTH_PROFILE_QUERY_KEY],
  },
});

/** 依依賴圖換算出要失效的 query，套用到本分頁並廣播給其他分頁。 */
export function invalidateResources(changes: readonly ResourceChangeEvent[]): void {
  queryClient.broadcastInvalidation(graph.resolve(changes));
}
