/**
 * apps/auth 的資源依賴圖（機制見 `core/cache/resourceGraph.ts`，寫法同 apps/backstage 的 `apis/resources.ts`）。
 *
 * 寫入後不要手列 query key，改成宣告「後端改了什麼」：
 *
 *   invalidateResources([{ resource: Resource.PROFILE, kind: 'update' }]);
 *
 * 這一版沒有推播：只有本分頁與其他分頁（BroadcastChannel）會失效。
 */
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { PLATFORM_ADMIN_LIST_QUERY_KEY } from '@/apis/platform-admin/get-admin-list/query';
import { FEATURE_FLAG_LIST_QUERY_KEY } from '@/apis/platform-feature-flag/get-feature-flag-list/query';
import { PLATFORM_JOB_LIST_QUERY_KEY } from '@/apis/platform-job/get-job-list/query';
import { PLATFORM_JOB_QUEUES_QUERY_KEY } from '@/apis/platform-job/get-job-queues/query';
import { PLATFORM_JOB_DETAIL_QUERY_KEY } from '@/apis/platform-job/get-job/query';
import { TENANT_LIST_QUERY_KEY } from '@/apis/platform-tenant/get-tenant-list/query';
import { TENANT_DETAIL_QUERY_KEY } from '@/apis/platform-tenant/get-tenant/query';
import { createResourceGraph, queryClient } from '@/core/cache';
import type { ResourceChange } from '@/core/cache';

export const Resource = {
  /** 登入中的平台管理者 */
  PROFILE: 'profile',
  /** 租戶登記（docs/architecture/05-tenancy.md §10.2 D12、D13） */
  TENANT: 'tenant',
  /** 平台管理者（D5） */
  PLATFORM_ADMIN: 'platformAdmin',
  /** 所有租戶與平台的背景工作（重試後佇列計數、列表、詳情都變） */
  PLATFORM_JOB: 'platformJob',
  /** feature flag 的全平台覆寫（docs/architecture/05-tenancy.md §11.2 D8）；租戶層的覆寫會改變列表上的租戶數 */
  FEATURE_FLAG: 'featureFlag',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

export type ResourceChangeEvent = ResourceChange<Resource>;

const graph = createResourceGraph<Resource>({
  [Resource.PROFILE]: {
    collection: [AUTH_PROFILE_QUERY_KEY],
  },
  [Resource.TENANT]: {
    collection: [TENANT_LIST_QUERY_KEY],
    entity: [TENANT_DETAIL_QUERY_KEY],
  },
  [Resource.PLATFORM_ADMIN]: {
    collection: [PLATFORM_ADMIN_LIST_QUERY_KEY],
  },
  [Resource.FEATURE_FLAG]: {
    collection: [FEATURE_FLAG_LIST_QUERY_KEY],
  },
  [Resource.PLATFORM_JOB]: {
    collection: [PLATFORM_JOB_QUEUES_QUERY_KEY, PLATFORM_JOB_LIST_QUERY_KEY],
    entity: [PLATFORM_JOB_DETAIL_QUERY_KEY],
  },
});

/** 依依賴圖換算出要失效的 query，套用到本分頁並廣播給其他分頁。 */
export function invalidateResources(changes: readonly ResourceChangeEvent[]): void {
  queryClient.broadcastInvalidation(graph.resolve(changes));
}
