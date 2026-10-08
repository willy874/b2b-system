import { queryClient } from '@b2b-system/web-core/cache';
import type { InvalidationTarget } from '@b2b-system/web-core/cache';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AUTH_PROFILE_QUERY_KEY } from '@/apis/auth/get-profile/query';
import { PLATFORM_ADMIN_LIST_QUERY_KEY } from '@/apis/platform-admin/get-admin-list/query';
import { PLATFORM_AUDIT_LOG_LIST_QUERY_KEY } from '@/apis/platform-audit-log/get-audit-log-list/query';
import { FEATURE_FLAG_LIST_QUERY_KEY } from '@/apis/platform-feature-flag/get-feature-flag-list/query';
import { PLATFORM_JOB_LIST_QUERY_KEY } from '@/apis/platform-job/get-job-list/query';
import { PLATFORM_JOB_QUEUES_QUERY_KEY } from '@/apis/platform-job/get-job-queues/query';
import { PLATFORM_NOTIFICATION_LIST_QUERY_KEY } from '@/apis/platform-notification/get-notification-list/query';
import { PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY } from '@/apis/platform-notification/get-notification-unread-count/query';
import { TENANT_LIST_QUERY_KEY } from '@/apis/platform-tenant/get-tenant-list/query';
import { TENANT_DETAIL_QUERY_KEY } from '@/apis/platform-tenant/get-tenant/query';
import type { PlatformProfile } from '@/shared/api-sdk';
import type { ResourceChangeWire } from '@/shared/websocket-sdk';

import {
  applyResourceChanges,
  invalidateResources,
  Resource,
  resolveResourceChanges,
  selfUpdated,
} from '../resources';

/** 只看「失效／移除了哪些 key」：`invalidate:KEY`、`remove:KEY/id`。 */
function describeTargets(targets: readonly InvalidationTarget[]): string[] {
  return targets.map((target) => `${target.action}:${target.queryKey.join('/')}`);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('apps/platform 的資源依賴圖（apis/resources.ts）', () => {
  it('租戶更新：清單、詳情、試行開關的租戶數與稽核都失效', () => {
    const targets = describeTargets(
      resolveResourceChanges([{ resource: Resource.TENANT, kind: 'update', id: 't1' }]),
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        `invalidate:${TENANT_LIST_QUERY_KEY}`,
        `invalidate:${TENANT_DETAIL_QUERY_KEY}/t1`,
        `invalidate:${FEATURE_FLAG_LIST_QUERY_KEY}`,
        `invalidate:${PLATFORM_AUDIT_LOG_LIST_QUERY_KEY}`,
      ]),
    );
  });

  it('租戶刪除：詳情移除（不重抓，會 404）', () => {
    const targets = describeTargets(
      resolveResourceChanges([{ resource: Resource.TENANT, kind: 'delete', id: 't1' }]),
    );
    expect(targets).toContain(`remove:${TENANT_DETAIL_QUERY_KEY}/t1`);
    expect(targets).not.toContain(`invalidate:${TENANT_DETAIL_QUERY_KEY}/t1`);
  });

  it('管理者更新：自己的 profile 也重抓（角色可能被換掉）', () => {
    const targets = describeTargets(
      resolveResourceChanges([{ resource: Resource.PLATFORM_ADMIN, kind: 'update', id: 'a1' }]),
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        `invalidate:${PLATFORM_ADMIN_LIST_QUERY_KEY}`,
        `invalidate:${AUTH_PROFILE_QUERY_KEY}`,
      ]),
    );
  });

  it('通知的變更：未讀數與列表失效，不動稽核', () => {
    const targets = describeTargets(
      resolveResourceChanges([{ resource: Resource.PLATFORM_NOTIFICATION, kind: 'update' }]),
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        `invalidate:${PLATFORM_NOTIFICATION_LIST_QUERY_KEY}`,
        `invalidate:${PLATFORM_NOTIFICATION_UNREAD_COUNT_QUERY_KEY}`,
      ]),
    );
    expect(targets).not.toContain(`invalidate:${PLATFORM_AUDIT_LOG_LIST_QUERY_KEY}`);
  });

  it('背景工作的變更：佇列計數與列表都失效', () => {
    const targets = describeTargets(
      resolveResourceChanges([{ resource: Resource.PLATFORM_JOB, kind: 'update' }]),
    );
    expect(targets).toEqual(
      expect.arrayContaining([
        `invalidate:${PLATFORM_JOB_QUEUES_QUERY_KEY}`,
        `invalidate:${PLATFORM_JOB_LIST_QUERY_KEY}`,
      ]),
    );
  });

  it('selfUpdated：自己的 profile 與管理者清單上的那一列', () => {
    const profile = { admin: { id: 'a1' } } as PlatformProfile;
    expect(selfUpdated(profile)).toEqual([
      { resource: Resource.PROFILE, kind: 'update' },
      { resource: Resource.PLATFORM_ADMIN, kind: 'update', id: 'a1' },
    ]);
  });

  it('invalidateResources：換算後套用到本分頁並廣播給其他分頁', () => {
    const broadcast = vi.spyOn(queryClient, 'broadcastInvalidation').mockImplementation(() => {});
    const changes = [{ resource: Resource.TENANT, kind: 'update', id: 't1' }] as const;
    invalidateResources(changes);
    expect(broadcast).toHaveBeenCalledWith(resolveResourceChanges(changes));
  });

  it('applyResourceChanges：只套用平台的來源（租戶的來源略過），只在本分頁並帶上選項', () => {
    const apply = vi.spyOn(queryClient, 'applyInvalidation').mockImplementation(() => {});
    const changes = [
      { resource: 'user', kind: 'update' },
      { resource: Resource.TENANT, kind: 'update', id: 't1' },
    ] as unknown as ResourceChangeWire[];
    applyResourceChanges(changes, { refetch: false });
    expect(apply).toHaveBeenCalledWith(
      resolveResourceChanges([{ resource: Resource.TENANT, kind: 'update', id: 't1' }]),
      { refetch: false },
    );
  });

  it('applyResourceChanges：全部是不認得的來源時什麼都不做', () => {
    const apply = vi.spyOn(queryClient, 'applyInvalidation').mockImplementation(() => {});
    applyResourceChanges([{ resource: 'user', kind: 'update' }] as unknown as ResourceChangeWire[]);
    expect(apply).not.toHaveBeenCalled();
  });
});
