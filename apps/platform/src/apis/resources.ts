import { createResourceGraph, queryClient } from '@b2b-system/web-core/cache';
import type { ApplyInvalidationOptions, ResourceChange } from '@b2b-system/web-core/cache';

/**
 * apps/platform 的資源依賴圖（機制見 `web-core/cache/resourceGraph.ts`，寫法同 apps/backstage 的 `apis/resources.ts`）。
 *
 * 寫入後不要手列 query key，改成宣告「後端改了什麼」：
 *
 *   invalidateResources([{ resource: Resource.PROFILE, kind: 'update' }]);
 *
 * 平台的推播（docs/architecture/backend/08-realtime.md §3.6）以同樣的形狀送來，`applyResourceChanges` 換算後只在本分頁失效。
 */
import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { PLATFORM_ADMIN_LIST_QUERY_KEY } from '@/apis/platform-admin/get-admin-list/query';
import { PLATFORM_AUDIT_LOG_LIST_QUERY_KEY } from '@/apis/platform-audit-log/get-audit-log-list/query';
import { CDN_OVERVIEW_QUERY_KEY } from '@/apis/platform-cdn/get-cdn-overview/query';
import { FEATURE_FLAG_LIST_QUERY_KEY } from '@/apis/platform-feature-flag/get-feature-flag-list/query';
import { PLATFORM_JOB_LIST_QUERY_KEY } from '@/apis/platform-job/get-job-list/query';
import { PLATFORM_JOB_QUEUES_QUERY_KEY } from '@/apis/platform-job/get-job-queues/query';
import { PLATFORM_JOB_DETAIL_QUERY_KEY } from '@/apis/platform-job/get-job/query';
import { PLATFORM_NOTIFICATION_LIST_QUERY_KEY } from '@/apis/platform-notification/get-notification-list/query';
import { PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY } from '@/apis/platform-notification/get-notification-unread-count/query';
import { TENANT_LIST_QUERY_KEY } from '@/apis/platform-tenant/get-tenant-list/query';
import { TENANT_DETAIL_QUERY_KEY } from '@/apis/platform-tenant/get-tenant/query';
import type { PlatformProfile } from '@/shared/api-sdk';
import { ChangeSource } from '@/shared/websocket-sdk';
import type { ResourceChangeWire } from '@/shared/websocket-sdk';

export const Resource = {
  /** 登入中的平台管理者（只存在前端：換角色、改名都經 `platformAdmin` 衍生） */
  PROFILE: 'profile',
  /** 平台稽核（只存在前端：每次寫入都會新增一筆） */
  PLATFORM_AUDIT_LOG: 'platformAuditLog',
  /** 租戶登記（docs/architecture/05-tenancy.md §10.2 D12、D13） */
  TENANT: ChangeSource.PLATFORM_TENANT,
  /** 平台管理者（D5） */
  PLATFORM_ADMIN: ChangeSource.PLATFORM_ADMIN,
  /** 所有租戶與平台的背景工作（重試後佇列計數、列表、詳情都變） */
  PLATFORM_JOB: ChangeSource.PLATFORM_JOB,
  /** feature flag 的全平台覆寫（docs/architecture/05-tenancy.md §11.2 D8）；租戶層的覆寫會改變列表上的租戶數 */
  FEATURE_FLAG: ChangeSource.PLATFORM_FEATURE_FLAG,
  /** 自己的站內通知（docs/architecture/backend/15-notification.md §6.2） */
  PLATFORM_NOTIFICATION: ChangeSource.PLATFORM_NOTIFICATION,
  /** CDN 的設定、最近一次檢查與最近的清理（只存在前端：伺服器不推播，docs/architecture/backend/09-file.md §16.12） */
  CDN: 'cdn',
} as const;

export type Resource = (typeof Resource)[keyof typeof Resource];

/**
 * 編譯期檢查：伺服器推給平台連線的每個來源都必須是 `Resource` 的成員。後端新增平台的來源而這裡沒跟上時編譯失敗。
 * 租戶的來源不會推到 apps/platform（`applyResourceChanges` 也會略過它們）。
 */
type PlatformChangeSource = Extract<ChangeSource, `platform${string}`>;
type AssertServerSources<T extends Resource> = T;
export type ServerChangeSource = AssertServerSources<PlatformChangeSource>;

export type ResourceChangeEvent = ResourceChange<Resource>;

const RESOURCES: ReadonlySet<string> = new Set(Object.values(Resource));

const graph = createResourceGraph<Resource>({
  [Resource.PROFILE]: {
    collection: [AUTH_PROFILE_QUERY_KEY],
    // 自己的角色被換掉（權限跟著變）或改名：profile 重抓。管理者的變更不多，不比對是不是自己
    derivesFrom: [{ from: Resource.PLATFORM_ADMIN, kinds: ['update'], id: 'none' }],
  },
  [Resource.PLATFORM_AUDIT_LOG]: {
    collection: [PLATFORM_AUDIT_LOG_LIST_QUERY_KEY],
    // 通知的建立與已讀不寫稽核
    derivesFromAnyChange: { except: [Resource.PLATFORM_NOTIFICATION] },
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
    // 列表上「幾個租戶覆寫」來自租戶的 flags
    derivesFrom: [{ from: Resource.TENANT, kinds: ['update', 'delete'], id: 'none' }],
  },
  [Resource.PLATFORM_JOB]: {
    collection: [PLATFORM_JOB_QUEUES_QUERY_KEY, PLATFORM_JOB_LIST_QUERY_KEY],
    entity: [PLATFORM_JOB_DETAIL_QUERY_KEY],
  },
  [Resource.CDN]: {
    collection: [CDN_OVERVIEW_QUERY_KEY],
    // 頁面上「最近的清理」來自 cdn.purge：背景工作重試、或別的分頁看到工作狀態變化時一起重抓
    derivesFrom: [{ from: Resource.PLATFORM_JOB, kinds: ['create', 'update'], id: 'none' }],
  },
  [Resource.PLATFORM_NOTIFICATION]: {
    collection: [
      PLATFORM_NOTIFICATION_LIST_QUERY_KEY,
      PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY,
    ],
  },
});

/** 改了自己的資料：自己的 profile 與管理者清單上的那一列都變了。 */
export function selfUpdated(profile: PlatformProfile): ResourceChangeEvent[] {
  return [
    { resource: Resource.PROFILE, kind: 'update' },
    { resource: Resource.PLATFORM_ADMIN, kind: 'update', id: profile.admin.id },
  ];
}

/** 依依賴圖換算出要失效的 query，套用到本分頁並廣播給其他分頁。 */
export function invalidateResources(changes: readonly ResourceChangeEvent[]): void {
  queryClient.broadcastInvalidation(graph.resolve(changes));
}

/**
 * 推播轉來的變更：只在本分頁套用。其他分頁會經 leader 分頁各自收到，不需要再轉給它們。
 * 背景分頁以 `{ refetch: false }` 只標 stale（docs/architecture/frontend/11-realtime.md §4）。
 */
export function applyResourceChanges(
  changes: readonly ResourceChangeWire[],
  options?: ApplyInvalidationOptions,
): void {
  const known = changes.filter((change) => RESOURCES.has(change.resource));
  // 收斂型別：上一行已經只留下 `Resource` 的成員（平台的來源）
  if (known.length) {
    queryClient.applyInvalidation(graph.resolve(known as ResourceChangeEvent[]), options);
  }
}

/** 供測試檢查換算結果，不觸發任何失效。 */
export function resolveResourceChanges(changes: readonly ResourceChangeEvent[]) {
  return graph.resolve(changes);
}
