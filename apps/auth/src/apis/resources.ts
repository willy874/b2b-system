/**
 * apps/auth 的資源依賴圖（機制見 `core/cache/resourceGraph.ts`，寫法同 apps/backstage 的 `apis/resources.ts`）。
 *
 * 寫入後不要手列 query key，改成宣告「後端改了什麼」：
 *
 *   invalidateResources([{ resource: Resource.WORKSPACE, kind: 'update', id: workspace.id }]);
 *
 * 這一版沒有推播：只有本分頁與其他分頁（BroadcastChannel）會失效。
 */
import { USER_LIST_QUERY_KEY } from '@/apis/user/get-user-list/query';
import { WORKSPACE_LIST_QUERY_KEY } from '@/apis/workspace/get-workspace-list/query';
import { createResourceGraph, queryClient } from '@/core/cache';
import type { ResourceChange } from '@/core/cache';

export const Resource = {
  USER: 'user',
  /** 工作區本身（`id` = 工作區 id） */
  WORKSPACE: 'workspace',
  /** 工作區的成員 ↔ 工作區角色（`id` = userId）；這裡沒有成員清單，只作為來源 */
  WORKSPACE_MEMBER: 'workspaceMember',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

export type ResourceChangeEvent = ResourceChange<Resource>;

const graph = createResourceGraph<Resource>({
  [Resource.USER]: {
    // 指定管理員的人選清單
    collection: [USER_LIST_QUERY_KEY],
  },
  [Resource.WORKSPACE]: {
    collection: [WORKSPACE_LIST_QUERY_KEY],
    derivesFrom: [
      // 成員數與管理員清單
      { from: Resource.WORKSPACE_MEMBER, id: 'none' },
    ],
  },
  [Resource.WORKSPACE_MEMBER]: {},
});

/** 依依賴圖換算出要失效的 query，套用到本分頁並廣播給其他分頁。 */
export function invalidateResources(changes: readonly ResourceChangeEvent[]): void {
  queryClient.broadcastInvalidation(graph.resolve(changes));
}
